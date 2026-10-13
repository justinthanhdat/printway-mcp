import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {PrintwayClient, type PrintwayCredentials} from '../src/client.js';
import {operations} from '../src/catalog.js';
const read=operations.find(o=>o.name==='printway_list_products')!;
const write=operations.find(o=>o.name==='printway_pay_order')!;
async function fixture(run:(client:PrintwayClient,seen:any[])=>Promise<void>,refreshResult:unknown={result:{access_token:'new-access',refresh_token:'new-refresh'}},refreshStatus=200) {
 const seen:any[]=[];
 const server=http.createServer((req,res)=>{const url=new URL(req.url!,'http://localhost');seen.push({path:url.pathname,query:url.searchParams.get('refresh_token'),auth:req.headers.authorization});res.setHeader('Content-Type','application/json');
  if(url.pathname==='/auth/refresh-token'){res.statusCode=refreshStatus;res.end(JSON.stringify(refreshResult));}
  else if(req.headers.authorization==='Bearer new-access')res.end(JSON.stringify({status:200,result:[]}));
  else{res.statusCode=401;res.end(JSON.stringify({message:'expired'}));}
 });
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 try{await run(new PrintwayClient('old-access','http://127.0.0.1:'+(server.address() as any).port,1000,'old-refresh'),seen);}finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
}
test('401 refreshes both credentials and retries a read exactly once',async()=>{
 await fixture(async(client,seen)=>{await client.call(read,{limit:1});assert.equal(client.token,'new-access');assert.equal(client.refreshToken,'new-refresh');assert.deepEqual(seen.map(s=>s.path),['/products/list','/auth/refresh-token','/products/list']);assert.equal(seen[1].query,'old-refresh');assert.equal(seen[2].auth,'Bearer new-access');});
});
test('Concurrent unauthorized reads share one refresh request',async()=>{
 await fixture(async(client,seen)=>{await Promise.all(Array.from({length:5},()=>client.call(read,{limit:1})));assert.equal(seen.filter(s=>s.path==='/auth/refresh-token').length,1);});
});
test('Unauthorized writes refresh credentials without replaying payment',async()=>{
 await fixture(async(client,seen)=>{await assert.rejects(client.call(write,{order_id:'PW1'}),/operation was not retried/);assert.equal(seen.filter(s=>s.path==='/order/paid').length,1);assert.equal(client.token,'new-access');});
});
test('Bad refresh, malformed response and missing refresh do not loop or leak secrets',async()=>{
 for(const [data,status] of [[{error:'old-refresh'},401],[{result:{}},200],[{access_token:'new-access',refresh_token:5},200]] as const){await fixture(async(client,seen)=>{await assert.rejects(client.call(read,{}),e=>String(e).includes('token refresh failed')&&!String(e).includes('old-refresh'));assert.equal(seen.length,2);assert.equal(client.token,'old-access');},data,status);}
 await fixture(async(client,seen)=>{client.credentials.refreshToken=undefined;await assert.rejects(client.call(read,{}),/401/);assert.equal(seen.length,1);});
});
test('Rotated credentials share state and preserve old refresh when not returned',()=>{
 const credentials:PrintwayCredentials={accessToken:'old-access',refreshToken:'old-refresh'};
 const a=new PrintwayClient(credentials),b=new PrintwayClient(credentials);
 a.updateCredentials({data:{access_token:'new-access'}});assert.equal(b.token,'new-access');assert.equal(b.refreshToken,'old-refresh');
 a.updateCredentials({access_token:'newest-access',refresh_token:'newest-refresh'});assert.equal(b.refreshToken,'newest-refresh');
});
