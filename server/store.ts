import Database from 'better-sqlite3';
import { mkdirSync, existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, randomUUID, createCipheriv, createDecipheriv } from 'node:crypto';
import type { Provider, Prompt, Run, Snapshot, Call } from '../shared/types.js';
import { buildRequest, providerSchema, promptSchema, resolveEndpoint, redactValue } from './core.js';
import { PRESETS } from './presets.js';
export class Store {
 private db: Database.Database;
 private master: Buffer;
 constructor(dir: string) {
  mkdirSync(dir,{recursive:true,mode:0o700});chmodSync(dir,0o700);
  const keyPath=join(dir,'master.key');
  if(!existsSync(keyPath))writeFileSync(keyPath,randomBytes(32),{mode:0o600,flag:'wx'});
  chmodSync(keyPath,0o600);this.master=readFileSync(keyPath);if(this.master.length!==32)throw new Error('本机 master.key 无效');
  this.db=new Database(join(dir,'relay.sqlite'));chmodSync(join(dir,'relay.sqlite'),0o600);this.db.pragma('journal_mode = WAL');
  this.db.exec(`CREATE TABLE IF NOT EXISTS providers(id TEXT PRIMARY KEY, data TEXT NOT NULL, secret TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS prompts(id TEXT PRIMARY KEY, data TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, created_at TEXT NOT NULL, data TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS calls(id TEXT PRIMARY KEY, run_id TEXT NOT NULL, data TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS calls_run ON calls(run_id);`);
  this.recover();
 }
 private encrypt(key:string):string {const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.master,iv);const out=Buffer.concat([cipher.update(key,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),out]).toString('base64');}
 private decrypt(secret:string):string {if(!secret)return '';const b=Buffer.from(secret,'base64'),decipher=createDecipheriv('aes-256-gcm',this.master,b.subarray(0,12));decipher.setAuthTag(b.subarray(12,28));return Buffer.concat([decipher.update(b.subarray(28)),decipher.final()]).toString('utf8');}
 providers():Provider[]{return (this.db.prepare('SELECT data,secret FROM providers ORDER BY rowid').all() as {data:string;secret:string}[]).map(r=>({...JSON.parse(r.data),hasKey:!!r.secret}));}
 getProvider(id:string):Provider {const p=this.providers().find(p=>p.id===id);if(!p)throw new Error('中转站不存在');return p;}
 getKey(id:string):string {const row=this.db.prepare('SELECT secret FROM providers WHERE id=?').get(id) as {secret:string}|undefined;if(!row)throw new Error('中转站不存在');return this.decrypt(row.secret);}
 keys():string[]{return (this.db.prepare('SELECT secret FROM providers').all() as {secret:string}[]).map(r=>this.decrypt(r.secret)).filter(Boolean);}
 safe<T>(value:T):T {return redactValue(value,this.keys());}
 saveProvider(value:unknown):Provider {
  const v=providerSchema.parse(value);resolveEndpoint(v.endpoint,v.protocol);const id=v.id||randomUUID();
  const old=this.db.prepare('SELECT secret FROM providers WHERE id=?').get(id) as {secret:string}|undefined;
  if(v.id&&!old)throw new Error('中转站不存在');
  const secret=v.key?this.encrypt(v.key):(old?.secret||'');
  if(!secret)throw new Error('请输入 API key');
  const data={id,name:v.name,protocol:v.protocol,endpoint:v.endpoint,models:[...new Set(v.models)]};
  this.db.prepare('INSERT INTO providers(id,data,secret) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,secret=excluded.secret').run(id,JSON.stringify(data),secret);
  return {...data,hasKey:true};
 }
 deleteProvider(id:string){this.db.prepare('DELETE FROM providers WHERE id=?').run(id);}
 prompts():Prompt[]{return [...PRESETS,...(this.db.prepare('SELECT data FROM prompts ORDER BY rowid').all() as {data:string}[]).map(r=>JSON.parse(r.data))];}
 savePrompt(value:unknown):Prompt {
  const v=promptSchema.parse(value);if(v.id&&PRESETS.some(p=>p.id===v.id))throw new Error('预制模板请另存为自定义模板');
  const old=v.id?this.prompts().find(p=>p.id===v.id):undefined;if(v.id&&!old)throw new Error('模板不存在');
  const p:Prompt={...v,id:v.id||randomUUID(),builtin:false,version:old?old.version+1:1};
  this.db.prepare('INSERT INTO prompts(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(p.id,JSON.stringify(p));return p;
 }
 deletePrompt(id:string){if(PRESETS.some(p=>p.id===id))throw new Error('不能删除预制模板');this.db.prepare('DELETE FROM prompts WHERE id=?').run(id);}
 createRun(name:string,snapshot:Snapshot,sourceRunId?:string,frozenCalls?:Call[]):Run {
  const run:Run={id:randomUUID(),name,createdAt:new Date().toISOString(),status:'running',snapshot:structuredClone(snapshot),calls:[],sourceRunId};
  for(let round=1;round<=snapshot.settings.repeats;round++)for(let pi=0;pi<snapshot.prompts.length;pi++)for(let ti=0;ti<snapshot.targets.length;ti++){
   const t=snapshot.targets[ti],source=frozenCalls?.find(c=>c.targetIndex===ti&&c.promptIndex===pi&&c.round===round);
   run.calls.push({id:randomUUID(),runId:run.id,targetIndex:ti,promptIndex:pi,round,status:'queued',request:source?structuredClone(source.request):buildRequest(t.protocol,t.model,snapshot.prompts[pi],snapshot.settings),url:source?.url||resolveEndpoint(t.endpoint,t.protocol),output:'',reasoning:'',usage:{},truncated:false});
  }
  this.db.transaction(()=>{this.saveRun(run);for(const c of run.calls)this.saveCall(c);})();return run;
 }
 saveRun(run:Run){const {calls:_,...data}=run;this.db.prepare('INSERT INTO runs(id,created_at,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(run.id,run.createdAt,JSON.stringify(data));}
 saveCall(call:Call){this.db.prepare('INSERT INTO calls(id,run_id,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(call.id,call.runId,JSON.stringify(call));}
 getRun(id:string):Run {
  const row=this.db.prepare('SELECT data FROM runs WHERE id=?').get(id) as {data:string}|undefined;if(!row)throw new Error('运行记录不存在');
  const calls=(this.db.prepare('SELECT data FROM calls WHERE run_id=? ORDER BY rowid').all(id) as {data:string}[]).map(c=>JSON.parse(c.data));return {...JSON.parse(row.data),calls};
 }
 runs():Run[]{return (this.db.prepare('SELECT id FROM runs ORDER BY created_at DESC, rowid DESC').all() as {id:string}[]).map(r=>this.getRun(r.id));}
 importRun(run:Run):Run {
  const next:Run={...structuredClone(run),id:randomUUID(),status:'imported',sourceRunId:run.id};next.calls=next.calls.map(c=>({...c,id:randomUUID(),runId:next.id,status:['queued','running'].includes(c.status)?'interrupted':c.status}));
  this.db.transaction(()=>{this.saveRun(next);for(const c of next.calls)this.saveCall(c);})();return next;
 }
 private recover(){
  for(const r of this.runs()){
   let changed=false;
   if(r.status==='running'){r.status='interrupted';changed=true;}
   for(const c of r.calls)if(c.status==='running'||c.status==='queued'){c.status='interrupted';c.errorCategory='interrupted';c.error='服务重启，调用未自动重试';c.endedAt=new Date().toISOString();this.saveCall(c);changed=true;}
   if(changed)this.saveRun(r);
  }
 }
 close(){if(this.db.open)this.db.close();}
}
