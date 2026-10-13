import {randomBytes} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
let env=existsSync('.env')?readFileSync('.env','utf8'):'';
if(!/^MCP_LOGIN_PASSWORD=.+$/m.test(env))env+='\nMCP_LOGIN_PASSWORD='+randomBytes(32).toString('base64url')+'\n';
if(!/^PRINTWAY_ACCESS_TOKEN=/m.test(env))env+='PRINTWAY_ACCESS_TOKEN=\n';
if(!/^PRINTWAY_REFRESH_TOKEN=/m.test(env))env+='PRINTWAY_REFRESH_TOKEN=\n';
writeFileSync('.env',env,{mode:0o600});
mkdirSync('.local',{recursive:true});
console.log('Local .env configured. Credentials remain outside Git.');
