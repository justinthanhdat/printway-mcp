import 'dotenv/config';
import {createHash,randomBytes} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
const base=process.argv[2]??'https://printway-mcp.onrender.com';
const password=process.env.MCP_LOGIN_PASSWORD;
if(!password)throw new Error('MCP_LOGIN_PASSWORD required in local .env');
const checks=[];
function check(name,condition){checks.push({name,passed:!!condition});if(!condition)throw new Error('Remote check failed: '+name);console.log('PASS '+name);}
const request=(path,options={})=>fetch(base+path,{...options,signal:AbortSignal.timeout(45000)});
const post=(path,body)=>request(path,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body),redirect:'manual'});
const healthResponse=await request('/healthz');check('health HTTP 200',healthResponse.status===200);const health=await healthResponse.json();check('19 business tools enabled',health.tools===19);
const unauth=await request('/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});check('anonymous MCP refused',unauth.status===401);
const metadata=await (await request('/.well-known/oauth-authorization-server')).json();check('OAuth issuer matches HTTPS deployment',metadata.issuer===base||metadata.issuer===base+'/');
const resource=await (await request('/.well-known/oauth-protected-resource/mcp')).json();check('protected resource points to MCP endpoint',resource.resource===base+'/mcp');
const redirect='http://localhost:3140/callback';
const reg=await request('/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_name:'Deployment verification',redirect_uris:[redirect],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']})});check('dynamic client registration',reg.status===201);const client=await reg.json();
const verifier=randomBytes(48).toString('base64url');const challenge=createHash('sha256').update(verifier).digest('base64url');
const consent=await request('/authorize?'+new URLSearchParams({client_id:client.client_id,response_type:'code',redirect_uri:redirect,code_challenge:challenge,code_challenge_method:'S256',scope:'printway:read',resource:base+'/mcp'}));check('browser consent',consent.status===200);const html=await consent.text();const nonce=/name="nonce" value="([^"]+)"/.exec(html)?.[1];check('consent nonce',!!nonce);
// A placeholder upstream token verifies MCP auth only; no Printway call is made.
const login=await post('/login',{nonce,password,printway_token:'integration-test-placeholder-not-a-real-token'});check('OAuth login',login.status===302);const code=new URL(login.headers.get('location')).searchParams.get('code');
const tokenResponse=await post('/token',{grant_type:'authorization_code',client_id:client.client_id,code,code_verifier:verifier,redirect_uri:redirect,resource:base+'/mcp'});check('PKCE exchange',tokenResponse.status===200);const tokens=await tokenResponse.json();
const rpc=async(method,params,id)=>{const response=await request('/mcp',{method:'POST',headers:{Authorization:'Bearer '+tokens.access_token,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id,method,params})});check(method+' HTTP 200',response.status===200);return response.json();};
const initialized=await rpc('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'remote-smoke',version:'1'}},1);check('MCP initialize',initialized.result?.serverInfo?.name==='printway-mcp');
const listing=await rpc('tools/list',{},2);check('MCP tool discovery',listing.result?.tools?.length===19);
const denied=await rpc('tools/call',{name:'printway_pay_order',arguments:{order_id:'TEST-NOT-A-REAL-ORDER'}},3);check('read-only token cannot pay',denied.result?.isError===true);
await post('/revoke',{client_id:client.client_id,token:tokens.access_token});await post('/revoke',{client_id:client.client_id,token:tokens.refresh_token});
mkdirSync('.local',{recursive:true});writeFileSync('.local/remote-smoke.json',JSON.stringify({timestamp:new Date().toISOString(),base,health,checks,livePrintwayCalls:false},null,2));
