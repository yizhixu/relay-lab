import { spawn } from 'node:child_process';
const children=[spawn(process.execPath,['node_modules/tsx/dist/cli.mjs','watch','server/index.ts'],{stdio:'inherit'}),spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1'],{stdio:'inherit'})];
let stopping=false;function stop(code=0){if(stopping)return;stopping=true;for(const c of children)c.kill('SIGTERM');setTimeout(()=>process.exit(code),1000).unref();}
for(const c of children)c.on('exit',code=>stop(code||0));for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>stop());
