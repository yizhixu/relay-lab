import type { Call, Summary, FrozenTarget, Prompt } from '../shared/types';
export interface RunRow { id:string;name:string;createdAt:string;status:string;sourceRunId?:string;targets:FrozenTarget[];prompts:Pick<Prompt,'id'|'name'>[];summary:Summary }
export const statusName:Record<string,string>={running:'运行中',queued:'等待中',success:'成功',failed:'失败',completed:'已完成',cancelled:'已取消',interrupted:'已中断',imported:'已导入'};
export const time=(ms:number|null|undefined)=>ms==null?'—':ms<1000?`${Math.round(ms)} ms`:`${(ms/1000).toFixed(2)} s`;
export const date=(value:string)=>new Date(value).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
export const percent=(v:number|null)=>v===null?'—':`${Math.round(v*1000)/10}%`;
export function stats(calls:Call[]):Summary {
 const good=calls.filter(c=>c.status==='success'),bad=calls.filter(c=>c.status==='failed'),a=good.flatMap(c=>c.durationMs==null?[]:[c.durationMs]).sort((a,b)=>a-b),ttft=good.flatMap(c=>c.ttftMs==null?[]:[c.ttftMs]).sort((a,b)=>a-b);
 const median=(v:number[])=>!v.length?null:v.length%2?v[Math.floor(v.length/2)]:(v[v.length/2-1]+v[v.length/2])/2;
 const errors:Record<string,number>={};bad.forEach(c=>errors[c.errorCategory||'unknown']=(errors[c.errorCategory||'unknown']||0)+1);
 return{total:calls.length,completed:good.length+bad.length,success:good.length,failed:bad.length,cancelled:calls.filter(c=>c.status==='cancelled').length,interrupted:calls.filter(c=>c.status==='interrupted').length,pending:calls.filter(c=>['running','queued'].includes(c.status)).length,successRate:good.length+bad.length?good.length/(good.length+bad.length):null,medianMs:median(a),p95Ms:a.length?a[Math.ceil(a.length*.95)-1]:null,medianTtftMs:median(ttft),truncated:good.filter(c=>c.truncated).length,errors};
}
