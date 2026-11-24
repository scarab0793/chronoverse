(function(root){
"use strict";
function validate(d,m){
 if(!d||d.schema_version!==1||!Array.isArray(d.records))throw Error("Invalid schema: "+m.id);
 if(d.records.length!==m.expected_records||(d.currencies||[]).length!==m.expected_currencies)throw Error("Count mismatch: "+m.id);
 const ids=new Set();
 for(const r of d.records){if(typeof r.id!=="string"||!r.id||ids.has(r.id))throw Error("Invalid ID: "+m.id);ids.add(r.id);}
 if(m.id==="chronoindustry"){const map=new Map(d.records.map(r=>[r.id,r]));const done=new Set(),active=new Set();function visit(id){if(active.has(id)||!map.has(id))throw Error("Invalid dependency: "+id);if(done.has(id))return;active.add(id);for(const dep of map.get(id).dependencies)visit(dep);active.delete(id);done.add(id);}for(const id of ids)visit(id);}
 return d;
}
function freeze(x){if(x&&typeof x==="object"&&!Object.isFrozen(x)){Object.values(x).forEach(freeze);Object.freeze(x);}return x;}
function create(fetcher){
 const cache=new Map();let manifestPromise;
 async function json(path){const r=await fetcher(path);if(!r.ok)throw Error("HTTP "+r.status+": "+path);return r.json();}
 function manifest(){if(!manifestPromise)manifestPromise=json("data/manifest.json").then(m=>{if(m.schema_version!==1||!Array.isArray(m.modules))throw Error("Invalid manifest");const ids=new Set(),paths=new Set();for(const x of m.modules){if(!/^[a-z0-9_]+$/.test(x.id)||x.path!=="data/"+x.id+".json"||ids.has(x.id)||paths.has(x.path)||!Number.isInteger(x.expected_records)||x.expected_records<0||!Number.isInteger(x.expected_currencies)||x.expected_currencies<0)throw Error("Invalid manifest entry");ids.add(x.id);paths.add(x.path);}return freeze(m);}).catch(e=>{manifestPromise=null;throw e;});return manifestPromise;}
 async function load(id){const m=(await manifest()).modules.find(x=>x.id===id||x.path===id);if(!m)throw Error("Unknown module: "+id);if(!cache.has(m.id))cache.set(m.id,json(m.path).then(d=>freeze(validate(d,m))).catch(e=>{cache.delete(m.id);throw e;}));return cache.get(m.id);}
 async function audit(){const m=await manifest();return Promise.all(m.modules.map(async x=>{try{const d=await load(x.id);return {id:x.id,ok:true,records:d.records.length,currencies:(d.currencies||[]).length};}catch(e){return {id:x.id,ok:false,error:e.message,records:0,currencies:0};}}));}
 async function get(module,id){return (await load(module)).records.find(r=>r.id===id)||null;}
 async function search(module,query){const q=String(query).toLocaleLowerCase("hu");return (await load(module)).records.filter(r=>JSON.stringify(r).toLocaleLowerCase("hu").includes(q));}
 return Object.freeze({manifest,load,audit,get,search});
}
if(typeof module!=="undefined"&&module.exports)module.exports={create,validate};else root.ChronoDB=create(root.fetch.bind(root));
})(globalThis);
