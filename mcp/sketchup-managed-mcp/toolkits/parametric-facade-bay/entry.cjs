'use strict';
const fs=require('node:fs');
const path=require('node:path');

function number(value,name,min,max){
  if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max) throw new Error(`${name}_OUT_OF_RANGE`);
  return value;
}
function parameters(input){
  const p=input.parameters;
  if(!p||typeof p!=='object'||Array.isArray(p)) throw new Error('PARAMETERS_REQUIRED');
  const keys=Object.keys(p).sort();
  const expected=['bay_count','depth_mm','height_mm','opening_ratio','sill_mm','width_mm'];
  if(keys.length!==expected.length||keys.some((k,i)=>k!==expected[i])) throw new Error('FIELD_MISMATCH');
  const width=number(p.width_mm,'WIDTH_MM',1800,48000);
  const height=number(p.height_mm,'HEIGHT_MM',1800,18000);
  const depth=number(p.depth_mm,'DEPTH_MM',120,1200);
  const openingRatio=number(p.opening_ratio,'OPENING_RATIO',0.2,0.82);
  const sill=number(p.sill_mm,'SILL_MM',0,2400);
  if(!Number.isInteger(p.bay_count)||p.bay_count<1||p.bay_count>12) throw new Error('BAY_COUNT_OUT_OF_RANGE');
  const bayWidth=width/p.bay_count;
  const openingWidth=bayWidth*openingRatio;
  if(sill>=height-600) throw new Error('SILL_LEAVES_NO_LINTEL');
  if(bayWidth-openingWidth<180) throw new Error('PIER_TOO_NARROW');
  return {width_mm:width,height_mm:height,depth_mm:depth,bay_count:p.bay_count,opening_ratio:openingRatio,sill_mm:sill,bay_width_mm:bayWidth,opening_width_mm:openingWidth,pier_width_mm:(bayWidth-openingWidth)/2,lintel_mm:height-sill-600};
}
function ruby(p,phase='massing'){
  const crypto=require('node:crypto');
  const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
  const template=fs.readFileSync(path.join(__dirname,'build-template.rb'),'utf8');
  // Explicit string keys also work on SketchUp 2019 / Ruby 2.5.
  const hash='{'+Object.entries(p).map(([key,value])=>`${JSON.stringify(key)} => ${JSON.stringify(value)}`).join(', ')+'}';
  return template.replace('__PHASE__',phase).replace('__PARAMS__',hash)
    .replace('__PARAMETER_HASH__',sha(JSON.stringify(p)))
    .replace('__GENERATOR_HASH__',sha(fs.readFileSync(__filename,'utf8')+template));
}
function main(input){
  if(!input||!['list','validate','compile'].includes(input.action)) throw new Error('UNKNOWN_ACTION');
  if(input.action==='list') return {method_family:'parametric_facade_bay',scope:'small facade-bay massing with repeated openings; no interior, structure or visual acceptance',parameters:['width_mm','height_mm','depth_mm','bay_count','opening_ratio','sill_mm'],feedback:['PIER_TOO_NARROW','SILL_LEAVES_NO_LINTEL','BAY_COUNT_OUT_OF_RANGE'],next_tool:'sketchup_project_step',requires_review:true};
  const p=parameters(input);
  if(input.action==='validate') return {ok:true,parameters:p,feedback:{expected_bays:p.bay_count,expected_opening_width_mm:p.opening_width_mm,expected_pier_width_mm:p.pier_width_mm},scope:'parameter contract only; no SketchUp execution'};
  if(typeof input.output_directory!=='string'||!path.isAbsolute(input.output_directory)) throw new Error('ABSOLUTE_OUTPUT_REQUIRED');
  if(fs.existsSync(input.output_directory)) throw new Error('OUTPUT_EXISTS');
  fs.mkdirSync(input.output_directory,{recursive:true});
  const rubyPath=path.join(input.output_directory,'build.rb');
  const manifest={schema_version:1,method_family:'parametric_facade_bay',phase:'massing',parameters:p,files:{ruby:'build.rb'},execution_contract:{next_tool:'sketchup_project_step',phase:'massing',requires_live_readback:true,requires_review:true},feedback:{expected_bays:p.bay_count,expected_opening_width_mm:p.opening_width_mm,expected_pier_width_mm:p.pier_width_mm}};
  manifest.files.finish_ruby='finish.rb';
  manifest.geometry_scope={opening_ratio:'horizontal clear width / bay width',opening_height_mm:600,dimension_tolerance_mm:0.1};
  fs.writeFileSync(rubyPath,ruby(p),'utf8');
  fs.writeFileSync(path.join(input.output_directory,'finish.rb'),ruby(p,'finish'),'utf8');
  fs.writeFileSync(path.join(input.output_directory,'manifest.json'),JSON.stringify(manifest,null,2)+'\n','utf8');
  return {ok:true,manifest,ruby_file:rubyPath,finish_ruby_file:path.join(input.output_directory,'finish.rb'),production_ready:false,scope:'compiled managed Ruby; actual readback and visual review must run through sketchup_project_step'};
}
let raw='';process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>raw+=chunk);process.stdin.on('end',()=>{try{console.log(JSON.stringify(main(JSON.parse(raw))));}catch(error){console.log(JSON.stringify({ok:false,error:String(error.message||error)}));process.exitCode=2;}});
