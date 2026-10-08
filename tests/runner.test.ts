import { it, expect } from 'vitest';
import { mkdtempSync,rmSync } from 'node:fs';import { tmpdir } from 'node:os';import { join } from 'node:path';
import { Store } from '../server/store';import { Runner } from '../server/runner';import { fixture } from './fixture';import { DEFAULT_SETTINGS, type Snapshot } from '../shared/types';
export async function waitFor(done:()=>boolean){const start=Date.now();while(!done()){if(Date.now()-start>5000)throw new Error('condition timeout');await new Promise(r=>setTimeout(r,10));}}
it('runs frozen matrices at the configured concurrency, preserves errors and never retries',async()=>{
 const f=await fixture(),dir=mkdtempSync(join(tmpdir(),'relay-runner-')),s=new Store(dir),runner=new Runner(s);
 try{const p=s.saveProvider({name:'r',protocol:'openai',endpoint:f.url,models:['good','fail'],key:'secret-fixture'});
 const snapshot:Snapshot={version:1,toolVersion:'1.0.0',targets:[{providerId:p.id,name:p.name,protocol:p.protocol,endpoint:p.endpoint,model:'good'},{providerId:p.id,name:p.name,protocol:p.protocol,endpoint:p.endpoint,model:'fail'}],prompts:[s.prompts()[0]],settings:{...DEFAULT_SETTINGS,repeats:2}};
 const r=s.createRun('batch',snapshot);runner.start(r.id);await waitFor(()=>s.getRun(r.id).status==='completed');const finished=s.getRun(r.id);
 expect(finished.calls.map(c=>c.status)).toEqual(['success','failed','success','failed']);expect(f.count).toBe(4);expect(f.peak).toBe(1);expect(JSON.stringify(finished)).not.toContain('secret-fixture');
 }finally{await runner.shutdown();s.close();rmSync(dir,{recursive:true,force:true});await f.close();}
});
it('cancels active and queued calls without counting them as failures',async()=>{
 const f=await fixture(),dir=mkdtempSync(join(tmpdir(),'relay-cancel-')),s=new Store(dir),runner=new Runner(s);
 try{const p=s.saveProvider({name:'r',protocol:'openai',endpoint:f.url,models:['timeout'],key:'secret-fixture'});const snapshot:Snapshot={version:1,toolVersion:'1.0.0',targets:[{providerId:p.id,name:p.name,protocol:p.protocol,endpoint:p.endpoint,model:'timeout'}],prompts:[s.prompts()[0]],settings:DEFAULT_SETTINGS};
 const r=s.createRun('cancel',snapshot);runner.start(r.id);await waitFor(()=>f.count===1);runner.cancel(r.id);await waitFor(()=>s.getRun(r.id).calls.every(c=>c.status==='cancelled'));expect(s.getRun(r.id).status).toBe('cancelled');expect(f.count).toBe(1);
 }finally{await runner.shutdown();s.close();rmSync(dir,{recursive:true,force:true});await f.close();}
});

it('redacts progress with the captured key when provider credentials rotate during a call',async()=>{
 const f=await fixture(),dir=mkdtempSync(join(tmpdir(),'relay-rotate-')),s=new Store(dir),runner=new Runner(s);
 try{
 const p=s.saveProvider({name:'r',protocol:'openai',endpoint:f.url,models:['rotate-stream'],key:'secret-fixture'});
 const r=s.createRun('rotation',{version:1,toolVersion:'1.0.0',targets:[{providerId:p.id,name:p.name,protocol:p.protocol,endpoint:p.endpoint,model:'rotate-stream'}],prompts:[s.prompts()[0]],settings:{...DEFAULT_SETTINGS,repeats:1}});
 const events:any[]=[];runner.events.on(r.id,e=>events.push(e));runner.start(r.id);await waitFor(()=>f.count===1);s.saveProvider({...p,key:'new-fixture-key'});
 await waitFor(()=>s.getRun(r.id).calls[0].output.length>5);
 expect(JSON.stringify(s.getRun(r.id))).not.toContain('secret-fixture');expect(JSON.stringify(events)).not.toContain('secret-fixture');
 await waitFor(()=>s.getRun(r.id).status==='completed');expect(s.getRun(r.id).calls[0].output).toContain('[REDACTED]');
 }finally{await runner.shutdown();s.close();rmSync(dir,{recursive:true,force:true});await f.close();}
});
