import { it, expect } from 'vitest';import { mkdtempSync,rmSync } from 'node:fs';import { tmpdir } from 'node:os';import { join } from 'node:path';
import { buildApp } from '../server/app';import { fixture } from './fixture';import { DEFAULT_SETTINGS } from '../shared/types';
async function context(){const dir=mkdtempSync(join(tmpdir(),'relay-api-'));const ctx=await buildApp({dataDir:dir,serveStatic:false});return {...ctx,close:async()=>{await ctx.app.close();rmSync(dir,{recursive:true,force:true});}};}
async function finished(app:any,id:string){for(let n=0;n<100;n++){const r=(await app.inject({method:'GET',url:'/api/runs/'+id})).json();if(r.status!=='running')return r;await new Promise(r=>setTimeout(r,10));}throw new Error('run timeout');}
it('provides validated CRUD, results, redacted exports, frozen replay and imported key rebinding',async()=>{
 const f=await fixture(),ctx=await context(),{app}=ctx;
 try{
 const p=(await app.inject({method:'POST',url:'/api/providers',payload:{name:'relay',protocol:'openai',endpoint:f.url,models:['good'],key:'secret-fixture'}})).json();expect(p.hasKey).toBe(true);
 const models=(await app.inject({method:'POST',url:'/api/providers/'+p.id+'/models'})).json();expect(models.models).toContain('good');
 const prompt=(await app.inject({method:'GET',url:'/api/prompts'})).json()[0];
 const runResponse=await app.inject({method:'POST',url:'/api/runs',payload:{name:'test',targets:[{providerId:p.id,model:'good'}],promptIds:[prompt.id],settings:{...DEFAULT_SETTINGS,repeats:1}}});expect(runResponse.statusCode).toBe(201);const run=runResponse.json();await finished(app,run.id);
 await app.inject({method:'PUT',url:'/api/providers/'+p.id,payload:{...p,endpoint:'http://127.0.0.1:1',key:''}});
 const replay=await app.inject({method:'POST',url:'/api/runs/'+run.id+'/replay',payload:{bindings:{'0':p.id}}});expect(replay.statusCode).toBe(201);expect((await finished(app,replay.json().id)).calls[0].status).toBe('success');
 const exported=await app.inject({method:'GET',url:'/api/runs/'+run.id+'/export?format=json'});expect(exported.body).not.toContain('secret-fixture');expect(exported.json().format).toBe('relay-lab');
 const imported=await app.inject({method:'POST',url:'/api/import',payload:exported.json()});expect(imported.statusCode).toBe(201);expect(imported.json().status).toBe('imported');
 expect((await app.inject({method:'GET',url:'/api/runs/'+run.id+'/export?format=csv'})).body).toContain('ttft_ms');
 expect((await app.inject({method:'POST',url:'/api/import',payload:{...exported.json<any>(),version:999}})).statusCode).toBe(400);
 const bad=exported.json();bad.run.calls[0].request.model='other';expect((await app.inject({method:'POST',url:'/api/import',payload:bad})).statusCode).toBe(400);
 }finally{await ctx.close();await f.close();}
});
it('rejects cross-origin/DNS-rebinding requests and invalid run configuration',async()=>{
 const ctx=await context();try{
 expect((await ctx.app.inject({method:'GET',url:'/api/providers',headers:{origin:'https://evil.example'}})).statusCode).toBe(403);
 expect((await ctx.app.inject({method:'GET',url:'/api/providers',headers:{host:'evil.example'}})).statusCode).toBe(403);
 expect((await ctx.app.inject({method:'POST',url:'/api/runs',payload:{targets:[],promptIds:[],settings:DEFAULT_SETTINGS}})).statusCode).toBe(400);
 }finally{await ctx.close();}
});

it('never exposes an echoed credential in metadata after provider deletion',async()=>{
 const f=await fixture(),ctx=await context();try{
 const p=(await ctx.app.inject({method:'POST',url:'/api/providers',payload:{name:'relay',protocol:'openai',endpoint:f.url,models:['leak-meta'],key:'secret-fixture'}})).json<any>();
 const r=(await ctx.app.inject({method:'POST',url:'/api/runs',payload:{name:'leak test',targets:[{providerId:p.id,model:'leak-meta'}],promptIds:['model-release-dates'],settings:{...DEFAULT_SETTINGS,repeats:1,stream:false}}})).json<any>();
 await finished(ctx.app,r.id);await ctx.app.inject({method:'DELETE',url:'/api/providers/'+p.id});
 expect((await ctx.app.inject({method:'GET',url:`/api/runs/${r.id}/export?format=json`})).body).not.toContain('secret-fixture');
 }finally{await ctx.close();await f.close();}
});
