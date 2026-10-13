import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { PrintwayClient,redact } from '../src/client.js';
import { operations } from '../src/catalog.js';
import { readFileSync } from 'node:fs';
test('All 23 published methods/paths covered, no undocumented endpoint',()=>{
 const source=JSON.parse(readFileSync('docs/postman-source.json','utf8'));
 const entries:any[]=[];const walk=(items:any[])=>{for(const i of items)i.item?walk(i.item):entries.push(i.request);};walk(source.item);
 assert.equal(operations.length,23);assert.equal(entries.length,23);
 assert.deepEqual(operations.map(o=>o.method+' '+o.path).sort(),entries.map(o=>o.method+' '+o.url.split('?')[0]).sort());
});
test('Exact HTTP method, GET JSON body, query encoding, auth and no token leak',async()=>{
 const seen:any[]=[];
 const mock=http.createServer((req,res)=>{let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{seen.push({method:req.method,url:req.url,auth:req.headers.authorization,body:raw?JSON.parse(raw):{}});res.setHeader('Content-Type','application/json');res.end(JSON.stringify({status:200,result:{ok:true,access_token:'secret'}}));});});
 await new Promise<void>(r=>mock.listen(0,'127.0.0.1',r));
 const client=new PrintwayClient('private-token','http://127.0.0.1:'+(mock.address() as any).port);
 try {for(const op of operations){await client.call(op,op.path==='/webhooks'?{type:'order',...(op.query?{}:{endpoint:'https://example.com',access_key:'x',access_token:'receiver'})}:op.query?{page:2,search:'a & b'}:{probe:'body'});}
  for(let i=0;i<operations.length;i++){assert.equal(seen[i].method,operations[i].method);assert.equal(seen[i].auth,'Bearer private-token');assert.equal(seen[i].url.split('?')[0],operations[i].path);if(operations[i].method==='GET'&&!operations[i].query)assert.equal(seen[i].body.probe,'body');}
  assert.match(seen[17].url,/type=order/);assert.equal(seen[18].body.type,undefined);
  assert.deepEqual(redact({access_token:'secret',result:[{password:'secret',ok:1}],tracking_number:'123'}),{access_token:'[REDACTED]',result:[{password:'[REDACTED]',ok:1}],tracking_number:'123'});
 }finally{mock.closeAllConnections();await new Promise<void>(r=>mock.close(()=>r()));}
});
test('Invalid input fails locally before any request',()=>{
 const schema=(n:string)=>operations.find(o=>o.name==='printway_'+n)!.schema;
 for(const [name,input] of [['get_order',{}],['list_products',{limit:101}],['list_orders',{limit:1}],['list_transactions',{limit:1}],['get_shipping_methods',{}],['pay_order',{}],['create_order',{order_id:'x'}],['update_artwork',{pw_order_id:'PW1',item_id:1,artworks:[{area:'front',artwork_url:'http://example.com'}]}]] as const)assert.equal(schema(name).safeParse(input).success,false);
 assert.equal(schema('list_products').safeParse({limit:100,page:1}).success,true);
 assert.equal(schema('get_order').safeParse({order_name:'my order'}).success,true);
});
test('HTTP errors, non-JSON and timeout do not retry mutating requests',async()=>{
 for(const mode of ['429','nonjson','api-error','timeout']){
 let count=0;const mock=http.createServer((_req,res)=>{count++;if(mode==='timeout')return;if(mode==='429')res.statusCode=429;res.end(mode==='nonjson'?'bad':JSON.stringify({status:mode==='api-error'?400:200,access_token:'private'}));});
 await new Promise<void>(r=>mock.listen(0,'127.0.0.1',r));
 try {const client=new PrintwayClient('secret','http://127.0.0.1:'+(mock.address() as any).port,100);await assert.rejects(client.call(operations.find(o=>o.name==='printway_pay_order')!,{order_id:'PW1'}),e=>!String(e).includes('private'));assert.equal(count,1);}finally{mock.closeAllConnections();await new Promise<void>(r=>mock.close(()=>r()));}
 }
});
