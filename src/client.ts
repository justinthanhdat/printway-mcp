import http from 'node:http';
import https from 'node:https';
import type { Operation } from './catalog.js';
export const origins = {production:'https://apis.printway.io/v3',uat:'https://uat.printway.work/api/v3'};
export function redact(value: unknown): unknown {
 if (Array.isArray(value)) return value.map(redact);
 if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,/token|password|secret|access_key|authorization/i.test(k) ? '[REDACTED]' : redact(v)]));
 return value;
}
export class PrintwayClient {
 private nextAt = 0;
 constructor(public token: string, private base = origins.production, private timeout = 30000) {}
 async call(op: Operation, args: Record<string,unknown>): Promise<unknown> {
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
     try {data=JSON.parse(raw);} catch {reject(new Error('Printway returned a non-JSON response (HTTP '+res.statusCode+')'));return;}
     const status = res.statusCode ?? 500;
     if(status<200 || status>=300) {reject(new Error('Printway HTTP '+status+(status===429?'; rate limited, retry later':'')+(op.read?'':'; verify current state before retrying')));return;}
     const obj = data as Record<string,unknown>;
     if(obj && (obj.success===false || (typeof obj.status==='number' && obj.status>=400))) {reject(new Error('Printway API reported failure; inspect account state before retrying'));return;}
     resolve(data);
    });
   });
   req.setTimeout(this.timeout,() => req.destroy(new Error('Printway timeout'+(op.read?'':'; outcome unknown, verify current state before retrying'))));
   req.on('error',e => reject(new Error(e.message.includes('Printway')?e.message:'Printway connection failed'+(op.read?'':'; outcome unknown, verify current state before retrying'))));
   if(body)req.write(body); req.end();
  });
 }
}
