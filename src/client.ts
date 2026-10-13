import http from 'node:http';
import https from 'node:https';
import { operations, type Operation } from './catalog.js';
export type PrintwayCredentials = { accessToken: string; refreshToken?: string };
class PrintwayHttpError extends Error {
 constructor(message: string, public status: number) { super(message); }
}
export const origins = {production:'https://apis.printway.io/v3',uat:'https://uat.printway.work/api/v3'};
export function redact(value: unknown): unknown {
 if (Array.isArray(value)) return value.map(redact);
 if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,/token|password|secret|access_key|authorization/i.test(k) ? '[REDACTED]' : redact(v)]));
 return value;
}
export class PrintwayClient {
 private nextAt = 0;
 private refreshing?: Promise<unknown>;
 readonly credentials: PrintwayCredentials;
 constructor(token: string | PrintwayCredentials, private base = origins.production, private timeout = 30000, refreshToken?: string) {
  this.credentials = typeof token === 'string' ? {accessToken:token,refreshToken} : token;
 }
 get token() { return this.credentials.accessToken; }
 set token(value: string) { this.credentials.accessToken = value; }
 get refreshToken() { return this.credentials.refreshToken; }
 updateCredentials(data: unknown, required = false) {
  const obj = data as Record<string,any>;
  const values = [obj?.result,obj?.data,obj];
  const pair = values.find(v => v && typeof v.access_token === 'string' && v.access_token.trim());
  if (!pair) { if(required)throw new Error('Printway refresh returned no usable access_token'); return; }
  if (/[\r\n]/.test(pair.access_token) || (pair.refresh_token !== undefined && (typeof pair.refresh_token !== 'string' || !pair.refresh_token.trim() || /[\r\n]/.test(pair.refresh_token))))throw new Error('Printway returned invalid credentials');
  this.token = pair.access_token;
  if (typeof pair.refresh_token === 'string')this.credentials.refreshToken = pair.refresh_token;
 }
 async refreshAccessToken(): Promise<unknown> {
  if(this.refreshing)return this.refreshing;
  if(!this.refreshToken)throw new Error('Printway Refresh Token is not configured; reconnect with both tokens');
  const operation=operations.find(o=>o.name==='printway_refresh_access_token')!;
  this.refreshing=(async()=>{
   try {const result=await this.request(operation,{refresh_token:this.refreshToken});this.updateCredentials(result,true);return result;}
   catch {throw new Error('Printway token refresh failed; reconnect with a valid Access Token and Refresh Token');}
  })();
  try {return await this.refreshing;}finally{this.refreshing=undefined;}
 }
 async call(op: Operation, args: Record<string,unknown>): Promise<unknown> {
  // Token administration must never recursively refresh itself.
  const attemptedToken=this.token;
  try {return await this.request(op,args);}catch(error){
   if(!(error instanceof PrintwayHttpError) || error.status!==401 || !this.refreshToken || op.admin)throw error;
   if(this.token===attemptedToken)await this.refreshAccessToken();
   if(!op.read)throw new Error('Printway authorization failed. Token refreshed; operation was not retried. Verify order state before explicitly trying again.');
   return this.request(op,args);
  }
 }
 private async request(op: Operation, args: Record<string,unknown>): Promise<unknown> {
  // Serialize starts at 10 requests/sec, below documented 50 requests / 3 seconds.
  const start = Math.max(Date.now(),this.nextAt); this.nextAt = start + 100;
  await new Promise(r => setTimeout(r,Math.max(0,start-Date.now())));
  const u = new URL(this.base + op.path);
  let payload = {...args};
  if (op.path === '/webhooks') {u.searchParams.set('type',String(payload.type)); delete payload.type;}
  if (op.query) {for (const [k,v] of Object.entries(payload)) u.searchParams.set(k,String(v)); payload = {};}
  const body = Object.keys(payload).length ? JSON.stringify(payload) : undefined;
  return new Promise((resolve,reject) => {
   const req = (u.protocol === 'https:' ? https : http).request(u,{method:op.method,headers:{Accept:'application/json','Content-Type':'application/json',...(this.token?{Authorization:'Bearer '+this.token}:{}),...(body?{'Content-Length':Buffer.byteLength(body)}:{})}},res => {
    const chunks: Buffer[] = []; let size = 0;
    res.on('data',(c:Buffer) => {size+=c.length;if(size>8*1024*1024){req.destroy(new Error('Printway response exceeds 8 MiB'));return;}chunks.push(c);});
    res.on('error',reject);
    res.on('end',() => {
     const raw = Buffer.concat(chunks).toString('utf8'); let data: unknown;
     const status = res.statusCode ?? 500;
     if(status<200 || status>=300) {reject(new PrintwayHttpError('Printway HTTP '+status+(status===429?'; rate limited, retry later':'')+(op.read?'':'; verify current state before retrying'),status));return;}
     try {data=JSON.parse(raw);} catch {reject(new Error('Printway returned a non-JSON response (HTTP '+res.statusCode+')'));return;}
     const obj = data as Record<string,unknown>;
     if(obj && (obj.success===false || (typeof obj.status==='number' && obj.status>=400))) {reject(new PrintwayHttpError('Printway API reported failure; inspect account state before retrying',typeof obj.status==='number'?obj.status:400));return;}
     resolve(data);
    });
   });
   req.setTimeout(this.timeout,() => req.destroy(new Error('Printway timeout'+(op.read?'':'; outcome unknown, verify current state before retrying'))));
   req.on('error',e => reject(new Error(e.message.includes('Printway')?e.message:'Printway connection failed'+(op.read?'':'; outcome unknown, verify current state before retrying'))));
   if(body)req.write(body); req.end();
  });
 }
}
