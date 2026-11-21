const DEFAULT_TIMEOUT=8000;
export async function api(path,{method='GET',body,timeout=DEFAULT_TIMEOUT,headers={}}={}) {
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeout);
 try {
  const response=await fetch(path.startsWith('/api/')?path:'/api/'+path,{method,credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json',...(body!==undefined?{'Content-Type':'application/json'}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal});
  const type=response.headers.get('content-type')||'';const payload=type.includes('json')?await response.json():await response.text();
  if(!response.ok||payload?.type==='error'||payload?.success===false)throw new Error(payload?.message||payload?.error?.message||response.statusText||'Erreur API');
  return payload?.data!==undefined?payload.data:payload;
 } catch(error){if(error.name==='AbortError')throw new Error('Le serveur ne répond pas (8 s).');throw error;}finally{clearTimeout(timer);}
}
export const get=(path,params={})=>api(path+(Object.keys(params).length?'?'+new URLSearchParams(params):''));
export const post=(path,body)=>api(path,{method:'POST',body});
export const put=(path,body)=>api(path,{method:'PUT',body});
export const patch=(path,body)=>api(path,{method:'PATCH',body});
export const del=(path,body)=>api(path,{method:'DELETE',body});
