'use strict';
const dns = require('dns').promises;
const net = require('net');
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const TIMEOUT_MS = 8000;
const MAX_BYTES = 5 * 1024 * 1024;
function decodeHtml(value) { return String(value || '').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&#x([0-9a-f]+);/gi,(_,h)=>String.fromCharCode(parseInt(h,16))).replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n))); }
function isPrivateAddress(address) {
 if(net.isIPv4(address)){const p=address.split('.').map(Number);return p[0]===0||p[0]===10||p[0]===127||p[0]>=224||(p[0]===169&&p[1]===254)||(p[0]===172&&p[1]>=16&&p[1]<=31)||(p[0]===192&&p[1]===168)||(p[0]===100&&p[1]>=64&&p[1]<=127);}
 if(net.isIPv6(address)){const v=address.toLowerCase();return v==='::1'||v==='::'||v.startsWith('fc')||v.startsWith('fd')||v.startsWith('fe80:')||v.startsWith('::ffff:127.');}
 return true;
}
async function assertPublicUrl(raw){
 const url=new URL(raw);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('Adresse de photo non autorisée.');
 const host=url.hostname.replace(/^\[|\]$/g,'');if(host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local'))throw new Error('Hôte de photo non autorisé.');
 if(net.isIP(host)){if(isPrivateAddress(host))throw new Error('Adresse réseau privée refusée.');}
 else{const addresses=await dns.lookup(host,{all:true,verbatim:true});if(!addresses.length||addresses.some(x=>isPrivateAddress(x.address)))throw new Error('Adresse réseau privée refusée.');}
 return url;
}
function extractDimensions(buffer,mime){
 if(mime==='image/png'&&buffer.length>=24)return{width:buffer.readUInt32BE(16),height:buffer.readUInt32BE(20)};
 if(mime==='image/gif'&&buffer.length>=10)return{width:buffer.readUInt16LE(6),height:buffer.readUInt16LE(8)};
 if(mime==='image/webp'&&buffer.length>=30&&buffer.toString('ascii',12,16)==='VP8X')return{width:1+buffer.readUIntLE(24,3),height:1+buffer.readUIntLE(27,3)};
 if(mime==='image/jpeg'){let o=2;while(o+9<buffer.length){if(buffer[o]!==0xff){o++;continue;}const marker=buffer[o+1],len=buffer.readUInt16BE(o+2);if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)&&o+9<buffer.length)return{height:buffer.readUInt16BE(o+5),width:buffer.readUInt16BE(o+7)};if(len<2)break;o+=2+len;}}
 return{width:0,height:0};
}
function imageType(buffer,contentType){
 const type=String(contentType||'').split(';')[0].trim().toLowerCase();
 if(type==='image/png'&&buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return'png';
 if(type==='image/jpeg'&&buffer[0]===0xff&&buffer[1]===0xd8&&buffer[2]===0xff)return'jpg';
 if(type==='image/webp'&&buffer.toString('ascii',0,4)==='RIFF'&&buffer.toString('ascii',8,12)==='WEBP')return'webp';
 if(type==='image/gif'&&/^GIF8[79]a$/.test(buffer.toString('ascii',0,6)))return'gif';
 throw new Error('Le fichier reçu n’est pas une image valide (JPEG, PNG, WebP ou GIF).');
}
async function fetchTimeout(url,options={}){return fetch(url,{...options,signal:AbortSignal.timeout(TIMEOUT_MS)});}
async function searchImages(query,limit=6){
 const response=await fetchTimeout('https://www.bing.com/images/search?q='+encodeURIComponent(query),{headers:{'User-Agent':USER_AGENT,'Accept':'text/html,application/xhtml+xml'}});
 if(!response.ok)throw new Error('Le moteur de recherche d’images est indisponible ('+response.status+').');
 const html=await response.text(),found=[],seen=new Set();
 const add=(raw,thumb,title,width,height)=>{const url=decodeHtml(raw).replace(/\\u0026/g,'&').replace(/\\\\/g,'').trim();if(!/^https?:\/\//i.test(url)||seen.has(url))return;const w=Number(width)||0,h=Number(height)||0;if(w&&h&&(w<150||h<150))return;seen.add(url);found.push({url,thumbnail:decodeHtml(thumb||raw),title:decodeHtml(title||query),width:w,height:h});};
 const metadata=/m="([^"]{20,12000})"/g;let match;
 while((match=metadata.exec(html))&&found.length<limit*3){try{const data=JSON.parse(decodeHtml(match[1]));if(data.murl)add(data.murl,data.turl,data.t,data.w||data.width,data.h||data.height);}catch(_){}}
 if(found.length<limit){const urls=/"murl"\s*:\s*"([^"]+)"/g;while((match=urls.exec(html))&&found.length<limit*3)add(match[1],'',query,0,0);}
 return found.slice(0,limit);
}
async function downloadImage(initialUrl){
 let current=initialUrl,response;
 for(let redirects=0;redirects<=4;redirects++){await assertPublicUrl(current);response=await fetchTimeout(current,{redirect:'manual',headers:{'User-Agent':USER_AGENT,'Accept':'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'}});if([301,302,303,307,308].includes(response.status)){const location=response.headers.get('location');if(!location||redirects===4)throw new Error('Redirection de photo invalide.');current=new URL(location,current).toString();continue;}break;}
 if(!response?.ok)throw new Error('Téléchargement de la photo impossible ('+(response?.status||'réseau')+').');
 const contentType=response.headers.get('content-type')||'';if(!/^image\/(?:jpeg|png|webp|gif)$/i.test(contentType))throw new Error('Le serveur distant n’a pas envoyé un fichier image.');
 if(Number(response.headers.get('content-length')||0)>MAX_BYTES)throw new Error('La photo dépasse la limite de 5 Mo.');
 const chunks=[];let total=0;if(!response.body)throw new Error('Réponse image vide.');
 for await(const chunk of response.body){total+=chunk.length;if(total>MAX_BYTES){try{await response.body.cancel();}catch(_){}throw new Error('La photo dépasse la limite de 5 Mo.');}chunks.push(Buffer.from(chunk));}
 const buffer=Buffer.concat(chunks),extension=imageType(buffer,contentType),dimensions=extractDimensions(buffer,contentType.split(';')[0].toLowerCase());
 if((dimensions.width&&dimensions.width<150)||(dimensions.height&&dimensions.height<150))throw new Error('La photo est trop petite (minimum 150 × 150 px).');
 return{buffer,extension,...dimensions};
}
module.exports={searchImages,downloadImage};
