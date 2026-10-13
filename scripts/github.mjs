import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
const credential=spawnSync('git',['credential','fill'],{input:'protocol=https\nhost=github.com\n\n',encoding:'utf8',env:{...process.env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'never'}});
if(credential.status!==0){console.error('GitHub credential unavailable; sign in to Git Credential Manager.');process.exit(1);}
const token=credential.stdout.split('\n').find(v=>v.startsWith('password='))?.slice(9).trim();
if(!token){console.error('GitHub credential unavailable');process.exit(1);}
const headers={Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'};
const profile=await fetch('https://api.github.com/user',{headers});if(!profile.ok){console.error('GitHub auth HTTP '+profile.status);process.exit(1);}
const user=await profile.json();console.log('GitHub account: '+user.login);
const name='printway-mcp';const repoUrl='https://api.github.com/repos/'+user.login+'/'+name;
let response=await fetch(repoUrl,{headers});
if(response.status===404){response=await fetch('https://api.github.com/user/repos',{method:'POST',headers,body:JSON.stringify({name,private:true,description:'Printway API v3 MCP server with OAuth and Streamable HTTP',auto_init:false})});}
if(!response.ok){console.error('GitHub repository HTTP '+response.status);process.exit(1);}
let repo=await response.json();
if(process.argv.includes('--public')){const update=await fetch(repoUrl,{method:'PATCH',headers,body:JSON.stringify({private:false})});if(!update.ok){console.error('GitHub visibility update HTTP '+update.status);process.exit(1);}repo=await update.json();}
mkdirSync('.local',{recursive:true});writeFileSync('.local/github.json',JSON.stringify({url:repo.html_url,clone:repo.clone_url,login:user.login,id:user.id,private:repo.private},null,2));
console.log('Repository: '+repo.html_url+'; private='+repo.private);
