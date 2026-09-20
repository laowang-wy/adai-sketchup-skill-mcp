'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),{execFile}=require('node:child_process');
const {guardWritePath}=require('../mcp-contract');
const ROOT=path.resolve(__dirname,'../../attribution');
async function attributionTool(input){
 if(input.command!=='显源'||input.user_requested!==true)throw Error('EXPLICIT_USER_COMMAND_REQUIRED');
 const allowed=new Set(['command','user_requested','output_directory','origin_mm','height_mm','depth_mm','font']);
 if(Object.keys(input).some(k=>!allowed.has(k)))throw Error('UNKNOWN_FIELD');
 if(typeof input.output_directory!=='string'||!path.isAbsolute(input.output_directory))throw Error('ABSOLUTE_OUTPUT_REQUIRED');
 const output=guardWritePath(input.output_directory).target;
 const integrity=JSON.parse(await fs.readFile(path.join(ROOT,'integrity.json'),'utf8'));
 for(const [name,sha] of Object.entries(integrity.files)){
  if(path.basename(name)!==name)throw Error('INVALID_CORE_MANIFEST');
  if(crypto.createHash('sha256').update(await fs.readFile(path.join(ROOT,name))).digest('hex')!==sha)throw Error('ATTRIBUTION_CORE_CHANGED');
 }
 return new Promise(resolve=>{const child=execFile(process.env.SKETCHUP_PYTHON||process.env.PYTHON||'python',['-B',path.join(ROOT,'attribution_entry.py')],{cwd:ROOT,windowsHide:true,timeout:30000,maxBuffer:128*1024,encoding:'utf8',env:{...process.env,PYTHONIOENCODING:'utf-8',PYTHONDONTWRITEBYTECODE:'1'}},(error,stdout,stderr)=>{
  try {const r=JSON.parse(stdout.replace(/^\uFEFF/,''));resolve({...r,scope:'explicit attribution preparation; no SU write until managed step'});}catch {resolve({ok:false,error:'ATTRIBUTION_PREPARATION_FAILED',detail:String(stderr||error?.message||'invalid output').slice(0,800)});}
 });child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify({...input,output_directory:output}));});
}
module.exports={attributionTool};
