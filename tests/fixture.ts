import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
export async function fixture() {
 let active = 0, peak = 0, count = 0;
 const requests: any[] = [];
 const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  if (req.url?.endsWith('/models')) { res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({ data: [{ id: 'good' }, { id: 'fail' }] })); return; }
  let body = ''; for await (const c of req) body += c;
  const b = JSON.parse(body); requests.push({ body: b, headers: req.headers }); count++; active++; peak = Math.max(peak, active);
  res.on('close', () => { active--; });
  if (b.model === 'fail' || b.model === 'auth') { res.writeHead(b.model === 'auth' ? 401 : 429); res.end(JSON.stringify({ error: { message: 'fixture error ' + (req.headers.authorization || req.headers['x-api-key'] || '') } })); return; }
  if (b.model === 'rotate-stream') { res.setHeader('Content-Type','text/event-stream');res.write('data: '+JSON.stringify({choices:[{delta:{content:'start'}}]})+'\n\n');const t=setTimeout(()=>{res.write('data: '+JSON.stringify({choices:[{delta:{content:String(req.headers.authorization).replace('Bearer ','')}}]})+'\n\n');const end=setTimeout(()=>{res.write('data: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');res.end();},250);res.on('close',()=>clearTimeout(end));},250);res.on('close',()=>clearTimeout(t));return; }
  if (b.model === 'malformed') { res.setHeader('Content-Type','text/event-stream');res.write('data: broken\n\n');const t=setInterval(()=>res.write(': keepalive\n\n'),20);res.on('close',()=>clearInterval(t));return; }
  if (b.model === 'timeout') { const t=setTimeout(()=>res.end('{}'), 5000); res.on('close',()=>clearTimeout(t)); return; }
  if (b.model === 'leak-meta') { res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({ model: String(req.headers.authorization).replace('Bearer ',''), choices: [{ message: { content: 'ok' }, finish_reason: String(req.headers.authorization).replace('Bearer ','') }] })); return; }
  if (b.model === 'unfinished') { res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({ choices: [{ message: { content: 'partial' }, finish_reason: null }] })); return; }
  if (!b.stream) { res.setHeader('Content-Type','application/json'); res.end(JSON.stringify(b.model === 'empty' ? { choices: [{ message: { content: '' }, finish_reason: 'stop' }] } : { model: b.model, choices: [{ message: { content: '完整回答' }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 4 } })); return; }
  res.setHeader('Content-Type','text/event-stream');
  const send = async (data: any, event?: string) => {
   const s = (event ? `event: ${event}\n` : '') + `data: ${JSON.stringify(data)}\n\n`;
   // Split in the middle of UTF-8 and between SSE frames.
   const buf = Buffer.from(s); const cut = Math.floor(buf.length/2); res.write(buf.subarray(0, cut)); await new Promise(r=>setTimeout(r, 4)); res.write(buf.subarray(cut));
  };
  if (req.url?.endsWith('/messages')) {
   await send({ type: 'message_start', message: { model: b.model, usage: { input_tokens: 3, output_tokens: 0 } } }, 'message_start');
   await send({ type: 'content_block_delta', delta: { type: 'text_delta', text: '你好' } }, 'content_block_delta');
   if (b.model === 'partial') { res.end(); return; }
   await send({ type: 'message_delta', delta: { stop_reason: 'max_tokens' }, usage: { output_tokens: 4 } }, 'message_delta');
   await send({ type: 'message_stop' }, 'message_stop'); res.end();
  } else {
   await send({ model: b.model, choices: [{ delta: { role: 'assistant' } }] });
   await send({ model: b.model, choices: [{ delta: { content: '你好' } }] });
   if (b.model === 'partial') { res.end(); return; }
   if (b.model === 'stream-error') { await send({ error: { message: 'stream rejected' } }); res.end(); return; }
   await send({ choices: [{ delta: {}, finish_reason: 'stop' }] });
   if (b.model !== 'no-usage') await send({ choices: [], usage: { prompt_tokens: 3, completion_tokens: 4 } });
   res.write('data: [DONE]\n\n'); res.end();
  }
 });
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const address = server.address() as { port: number };
 return { url: `http://127.0.0.1:${address.port}`, requests, get count(){ return count; }, get peak(){ return peak; }, get active(){ return active; }, close: () => new Promise<void>(r=>{server.closeAllConnections();server.close(()=>r());}) };
}
