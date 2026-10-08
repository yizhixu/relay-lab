import { it,expect,vi } from 'vitest';import { mkdtempSync,rmSync } from 'node:fs';import { tmpdir } from 'node:os';import { join } from 'node:path';
import { buildApp } from '../server/app';import { fixture } from './fixture';import { api,post } from '../src/api';
it('sends bodyless browser operations without an invalid JSON content type',async()=>{
 const f=await fixture(),dir=mkdtempSync(join(tmpdir(),'relay-client-')),ctx=await buildApp({dataDir:dir,serveStatic:false});const base=await ctx.app.listen({port:0,host:'127.0.0.1'});const original=globalThis.fetch;
 vi.stubGlobal('fetch',(url:any,options:any)=>original(new URL(String(url),base),options));
 try{
 const p=await post<any>('/providers',{name:'relay',protocol:'openai',endpoint:f.url,models:['good'],key:'secret-fixture'});
 expect((await post<any>('/providers/'+p.id+'/models')).models).toContain('good');
 expect(await api('/providers/'+p.id,{method:'DELETE'})).toEqual({ok:true});
 }finally{vi.unstubAllGlobals();await ctx.app.close();rmSync(dir,{recursive:true,force:true});await f.close();}
});
