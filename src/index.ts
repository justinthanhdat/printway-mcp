import { createApp } from './server.js';
const port=Number(process.env.PORT??3000);
if(process.env.PRINTWAY_ENV&&!['production','uat'].includes(process.env.PRINTWAY_ENV))throw new Error('Invalid PRINTWAY_ENV');
const {app}=createApp({url:process.env.PUBLIC_URL??process.env.RENDER_EXTERNAL_URL??'http://localhost:'+port,password:process.env.MCP_LOGIN_PASSWORD??'',token:process.env.PRINTWAY_ACCESS_TOKEN,refreshToken:process.env.PRINTWAY_REFRESH_TOKEN,environment:process.env.PRINTWAY_ENV as 'production'|'uat'|undefined,admin:process.env.ENABLE_AUTH_ADMIN==='true'});
const listener=app.listen(port,'0.0.0.0',()=>console.error('Printway MCP listening on port '+port));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{listener.close(()=>process.exit(0));setTimeout(()=>process.exit(0),10000).unref();});
