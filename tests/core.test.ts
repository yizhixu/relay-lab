import { describe, it, expect } from 'vitest';
import { resolveEndpoint, buildRequest, summarize, validateSettings } from '../server/core';
import { DEFAULT_SETTINGS, type Call, type Prompt } from '../shared/types';
const prompt: Prompt = { id: 'p', name: 'test', category: 'test', description: '', text: 'hello', system: 'help', version: 1, builtin: true };
describe('frozen requests', () => {
 it('resolves base URLs and complete endpoints without doubling v1', () => {
  expect(resolveEndpoint('https://relay.example', 'openai')).toBe('https://relay.example/v1/chat/completions');
  expect(resolveEndpoint('https://relay.example/proxy/v1/', 'anthropic')).toBe('https://relay.example/proxy/v1/messages');
  expect(resolveEndpoint('https://relay.example/custom/chat/completions?x=1', 'openai')).toBe('https://relay.example/custom/chat/completions?x=1');
  expect(() => resolveEndpoint('file:///tmp/key', 'openai')).toThrow();
  expect(() => resolveEndpoint('https://user:secret@relay.example', 'openai')).toThrow();
 });
 it('builds both protocols without a hidden temperature default', () => {
  const a = buildRequest('openai', 'model', prompt, DEFAULT_SETTINGS);
  expect(a).toMatchObject({ model: 'model', messages: [{ role: 'system', content: 'help' }, { role: 'user', content: 'hello' }], stream: true });
  expect(a).not.toHaveProperty('temperature');
  expect(buildRequest('anthropic', 'claude', prompt, { ...DEFAULT_SETTINGS, temperature: 0 })).toMatchObject({ system: 'help', messages: [{ role: 'user', content: 'hello' }], temperature: 0 });
 });
 it('rejects reserved/credential parameters and excessive task settings', () => {
  for (const key of ['model','messages','stream','system','api_key','headers','authorization','Authorization','max_tokens']) expect(() => validateSettings({ ...DEFAULT_SETTINGS, extra: { [key]: 'bad' } })).toThrow();
  expect(() => validateSettings({ ...DEFAULT_SETTINGS, concurrency: 0 })).toThrow();
  expect(() => validateSettings({ ...DEFAULT_SETTINGS, repeats: 1.5 })).toThrow();
 });
});
it('excludes cancelled/interrupted from success denominator and computes nearest rank P95', () => {
 const calls = [100,200,300].map(durationMs => ({ status: 'success', durationMs, ttftMs: 10, truncated: durationMs === 300 })) as Call[];
 calls.push({ status: 'failed', errorCategory: 'http' } as Call, { status: 'cancelled' } as Call, { status: 'interrupted' } as Call, { status: 'queued' } as Call);
 expect(summarize(calls)).toMatchObject({ total: 7, completed: 4, success: 3, failed: 1, successRate: .75, medianMs: 200, p95Ms: 300, pending: 1, cancelled: 1, interrupted: 1, truncated: 1, errors: { http: 1 } });
});
it('defaults to unlimited time and output without sending infinity or a hidden token cap',()=>{
 expect(DEFAULT_SETTINGS.timeoutMs).toBeNull();expect(DEFAULT_SETTINGS.maxTokens).toBeNull();
 expect(validateSettings({...DEFAULT_SETTINGS,timeoutMs:null,maxTokens:null})).toMatchObject({timeoutMs:null,maxTokens:null});
 for(const protocol of ['openai','anthropic'] as const)expect(buildRequest(protocol,'model',prompt,{...DEFAULT_SETTINGS,timeoutMs:null,maxTokens:null} as any)).not.toHaveProperty('max_tokens');
 expect(buildRequest('openai','model',prompt,{...DEFAULT_SETTINGS,timeoutMs:3000,maxTokens:8192})).toMatchObject({max_tokens:8192});
});
it('sends the selected thinking effort for each protocol without overriding advanced values silently',()=>{
 const high={...DEFAULT_SETTINGS,thinkingEffort:'high' as const};
 expect(buildRequest('openai','m',prompt,high)).toHaveProperty('reasoning_effort','high');
 expect(buildRequest('anthropic','m',prompt,high)).toHaveProperty('output_config.effort','high');
 expect(buildRequest('openai','m',prompt,DEFAULT_SETTINGS)).not.toHaveProperty('reasoning_effort');
 expect(buildRequest('anthropic','m',prompt,DEFAULT_SETTINGS)).not.toHaveProperty('output_config');
 expect(buildRequest('anthropic','m',prompt,{...high,extra:{output_config:{format:{type:'json_schema'}}}})).toMatchObject({output_config:{effort:'high',format:{type:'json_schema'}}});
 expect(()=>buildRequest('openai','m',prompt,{...high,extra:{reasoning_effort:'low'}})).toThrow();
 expect(()=>buildRequest('anthropic','m',prompt,{...high,extra:{output_config:{effort:'low'}}})).toThrow();
 expect(()=>buildRequest('anthropic','m',prompt,{...DEFAULT_SETTINGS,thinkingEffort:'none'} as any)).toThrow();
 for(const effort of ['xhigh','max'] as const){expect(buildRequest('openai','m',prompt,{...DEFAULT_SETTINGS,thinkingEffort:effort})).toHaveProperty('reasoning_effort',effort);expect(buildRequest('anthropic','m',prompt,{...DEFAULT_SETTINGS,thinkingEffort:effort})).toHaveProperty('output_config.effort',effort);}
});
