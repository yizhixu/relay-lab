export type Protocol = 'openai' | 'anthropic';
export interface Provider { id: string; name: string; protocol: Protocol; endpoint: string; models: string[]; hasKey: boolean }
export interface Prompt { id: string; name: string; category: string; description: string; system: string; text: string; version: number; builtin: boolean }
export interface Target { providerId: string; model: string }
export type ThinkingEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export interface Settings { repeats: number; concurrency: number; timeoutMs: number | null; maxTokens: number | null; thinkingEffort?: ThinkingEffort; stream: boolean; temperature?: number; extra: Record<string, unknown> }
export const DEFAULT_SETTINGS: Settings = { repeats: 3, concurrency: 1, timeoutMs: null, maxTokens: null, stream: true, extra: {} };
export interface FrozenTarget { providerId: string; name: string; protocol: Protocol; endpoint: string; model: string }
export interface Snapshot { version: 1; toolVersion: string; targets: FrozenTarget[]; prompts: Prompt[]; settings: Settings }
export type CallStatus = 'queued' | 'running' | 'success' | 'failed' | 'cancelled' | 'interrupted';
export interface Usage { input?: number; output?: number }
export interface Call { id: string; runId: string; targetIndex: number; promptIndex: number; round: number; status: CallStatus; request: Record<string, unknown>; url: string; output: string; reasoning: string; startedAt?: string; endedAt?: string; ttftMs?: number; durationMs?: number; usage: Usage; httpStatus?: number; returnedModel?: string; finishReason?: string; truncated: boolean; errorCategory?: string; error?: string }
export interface Run { id: string; name: string; createdAt: string; status: 'running' | 'completed' | 'cancelled' | 'interrupted' | 'imported'; snapshot: Snapshot; calls: Call[]; sourceRunId?: string }
export interface Summary { total: number; completed: number; success: number; failed: number; cancelled: number; interrupted: number; pending: number; successRate: number | null; medianMs: number | null; p95Ms: number | null; medianTtftMs: number | null; truncated: number; errors: Record<string, number> }
