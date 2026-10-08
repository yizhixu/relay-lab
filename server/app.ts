import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z, ZodError } from 'zod';
import type { ServerResponse } from 'node:http';
import { Store } from './store.js';
import { Runner } from './runner.js';
import { promptSchema, resolveEndpoint, summarize, validateSettings, redact } from './core.js';
import { parseImport, exportCSV } from './export.js';
import type { Run, Snapshot } from '../shared/types.js';
const idParam=(p:unknown)=>z.object({id:z.string().min(1).max(100)}).parse(p).id;
export async function buildApp(options:{dataDir:string;serveStatic?:boolean}){
 const store=new Store(options.dataDir),runner=new Runner(store),streams=new Set<ServerResponse>();
 const app=Fastify({logger:false,bodyLimit:32*1024*1024});
 app.addHook('onRequest',async(req,reply)=>{
  const allowed=(s:string)=>{try{return ['127.0.0.1','localhost','[::1]'].includes(new URL(s).hostname);}catch{return false;}};
  if(!allowed('http://'+req.headers.host)||(req.headers.origin&&!allowed(req.headers.origin))||req.headers['sec-fetch-site']==='cross-site')return reply.code(403).send({error:'仅允许本机网页访问'});
  reply.header('X-Content-Type-Options','nosniff');reply.header('Referrer-Policy','no-referrer');if(req.url.startsWith('/api/'))reply.header('Cache-Control','no-store');
 });
 app.setErrorHandler((error,req,reply)=>{const status=error instanceof ZodError?400:(error as any).statusCode||400;const message=error instanceof ZodError?error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('；'):error instanceof Error?error.message:'请求处理失败';reply.code(status).send({error:redact(message,store.keys())});});
 app.get('/api/health',async()=>({ok:true,version:'1.0.0'}));
 app.get('/api/providers',async()=>store.providers());
 app.post('/api/providers',async(req,reply)=>reply.code(201).send(store.saveProvider(req.body)));
 app.put('/api/providers/:id',async(req)=>store.saveProvider({...z.record(z.unknown()).parse(req.body),id:idParam(req.params)}));
 app.delete('/api/providers/:id',async(req)=>{const id=idParam(req.params);if(store.runs().some(r=>runner.active(r.id)&&r.snapshot.targets.some(t=>t.providerId===id)))throw new Error('该中转站有正在运行的实验，请结束后删除');store.deleteProvider(id);return{ok:true};});
 app.post('/api/providers/:id/models',async(req)=>{
  const id=idParam(req.params),p=store.getProvider(id);if(p.protocol!=='openai')throw new Error('Anthropic 协议请手动填写模型 ID');
  const u=new URL(resolveEndpoint(p.endpoint,p.protocol));u.pathname=u.pathname.replace(/\/chat\/completions$/,'/models');
  const response=await fetch(u,{headers:{Authorization:`Bearer ${store.getKey(id)}`},signal:AbortSignal.timeout(15000),redirect:'error'});
  if(!response.ok)throw new Error(`获取模型列表失败：HTTP ${response.status}`);
  const body=await response.json() as any;const models=z.array(z.object({id:z.string().min(1).max(200)})).max(10000).parse(body.data).map(m=>m.id);
  return store.safe({models:[...new Set(models)]});
 });
 app.get('/api/prompts',async()=>store.prompts());
 app.post('/api/prompts',async(req,reply)=>reply.code(201).send(store.savePrompt(req.body)));
 app.put('/api/prompts/:id',async(req)=>store.savePrompt({...z.record(z.unknown()).parse(req.body),id:idParam(req.params)}));
 app.delete('/api/prompts/:id',async(req)=>{store.deletePrompt(idParam(req.params));return{ok:true};});
 const launch=(name:string,snapshot:Snapshot,source?:Run)=>{
  if(!runner.canStart())throw new Error('最多同时运行 3 个实验');
  if(snapshot.targets.length*snapshot.prompts.length*snapshot.settings.repeats>2000)throw new Error('单次实验最多 2000 个调用，请减少模型、模板或轮次');
  const run=store.createRun(name,snapshot,source?.id,source?.calls);try{runner.start(run.id);}catch(e){run.status='interrupted';for(const c of run.calls){c.status='interrupted';store.saveCall(c);}store.saveRun(run);throw e;}return store.safe(store.getRun(run.id));
 };
 app.post('/api/runs',async(req,reply)=>{
  const v=z.object({name:z.string().trim().min(1).max(100),targets:z.array(z.object({providerId:z.string(),model:z.string().trim().min(1).max(200)})).min(1).max(100),promptIds:z.array(z.string()).min(1).max(100),settings:z.unknown()}).parse(req.body);
  const seen=new Set<string>();const targets=v.targets.map(t=>{const p=store.getProvider(t.providerId);const pair=t.providerId+'\0'+t.model;if(seen.has(pair))throw new Error('测试目标重复');seen.add(pair);store.getKey(p.id);return{providerId:p.id,name:p.name,protocol:p.protocol,endpoint:p.endpoint,model:t.model};});
  const prompts=[...new Set(v.promptIds)].map(id=>{const p=store.prompts().find(p=>p.id===id);if(!p)throw new Error('测试模板不存在');return p;});
  return reply.code(201).send(launch(v.name,{version:1,toolVersion:'1.0.0',targets,prompts,settings:validateSettings(v.settings)}));
 });
 app.get('/api/runs',async()=>store.safe(store.runs().map(r=>({id:r.id,name:r.name,createdAt:r.createdAt,status:r.status,sourceRunId:r.sourceRunId,targets:r.snapshot.targets,prompts:r.snapshot.prompts.map(p=>({id:p.id,name:p.name})),summary:summarize(r.calls)}))));
 app.get('/api/runs/:id',async(req)=>store.safe(store.getRun(idParam(req.params))));
 app.post('/api/runs/:id/cancel',async(req)=>{runner.cancel(idParam(req.params));return{ok:true};});
 app.post('/api/runs/:id/replay',async(req,reply)=>{
  const source=store.getRun(idParam(req.params));const body=z.object({bindings:z.record(z.string()),name:z.string().trim().min(1).max(100).optional()}).parse(req.body);
  const snapshot=structuredClone(source.snapshot);snapshot.targets=snapshot.targets.map((t,i)=>{const id=body.bindings[String(i)];if(!id)throw new Error(`请为目标 ${t.name} / ${t.model} 选择凭据`);const p=store.getProvider(id);if(p.protocol!==t.protocol)throw new Error('重跑凭据协议不匹配');store.getKey(id);return{...t,providerId:id};});
  return reply.code(201).send(launch(body.name||source.name.slice(0,90)+' · 重跑',snapshot,source));
 });
 app.get('/api/runs/:id/export',async(req,reply)=>{
  const run=store.safe(store.getRun(idParam(req.params)));const {format}=z.object({format:z.enum(['json','csv']).default('json')}).parse(req.query);
  reply.header('Content-Disposition',`attachment; filename="relay-lab-${run.id}.${format}"`);
  if(format==='csv')return reply.type('text/csv; charset=utf-8').send(exportCSV(run));
  return reply.type('application/json').send({format:'relay-lab',version:1,exportedAt:new Date().toISOString(),run});
 });
 app.post('/api/import',async(req,reply)=>reply.code(201).send(store.safe(store.importRun(parseImport(req.body)))));
 app.get('/api/runs/:id/events',async(req,reply)=>{
  const id=idParam(req.params);const run=store.safe(store.getRun(id));
  reply.hijack();reply.raw.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store','Connection':'keep-alive','X-Accel-Buffering':'no'});streams.add(reply.raw);
  const send=(r:Run)=>{if(!reply.raw.destroyed)reply.raw.write(`event: update\ndata: ${JSON.stringify(r)}\n\n`);};send(run);
  runner.events.on(id,send);const heartbeat=setInterval(()=>{if(!reply.raw.destroyed)reply.raw.write(': heartbeat\n\n');},15000);
  reply.raw.on('close',()=>{clearInterval(heartbeat);runner.events.off(id,send);streams.delete(reply.raw);});
 });
 if(options.serveStatic!==false&&existsSync(resolve('dist/index.html'))){await app.register(fastifyStatic,{root:resolve('dist'),list:false});app.setNotFoundHandler((req,reply)=>req.url.startsWith('/api/')?reply.code(404).send({error:'接口不存在'}):reply.sendFile('index.html'));}
 app.addHook('preClose',async()=>{for(const stream of streams)stream.end();await runner.shutdown();});
 app.addHook('onClose',async()=>store.close());
 return{app,store,runner};
}
