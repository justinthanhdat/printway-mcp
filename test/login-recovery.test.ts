import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AuthProvider} from '../src/auth.js';
const password='a-secure-test-password-32-characters';
const base=new URL('http://localhost:3150');
const params={redirectUri:'http://localhost:3150/callback',codeChallenge:'a'.repeat(43),scopes:['printway:read']};
function response(){return {statusCode:200,html:'',location:'',status(n:number){this.statusCode=n;return this;},set(){return this;},type(){return this;},send(html:string){this.html=html;return this;},redirect(location:string){this.location=location;this.statusCode=302;return this;}};}
async function setup(){const provider=new AuthProvider(base,password,'upstream-token');const client=await provider.clientsStore.registerClient({redirect_uris:[params.redirectUri],token_endpoint_auth_method:'none'});const form=response();await provider.authorize(client,params,form as any);return {provider,client,form,nonce:/name="nonce" value="([^"]+)"/.exec(form.html)![1],state:/name="login_state" value="([^"]+)"/.exec(form.html)![1]};}
test('Incorrect password keeps a retry form; pasted outer whitespace is tolerated',async()=>{
 const {provider,nonce,state}=await setup();const bad=response();provider.login({ip:'test',body:{nonce,login_state:state,password:'bad'}} as any,bad as any);
 assert.equal(bad.statusCode,403);assert.match(bad.html,/MCP_LOGIN_PASSWORD/);assert.match(bad.html,/name="password"/);assert.ok(!bad.html.includes('upstream-token'));
 const good=response();provider.login({ip:'test',body:{nonce,login_state:state,password:' '+password+'\n'}} as any,good as any);assert.equal(good.statusCode,302);
 const replay=response();provider.login({ip:'test',body:{nonce,login_state:state,password}} as any,replay as any);assert.equal(replay.statusCode,403);assert.ok(!replay.location);
});
test('Encrypted login flow survives a server restart without exposing client secret',async()=>{
 const original=new AuthProvider(base,password,'upstream-token');const client=await original.clientsStore.registerClient({redirect_uris:[params.redirectUri],token_endpoint_auth_method:'client_secret_post',client_secret:'confidential-client-secret'});
 const form=response();await original.authorize(client,params,form as any);assert.ok(!form.html.includes('confidential-client-secret'));
 const nonce=/name="nonce" value="([^"]+)"/.exec(form.html)![1],state=/name="login_state" value="([^"]+)"/.exec(form.html)![1];
 const restarted=new AuthProvider(base,password,'upstream-token');const login=response();restarted.login({ip:'test',body:{nonce,login_state:state,password}} as any,login as any);assert.equal(login.statusCode,302);
 const registered=await restarted.clientsStore.getClient(client.client_id);assert.equal(registered?.client_secret,'confidential-client-secret');
 const code=new URL(login.location).searchParams.get('code')!;assert.equal(await restarted.challengeForAuthorizationCode(client,code),params.codeChallenge);
});
test('Expired form offers a safe restart link; tampered or cross-server state is rejected',async()=>{
 const {provider,nonce,state}=await setup();const now=Date.now();const originalNow=Date.now;
 try{
  Date.now=()=>now+16*60*1000;
  const expired=response();provider.login({ip:'test',body:{nonce,login_state:state,password}} as any,expired as any);assert.equal(expired.statusCode,403);assert.match(expired.html,/Mở lại form đăng nhập/);
  const fresh=response();await provider.restartLogin({query:{state}} as any,fresh as any);assert.equal(fresh.statusCode,200);assert.match(fresh.html,/name="password"/);
  Date.now=()=>now+31*60*1000;
  const tooOld=response();await provider.restartLogin({query:{state}} as any,tooOld as any);assert.equal(tooOld.statusCode,403);assert.ok(!tooOld.html.includes('/login/restart?'));
 }finally{Date.now=originalNow;}
 for(const [target,badState] of [[provider,state.slice(0,-5)+'aaaaa'],[new AuthProvider(new URL('http://localhost:3151'),password,'token'),state]] as const){const rejected=response();target.login({ip:'test',body:{nonce,login_state:badState,password}} as any,rejected as any);assert.equal(rejected.statusCode,403);assert.ok(!rejected.location);}
});
