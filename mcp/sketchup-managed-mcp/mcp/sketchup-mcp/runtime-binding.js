 'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const run=promisify(execFile);
const adapters=require('./runtime-adapters.json');
const supportedYears=Object.entries(adapters.versions).filter(([,v])=>v.adapter).map(([k])=>Number(k));
const {agentProfile,starterPacket}=require('./agent-profile');
const PACKAGE_ROOT=path.resolve(__dirname,'..','..');
const ENTRY_NAME='launch.cjs';
const CLIENT_BINDING_FILE='mcp-client.json';
function clientBindingPath(appData){return path.join(appData,'SketchUpLiveMCP',CLIENT_BINDING_FILE);}
// The package entry is self-located. Callers never pass or guess a path.
function packageEntry(){const entry=path.join(PACKAGE_ROOT,ENTRY_NAME);return require('node:fs').existsSync(entry)?entry:null;}
async function writeClientBinding(appData){
 const entry=packageEntry();
 if(!entry)throw new Error('MCP_ENTRY_NOT_FOUND_IN_PACKAGE');
 const file=clientBindingPath(appData);
 await fs.mkdir(path.dirname(file),{recursive:true});
 const payload={schema_version:1,entry,note:'Absolute entry of the installed MCP package. Written by the MCP itself; do not hand-edit.',updated_at:new Date().toISOString()};
 const temp=file+'.'+crypto.randomUUID()+'.tmp';await fs.writeFile(temp,JSON.stringify(payload,null,2),{flag:'wx'});await fs.rename(temp,file);
 return payload;
}
// Bounded host-enablement guidance. Never returns directory listings or source.
function hostEnablement(appData){
 const entry=packageEntry();
 return {ok:true,installed_package_root:PACKAGE_ROOT,entry,entry_available:!!entry,client_binding_path:clientBindingPath(appData),
  installed_does_not_mean_enabled:true,
  check_in_order:['宿主配置里该 MCP 是否登记',"该条目 enabled 是否为真",'刷新注册并新建会话','新会话能否列出 sketchup_runtime / sketchup_ref / sketchup_ancient_tool / sketchup_project_begin'],
  enable_steps:["在宿主 MCP 配置中登记上面 entry 的绝对路径",'确认 enabled 为真（仅文件存在不算启用）','重启宿主或刷新 MCP 注册，然后新建会话'],
  toml_note:'Windows 路径写在 TOML 基本字符串中必须转义反斜杠，或改用单引号字面量；转义错误会导致整份配置解析失败，表现为所有 MCP 都消失。',
  helper:'scripts/enable_host_mcp.py --status | --enable（按 --config 指定宿主配置）',
  fallback_script:'scripts/call_sketchup_mcp.mjs（需 --server 或先执行 sketchup_runtime(action=client_binding)）',
  budget_rules:['同类接入失败连续2次且无新证据：停止搜索与阅读实现，报告状态/已证事实/待证假设/下一步','单条输出超约4000字符：落盘，只读所需字段','不要通读 MCP 源码或整份参考库推断调用方式'],
  never:['扫描磁盘查找 SketchUp.exe','用搜索结果当作 MCP 入口','把「独立启动成功」报告为「本机已可用」'],
  report_distinction:['文件已安装','宿主已启用','会话可见','实机已验收']};
}
function validateShortcut(record){
 if(!record||!path.isAbsolute(record.shortcut_path||'')||!path.isAbsolute(record.executable||'')||path.basename(record.executable).toLowerCase()!=='sketchup.exe'||!/^[a-f0-9]{64}$/.test(record.executable_sha256||'')||!/^[a-f0-9]{64}$/.test(record.shortcut_sha256||''))throw new Error('Invalid shortcut inspection record');
 return record;
}
async function inspect(shortcut,skillRoot){
 if(typeof shortcut!=='string'||!path.isAbsolute(shortcut)||!['.lnk','.exe'].includes(path.extname(shortcut).toLowerCase()))throw new Error('Ask the user for the absolute path or uploaded file of their normal SketchUp .lnk shortcut or explicit SketchUp.exe. Do not search for an arbitrary EXE.');
 const {stdout}=await run('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(skillRoot,'scripts','inspect_sketchup_shortcut.ps1'),'-ShortcutPath',shortcut],{windowsHide:true,timeout:30000,maxBuffer:1024*1024,encoding:'utf8'});
 return validateShortcut(JSON.parse(stdout.replace(/^\uFEFF/,'')));
}
async function runtimeBinding(input,appData,skillRoot){
 if(input.action==='startup'){
  const packet=starterPacket(appData,skillRoot);
  // Best effort only: a bounded binding file makes the packaged fallback usable without guessing paths.
  let binding_written=false;
  try{await writeClientBinding(appData);binding_written=true;}catch{/* guidance must never fail on this */}
  return {...packet,client_binding:{path:clientBindingPath(appData),written:binding_written},host_enablement:{installed_does_not_mean_enabled:true,check:['宿主是否登记','enabled 是否为真','刷新后新会话能否列出 sketchup_*']}};
 }
 if(input.action==='client_binding')return {ok:true,...await writeClientBinding(appData),next:'Fallback script may now run without --server. Native host enablement is still preferred.'};
 if(input.action==='host_enablement')return hostEnablement(appData);
 if(input.action==='capabilities')return {ok:true,...adapters,launched:false};
 const agent=agentProfile(appData); 
 const file=path.join(appData,'SketchUpLiveMCP','runtime-target.json');
 if(input.action==='status'){
  let binding;try{binding=JSON.parse(await fs.readFile(file,'utf8'))}catch(e){if(e.code==='ENOENT')return {state:'unconfigured',supported_versions:supportedYears,agent_profile:agent,next_action:'首次配置：请用户提供平时打开 SketchUp 的 .lnk 快捷方式文件或绝对路径，再 inspect_shortcut / bind_shortcut。不得猜选 EXE。',launched:false};throw e}
  const current=await inspect(binding.shortcut_path,skillRoot).catch(e=>({error:e.message}));
  const unchanged=!current.error&&['executable_sha256','shortcut_sha256','executable','arguments','working_directory','version_year'].every(k=>binding[k]===current[k]);
  return {state:unchanged?(supportedYears.includes(current.version_year)?'bound_not_live_verified':'adaptation_required'):'binding_changed',binding_path:file,binding,current,supported_versions:supportedYears,launched:false,next_action:'Verify running executable, bridge version/PID, document and window capture. Binding alone is not live compatibility proof.'};
 }
 if(!['inspect_shortcut','bind_shortcut'].includes(input.action))throw new Error('Unsupported runtime action');
 if(input.user_provided!==true)throw new Error('Shortcut must be supplied by the user; set user_provided only with that evidence.');
 const record=await inspect(input.shortcut_path,skillRoot);
 if(input.action==='inspect_shortcut')return {state:'inspected',...record,supported_versions:supportedYears};
 const binding={schema_version:1,...record,bound_at:new Date().toISOString(),provenance:'user_provided_shortcut',supported_versions:supportedYears};
 await fs.mkdir(path.dirname(file),{recursive:true});
 const temp=file+'.'+crypto.randomUUID()+'.tmp';await fs.writeFile(temp,JSON.stringify(binding,null,2),{flag:'wx'});await fs.rename(temp,file);
 return {state:supportedYears.includes(record.version_year)?'bound_not_live_verified':'adaptation_required',binding_path:file,binding,launched:false,render_profile_changed:false};
}
module.exports={runtimeBinding,validateShortcut,supportedYears};
