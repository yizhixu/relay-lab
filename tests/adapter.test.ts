import { it, expect } from 'vitest';
import { fixture } from './fixture';
import { invoke } from '../server/adapter';
const task = (url: string, protocol: 'openai'|'anthropic', model='good', stream=true, timeoutMs=1000) => ({ url: url + (protocol==='openai'?'/v1/chat/completions':'/v1/messages'), protocol, key: 'secret-fixture', request: { model, messages: [{ role:'user',content:'hello'}], stream, max_tokens:2048 }, timeoutMs, signal: new AbortController().signal });
it('assembles split OpenAI SSE, ignores role-only frames and reads usage', async()=>{
 const f=await fixture();try { const deltas:string[]=[]; const r=await invoke(task(f.url,'openai'), d=>deltas.push(d.output)); expect(r).toMatchObject({ status:'success', output:'你好', usage:{input:3,output:4}, httpStatus:200, finishReason:'stop' }); expect(r.ttftMs).toBeGreaterThan(0); expect(deltas.join('')).toContain('你好'); expect(f.requests[0].headers.authorization).toBe('Bearer secret-fixture'); } finally { await f.close(); }
});
it('reads Anthropic deltas and cumulative usage, marking truncation', async()=>{
 const f=await fixture();try { const r=await invoke(task(f.url,'anthropic')); expect(r).toMatchObject({status:'success',output:'你好',usage:{input:3,output:4},truncated:true});expect(f.requests[0].headers['x-api-key']).toBe('secret-fixture'); } finally {await f.close();}
});
it('records no usage, non-stream responses, and partial/error streams honestly',async()=>{
 const f=await fixture();try {
 expect((await invoke(task(f.url,'openai','no-usage'))).usage).toEqual({});
 expect(await invoke(task(f.url,'openai','good',false))).toMatchObject({ status:'success',output:'完整回答' });
 expect((await invoke(task(f.url,'openai','good',false))).ttftMs).toBeUndefined();
 expect(await invoke(task(f.url,'openai','partial'))).toMatchObject({status:'failed',output:'你好',errorCategory:'stream'});
 expect(await invoke(task(f.url,'anthropic','partial'))).toMatchObject({status:'failed',output:'你好',errorCategory:'stream'});
 expect(await invoke(task(f.url,'openai','stream-error'))).toMatchObject({status:'failed',output:'你好'});
 expect(await invoke(task(f.url,'openai','empty',false))).toMatchObject({status:'failed',errorCategory:'empty'});
 }finally{await f.close();}
});
it('classifies HTTP, timeout and cancellation without retrying or leaking credentials',async()=>{
 const f=await fixture();try {
 const r=await invoke(task(f.url,'openai','fail'));expect(r).toMatchObject({status:'failed',httpStatus:429,errorCategory:'http'});expect(r.error).not.toContain('secret-fixture');expect(f.count).toBe(1);
 expect(await invoke(task(f.url,'openai','auth'))).toMatchObject({status:'failed',httpStatus:401});
 expect(await invoke(task(f.url,'openai','timeout',true,30))).toMatchObject({status:'failed',errorCategory:'timeout'});
 const controller=new AbortController();const pending=invoke({...task(f.url,'openai','timeout'),signal:controller.signal});setTimeout(()=>controller.abort(),20);expect(await pending).toMatchObject({status:'cancelled'});
 }finally{await f.close();}
});

it('does not accept unfinished nonstream answers and redacts metadata fields',async()=>{
 const f=await fixture();try{
 expect(await invoke(task(f.url,'openai','unfinished',false))).toMatchObject({status:'failed',output:'partial',errorCategory:'protocol'});
 const leaked=await invoke(task(f.url,'openai','leak-meta',false));expect(JSON.stringify(leaked)).not.toContain('secret-fixture');
 }finally{await f.close();}
});

it('closes upstream generation immediately when SSE parsing fails',async()=>{
 const f=await fixture();try{
 expect(await invoke(task(f.url,'openai','malformed'))).toMatchObject({status:'failed',errorCategory:'protocol'});
 for(let i=0;i<10&&f.active;i++)await new Promise(r=>setTimeout(r,10));
 expect(f.active).toBe(0);
 }finally{await f.close();}
});
it('unlimited timeout permits completion and still supports user cancellation',async()=>{
 const f=await fixture();try{
 expect(await invoke({...task(f.url,'openai'),timeoutMs:null} as any)).toMatchObject({status:'success',output:'你好'});
 const controller=new AbortController();const pending=invoke({...task(f.url,'openai','timeout'),timeoutMs:null,signal:controller.signal} as any);setTimeout(()=>controller.abort(),40);expect(await pending).toMatchObject({status:'cancelled'});
 }finally{await f.close();}
});
it('cancellation closes a connection that never finishes its TLS handshake with no timeout',async()=>{
 const {createServer}=await import('node:net');let peer:import('node:net').Socket|undefined;let accepted!:()=>void;const connected=new Promise<void>(r=>accepted=r);
 const server=createServer(socket=>{peer=socket;socket.resume();accepted();});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const port=(server.address() as {port:number}).port,controller=new AbortController();
 try{
 const pending=invoke({...task(`https://127.0.0.1:${port}`,'openai'),timeoutMs:null,signal:controller.signal});await connected;controller.abort();expect(await pending).toMatchObject({status:'cancelled'});
 for(let i=0;i<20&&!peer?.destroyed;i++)await new Promise(r=>setTimeout(r,10));expect(peer?.destroyed).toBe(true);
 }finally{peer?.destroy();await new Promise<void>(r=>server.close(()=>r()));}
});
