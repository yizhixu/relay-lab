import { Agent, fetch as upstreamFetch } from 'undici';
import type { Protocol, Usage } from '../shared/types.js';
import { redact, redactValue } from './core.js';
export interface Invocation { url:string; protocol:Protocol; key:string; request:Record<string,unknown>; timeoutMs:number|null; signal:AbortSignal }
export interface InvocationResult { status:'success'|'failed'|'cancelled'; output:string; reasoning:string; usage:Usage; durationMs:number; ttftMs?:number; httpStatus?:number; returnedModel?:string; finishReason?:string; truncated:boolean; errorCategory?:string; error?:string }
class InvokeError extends Error { constructor(public category:string,message:string){super(message);} }
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
export async function invoke(task:Invocation,onDelta?:(value:{output:string;reasoning:string})=>void):Promise<InvocationResult>{
 const start=performance.now(),controller=new AbortController();let timedOut=false;
 const dispatcher=new Agent({headersTimeout:0,bodyTimeout:0,connect:{timeout:0,signal:controller.signal}});
 const abort=()=>controller.abort();task.signal.addEventListener('abort',abort,{once:true});if(task.signal.aborted)abort();
 const timer=task.timeoutMs===null?undefined:setTimeout(()=>{timedOut=true;controller.abort();},task.timeoutMs);
 const r:InvocationResult={status:'failed',output:'',reasoning:'',usage:{},durationMs:0,truncated:false};
 let done=false;
 const append=(text:unknown,reasoning=false)=>{if(typeof text!=='string'||!text)return;if(!reasoning&&r.ttftMs===undefined&&task.request.stream)r.ttftMs=performance.now()-start;if(reasoning)r.reasoning+=text;else r.output+=text;onDelta?.({output:reasoning?'':text,reasoning:reasoning?text:''});};
 const usage=(v:any)=>{if(!v)return;const input=task.protocol==='openai'?v.prompt_tokens:v.input_tokens,output=task.protocol==='openai'?v.completion_tokens:v.output_tokens;if(finite(input))r.usage.input=input;if(finite(output))r.usage.output=output;};
 const event=(v:any)=>{
  if(!v||typeof v!=='object')throw new InvokeError('protocol','响应事件不是 JSON 对象');
  if(v.error||v.type==='error')throw new InvokeError('protocol',String(v.error?.message||v.error?.type||'流式接口返回错误'));
  if(task.protocol==='openai'){
   if(typeof v.model==='string')r.returnedModel=v.model;usage(v.usage);const c=v.choices?.[0];
   if(c){append(c.delta?.content);append(c.delta?.reasoning_content||c.delta?.reasoning,true);if(typeof c.finish_reason==='string')r.finishReason=c.finish_reason;}
  }else{
   if(v.type==='message_start'){if(typeof v.message?.model==='string')r.returnedModel=v.message.model;usage(v.message?.usage);}
   if(v.type==='content_block_delta'){if(v.delta?.type==='text_delta')append(v.delta.text);if(v.delta?.type==='thinking_delta')append(v.delta.thinking,true);}
   if(v.type==='message_delta'){usage(v.usage);if(typeof v.delta?.stop_reason==='string')r.finishReason=v.delta.stop_reason;}
   if(v.type==='message_stop')done=true;
  }
 };
 try{
  const headers:Record<string,string>={'Content-Type':'application/json',Accept:task.request.stream?'text/event-stream':'application/json'};
  if(task.protocol==='openai')headers.Authorization=`Bearer ${task.key}`;else{headers['x-api-key']=task.key;headers['anthropic-version']='2023-06-01';}
  const response=await upstreamFetch(task.url,{dispatcher,method:'POST',headers,body:JSON.stringify(task.request),signal:controller.signal,redirect:'error'});r.httpStatus=response.status;
  if(!response.ok)throw new InvokeError('http',`HTTP ${response.status}: ${(await response.text()).slice(0,3000)}`);
  if(task.request.stream){
   if(!response.body)throw new InvokeError('protocol','响应缺少可读取的流');
   const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
   const frame=(block:string)=>{const data=block.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).replace(/^ /,'')).join('\n');if(!data)return;if(data==='[DONE]'){done=true;return;}try{event(JSON.parse(data));}catch(e){if(e instanceof InvokeError)throw e;throw new InvokeError('protocol','无法解析流式 JSON 事件');}};
   try{
    while(true){const chunk=await reader.read();buffer+=decoder.decode(chunk.value,{stream:!chunk.done});buffer=buffer.replace(/\r\n/g,'\n');let end:number;while((end=buffer.indexOf('\n\n'))>=0){frame(buffer.slice(0,end));buffer=buffer.slice(end+2);}if(chunk.done){if(buffer.trim())frame(buffer);break;}if(done){await reader.cancel();break;}if(buffer.length>2000000)throw new InvokeError('protocol','单个流事件过大');}
   }finally{reader.releaseLock();}
   if(!done||!r.finishReason)throw new InvokeError('stream','响应流在正常结束标记之前中断');
  }else{
   let v:any;try{v=await response.json();}catch{throw new InvokeError('protocol','响应不是有效 JSON');}
   if(!v||typeof v!=='object'||Array.isArray(v))throw new InvokeError('protocol','响应不是 JSON 对象');
   if(v.error)throw new InvokeError('protocol',String(v.error.message||'接口返回错误'));
   if(typeof v.model==='string')r.returnedModel=v.model;usage(v.usage);
   if(task.protocol==='openai'){const c=v.choices?.[0];if(!c?.message)throw new InvokeError('protocol','缺少 choices/message');append(c.message.content);append(c.message.reasoning_content||c.message.reasoning,true);r.finishReason=c.finish_reason;}
   else{if(!Array.isArray(v.content))throw new InvokeError('protocol','缺少 content');for(const c of v.content){if(c.type==='text')append(c.text);if(c.type==='thinking')append(c.thinking,true);}r.finishReason=v.stop_reason;}
  }
  if(typeof r.finishReason!=='string'||!r.finishReason.trim())throw new InvokeError('protocol','响应缺少正常结束原因');
  if(!r.output.trim())throw new InvokeError('empty','响应正常结束，但文本内容为空');
  r.truncated=['length','max_tokens'].includes(r.finishReason||'');r.status='success';
 }catch(e){
  if(task.signal.aborted){r.status='cancelled';r.errorCategory='cancelled';r.error='用户取消';}
  else if(timedOut){r.errorCategory='timeout';r.error=`调用超过 ${(task.timeoutMs??0)/1000} 秒`;}
  else{r.errorCategory=e instanceof InvokeError?e.category:'network';r.error=redact(e instanceof Error?e.message:String(e),[task.key]);}
 }finally{controller.abort();clearTimeout(timer);task.signal.removeEventListener('abort',abort);r.durationMs=performance.now()-start;r.output=redact(r.output,[task.key]);r.reasoning=redact(r.reasoning,[task.key]);await dispatcher.destroy();}
 return redactValue(r,[task.key]);
}
