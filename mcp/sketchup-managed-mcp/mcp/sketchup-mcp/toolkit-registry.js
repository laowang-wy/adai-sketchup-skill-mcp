'use strict';
// Portable stdio tool-package protocol v1. Registration copies explicitly trusted code;
// read-only discovery never executes it. Hash pinning detects modification, not publisher identity.
const fs=require('node:fs/promises'),fss=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFile}=require('node:child_process');
const {guardWritePath}=require('../mcp-contract');
const BUNDLED=path.resolve(__dirname,'../../toolkits');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const canonical=value=>Array.isArray(value)?`[${value.map(canonical).join(',')}]`:value&&typeof value==='object'?`{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`:JSON.stringify(value);
const idOK=s=>typeof s==='string'&&/^[a-z0-9][a-z0-9._-]{1,63}$/.test(s)&&!['__proto__','constructor','prototype'].includes(s);
function within(root,p){const rel=path.relative(root,p);return rel===''||(!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel));}
async function snapshot(root){
 root=await fs.realpath(root);const files={};let bytes=0;
 async function walk(dir){for(const e of await fs.readdir(dir,{withFileTypes:true})){
  if(e.name==='__pycache__'||e.name==='.git')continue;
  if(e.name==='official-pack.json'||e.name==='official-pack.sig'){if(e.isSymbolicLink()||!e.isFile())throw Error('NON_REGULAR_FILE');continue;}
  const p=path.join(dir,e.name);
  if(e.isSymbolicLink())throw Error('SYMLINK_NOT_ALLOWED');
  if(e.isDirectory()){await walk(p);continue;}
  if(!e.isFile())throw Error('NON_REGULAR_FILE');
  const rel=path.relative(root,p).split(path.sep).join('/'),b=await fs.readFile(p);bytes+=b.length;
  if(bytes>64*1024*1024||Object.keys(files).length>=500)throw Error('PACKAGE_BUDGET_EXCEEDED');
  files[rel]=hash(b);
 }}await walk(root);
 const text=await fs.readFile(path.join(root,'toolkit.json'),'utf8');const manifest=JSON.parse(text.replace(/^\uFEFF/,''));
 if(manifest.schema_version!==1||!idOK(manifest.id)||!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(manifest.version||''))throw Error('INVALID_TOOLKIT_ID_VERSION');
 if(!['python','node'].includes(manifest.runtime)||typeof manifest.entry!=='string'||!files[manifest.entry]||path.isAbsolute(manifest.entry)||manifest.entry.split(/[\\/]/).includes('..'))throw Error('INVALID_ENTRY');
 if(!manifest.author||!manifest.license||!manifest.actions||typeof manifest.actions!=='object'||Array.isArray(manifest.actions))throw Error('MANIFEST_FIELDS_REQUIRED');
 for(const [name,a] of Object.entries(manifest.actions))if(!/^[a-z_]{1,32}$/.test(name)||!a||!['read','compile'].includes(a.effect))throw Error('INVALID_ACTION_EFFECT');
 return {root,manifest,files,fingerprint:hash(JSON.stringify(Object.entries(files).sort())),bytes};
}
function store(app){return path.join(app,'SketchUpLiveMCP','toolkits');}
async function records(app){try{const d=JSON.parse(await fs.readFile(path.join(store(app),'registry.json'),'utf8'));if(d.schema_version!==1||!d.packages||typeof d.packages!=='object')throw Error('REGISTRY_INVALID');d.history=d.history&&typeof d.history==='object'?d.history:{};d.pending_updates=d.pending_updates&&typeof d.pending_updates==='object'?d.pending_updates:{};return d;}catch(e){if(e.code==='ENOENT')return {schema_version:1,packages:{},history:{},pending_updates:{}};throw e;}}
async function saveRecords(app,d){await fs.mkdir(store(app),{recursive:true});const tmp=path.join(store(app),'registry-'+crypto.randomUUID()+'.tmp');await fs.writeFile(tmp,JSON.stringify(d,null,2),{flag:'wx'});await fs.rename(tmp,path.join(store(app),'registry.json'));}
async function bundled(){const found=[],errors=[];for(const e of await fs.readdir(BUNDLED,{withFileTypes:true}))if(e.isDirectory()&&fss.existsSync(path.join(BUNDLED,e.name,'toolkit.json'))) {try{found.push(await snapshot(path.join(BUNDLED,e.name)));}catch(error){errors.push({directory:e.name,error:String(error.message),isolated:true});}}return {packages:found,errors};}
function skillRoot(){
 const source=path.resolve(__dirname,'../../../professional-sketchup-modeling');
 return fss.existsSync(source)?source:path.resolve(__dirname,'../../runtime-support/professional-sketchup-modeling');
}
async function bindProjectToolkit(app, projectId, binding){
 const {ManagedProjects}=require('./managed-project');
 const manager=new ManagedProjects({appDataDir:app,skillRoot:skillRoot()});
 const state=await manager.loadState(projectId);
 const bindings=Array.isArray(state.toolkit_bindings)?state.toolkit_bindings.slice():[];
 const current=bindings.find((item)=>item&&item.id===binding.id);
 if(current)return state;
 bindings.push({id:binding.id,version:binding.version,fingerprint:binding.fingerprint,origin:binding.origin||'registered',bound_at:new Date().toISOString()});
 state.toolkit_bindings=bindings;
 await manager.saveState(state);
 return state;
}
async function requiredCapabilities(manifest){
 const required=Array.isArray(manifest?.requires_capabilities)?manifest.requires_capabilities.map(String):[];
 if(!required.length)return;
 const known=new Set(['PipClawManagedProject.register_projection_subject','PipClawManagedProject.register_archetype','PipClawManagedProject.instantiate_archetype','PipClawManagedProject.register_visible_detail','PipClawManagedProject.register_unique_detail','PipClawManagedProject.register_variant','PipClawManagedProject.register_primary_correction']);
 const missing=required.filter((name)=>!known.has(name));
 if(missing.length) throw Object.assign(new Error(`TOOLKIT_CAPABILITY_UNAVAILABLE: ${missing.join(', ')}`),{code:'TOOLKIT_CAPABILITY_UNAVAILABLE',missing});
}
async function copyInspected(source, destination, files){
 await fs.mkdir(destination,{recursive:true});
 for(const rel of Object.keys(files)){const src=path.join(source,rel);if((await fs.lstat(src)).isSymbolicLink()||!within(source,await fs.realpath(src)))throw Error('SOURCE_CHANGED');const target=path.join(destination,rel);await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(src,target);}
 for(const metadata of ['official-pack.json','official-pack.sig']){const src=path.join(source,metadata);if(fss.existsSync(src)){const stat=await fs.lstat(src);if(stat.isSymbolicLink()||!stat.isFile()||!within(source,await fs.realpath(src)))throw Error('SOURCE_CHANGED');const target=path.join(destination,metadata);await fs.copyFile(src,target);}}
 const copied=await snapshot(destination);if(copied.fingerprint!==hash(JSON.stringify(Object.entries(files).sort())))throw Error('SOURCE_CHANGED');return copied;
}
async function officialStatus(root, snapshotInfo, app){
 const manifestPath=path.join(root,'official-pack.json'),sigPath=path.join(root,'official-pack.sig');
 const sidecar=fss.existsSync(manifestPath),signature=fss.existsSync(sigPath);
 if(!sidecar&&!signature)return {status:'not_configured',reason:'official-pack.json and official-pack.sig are absent'};
 if(!sidecar||!signature)return {status:'invalid',reason:'official sidecar and detached signature must be supplied together'};
 let doc;try{doc=JSON.parse(await fs.readFile(manifestPath,'utf8'));}catch(error){return {status:'invalid',reason:'official-pack.json is not valid JSON'};}
 const payload=doc?.signed_payload;
 if(!payload||payload.pack_id!==snapshotInfo.manifest.id||payload.version!==snapshotInfo.manifest.version||payload.fingerprint!==snapshotInfo.fingerprint)return {status:'invalid',reason:'official payload does not match package manifest or fingerprint'};
 const keyPath=process.env.SKETCHUP_TOOLKIT_OFFICIAL_PUBLIC_KEY||path.join(app,'SketchUpLiveMCP','trust','official-public-key.pem');
 if(!fss.existsSync(keyPath))return {status:'not_configured',reason:'approved official public key is not configured',sidecar_present:true,key_path:keyPath};
 let sig;try{const text=(await fs.readFile(sigPath,'utf8')).trim();sig=/^[A-Fa-f0-9]+$/.test(text)?Buffer.from(text,'hex'):Buffer.from(text,'base64');}catch(error){return {status:'invalid',reason:'detached signature cannot be read'};}
 try{const key=await fs.readFile(keyPath);const valid=crypto.verify(null,Buffer.from(canonical(payload)),key,sig);return {status:valid?'verified':'invalid',publisher:payload.publisher||null,key_id:doc.key_id||null,key_path:keyPath};}catch(error){return {status:'invalid',reason:'official public key or signature algorithm is invalid'};}
}
async function activeBindings(app, toolkitId, fingerprint){
 const root=path.join(app,'SketchUpLiveMCP','managed-projects');let entries=[];try{entries=await fs.readdir(root,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return {known:true,items:[]};throw error;}
 const {ManagedProjects}=require('./managed-project');
 const manager=new ManagedProjects({appDataDir:app,skillRoot:skillRoot()});
 const items=[];
 for(const entry of entries.filter(e=>e.isDirectory())){
  let state;try{state=await manager.readStoredStateForCas(entry.name);}catch(error){if(error.code==='ENOENT')continue;return {known:false,error:'TOOLKIT_DEPENDENCY_STATE_UNVERIFIED'};}
  if(!state)continue;
  const bindings=Array.isArray(state.toolkit_bindings)?state.toolkit_bindings:[];
  if(bindings.some(b=>b&&b.id===toolkitId&&b.fingerprint===fingerprint&&state.status!=='finished'))items.push({project_id:state.project_id||entry.name,status:state.status||'unknown'});
 }
 return {known:true,items};
}
async function resolveMethodBinding(app, methodFamily){
 const family=String(methodFamily||'').trim().toLowerCase();if(!family)return null;const discovered=await bundled(),found=discovered.packages,reg=await records(app);
 const registered=Object.values(reg.packages).filter(p=>p.enabled!==false).map(p=>({id:p.id,version:p.version,fingerprint:p.fingerprint,method_family:p.method_family||null,origin:'registered'}));
 const candidate=registered.find(p=>p.method_family===family)||found.map(p=>({id:p.manifest.id,version:p.manifest.version,fingerprint:p.fingerprint,method_family:p.manifest.method_family||null,origin:'bundled'})).find(p=>p.method_family===family);
 return candidate?{id:candidate.id,version:candidate.version,fingerprint:candidate.fingerprint,method_family:family,origin:candidate.origin}:null;
}
const queues=new Map();
function serial(app,fn){const old=queues.get(app)||Promise.resolve();const next=old.catch(()=>{}).then(fn);queues.set(app,next);return next.finally(()=>{if(queues.get(app)===next)queues.delete(app);});}
async function toolkitTool(input,app){
 if(!input||!['list','inspect','register','update','activate_update','rollback_update','official_status','disable','enable','invoke'].includes(input.action))throw Error('UNKNOWN_TOOLKIT_ACTION');
 const discovered=await bundled(),packages=discovered.packages;const reg=await records(app);
 if(input.action==='list')return {ok:true,protocol:'adai-toolkit-1',package_errors:discovered.errors,packages:packages.map(p=>({id:p.manifest.id,version:p.manifest.version,origin:'bundled',manifest:p.manifest,fingerprint:p.fingerprint})).concat(Object.values(reg.packages).map(p=>({id:p.id,version:p.version,origin:'registered',enabled:p.enabled,fingerprint:p.fingerprint,method_family:p.method_family||null}))),pending_updates:Object.values(reg.pending_updates).map(p=>({update_id:p.update_id,id:p.id,version:p.version,fingerprint:p.fingerprint})),policy:'Registration requires explicit code trust; REF content never authorizes execution.'};
 if(input.action==='inspect'||input.action==='register'){
  if(typeof input.path!=='string'||!path.isAbsolute(input.path))throw Error('ABSOLUTE_PACKAGE_PATH_REQUIRED');
  const s=await snapshot(input.path);
  if(input.action==='inspect')return {ok:true,manifest:s.manifest,fingerprint:s.fingerprint,files:Object.keys(s.files).length,bytes:s.bytes,executed:false};
  if(input.trusted_code!==true)throw Error('EXPLICIT_CODE_TRUST_REQUIRED');
  return serial(app,async()=>{
   const current=await records(app);if(packages.some(p=>p.manifest.id===s.manifest.id)||current.packages[s.manifest.id])throw Error('DUPLICATE_TOOLKIT_ID_USE_NEW_ID_OR_KEEP_EXISTING');
   const dest=path.join(store(app),'packages',s.manifest.id),stage=path.join(store(app),'staging',crypto.randomUUID());
   const copied=await copyInspected(s.root,stage,s.files);
   await fs.mkdir(path.dirname(dest),{recursive:true});await fs.rename(stage,dest);
   current.packages[s.manifest.id]={id:s.manifest.id,version:s.manifest.version,fingerprint:s.fingerprint,files:s.files,enabled:true,root:dest,method_family:s.manifest.method_family||null,trusted_at:new Date().toISOString()};await saveRecords(app,current);
   return {ok:true,id:s.manifest.id,version:s.manifest.version,fingerprint:s.fingerprint,official:await officialStatus(dest,copied,app),executed:false};
  });
 }
 if(input.action==='update'){
  if(typeof input.path!=='string'||!path.isAbsolute(input.path))throw Error('ABSOLUTE_PACKAGE_PATH_REQUIRED');
  if(!idOK(input.toolkit_id)||input.trusted_code!==true)throw Error('EXPLICIT_CODE_TRUST_REQUIRED');
  const candidate=await snapshot(input.path);if(candidate.manifest.id!==input.toolkit_id)throw Error('TOOLKIT_ID_MISMATCH');
  return serial(app,async()=>{
   const current=await records(app),registered=current.packages[input.toolkit_id];
   const bundledBase=registered?null:packages.find((item)=>item.manifest.id===input.toolkit_id);
   const old=registered|| (bundledBase ? {...bundledBase.manifest, id:bundledBase.manifest.id, version:bundledBase.manifest.version, fingerprint:bundledBase.fingerprint, files:bundledBase.files, root:bundledBase.root, enabled:true, origin:'bundled'} : null);
   if(!old)throw Error('REGISTERED_TOOLKIT_NOT_FOUND');
   if(input.expected_fingerprint&&input.expected_fingerprint!==old.fingerprint)throw Error('CURRENT_TOOLKIT_VERSION_LOCK_MISMATCH');
   if(candidate.fingerprint===old.fingerprint)throw Error('TOOLKIT_ALREADY_CURRENT');
   if(candidate.manifest.version===old.version)throw Object.assign(new Error('TOOLKIT_VERSION_BYTES_MISMATCH'),{code:'TOOLKIT_VERSION_BYTES_MISMATCH'});
   const updateId=crypto.randomUUID(),stage=path.join(store(app),'staging',updateId),copied=await copyInspected(candidate.root,stage,candidate.files);
   current.pending_updates[updateId]={update_id:updateId,id:candidate.manifest.id,version:candidate.manifest.version,fingerprint:candidate.fingerprint,files:candidate.files,method_family:candidate.manifest.method_family||null,root:stage,created_at:new Date().toISOString(),base_fingerprint:old.fingerprint,base_origin:old.origin||'registered'};
   await saveRecords(app,current);
   return {ok:true,status:'staged',update_id:updateId,id:candidate.manifest.id,version:candidate.manifest.version,fingerprint:candidate.fingerprint,previous:{version:old.version,fingerprint:old.fingerprint},official:await officialStatus(stage,copied,app),activated:false};
  });
 }
 if(input.action==='official_status'){
  let s=packages.find(p=>p.manifest.id===input.toolkit_id);if(!s){const p=reg.packages[input.toolkit_id];if(!p)throw Error('TOOLKIT_NOT_FOUND');s=await snapshot(path.join(store(app),'packages',input.toolkit_id));if(s.fingerprint!==p.fingerprint)return {ok:true,id:s.manifest.id,version:s.manifest.version,fingerprint:s.fingerprint,registered_fingerprint:p.fingerprint,official:{status:'modified_local',reason:'installed toolkit bytes differ from the registered fingerprint; execution remains blocked until an explicit update or rollback',expected_fingerprint:p.fingerprint,actual_fingerprint:s.fingerprint},requires_review:true};}
  return {ok:true,id:s.manifest.id,version:s.manifest.version,fingerprint:s.fingerprint,official:await officialStatus(s.root,s,app)};
 }
 if(input.action==='activate_update')return serial(app,async()=>{
  const current=await records(app),pending=current.pending_updates[input.update_id];if(!pending)throw Error('PENDING_UPDATE_NOT_FOUND');
  const bundledOld=packages.find((item)=>item.manifest.id===pending.id);
  const old=current.packages[pending.id] || (pending.base_origin==='bundled' && bundledOld ? {...bundledOld.manifest,id:bundledOld.manifest.id,version:bundledOld.manifest.version,fingerprint:bundledOld.fingerprint,files:bundledOld.files,root:bundledOld.root,enabled:true,origin:'bundled'} : null);
  if(!old||old.fingerprint!==pending.base_fingerprint)throw Error('UPDATE_BASE_CHANGED');
  const inUse=await activeBindings(app,old.id,old.fingerprint);if(!inUse.known)throw Object.assign(new Error(inUse.error),{code:inUse.error});if(inUse.items.length) {const e=Error('A managed project still depends on the current toolkit version');e.code='PACK_VERSION_IN_USE';e.projects=inUse.items;throw e;}
  const staged=await snapshot(pending.root);if(staged.fingerprint!==pending.fingerprint)throw Error('PENDING_UPDATE_CHANGED');
  const official=await officialStatus(pending.root,staged,app);if(official.status==='invalid')throw Object.assign(new Error('OFFICIAL_PACKAGE_SIGNATURE_INVALID'),{code:'OFFICIAL_PACKAGE_SIGNATURE_INVALID',official});
  const dest=path.join(store(app),'packages',pending.id),historyRoot=path.join(store(app),'history',pending.id,`${old.version}-${old.fingerprint.slice(0,16)}`);
  await fs.mkdir(path.dirname(historyRoot),{recursive:true});
  let archived=false, promoted=false;
  try {
   if(old.origin==='bundled') await copyInspected(old.root,historyRoot,old.files); else { await fs.rename(dest,historyRoot); archived=true; }
   current.history[pending.id]=[...(current.history[pending.id]||[]),{...old,root:historyRoot,archived_at:new Date().toISOString()}];
   await fs.rename(pending.root,dest);promoted=true;
   current.packages[pending.id]={...pending,root:dest,origin:'registered',enabled:true,activated_at:new Date().toISOString()};delete current.pending_updates[input.update_id];await saveRecords(app,current);
  } catch(error) {
   if(promoted) await fs.rename(dest,pending.root).catch(()=>{});
   if(archived && !fss.existsSync(dest) && fss.existsSync(historyRoot)) await fs.rename(historyRoot,dest).catch(()=>{});
   throw error;
  }
  return {ok:true,status:'activated',id:pending.id,version:pending.version,fingerprint:pending.fingerprint,previous:{version:old.version,fingerprint:old.fingerprint},official};
 });
 if(input.action==='rollback_update')return serial(app,async()=>{
  const current=await records(app),active=current.packages[input.toolkit_id];if(!active)throw Error('REGISTERED_TOOLKIT_NOT_FOUND');const target=(current.history[input.toolkit_id]||[]).find(x=>x.fingerprint===input.target_fingerprint);if(!target)throw Error('HISTORICAL_TOOLKIT_VERSION_NOT_FOUND');
  const inUse=await activeBindings(app,active.id,active.fingerprint);if(!inUse.known)throw Object.assign(new Error(inUse.error),{code:inUse.error});if(inUse.items.length){const e=Error('A managed project still depends on the active toolkit version');e.code='PACK_VERSION_IN_USE';e.projects=inUse.items;throw e;}
  const dest=path.join(store(app),'packages',active.id),currentHistory=path.join(store(app),'history',active.id,`${active.version}-${active.fingerprint.slice(0,16)}-${Date.now()}`);
  const targetSnapshot=await snapshot(target.root);if(targetSnapshot.fingerprint!==target.fingerprint)throw Object.assign(new Error('HISTORICAL_TOOLKIT_CHANGED'),{code:'HISTORICAL_TOOLKIT_CHANGED'});
  await fs.rename(dest,currentHistory);await fs.rename(target.root,dest);
  current.history[input.toolkit_id]=[...(current.history[input.toolkit_id]||[]).filter(x=>x.fingerprint!==target.fingerprint),{...active,root:currentHistory,archived_at:new Date().toISOString()}];current.packages[input.toolkit_id]={...target,root:dest,enabled:true,activated_at:new Date().toISOString()};await saveRecords(app,current);
  const restored=await snapshot(dest);return {ok:true,status:'rolled_back',id:active.id,version:target.version,fingerprint:target.fingerprint,previous:{version:active.version,fingerprint:active.fingerprint},official:await officialStatus(dest,restored,app)};
 });
 if(!idOK(input.toolkit_id))throw Error('INVALID_TOOLKIT_ID');
 if(['enable','disable'].includes(input.action))return serial(app,async()=>{const current=await records(app),p=current.packages[input.toolkit_id];if(!p)throw Error('REGISTERED_TOOLKIT_NOT_FOUND');p.enabled=input.action==='enable';await saveRecords(app,current);return {ok:true,id:p.id,enabled:p.enabled};});
 let s=null;
 const record=reg.packages[input.toolkit_id];
 if(record && record.enabled!==false){const root=path.join(store(app),'packages',input.toolkit_id);s=await snapshot(root);if(s.fingerprint!==record.fingerprint)throw Error('TOOLKIT_CHANGED_REVIEW_REQUIRED');}
 if(!s)s=packages.find(p=>p.manifest.id===input.toolkit_id);
 if(!s)throw Error('TOOLKIT_NOT_ENABLED');
 if(input.project_id){if(!/^[A-Za-z][A-Za-z0-9_-]{2,63}$/.test(String(input.project_id)))throw Error('INVALID_PROJECT_ID');const statePath=path.join(app,'SketchUpLiveMCP','managed-projects',String(input.project_id),'state.json');try{const state=JSON.parse(await fs.readFile(statePath,'utf8'));const binding=(state.toolkit_bindings||[]).find(b=>b&&b.id===input.toolkit_id);if(binding&&binding.fingerprint!==s.fingerprint){const historical=(reg.history[input.toolkit_id]||[]).find(x=>x.fingerprint===binding.fingerprint);if(!historical)throw Error('PACK_VERSION_UNAVAILABLE');s=await snapshot(historical.root);if(s.fingerprint!==binding.fingerprint)throw Error('PACK_VERSION_UNAVAILABLE');}}catch(error){if(error.code==='ENOENT'){}else throw error;}}
 await requiredCapabilities(s.manifest);
 if(input.project_id){
  const state=await bindProjectToolkit(app,String(input.project_id),{id:s.manifest.id,version:s.manifest.version,fingerprint:s.fingerprint,origin:record?'registered':'bundled'});
  const binding=(state.toolkit_bindings||[]).find((item)=>item&&item.id===input.toolkit_id);
  if(binding&&binding.fingerprint!==s.fingerprint){const historical=(reg.history[input.toolkit_id]||[]).find(x=>x.fingerprint===binding.fingerprint);if(!historical)throw Error('PACK_VERSION_UNAVAILABLE');s=await snapshot(historical.root);if(s.fingerprint!==binding.fingerprint)throw Error('PACK_VERSION_UNAVAILABLE');}
 }
 const action=s.manifest.actions[input.operation];if(!action)throw Error('UNKNOWN_TOOLKIT_OPERATION');
 if(input.expected_fingerprint&&input.expected_fingerprint!==s.fingerprint)throw Error('TOOLKIT_VERSION_LOCK_MISMATCH');
 const args=input.arguments||{};if(typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(k=>k==='action'||k==='__proto__'))throw Error('INVALID_ARGUMENTS');
 let output;
 if(action.effect==='compile'){
  if(typeof args.output_directory!=='string'||!path.isAbsolute(args.output_directory))throw Error('ABSOLUTE_OUTPUT_REQUIRED');output=guardWritePath(args.output_directory).target;
  const ancestor=async(p)=>{while(!fss.existsSync(p)){const parent=path.dirname(p);if(parent===p)break;p=parent;}return fs.realpath(p);};
  const actual=await ancestor(output);if(within(path.resolve(__dirname,'../..'),actual)||within(path.resolve(store(app)),actual))throw Error('OUTPUT_IN_INSTALLED_ASSET');
  if(fss.existsSync(output))throw Error('OUTPUT_EXISTS');
 }
 const exe=s.manifest.runtime==='python'?(process.env.SKETCHUP_PYTHON||process.env.PYTHON||'python'):process.execPath;
 const argv=[...(s.manifest.runtime==='python'?['-B']:[]),path.join(s.root,s.manifest.entry)];
 return new Promise(resolve=>{const p=execFile(exe,argv,{cwd:s.root,windowsHide:true,timeout:90000,maxBuffer:2*1024*1024,encoding:'utf8',env:{...process.env,PYTHONIOENCODING:'utf-8',PYTHONDONTWRITEBYTECODE:'1'}},(error,stdout,stderr)=>{
  if(error){let diagnostic;try{diagnostic=JSON.parse(String(stdout).replace(/^\uFEFF/,''));}catch{} resolve({ok:false,error:error.killed?'TOOLKIT_TIMEOUT_RECONCILE_OUTPUT':diagnostic?.ok===false?diagnostic.error:'TOOLKIT_PROCESS_FAILED',detail:String(stderr||error.message).slice(0,1200),output_directory:output||null});return;}
  try{const result=JSON.parse(stdout.replace(/^\uFEFF/,''));resolve({...result,toolkit:{id:s.manifest.id,version:s.manifest.version,fingerprint:s.fingerprint},scope:'offline tool operation; no managed SketchUp execution'});}catch{resolve({ok:false,error:'INVALID_TOOLKIT_JSON'});}
 });p.stdin.on('error',()=>{});p.stdin.end(JSON.stringify({...args,...(output?{output_directory:output}:{}),action:input.operation}));});
}
module.exports={toolkitTool,snapshot,resolveMethodBinding,officialStatus};
