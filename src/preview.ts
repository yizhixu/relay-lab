export interface Artifact { kind: 'HTML' | 'SVG'; source: string }

/** Extract renderable code, keeping the original model output untouched. */
export function extractArtifacts(output: string): Artifact[] {
 const artifacts: Artifact[]=[];
 const fences=[...output.matchAll(/^[ \t]*(`{3,}|~{3,})[ \t]*([^\n]*)\n([\s\S]*?)^[ \t]*\1[ \t]*$/gm)];
 for(const match of fences){
  const language=match[2].trim().toLowerCase();const source=match[3].trim();
  if(!source)continue;
  if(['html','htm'].includes(language))artifacts.push({kind:'HTML',source});
  else if(['svg','xml',''].includes(language)&&/^<svg\b/i.test(source))artifacts.push({kind:'SVG',source});
  else if(!language&&/^<!doctype\s+html\b|^<html\b/i.test(source))artifacts.push({kind:'HTML',source});
 }
 if(artifacts.length||fences.length)return artifacts;
 const html=output.match(/(?:<!doctype\s+html[^>]*>\s*)?<html\b[\s\S]*?<\/html\s*>/i);
 if(html)return [{kind:'HTML',source:html[0]}];
 let svg='';let depth=0,start=-1;
 for(const tag of output.matchAll(/<\/?svg\b[^>]*>/gi)){
  const closing=/^<\//.test(tag[0]);
  if(!closing){if(depth===0)start=tag.index!;if(!/\/\s*>$/.test(tag[0]))depth++;}
  else if(depth>0)depth--;
  if(depth===0&&start>=0){svg=output.slice(start,tag.index!+tag[0].length);break;}
 }
 // A standalone HTML fragment may contain an SVG plus styles or scripts.
 const trimmed=output.trim();
 if(/^<(?:!doctype\s+html|head|body|div|main|section|article|style|canvas|button|h[1-6]|p)\b/i.test(trimmed))return [{kind:'HTML',source:trimmed}];
 if(svg)return [{kind:'SVG',source:svg}];
 return [];
}

export function previewDocument(artifact: Artifact): string {
 // First in the document: generated meta tags cannot relax this policy.
 // The iframe separately uses an opaque origin (no allow-same-origin).
 const policy="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'";
 const head=`<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="viewport" content="width=device-width, initial-scale=1">`;
 const source=artifact.source.replace(/^\s*<!doctype[^>]*>/i,'');
 return head+(artifact.kind==='SVG'?'<style>body{margin:0;display:grid;place-items:center;min-height:100vh}svg{max-width:100%;height:auto}</style>'+source:source);
}

export function guardedPreviewDocument(artifact: Artifact): string {
 // A parent frame policy also blocks the child's own navigations; the child's
 // connect-src alone only controls fetch/XHR. srcdoc can still load initially.
 const inner=previewDocument(artifact).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
 return '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="frame-src \'none\'"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}iframe{display:block;border:0;width:100%;height:100%}</style><iframe title="生成成果内容" sandbox="allow-scripts" referrerpolicy="no-referrer" allow="camera \'none\'; microphone \'none\'; geolocation \'none\'; clipboard-read \'none\'; clipboard-write \'none\'" srcdoc="'+inner+'"></iframe>';
}
