"""Compile declared parts into the shared managed geometry kernel; never operates SketchUp."""
import argparse,base64,json,hashlib,time,re
from pathlib import Path
from geometry.contracts import validate,thicken,intersection_check,VERSION
ROOT=Path(__file__).resolve().parent
CONTRACT_PATH=ROOT/'geometry/managed_contract.json'
CONTRACT=json.loads(CONTRACT_PATH.read_text(encoding='utf-8'))
PHASES=tuple(CONTRACT['geometry_adapter']['phases'])
ADAPTER_VERSION=CONTRACT['geometry_adapter'].get('adapter_version','0.1.0')
ROOF_RECIPE_VERSION='v4-roof-shell-0.1.0'
def digest(v):return hashlib.sha256(json.dumps(v,sort_keys=True,separators=(',',':'),allow_nan=False).encode()).hexdigest()
def expand_roof_recipe(data):
 recipe=data.get('roof_recipe')
 if not isinstance(recipe,dict):raise ValueError('ROOF_RECIPE_REQUIRED')
 if data.get('parts'):raise ValueError('ROOF_RECIPE_PARTS_CONFLICT')
 import sys
 v4=ROOT/'v4'
 sys.path.insert(0,str(v4))
 try:
  from contract import validate as validate_roof
  from roof_mesh import build
  params=validate_roof(json.loads(json.dumps(recipe)))
  mesh=build(params)
 finally:
  try:sys.path.remove(str(v4))
  except ValueError:pass
 data['parts']=[{'semantic_id':'roof_shell','role':'roof_shell','topology':'closed','vertices':mesh.vertices,'triangles':mesh.faces}]
 data['generator_recipe']={'id':'v4-roof-shell','version':ROOF_RECIPE_VERSION,'roof_type':params['roof_type'],'details':params['details'],'input_sha256':digest(params),'scope':'shell only; tile/ridge details are not implied'}
 return data
def validate_phase_contract(data,ids):
 phase=data.get('phase')
 if phase not in PHASES:raise ValueError('UNSUPPORTED_PRODUCTION_PHASE: expected '+', '.join(PHASES)+'; refinement is a mode, not a phase')
 task=data.get('task_contract')
 if not isinstance(task,dict) or not isinstance(task.get('mode'),str) or not task['mode'].strip() or not isinstance(task.get('plan_version'),str) or not task['plan_version'].strip():
  raise ValueError('TASK_CONTRACT_REQUIRED: mode and plan_version are required')
 if phase=='primary_corrections' and task['mode']!='refinement':
  raise ValueError('PRIMARY_CORRECTIONS_REFINEMENT_ONLY')
 if phase=='massing':
  items=data.get('projection_subjects')
  if not isinstance(items,list) or not items:raise ValueError('PROJECTION_SUBJECT_MAPPING_REQUIRED')
  seen=set()
  for item in items:
   if not isinstance(item,dict) or item.get('semantic_id') not in ids or not isinstance(item.get('id'),str) or not isinstance(item.get('role'),str) or not item['id'].strip() or not item['role'].strip():
    raise ValueError('PROJECTION_SUBJECT_MAPPING_INVALID')
   if item['id'] in seen:raise ValueError('DUPLICATE_PROJECTION_SUBJECT')
   seen.add(item['id'])
 if phase=='archetypes':
  specs=data.get('archetypes')
  if not isinstance(specs,list) or not specs:raise ValueError('ARCHETYPE_REGISTRATION_REQUIRED')
  seen=set();mapped=set()
  for item in specs:
   if not isinstance(item,dict) or item.get('semantic_id') not in ids or not all(isinstance(item.get(k),str) and item[k].strip() for k in ('id','family','source_cue')):
    raise ValueError('ARCHETYPE_MAPPING_INVALID')
   if item['id'] in seen:raise ValueError('DUPLICATE_ARCHETYPE_ID')
   if item['semantic_id'] in mapped:raise ValueError('DUPLICATE_ARCHETYPE_PART')
   mapped.add(item['semantic_id'])
   seen.add(item['id'])
  if mapped!=set(ids):raise ValueError('ARCHETYPE_PART_MAPPING_MISSING')
  details=data.get('visible_detail_systems')
  if not isinstance(details,list):raise ValueError('VISIBLE_DETAIL_SYSTEMS_REQUIRED')
  if not details:raise ValueError('VISIBLE_DETAIL_SYSTEMS_REQUIRED')
  required=task.get('required_detail_systems',[])
  if not isinstance(required,list) or len(required)>20 or any(not isinstance(x,str) or not x.strip() or len(x)>160 for x in required):raise ValueError('REQUIRED_DETAIL_SYSTEMS_INVALID')
  normalized=[x.strip() for x in required]
  if len(set(normalized))!=len(normalized):raise ValueError('REQUIRED_DETAIL_SYSTEMS_DUPLICATE')
  required=set(normalized)
  detail_ids=set()
  for item in details:
   if not isinstance(item,dict) or item.get('archetype_id') not in seen or not all(isinstance(item.get(k),str) and item[k].strip() for k in ('id','kind','source_cue')) or type(item.get('instances')) is not int or item['instances']<1:
    raise ValueError('VISIBLE_DETAIL_MAPPING_INVALID')
   normalized_id=item['id'].strip()
   if normalized_id in detail_ids:raise ValueError('DUPLICATE_VISIBLE_DETAIL_ID')
   detail_ids.add(normalized_id)
  missing=required-detail_ids
  if missing:raise ValueError('VISIBLE_DETAIL_SYSTEMS_MISSING:'+','.join(sorted(missing)))
 if phase=='primary_corrections':
  targets=data.get('correction_targets')
  if not isinstance(targets,list) or not targets:raise ValueError('CORRECTION_TARGET_MAPPING_REQUIRED')
  seen=set()
  for item in targets:
   if not isinstance(item,dict) or item.get('correction_semantic_id') not in ids or not all(isinstance(item.get(k),str) and item[k].strip() for k in ('id','target_semantic_id','reason')):
    raise ValueError('CORRECTION_TARGET_MAPPING_INVALID')
   if item['id'] in seen:raise ValueError('DUPLICATE_CORRECTION_ID')
   seen.add(item['id'])
 return {'adapter_version':ADAPTER_VERSION,'phase':phase,'task_contract':task,'requirements':CONTRACT['geometry_adapter'].get('registration_requirements',{}).get(phase,[]),'mapping_sha256':digest({'projection_subjects':data.get('projection_subjects',[]),'archetypes':data.get('archetypes',[]),'visible_detail_systems':data.get('visible_detail_systems',[]),'correction_targets':data.get('correction_targets',[])})}
def compile_parts(data,output):
 start=time.perf_counter();out=Path(output).resolve()
 if out.exists():raise ValueError('OUTPUT_EXISTS')
 if data.get('phase') not in PHASES:raise ValueError('UNSUPPORTED_PRODUCTION_PHASE: expected '+', '.join(PHASES)+'; refinement is a mode, not a phase')
 if not re.fullmatch(r'[A-Za-z0-9_-]{1,100}',data.get('project_id','')):raise ValueError('PROJECT_ID_REQUIRED')
 if not isinstance(data.get('source_evidence'),str) or not data['source_evidence'].strip():raise ValueError('SOURCE_EVIDENCE_REQUIRED')
 data=json.loads(json.dumps(data))
 if data.get('roof_recipe') is not None:data=expand_roof_recipe(data)
 if not isinstance(data.get('parts'),list) or not 1<=len(data['parts'])<=100:raise ValueError('PART_COUNT_RANGE_1_100')
 ids=[]
 for part in data['parts']:
  sid=part.get('semantic_id');role=part.get('role')
  if not isinstance(sid,str) or not re.fullmatch(r'[A-Za-z0-9_/-]{1,160}',sid) or '..' in sid or sid.startswith('/'):raise ValueError('SEMANTIC_ID_INVALID')
  if not isinstance(role,str) or not role:raise ValueError('PART_ROLE_REQUIRED')
  if sid in ids:raise ValueError('DUPLICATE_SEMANTIC_ID')
  ids.append(sid);v=part['vertices'];f=part.get('triangles',part.get('faces'))
  if part.get('topology')=='open_sheet':
   shell=thicken(v,f,part['thickness_mm'],part['expected_boundary'],part['offset_direction'],sid);v=shell['vertices'];f=shell['faces'];part['thickening_report']={k:x for k,x in shell.items() if k not in ['vertices','faces','report']}
  elif part.get('topology')!='closed':raise ValueError('EXPLICIT_TOPOLOGY_REQUIRED')
  report=validate(v,f,sid);f=report['triangle_indices'];report['intersection_check']=intersection_check(v,f,sid)
  part.update(vertices=v,triangles=f,compile_checks={k:x for k,x in report.items() if k not in ['triangle_indices','face_map']},geometry_sha256=digest([v,f]));part.pop('faces',None)
 data['phase_contract']=validate_phase_contract(data,ids)
 for edge in data.get('dependencies',[]):
  if edge.get('consumer') not in ids or edge.get('producer') not in ids:raise ValueError('DEPENDENCY_ID_NOT_FOUND')
 # Cycles are invalid even when both IDs exist.
 pending={i:set(e['producer'] for e in data.get('dependencies',[]) if e['consumer']==i) for i in ids};done=set()
 while len(done)<len(ids):
  ready={i for i,ds in pending.items() if i not in done and ds<=done}
  if not ready:raise ValueError('DEPENDENCY_CYCLE')
  done|=ready
 for c in data.get('contacts',[]):
  if len(c.get('pair',[]))!=2 or any(i not in ids for i in c['pair']):raise ValueError('CONTACT_PAIR_INVALID')
  if not c.get('points_mm') or len(c['points_mm'])>200:raise ValueError('CONTACT_SAMPLES_REQUIRED')
 if data['phase']=='roof_profile':
  c=data.get('roof_control_contract',{})
  if not {'body','corner'}<=set(c.get('prototype_kinds',[])):raise ValueError('BODY_AND_CORNER_REQUIRED')
  for key in ['ridge_profile','eave_curve','corner_lift_section']:
   if len(c.get(key,[]))<3:raise ValueError('CONTROL_CURVE_REQUIRED:'+key)
 data['parameter_sha256']=digest(data);sources=[ROOT/'geometry/managed_guard.rb',ROOT/'geometry/managed_contract.rb',ROOT/'geometry/production_adapter.rb',Path(__file__),ROOT/'geometry/contracts.py',CONTRACT_PATH]
 if data.get('generator_recipe'):sources += [ROOT/'v4/compile.py',ROOT/'v4/contract.py',ROOT/'v4/roof_mesh.py',ROOT/'study/measured-profiles.json']
 data['generator_sha256']=hashlib.sha256(b''.join(p.read_bytes() for p in sources)).hexdigest()
 ruby="require 'sketchup.rb'\nrequire 'json'\nrequire 'base64'\n"+'\n'.join(p.read_text(encoding='utf-8-sig') for p in sources[:3])
 payload=base64.b64encode(json.dumps(data,separators=(',',':')).encode()).decode()
 ruby+="\n# ADAI_COMPILED_PHASE: "+data['phase']+"\nmodule PipClawManagedBuild\n extend self\n def build(entities,context)\n ADAIGeometryAdapter.build(entities,context,JSON.parse(Base64.strict_decode64('"+payload+"')))\n end\nend\n"
 manifest={'schema_version':1,'kernel_version':VERSION,'adapter_version':ADAPTER_VERSION,'phase':data['phase'],'project_id':data['project_id'],'source_evidence':data['source_evidence'],'task_contract':data['task_contract'],'phase_contract':data['phase_contract'],'generator_recipe':data.get('generator_recipe'),'generator_sha256':data['generator_sha256'],'parameter_sha256':data['parameter_sha256'],'ruby_file':str(out/'build.rb'),'build_sha256':hashlib.sha256(ruby.encode()).hexdigest(),'compile_seconds':time.perf_counter()-start,'parts':[{'semantic_id':p['semantic_id'],'triangles':len(p['triangles']),'checks':p['compile_checks']} for p in data['parts']],'live_state':'unverified','visual_state':'unverified'}
 out.mkdir(parents=True);(out/'build.rb').write_text(ruby,encoding='utf8',newline='');(out/'parts.json').write_text(json.dumps(data,ensure_ascii=False),encoding='utf8');(out/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf8');return manifest
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('input',type=Path);p.add_argument('--output',required=True,type=Path);a=p.parse_args()
 try:print(json.dumps({'ok':True,'result':compile_parts(json.loads(a.input.read_text(encoding='utf-8-sig')),a.output)},ensure_ascii=False))
 except (ValueError,KeyError,TypeError,OSError) as e:print(json.dumps({'ok':False,'error':str(e)},ensure_ascii=False));raise SystemExit(2)
