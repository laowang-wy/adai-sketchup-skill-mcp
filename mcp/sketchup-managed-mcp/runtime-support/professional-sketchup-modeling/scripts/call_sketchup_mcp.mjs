#!/usr/bin/env node
// Portable fallback. Explicit entry/binding only; never search disks or infer install layout.
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const argv=process.argv.slice(2);
const value=(k,d='')=>{const i=argv.indexOf(k);return i<0?d:argv[i+1];};
const fail=(code,extra={})=>{console.error(JSON.stringify({ok:false,code,...extra}));process.exit(1);};
const bindingPath=value('--binding',path.join(process.env.APPDATA||path.join(os.homedir(),'AppData','Roaming'),'SketchUpLiveMCP','mcp-client.json'));
let saved={};
try {if(fs.existsSync(bindingPath))saved=JSON.parse(fs.readFileSync(bindingPath,'utf8').replace(/^\uFEFF/,''));}catch{fail('INVALID_CLIENT_BINDING',{binding:bindingPath});}
const server=value('--server',process.env.SKETCHUP_MCP_ENTRY||saved.entry||'');
if(!server||!path.isAbsolute(server)||!fs.existsSync(server))fail('MCP_ENTRY_REQUIRED',{binding:bindingPath,next:'Enable the installed MCP in the host. For an explicit fallback pass --server <absolute launch.cjs>, or run sketchup_runtime(action=client_binding) once. Do not scan directories.'});
const tool=value('--tool');
if(!tool)fail('TOOL_REQUIRED');
let args;try{args=JSON.parse(value('--args','{}'));}catch{fail('INVALID_ARGUMENT_JSON');}
const timeout=Number(value('--timeout','30000'));if(!Number.isFinite(timeout)||timeout<100||timeout>300000)fail('INVALID_TIMEOUT');
const output=value('--output');if(output&&(!path.isAbsolute(output)||fs.existsSync(output)))fail('OUTPUT_MUST_BE_NEW_ABSOLUTE_FILE');
const child=spawn(process.execPath,[server],{cwd:path.dirname(server),windowsHide:true,env:{...process.env},stdio:['pipe','pipe','pipe']});
let buf='',stderr='',nextId=0,done=false;const pending=new Map();
function end(payload,code=0){if(done)return;done=true;clearTimeout(timer);child.stdin.end();child.kill();
 const text=JSON.stringify(payload);if(text.length>6000){
  const file=output||path.join(fs.mkdtempSync(path.join(os.tmpdir(),'adai-mcp-result-')),'result.json');fs.writeFileSync(file,text,{flag:'wx'});
  console.log(JSON.stringify({ok:code===0,tool,output_path:file,characters:text.length,inline:false,next:'Read only the fields you need from the result file; never print the whole file.'}));
 }else {if(output)fs.writeFileSync(output,text,{flag:'wx'});console.log(text);}process.exitCode=code;}
child.stdout.on('data',c=>{buf+=c.toString();let i;while((i=buf.indexOf('\n'))>=0){const line=buf.slice(0,i);buf=buf.slice(i+1);if(!line.trim())continue;try{const msg=JSON.parse(line);const p=pending.get(msg.id);if(p){pending.delete(msg.id);p(msg);}}catch{/* non-JSON stdout is ignored */}}});
child.stderr.on('data',c=>{stderr=(stderr+c.toString()).slice(-1200);});
child.on('error',e=>end({ok:false,code:'MCP_START_FAILED',error:e.message},1));
child.on('exit',()=>{if(!done)end({ok:false,code:'MCP_EXITED',detail:stderr},1);});
function rpc(method,params){return new Promise(resolve=>{const id=++nextId;pending.set(id,resolve);child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});}
function decoded(msg){if(msg.error)throw Error(msg.error.message);const text=msg.result?.content?.find(c=>c.type==='text')?.text;return text?JSON.parse(text):msg.result;}
const timer=setTimeout(()=>end({ok:false,code:'RESULT_UNKNOWN',tool,next:'Check request/project status before retrying a write. Do not replay geometry.',detail:stderr},1),timeout);
try{
 // 0.5.3 identifies this portable client's own protocol implementation, not the MCP package release.
 await rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'adai-portable-client',version:'0.5.3'}});
 child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized',params:{}})+'\n');
 const card=decoded(await rpc('tools/call',{name:'sketchup_runtime',arguments:{action:'startup'}}));
 if(tool==='sketchup_runtime'&&args.action==='startup')end(card);
 else if(card.guidance&&!['sketchup_runtime','sketchup_ref'].includes(tool)&&value('--ack-startup')!==card.card_sha256)end({ok:false,code:'READ_STARTUP_FIRST',startup:card,next:'Read guidance; repeat the original command with --ack-startup <card_sha256>. This acknowledges reading, not model identity.'},1);
 else{const raw=await rpc('tools/call',{name:tool,arguments:args});const result=decoded(raw);end(result,raw.result?.isError||result?.ok===false?1:0);}
}catch(e){end({ok:false,code:'CLIENT_ERROR',error:e.message},1);}
