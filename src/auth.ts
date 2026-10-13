import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import type { OAuthServerProvider, AuthorizationParams } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { OAuthClientInformationFull, OAuthTokens, OAuthTokenRevocationRequest } from '@modelcontextprotocol/sdk/shared/auth.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { InvalidGrantError, InvalidTokenError, InvalidScopeError, InvalidClientMetadataError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { PrintwayCredentials } from './client.js';
const random = () => randomBytes(32).toString('base64url');
const esc = (v:string) => v.replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const hash = (s:string) => createHash('sha256').update(s).digest();
export class AuthProvider implements OAuthServerProvider {
 private clients = new Map<string,OAuthClientInformationFull>();
 private pending = new Map<string,{client:OAuthClientInformationFull;params:AuthorizationParams;expires:number}>();
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
 }
 async authorize(client:OAuthClientInformationFull,params:AuthorizationParams,res:Response) {
  this.prune();
  if(this.pending.size>=1000)throw new InvalidGrantError('Authorization capacity reached');
  const scopes=params.scopes?.length?params.scopes:['printway:read','printway:write'];
  if(scopes.some(s => !['printway:read','printway:write',...(this.admin?['printway:admin']:[])].includes(s)))throw new InvalidScopeError('Unsupported scope');
  if(params.resource && params.resource.href!==new URL('/mcp',this.base).href)throw new InvalidGrantError('Invalid resource');
  const nonce=random();this.pending.set(nonce,{client,params:{...params,scopes},expires:Date.now()+300000});
  res.set({'Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",'Referrer-Policy':'no-referrer'}).type('html').send(`<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Kết nối Printway MCP</title><style>body{font:16px system-ui;max-width:520px;margin:60px auto;padding:24px;background:#f5f7fb}form{background:white;padding:28px;border-radius:16px}input,button{box-sizing:border-box;width:100%;padding:12px;margin:10px 0}button{background:#184fce;color:white;border:0;border-radius:8px}</style><form method="post" action="/login"><h1>Printway MCP</h1><p>Cho phép <b>${esc(client.client_name??'MCP client')}</b> truy cập Printway.</p><p>Quyền: ${esc(scopes.join(', '))}</p><input type="hidden" name="nonce" value="${nonce}"><label>Mật khẩu kết nối MCP<input type="password" name="password" required autocomplete="current-password"></label>${this.defaultToken?'':'<label>Printway API v3 token<input type="password" name="printway_token" required autocomplete="off"></label><label>Printway Refresh Token (khuyến nghị)<input type="password" name="printway_refresh_token" autocomplete="off"></label><p>Lấy hai token tại Store → Connect APIs → Generate Token.</p>'}<p>Quyền ghi cho phép tạo/sửa đơn, thanh toán và quản lý webhook theo yêu cầu trong chat.</p><button>Kết nối và cấp quyền</button></form></html>`);
 }
 login = (req:Request,res:Response) => {
  this.prune();const ip=req.ip??'unknown';const attempts=this.attempts.get(ip)??{count:0,until:Date.now()+900000};
  if(attempts.count>=10){res.status(429).send('Too many attempts. Try again later.');return;}
  attempts.count++;this.attempts.set(ip,attempts);
  const nonce=typeof req.body.nonce==='string'?req.body.nonce:'';const p=this.pending.get(nonce);
  const supplied=typeof req.body.password==='string'?req.body.password:'';
  if(!p || p.expires<Date.now() || !timingSafeEqual(hash(supplied),hash(this.password))){res.status(403).send('Invalid or expired login. Restart connection.');return;}
  const pwToken=this.defaultToken||(typeof req.body.printway_token==='string'?req.body.printway_token.trim():'');
  if(!pwToken || /[\r\n]/.test(pwToken)){res.status(400).send('Printway API token required');return;}
  const refreshToken=typeof req.body.printway_refresh_token==='string'?req.body.printway_refresh_token.trim():'';
  if(/[\r\n]/.test(refreshToken)){res.status(400).send('Invalid Printway Refresh Token');return;}
  const credentials=this.defaultToken?this.defaultCredentials:{accessToken:pwToken,refreshToken:refreshToken||undefined};
  if(this.codes.size>=1000){res.status(503).send('Please try again later');return;}
  this.pending.delete(nonce);this.attempts.delete(ip);
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
