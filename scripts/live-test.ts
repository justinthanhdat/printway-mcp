import 'dotenv/config';
import {PrintwayClient,origins} from '../src/client.js';
import {operations} from '../src/catalog.js';
import {readFileSync,writeFileSync} from 'node:fs';
if(!process.env.PRINTWAY_ACCESS_TOKEN){console.error('SKIPPED: configure PRINTWAY_ACCESS_TOKEN in .env to run read-only live tests');process.exit(2);}
const client=new PrintwayClient(process.env.PRINTWAY_ACCESS_TOKEN,origins[process.env.PRINTWAY_ENV==='uat'?'uat':'production'],30000,process.env.PRINTWAY_REFRESH_TOKEN);
let failed=0;
const dates={created_at_min:'2026-09-13 00:00:00',created_at_max:'2026-10-13 23:59:59'};
for(const [name,args] of [['list_products',{limit:1,page:1}],['list_orders',{limit:1,page:1,...dates}],['get_webhook',{type:'tracking'}],['list_transactions',{limit:1,page:1,...dates}]] as const){try{await client.call(operations.find(o=>o.name==='printway_'+name)!,args);console.log('PASS '+name);}catch(e){failed++;console.error('FAIL '+name+': '+(e as Error).message);}}
process.exitCode=failed?1:0;
// If Printway rotated credentials during a 401 recovery, retain them locally.
if(client.token!==process.env.PRINTWAY_ACCESS_TOKEN || client.refreshToken!==process.env.PRINTWAY_REFRESH_TOKEN){
 let env=readFileSync('.env','utf8');
 for(const [key,value] of [['PRINTWAY_ACCESS_TOKEN',client.token],['PRINTWAY_REFRESH_TOKEN',client.refreshToken]] as const){if(value){const line=key+'='+JSON.stringify(value);const pattern=new RegExp('^'+key+'=.*$','m');env=pattern.test(env)?env.replace(pattern,()=>line):env+'\n'+line+'\n';}}
 writeFileSync('.env',env);console.log('Rotated credentials saved locally; values are not displayed.');
}
