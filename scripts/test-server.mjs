import { spawn } from 'node:child_process';import { mkdtempSync,rmSync } from 'node:fs';import { join } from 'node:path';import { tmpdir } from 'node:os';
const dir=mkdtempSync(join(tmpdir(),'relay-lab-browser-'));
const child=spawn(process.execPath,['scripts/dev.mjs'],{stdio:'inherit',env:{...process.env,RELAY_DATA_DIR:dir,RELAY_PORT:'3211',RELAY_WEB_PORT:'5174'}});
child.on('exit',code=>{rmSync(dir,{recursive:true,force:true});process.exit(code||0);});
for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>child.kill(sig));
