import { z } from 'zod';
import { isDeepStrictEqual } from 'node:util';
import { assertNoSecrets, buildRequest, promptSchema, resolveEndpoint, validateSettings, protocolSchema } from './core.js';
import type { Run, Snapshot } from '../shared/types.js';
const targetSchema=z.object({providerId:z.string().min(1),name:z.string().min(1).max(100),protocol:protocolSchema,endpoint:z.string().max(2000),model:z.string().min(1).max(200)});
const snapshotSchema=z.object({version:z.literal(1),toolVersion:z.string().max(100),targets:z.array(targetSchema).min(1).max(100),prompts:z.array(promptSchema.extend({id:z.string().min(1)})).min(1).max(100),settings:z.unknown()});
const n=z.number().finite().nonnegative();
const callSchema=z.object({id:z.string(),runId:z.string(),targetIndex:z.number().int().nonnegative(),promptIndex:z.number().int().nonnegative(),round:z.number().int().positive(),status:z.enum(['queued','running','success','failed','cancelled','interrupted']),request:z.record(z.unknown()),url:z.string().max(2000),output:z.string().max(4000000),reasoning:z.string().max(4000000),startedAt:z.string().datetime().optional(),endedAt:z.string().datetime().optional(),ttftMs:n.optional(),durationMs:n.optional(),usage:z.object({input:n.optional(),output:n.optional()}),httpStatus:z.number().int().optional(),returnedModel:z.string().optional(),finishReason:z.string().optional(),truncated:z.boolean(),errorCategory:z.string().optional(),error:z.string().optional()});
export function parseImport(value:unknown):Run{
 const envelope=z.object({format:z.literal('relay-lab'),version:z.literal(1),run:z.object({id:z.string(),name:z.string().min(1).max(100),createdAt:z.string().datetime(),status:z.enum(['running','completed','cancelled','interrupted','imported']),sourceRunId:z.string().optional(),snapshot:snapshotSchema,calls:z.array(callSchema).max(2000)})}).parse(value);
 const run=envelope.run;const snapshot:Snapshot={...run.snapshot,settings:validateSettings(run.snapshot.settings)};const count=snapshot.targets.length*snapshot.prompts.length*snapshot.settings.repeats;
 if(count>2000||count!==run.calls.length)throw new Error('导入记录的调用数量与配置不匹配');
 const seen=new Set<string>();
 for(const c of run.calls){const t=snapshot.targets[c.targetIndex],p=snapshot.prompts[c.promptIndex];const tuple=`${c.targetIndex}:${c.promptIndex}:${c.round}`;
  if(!t||!p||c.round>snapshot.settings.repeats||seen.has(tuple))throw new Error('导入记录的组合索引无效或重复');seen.add(tuple);assertNoSecrets(c.request);
  if(c.url!==resolveEndpoint(t.endpoint,t.protocol)||!isDeepStrictEqual(c.request,buildRequest(t.protocol,t.model,p,snapshot.settings)))throw new Error('导入请求与配置快照不一致');
 }
 return {...run,snapshot};
}
export function exportCSV(run:Run):string{
 const headers=['provider','protocol','model','prompt','round','status','http_status','ttft_ms','duration_ms','input_tokens','output_tokens','output_tokens_per_total_second','truncated','finish_reason','error_category','error'];
 const cell=(v:unknown)=>{let s=v==null?'':String(v);if(/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
 return '\uFEFF'+[headers,...run.calls.map(c=>{const t=run.snapshot.targets[c.targetIndex];return[t.name,t.protocol,t.model,run.snapshot.prompts[c.promptIndex].name,c.round,c.status,c.httpStatus,c.ttftMs,c.durationMs,c.usage.input,c.usage.output,c.usage.output!==undefined&&c.durationMs?c.usage.output/(c.durationMs/1000):undefined,c.truncated,c.finishReason,c.errorCategory,c.error];})].map(row=>row.map(cell).join(',')).join('\r\n');
}
