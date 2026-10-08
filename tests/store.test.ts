import { it, expect } from 'vitest';
import { mkdtempSync, readFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store';
import { DEFAULT_SETTINGS, type Snapshot } from '../shared/types';
it('encrypts local keys, preserves snapshots and marks unfinished calls interrupted on restart', () => {
 const dir = mkdtempSync(join(tmpdir(), 'relay-store-'));
 const s = new Store(dir);
 try {
 const p = s.saveProvider({ name: 'relay', protocol: 'openai', endpoint: 'https://relay.example/v1', models: ['m'], key: 'test-secret-xyz' });
 expect(p.hasKey).toBe(true); expect(p).not.toHaveProperty('key'); expect(s.getKey(p.id)).toBe('test-secret-xyz');
 expect(readFileSync(join(dir,'relay.sqlite')).includes(Buffer.from('test-secret-xyz'))).toBe(false);
 expect(statSync(join(dir,'master.key')).mode & 0o777).toBe(0o600);
 const snapshot: Snapshot = { version: 1, toolVersion: '1.0.0', targets: [{ ...p, providerId: p.id, model: 'm' }], prompts: [{ id: 'p', name: 'p', category: 'p', description: '', system: '', text: 'original', version: 1, builtin: false }], settings: DEFAULT_SETTINGS };
 const run = s.createRun('experiment', snapshot);
 s.saveProvider({ ...p, name: 'edited', endpoint: 'https://changed.example', key: '' });
 expect(s.getRun(run.id).snapshot.targets[0].endpoint).toBe('https://relay.example/v1');
 expect(s.getKey(p.id)).toBe('test-secret-xyz');
 s.close();
 const reopened = new Store(dir);
 expect(reopened.getRun(run.id).status).toBe('interrupted'); expect(reopened.getRun(run.id).calls[0].status).toBe('interrupted');
 expect(reopened.getKey(p.id)).toBe('test-secret-xyz');
 reopened.close();
 } finally { try { s.close(); } catch {} rmSync(dir, { recursive: true, force: true }); }
});
it('recovers unfinished calls even if cancellation already persisted a terminal run status',()=>{
 const dir=mkdtempSync(join(tmpdir(),'relay-recover-'));const s=new Store(dir);
 try{
 const snapshot:Snapshot={version:1,toolVersion:'1.0.0',targets:[{providerId:'p',name:'r',protocol:'openai',endpoint:'https://relay.example',model:'m'}],prompts:[s.prompts()[0]],settings:{...DEFAULT_SETTINGS,repeats:1}};
 const r=s.createRun('cancel race',snapshot);r.status='cancelled';r.calls[0].status='running';s.saveCall(r.calls[0]);s.saveRun(r);s.close();
 const reopened=new Store(dir);try{expect(reopened.getRun(r.id).status).toBe('cancelled');expect(reopened.getRun(r.id).calls[0].status).toBe('interrupted');}finally{reopened.close();}
 }finally{s.close();rmSync(dir,{recursive:true,force:true});}
});
