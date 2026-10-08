import { z } from 'zod';
import type { Protocol, Prompt, Settings, Call, Summary } from '../shared/types.js';
export const protocolSchema = z.enum(['openai', 'anthropic']);
export const providerSchema = z.object({ id: z.string().optional(), name: z.string().trim().min(1).max(100), protocol: protocolSchema, endpoint: z.string().trim().min(1).max(2000), models: z.array(z.string().trim().min(1).max(200)).min(1).max(100), key: z.string().max(4000).optional() });
export const promptSchema = z.object({ id: z.string().optional(), name: z.string().trim().min(1).max(100), category: z.string().max(100).default('自定义'), description: z.string().max(1000).default(''), system: z.string().max(100000).default(''), text: z.string().min(1).max(200000), version: z.number().int().positive().default(1), builtin: z.boolean().default(false) });
const settingsSchema = z.object({ repeats: z.number().int().min(1).max(100), concurrency: z.number().int().min(1).max(20), timeoutMs: z.number().int().min(1000).max(2147483647).nullable(), maxTokens: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).nullable(), thinkingEffort: z.enum(['none','minimal','low','medium','high','xhigh','max']).optional(), stream: z.boolean(), temperature: z.number().min(0).max(2).optional(), extra: z.record(z.unknown()).default({}) });
const reserved = new Set(['model','messages','stream','system','max_tokens','max_completion_tokens','temperature']);
const sensitive = /^(api[-_]?key|authorization|headers|key|access[-_]?token|password|secret|__proto__|constructor|prototype)$/i;
export function assertNoSecrets(value: unknown): void {
 if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) { if(sensitive.test(key)) throw new Error(`参数 ${key} 不允许包含凭据或特殊字段`); assertNoSecrets(child); }
}
export function resolveEndpoint(endpoint: string, protocol: Protocol): string {
 const url = new URL(endpoint.trim());
 if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.hash) throw new Error('endpoint 必须是无认证信息的 HTTP(S) 地址');
 for(const k of url.searchParams.keys()) if(sensitive.test(k)) throw new Error('endpoint 查询参数不允许包含凭据');
 const path = url.pathname.replace(/\/+$/, '');
 const route = protocol === 'openai' ? '/chat/completions' : '/messages';
 if(path.endsWith('/chat/completions') || path.endsWith('/messages')) { if(!path.endsWith(route)) throw new Error('完整 endpoint 与所选协议不匹配'); url.pathname=path; }
 else url.pathname=path+(path.endsWith('/v1') ? '' : '/v1')+route;
 return url.toString();
}
export function validateSettings(value: unknown): Settings {
 const s = settingsSchema.parse(value);
 for(const key of Object.keys(s.extra)) if(reserved.has(key.toLowerCase())) throw new Error(`高级参数不能覆盖 ${key}`);
 if(s.thinkingEffort!==undefined && ('reasoning_effort' in s.extra || (s.extra.output_config && typeof s.extra.output_config==='object' && 'effort' in s.extra.output_config)))throw new Error('思考强度与高级 JSON 参数重复，请移除高级参数中的 reasoning_effort 或 output_config.effort');
 assertNoSecrets(s.extra);
 if (JSON.stringify(s.extra).length > 50000) throw new Error('高级参数过大');
 return s;
}
export function buildRequest(protocol: Protocol, model: string, prompt: Prompt, settings: Settings): Record<string, unknown> {
 const s = validateSettings(settings);
 const messages: {role:string;content:string}[] = [];
 if(protocol==='openai' && prompt.system) messages.push({role:'system',content:prompt.system});
 messages.push({role:'user',content:prompt.text});
 let effort:Record<string,unknown>={};
 if(s.thinkingEffort!==undefined){
  if(protocol==='openai')effort={reasoning_effort:s.thinkingEffort};
  else{
   if(s.thinkingEffort==='none'||s.thinkingEffort==='minimal')throw new Error('Anthropic 协议不支持 none / minimal 思考强度，请选择 low 或更高级别');
   const config=s.extra.output_config;
   if(config!==undefined&&(!config||typeof config!=='object'||Array.isArray(config)))throw new Error('output_config 必须是 JSON 对象');
   effort={output_config:{...(config as Record<string,unknown>|undefined),effort:s.thinkingEffort}};
  }
 }
 return { ...s.extra, ...effort, model, messages, ...(s.maxTokens===null?{}:{max_tokens:s.maxTokens}), stream:s.stream, ...(s.temperature===undefined?{}:{temperature:s.temperature}), ...(protocol==='anthropic' && prompt.system ? {system:prompt.system} : {}) };
}
function median(values:number[]):number|null { if(!values.length)return null;const a=[...values].sort((a,b)=>a-b),i=Math.floor(a.length/2);return a.length%2?a[i]:(a[i-1]+a[i])/2; }
export function summarize(calls: Call[]): Summary {
 const success=calls.filter(c=>c.status==='success'),failed=calls.filter(c=>c.status==='failed');
 const times=success.flatMap(c=>c.durationMs===undefined?[]:[c.durationMs]).sort((a,b)=>a-b);
 const errors:Record<string,number>={};for(const c of failed){const k=c.errorCategory||'unknown';errors[k]=(errors[k]||0)+1;}
 return {total:calls.length,completed:success.length+failed.length,success:success.length,failed:failed.length,cancelled:calls.filter(c=>c.status==='cancelled').length,interrupted:calls.filter(c=>c.status==='interrupted').length,pending:calls.filter(c=>['queued','running'].includes(c.status)).length,successRate:success.length+failed.length?success.length/(success.length+failed.length):null,medianMs:median(times),p95Ms:times.length?times[Math.ceil(times.length*.95)-1]:null,medianTtftMs:median(success.flatMap(c=>c.ttftMs===undefined?[]:[c.ttftMs])),truncated:success.filter(c=>c.truncated).length,errors};
}
export function redact(text:string, keys:string[]):string { let result=text;for(const key of keys)if(key)result=result.split(key).join('[REDACTED]');return result.replace(/(Bearer\s+)[^\s"\\]+/gi,'$1[REDACTED]'); }

export function redactValue<T>(value:T,keys:string[]):T {
 const visit=(v:unknown):unknown=>typeof v==='string'?redact(v,keys):Array.isArray(v)?v.map(visit):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,visit(x)])):v;
 return visit(value) as T;
}
