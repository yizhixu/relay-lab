import { EventEmitter } from 'node:events';
import type { Store } from './store.js';
import type { Run, Call } from '../shared/types.js';
import { invoke } from './adapter.js';
import { redact, redactValue } from './core.js';
interface Job { run:Run; controller:AbortController; done:Promise<void>; lastEmit:number; stopping:boolean; keys:Map<number,string> }
export class Runner {
 readonly events=new EventEmitter();private jobs=new Map<string,Job>();
 constructor(private store:Store){this.events.setMaxListeners(100);}
 private emit(job:Job,force=false){const now=Date.now();if(force||now-job.lastEmit>=150){job.lastEmit=now;this.events.emit(job.run.id,this.store.safe(redactValue(job.run,[...job.keys.values()])));}}
 start(id:string){
  if(this.jobs.has(id))throw new Error('任务已在运行');if(this.jobs.size>=3)throw new Error('最多同时运行 3 个实验');
  const run=this.store.getRun(id),keys=new Map<number,string>();
  run.snapshot.targets.forEach((t,i)=>{const key=this.store.getKey(t.providerId);if(!key)throw new Error('目标中转站缺少凭据');keys.set(i,key);});
  const job:Job={run,controller:new AbortController(),done:Promise.resolve(),lastEmit:0,stopping:false,keys};this.jobs.set(id,job);
  job.done=this.execute(job).finally(()=>{keys.clear();this.jobs.delete(id);});
 }
 private async execute(job:Job){
  const {run}=job;let cursor=0;
  const worker=async()=>{
   while(cursor<run.calls.length&&!job.controller.signal.aborted){
    const call=run.calls[cursor++],target=run.snapshot.targets[call.targetIndex];call.status='running';call.startedAt=new Date().toISOString();this.store.saveCall(call);this.emit(job,true);
    let lastSave=0;
    const result=await invoke({url:call.url,protocol:target.protocol,key:job.keys.get(call.targetIndex)!,request:call.request,timeoutMs:run.snapshot.settings.timeoutMs,signal:job.controller.signal},delta=>{
     call.output+=delta.output;call.reasoning+=delta.reasoning;
     if(Date.now()-lastSave>150){lastSave=Date.now();const safe=this.store.safe(redactValue(call,[...job.keys.values()]));this.store.saveCall(safe);this.emit(job);}
    });
    Object.assign(call,result,{endedAt:new Date().toISOString()});
    if(job.stopping){call.status='interrupted';call.errorCategory='interrupted';call.error='服务关闭，未自动重试';}
    call.output=redact(call.output,[...job.keys.values()]);call.reasoning=redact(call.reasoning,[...job.keys.values()]);if(call.error)call.error=redact(call.error,[...job.keys.values()]);
    this.store.saveCall(call);this.emit(job,true);
   }
  };
  try{await Promise.all(Array.from({length:Math.min(run.snapshot.settings.concurrency,run.calls.length)},worker));}
  catch(e){run.status='interrupted';for(const c of run.calls)if(c.status==='running'||c.status==='queued'){c.status='interrupted';c.errorCategory='internal';c.error='本机执行异常：'+(e instanceof Error?e.message:String(e));this.store.saveCall(c);}}
  if(run.status==='running')run.status='completed';this.store.saveRun(run);this.emit(job,true);
 }
 cancel(id:string){const job=this.jobs.get(id);if(!job)throw new Error('任务已结束，无法取消');job.run.status='cancelled';job.controller.abort();for(const c of job.run.calls)if(c.status==='queued'){c.status='cancelled';c.errorCategory='cancelled';c.error='尚未执行，用户取消';c.endedAt=new Date().toISOString();this.store.saveCall(c);}this.store.saveRun(job.run);this.emit(job,true);}
 active(id:string){return this.jobs.has(id);}
 canStart(){return this.jobs.size<3;}
 async shutdown(){const jobs=[...this.jobs.values()];for(const j of jobs){j.stopping=true;j.run.status='interrupted';j.controller.abort();for(const c of j.run.calls)if(c.status==='queued'){c.status='interrupted';c.errorCategory='interrupted';c.error='服务关闭，未自动重试';this.store.saveCall(c);}this.store.saveRun(j.run);}await Promise.all(jobs.map(j=>j.done));}
}
