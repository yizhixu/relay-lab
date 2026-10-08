import { useMemo, useState } from 'react';
import { Maximize2, RotateCcw } from 'lucide-react';
import { extractArtifacts, guardedPreviewDocument } from './preview';
import { Modal } from './Modal';

export function OutputPreview({output,name,running}:{output:string;name:string;running:boolean}) {
 const artifacts=useMemo(()=>extractArtifacts(output),[output]);
 const [index,setIndex]=useState(0),[revision,setRevision]=useState(0),[expanded,setExpanded]=useState(false);
 const selected=Math.min(index,Math.max(0,artifacts.length-1));
 const artifact=artifacts[selected];
 const document=useMemo(()=>artifact?guardedPreviewDocument(artifact):'',[artifact]);
 if(running)return <div className="preview-empty">内容正在生成，调用结束后可预览。可切换到原文查看实时输出。</div>;
 if(!artifact)return <div className="preview-empty">未识别到 HTML 或 SVG 内容。请切换到 Markdown 或原文查看回答。</div>;
 function frame(large=false){return <iframe key={`${selected}:${revision}:${large}`} title={`${large?'放大':''}成果预览 ${name}`} className={`artifact-frame${large?' expanded':''}`} sandbox="allow-scripts" referrerPolicy="no-referrer" allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'" srcDoc={document}/>;}
 const controls=<div className="preview-toolbar">{artifacts.length>1?<label>代码块<select aria-label={`预览代码块 ${name}`} value={selected} onChange={e=>{setIndex(Number(e.target.value));setRevision(0);}}>{artifacts.map((a,i)=><option value={i} key={i}>{i+1} · {a.kind}</option>)}</select></label>:<span className="small-tag">{artifact.kind}</span>}<button onClick={()=>setRevision(n=>n+1)}><RotateCcw size={13}/>重播</button><button onClick={()=>setExpanded(true)}><Maximize2 size={13}/>放大</button></div>;
 return <div className="artifact-preview">{controls}{!expanded&&frame()}<p className="hint preview-note">隔离预览 · 支持内联脚本与动画，外部资源不加载</p>{expanded&&<Modal title={`成果预览 · ${name}`} wide onClose={()=>setExpanded(false)}><div className="preview-toolbar"><button onClick={()=>setRevision(n=>n+1)}><RotateCcw size={13}/>重播</button></div>{frame(true)}<p className="hint preview-note">关闭后可继续查看原文；预览不会修改保存的结果。</p></Modal>}</div>;
}
