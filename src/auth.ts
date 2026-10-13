import { createHash, randomBytes, timingSafeEqual, createCipheriv, createDecipheriv } from 'node:crypto';
import type { Request, Response } from 'express';
import type { OAuthServerProvider, AuthorizationParams } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { OAuthClientInformationFull, OAuthTokens, OAuthTokenRevocationRequest } from '@modelcontextprotocol/sdk/shared/auth.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { InvalidGrantError, InvalidTokenError, InvalidScopeError, InvalidClientMetadataError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { PrintwayCredentials } from './client.js';
const random = () => randomBytes(32).toString('base64url');
const esc = (v:string) => v.replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const hash = (s:string) => createHash('sha256').update(s).digest();
type LoginFlow = {client:OAuthClientInformationFull;params:AuthorizationParams;expires:number};
export class AuthProvider implements OAuthServerProvider {
 private clients = new Map<string,OAuthClientInformationFull>();
 private pending = new Map<string,LoginFlow>();
 private usedLogins = new Map<string,number>();
 private codes = new Map<string,{clientId:string;params:AuthorizationParams;credentials:PrintwayCredentials;expires:number}>();
 private tokens = new Map<string,AuthInfo>();
 private refresh = new Map<string,{clientId:string;scopes:string[];credentials:PrintwayCredentials;expires:number}>();
 private attempts = new Map<string,{count:number;until:number}>();
 private defaultCredentials: PrintwayCredentials;
 constructor(private base: URL,private password:string,private defaultToken:string,private admin = false,defaultRefreshToken?:string) {
  this.defaultCredentials={accessToken:defaultToken,refreshToken:defaultRefreshToken};
 }
 readonly clientsStore = {
  getClient: async (id:string) => this.clients.get(id),
  registerClient: async (c:Omit<OAuthClientInformationFull,'client_id'|'client_id_issued_at'>):Promise<OAuthClientInformationFull> => {
   this.prune();
   if(this.clients.size>=1000)throw new InvalidClientMetadataError('Client registration capacity reached');
   if(c.redirect_uris.some(s => {try {const u=new URL(s);return !(u.protocol==='https:' || (u.protocol==='http:' && ['localhost','127.0.0.1','[::1]'].includes(u.hostname)));}catch{return true;}})) throw new InvalidClientMetadataError('HTTPS or loopback redirect required');
   const client = {...c,client_id:random(),client_id_issued_at:Math.floor(Date.now()/1000)};
   this.clients.set(client.client_id,client); return client;
  }
 };
 private prune() {
  const now=Date.now();
  for(const [k,v] of this.pending)if(v.expires<now)this.pending.delete(k);
  for(const [k,v] of this.codes)if(v.expires<now)this.codes.delete(k);
  for(const [k,v] of this.tokens)if((v.expiresAt??0)<now/1000)this.tokens.delete(k);
  for(const [k,v] of this.refresh)if(v.expires<now)this.refresh.delete(k);
  for(const [k,v] of this.attempts)if(v.until<now)this.attempts.delete(k);
  for(const [k,until] of this.usedLogins)if(until<Date.now())this.usedLogins.delete(k);
 }
 private sealFlow(nonce:string,flow:LoginFlow) {
  const iv=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',hash('printway-login-v1:'+this.password),iv);
  const data=Buffer.concat([cipher.update(JSON.stringify({nonce,flow,issuer:this.base.href})),cipher.final()]);
  return Buffer.concat([iv,cipher.getAuthTag(),data]).toString('base64url');
 }
 private openFlow(state:string,allowExpired=false):{nonce:string;flow:LoginFlow}|undefined {
  try {
   if(state.length>24000)return;
   const bytes=Buffer.from(state,'base64url');const cipher=createDecipheriv('aes-256-gcm',hash('printway-login-v1:'+this.password),bytes.subarray(0,12));cipher.setAuthTag(bytes.subarray(12,28));
   const data=JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)),cipher.final()]).toString());
   if(data.issuer!==this.base.href || typeof data.flow?.expires!=='number' || data.flow.expires+(allowExpired?900000:0)<Date.now() || this.usedLogins.has(data.nonce))return;
   const flow=data.flow as LoginFlow;
   if(flow.params.resource)flow.params.resource=new URL(String(flow.params.resource));
   if(flow.params.resource && flow.params.resource.href!==new URL('/mcp',this.base).href)return;
   if(flow.params.scopes?.some(s=>!['printway:read','printway:write',...(this.admin?['printway:admin']:[])].includes(s)))return;
   return {nonce:data.nonce,flow};
  }catch{return;}
 }
 private sendPage(res:Response,html:string,status=200) {
  res.status(status).set({'Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",'Referrer-Policy':'no-referrer'}).type('html').send(`<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Kết nối Printway MCP</title><style>body{font:16px system-ui;max-width:520px;margin:60px auto;padding:24px;background:#f5f7fb}form,main{background:white;padding:28px;border-radius:16px}input,button{box-sizing:border-box;width:100%;padding:12px;margin:10px 0}button{background:#184fce;color:white;border:0;border-radius:8px}.error{color:#a42020;background:#fff1f1;padding:12px;border-radius:8px}</style>${html}</html>`);
 }
 private renderLogin(nonce:string,flow:LoginFlow,res:Response,error?:string,status=200) {
  const state=this.sealFlow(nonce,flow);
  this.sendPage(res,`<form method="post" action="/login"><h1>Printway MCP</h1><p>Cho phép <b>${esc(flow.client.client_name??'MCP client')}</b> truy cập Printway.</p><p>Quyền: ${esc((flow.params.scopes??[]).join(', '))}</p>${error?`<p class="error" role="alert">${esc(error)}</p>`:''}<input type="hidden" name="nonce" value="${nonce}"><input type="hidden" name="login_state" value="${state}"><label>Mật khẩu kết nối MCP<input type="password" name="password" required autocomplete="current-password" autofocus></label><p>Nhập giá trị <code>MCP_LOGIN_PASSWORD</code> trong file <code>.env</code> của dự án. Form có hiệu lực 15 phút.</p>${this.defaultToken?'':'<label>Printway Access Token<input type="password" name="printway_token" required autocomplete="off"></label><label>Printway Refresh Token (khuyến nghị)<input type="password" name="printway_refresh_token" autocomplete="off"></label><p>Lấy hai token tại Store → Connect APIs → Generate Token.</p>'}<p>Quyền ghi cho phép tạo/sửa đơn, thanh toán và quản lý webhook theo yêu cầu trong chat.</p><button>Kết nối và cấp quyền</button></form>`,status);
 }
 private expiredPage(res:Response,state?:string) {
  const canRestart=state&&this.openFlow(state,true);
  this.sendPage(res,`<main><h1>Phiên kết nối đã hết hạn</h1><p>${canRestart?'Bạn có thể mở lại form rồi nhập mật khẩu kết nối MCP.':'Hãy quay lại ChatGPT và chọn kết nối Printway để mở một phiên đăng nhập mới.'}</p>${canRestart?`<a href="/login/restart?state=${encodeURIComponent(state!)}">Mở lại form đăng nhập</a>`:''}</main>`,403);
 }
 restartLogin = async (req:Request,res:Response) => {
  const state=typeof req.query.state==='string'?req.query.state:'';
  const restored=this.openFlow(state,true);
  if(!restored){this.expiredPage(res);return;}
  this.clients.set(restored.flow.client.client_id,restored.flow.client);
  await this.authorize(restored.flow.client,restored.flow.params,res);
 };
 loginHelp = (_req:Request,res:Response) => this.sendPage(res,'<main><h1>Kết nối Printway MCP</h1><p>Hãy bắt đầu kết nối từ ChatGPT bằng endpoint <code>https://printway-mcp.onrender.com/mcp</code> và xác thực OAuth.</p><p>Khi form xuất hiện, nhập giá trị <code>MCP_LOGIN_PASSWORD</code> trong file <code>.env</code> của dự án.</p></main>');
 async authorize(client:OAuthClientInformationFull,params:AuthorizationParams,res:Response) {
  this.prune();
  if(this.pending.size>=1000)throw new InvalidGrantError('Authorization capacity reached');
  const scopes=params.scopes?.length?params.scopes:['printway:read','printway:write'];
  if(scopes.some(s => !['printway:read','printway:write',...(this.admin?['printway:admin']:[])].includes(s)))throw new InvalidScopeError('Unsupported scope');
  if(params.resource && params.resource.href!==new URL('/mcp',this.base).href)throw new InvalidGrantError('Invalid resource');
  const nonce=random();const flow={client,params:{...params,scopes},expires:Date.now()+900000};
  this.pending.set(nonce,flow);
  this.renderLogin(nonce,flow,res);
 }
 login = (req:Request,res:Response) => {
  this.prune();const ip=req.ip??'unknown';const attempts=this.attempts.get(ip)??{count:0,until:Date.now()+900000};
  if(attempts.count>=10){res.status(429).send('Too many attempts. Try again later.');return;}
  attempts.count++;this.attempts.set(ip,attempts);
  const nonce=typeof req.body.nonce==='string'?req.body.nonce:'';
  const state=typeof req.body.login_state==='string'?req.body.login_state:'';
  if(this.usedLogins.has(nonce)){this.expiredPage(res);return;}
  let p=this.pending.get(nonce);
  if(!p && state){const restored=this.openFlow(state);if(restored&&restored.nonce===nonce){p=restored.flow;this.pending.set(nonce,p);this.clients.set(p.client.client_id,p.client);}}
  if(!p || p.expires<Date.now()){this.expiredPage(res,state);return;}
  const supplied=typeof req.body.password==='string'?req.body.password:'';
  if(!timingSafeEqual(hash(supplied.trim()),hash(this.password))){this.renderLogin(nonce,p,res,'Mật khẩu kết nối MCP chưa đúng. Hãy sao chép giá trị MCP_LOGIN_PASSWORD trong file .env rồi nhập lại.',403);return;}
  const pwToken=this.defaultToken||(typeof req.body.printway_token==='string'?req.body.printway_token.trim():'');
  if(!pwToken || /[\r\n]/.test(pwToken)){res.status(400).send('Printway API token required');return;}
  const refreshToken=typeof req.body.printway_refresh_token==='string'?req.body.printway_refresh_token.trim():'';
  if(/[\r\n]/.test(refreshToken)){res.status(400).send('Invalid Printway Refresh Token');return;}
  const credentials=this.defaultToken?this.defaultCredentials:{accessToken:pwToken,refreshToken:refreshToken||undefined};
  if(this.codes.size>=1000){res.status(503).send('Please try again later');return;}
  this.pending.delete(nonce);this.attempts.delete(ip);
  this.usedLogins.set(nonce,Date.now()+1800000);
  const code=random();this.codes.set(code,{clientId:p.client.client_id,params:p.params,credentials,expires:Date.now()+60000});
  const dest=new URL(p.params.redirectUri);dest.searchParams.set('code',code);if(p.params.state)dest.searchParams.set('state',p.params.state);
  res.set('Cache-Control','no-store').redirect(dest.href);
 };
 private code(client:OAuthClientInformationFull,code:string) {
  const c=this.codes.get(code);if(!c||c.expires<Date.now()||c.clientId!==client.client_id)throw new InvalidGrantError('Invalid authorization code');return c;
 }
 async challengeForAuthorizationCode(client:OAuthClientInformationFull,code:string){return this.code(client,code).params.codeChallenge;}
 async exchangeAuthorizationCode(client:OAuthClientInformationFull,code:string,_verifier?:string,redirect?:string,resource?:URL):Promise<OAuthTokens> {
  const c=this.code(client,code);
  if(redirect!==c.params.redirectUri || (resource && resource.href!==new URL('/mcp',this.base).href))throw new InvalidGrantError('Invalid redirect or resource');
  this.codes.delete(code);return this.issue(client.client_id,c.params.scopes??[],c.credentials);
 }
 private issue(clientId:string,scopes:string[],credentials:PrintwayCredentials):OAuthTokens {
  this.prune();if(this.tokens.size>=2000||this.refresh.size>=2000)throw new InvalidGrantError('Token capacity reached');
  const access=random(),refresh=random();this.tokens.set(access,{token:access,clientId,scopes,expiresAt:Math.floor(Date.now()/1000)+3600,resource:new URL('/mcp',this.base),extra:{printwayCredentials:credentials}});
  this.refresh.set(refresh,{clientId,scopes,credentials,expires:Date.now()+86400000});
  return {access_token:access,token_type:'Bearer',expires_in:3600,refresh_token:refresh,scope:scopes.join(' ')};
 }
 async exchangeRefreshToken(client:OAuthClientInformationFull,token:string,scopes?:string[],resource?:URL) {
  const r=this.refresh.get(token);if(!r||r.expires<Date.now()||r.clientId!==client.client_id)throw new InvalidGrantError('Invalid refresh token');
  if(resource && resource.href!==new URL('/mcp',this.base).href)throw new InvalidGrantError('Invalid resource');
  if(scopes?.some(s => !r.scopes.includes(s)))throw new InvalidScopeError('Scope cannot expand');
  this.refresh.delete(token);return this.issue(r.clientId,scopes??r.scopes,r.credentials);
 }
 async verifyAccessToken(token:string) {const info=this.tokens.get(token);if(!info||!info.expiresAt||info.expiresAt<Date.now()/1000)throw new InvalidTokenError('Invalid or expired token');return info;}
 async revokeToken(client:OAuthClientInformationFull,request:OAuthTokenRevocationRequest) {
  if(this.tokens.get(request.token)?.clientId===client.client_id)this.tokens.delete(request.token);
  if(this.refresh.get(request.token)?.clientId===client.client_id)this.refresh.delete(request.token);
 }
}
