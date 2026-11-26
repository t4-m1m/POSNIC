const DEFAULT_TIMEOUT=8000;
let csrfToken='';
const SAFE_METHODS=new Set(['GET','HEAD','OPTIONS']);
export async function api(path,{method='GET',body,timeout=DEFAULT_TIMEOUT,headers={}}={}) {
 const requestMethod=String(method||'GET').toUpperCase();
 const requestHeaders={Accept:'application/json',...(body!==undefined?{'Content-Type':'application/json'}:{}),...(!SAFE_METHODS.has(requestMethod)&&csrfToken?{'X-XSRF-TOKEN':csrfToken}:{}),...headers};
 const controller=new AbortController();const routePath=String(path||'').replace(/^\/?api\//,'');const requestTimeout=/^whatsapp\/(?:sendMessage|send-receipt)$/.test(routePath)?Math.max(timeout,30000):timeout;const timer=setTimeout(()=>controller.abort(),requestTimeout);
 try {
  const response=await fetch(path.startsWith('/api/')?path:'/api/'+path,{method:requestMethod,credentials:'same-origin',cache:'no-store',headers:requestHeaders,body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal});
  const nextCsrf=response.headers.get('X-CSRF-TOKEN');if(nextCsrf)csrfToken=nextCsrf;
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
