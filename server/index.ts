import { resolve } from 'node:path';
import { buildApp } from './app.js';
const {app}=await buildApp({dataDir:resolve(process.env.RELAY_DATA_DIR||'data')});
const port=Number(process.env.RELAY_PORT||3210);
await app.listen({port,host:'127.0.0.1'});
console.log(`Relay Lab ready at http://127.0.0.1:${port}`);
for(const sig of ['SIGINT','SIGTERM'] as const)process.on(sig,()=>{void app.close().then(()=>process.exit(0));});
