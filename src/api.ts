export async function api<T>(path:string,options:RequestInit={}):Promise<T>{
 const response=await fetch('/api'+path,{...options,headers:{...(options.body===undefined?{}:{'Content-Type':'application/json'}),...options.headers}});
 if(!response.ok){let message=`请求失败：${response.status}`;try{message=(await response.json()).error||message;}catch{}throw new Error(message);}
 return response.json() as Promise<T>;
}
export const post=<T,>(path:string,body?:unknown)=>api<T>(path,{method:'POST',body:body===undefined?undefined:JSON.stringify(body)});
export const put=<T,>(path:string,body:unknown)=>api<T>(path,{method:'PUT',body:JSON.stringify(body)});
export async function downloadRun(id:string,format:'json'|'csv'){
 const response=await fetch(`/api/runs/${id}/export?format=${format}`);if(!response.ok)throw new Error('导出失败');
 const url=URL.createObjectURL(await response.blob()),a=document.createElement('a');a.href=url;a.download=`relay-lab-${id}.${format}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
