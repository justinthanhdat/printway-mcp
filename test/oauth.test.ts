import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createApp,createMcpServer} from '../src/server.js';
import {PrintwayClient} from '../src/client.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
const password='test-password-with-32-characters';
test('OAuth discovery, consent, PKCE, code replay, resource, refresh rotation, MCP discovery',async()=>{
 const {app}=createApp({url:'http://localhost:3129',password,token:'private-printway-token'});
 const listener=app.listen(3129);await new Promise<void>(r=>listener.once('listening',r));
 const base='http://localhost:3129';
 const post=(path:string,body:Record<string,string>)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body),redirect:'manual'});
 try{
  const noauth=await fetch(base+'/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(noauth.status,401);assert.match(noauth.headers.get('www-authenticate')!,/resource_metadata/);
  const discovery=await (await fetch(base+'/.well-known/oauth-authorization-server')).json();assert.match(discovery.authorization_endpoint,/authorize/);assert.deepEqual(discovery.code_challenge_methods_supported,['S256']);
  const resource=await (await fetch(base+'/.well-known/oauth-protected-resource/mcp')).json();assert.equal(resource.resource,base+'/mcp');
  const reg=await fetch(base+'/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_name:'Test <script>',redirect_uris:[base+'/callback'],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']})});assert.equal(reg.status,201);const client=await reg.json();
  const verifier='a'.repeat(64);const challenge=createHash('sha256').update(verifier).digest('base64url');
  const auth=await fetch(base+'/authorize?'+new URLSearchParams({client_id:client.client_id,redirect_uri:base+'/callback',response_type:'code',scope:'printway:read',code_challenge:challenge,code_challenge_method:'S256',state:'test-state',resource:base+'/mcp'}));
  const html=await auth.text();assert.equal(auth.status,200);assert.ok(!html.includes('<script>'));assert.ok(!html.includes('private-printway-token'));
  const nonce=/name="nonce" value="([^"]+)"/.exec(html)![1];
  assert.equal((await post('/login',{nonce,password:'bad'})).status,403);
  const login=await post('/login',{nonce,password});assert.equal(login.status,302);const callback=new URL(login.headers.get('location')!);assert.equal(callback.searchParams.get('state'),'test-state');
  assert.equal((await post('/login',{nonce,password})).status,403);
  const exchange={grant_type:'authorization_code',client_id:client.client_id,code:callback.searchParams.get('code')!,redirect_uri:base+'/callback',code_verifier:verifier,resource:base+'/mcp'};
  assert.equal((await post('/token',{...exchange,code_verifier:'wrong'.repeat(16)})).status,400);
  assert.equal((await post('/token',{...exchange,resource:'https://attacker.example/mcp'})).status,400);
  const tokenResponse=await post('/token',exchange);assert.equal(tokenResponse.status,200);const tokens=await tokenResponse.json();assert.ok(tokens.access_token);assert.ok(!JSON.stringify(tokens).includes('private-printway-token'));
  assert.equal((await post('/token',exchange)).status,400);
  const rpc=await fetch(base+'/mcp',{method:'POST',headers:{Authorization:'Bearer '+tokens.access_token,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'test',version:'1'}}})});assert.equal(rpc.status,200);assert.equal((await rpc.json()).result.serverInfo.name,'printway-mcp');
  const list=await fetch(base+'/mcp',{method:'POST',headers:{Authorization:'Bearer '+tokens.access_token,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/list',params:{}})});const tools=(await list.json()).result.tools;assert.equal(tools.length,19);assert.equal(tools.find((t:any)=>t.name==='printway_pay_order').annotations.destructiveHint,true);
  const refresh={grant_type:'refresh_token',client_id:client.client_id,refresh_token:tokens.refresh_token};
  assert.equal((await post('/token',{...refresh,scope:'printway:write'})).status,400);
  assert.equal((await post('/token',refresh)).status,200);assert.equal((await post('/token',refresh)).status,400);
  assert.equal((await post('/revoke',{client_id:client.client_id,token:tokens.access_token})).status,200);
  const revoked=await fetch(base+'/mcp',{method:'POST',headers:{Authorization:'Bearer '+tokens.access_token,'Content-Type':'application/json'},body:'{}'});assert.equal(revoked.status,401);
 }finally{listener.closeAllConnections();await new Promise<void>(r=>listener.close(()=>r()));}
});
test('MCP tool invocation enforces read/write scopes and can return upstream data',async()=>{
 const calls:any[]=[];const upstream=new PrintwayClient('token');upstream.call=async (op,args)=>{calls.push({op,args});return {status:200,result:{product:'test',access_token:'secret'}};};
 const server=createMcpServer({token:'local',clientId:'test',scopes:['printway:read']},upstream,true);
 const client=new Client({name:'test',version:'1'});const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);
 try{assert.equal((await client.listTools()).tools.length,23);
 const denied=await client.callTool({name:'printway_pay_order',arguments:{order_id:'PW1'}});assert.equal(denied.isError,true);assert.equal(calls.length,0);
 const ok=await client.callTool({name:'printway_get_product',arguments:{code:'SPF'}});assert.equal(ok.isError,undefined);assert.equal(calls.length,1);assert.ok(!JSON.stringify(ok).includes('secret'));
 const invalid=await client.callTool({name:'printway_list_products',arguments:{limit:101}});assert.equal(invalid.isError,true);assert.equal(calls.length,1);
 }finally{await client.close();await server.close();}
});
