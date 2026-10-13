import 'dotenv/config';
import {PrintwayClient,origins} from '../src/client.js';
import {operations} from '../src/catalog.js';
if(!process.env.PRINTWAY_ACCESS_TOKEN){console.error('SKIPPED: configure PRINTWAY_ACCESS_TOKEN in .env to run read-only live tests');process.exit(2);}
const client=new PrintwayClient(process.env.PRINTWAY_ACCESS_TOKEN,origins[process.env.PRINTWAY_ENV==='uat'?'uat':'production']);
let failed=0;
for(const [name,args] of [['list_products',{limit:1,page:1}],['list_orders',{limit:1,page:1}],['get_webhook',{type:'tracking'}],['list_transactions',{limit:1,page:1}]] as const){try{await client.call(operations.find(o=>o.name==='printway_'+name)!,args);console.log('PASS '+name);}catch(e){failed++;console.error('FAIL '+name+': '+(e as Error).message);}}
process.exitCode=failed?1:0;
