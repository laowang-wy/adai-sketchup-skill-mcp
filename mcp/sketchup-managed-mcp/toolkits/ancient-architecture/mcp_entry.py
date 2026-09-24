"""Bounded MCP adapter for AncientArchitectureExperience 0.4; never starts SketchUp."""
import json,sys,tempfile,subprocess,re,hashlib
from pathlib import Path
ROOT=Path(__file__).resolve().parent
GEOMETRY_PHASES=json.loads((ROOT/'geometry/managed_contract.json').read_text(encoding='utf-8'))['geometry_adapter']['phases']
sys.path.insert(0,str(ROOT/'v4'))
from geometry_tool import validate_phase_contract,expand_roof_recipe,ADAPTER_VERSION,CONTRACT
def read(path):return json.loads(path.read_text(encoding='utf-8-sig'))
def parameters(action,family,a):
 if action=='preset':
  name=a.get('preset_id')
  if name is not None and (not isinstance(name,str) or not re.fullmatch(r'[a-z0-9][a-z0-9_-]{0,63}',name)):raise ValueError('INVALID_PRESET_ID')
  if family in ['source','roof','recipe'] and not name:raise ValueError('PRESET_ID_REQUIRED')
  if family=='source':
   cat=read(ROOT/'source_templates/catalog.json')['templates']
   if name not in cat:raise ValueError('UNKNOWN_TEMPLATE')
   return {'schema':'ark-template-1','template':name,'width_mm':cat[name]['default_width_mm'],'origin_mm':[0,0,0],'rotation_deg':0,'count':1,'spacing_mm':0}
  if family=='recipe':
   candidate=ROOT/'experience/recipes'/(name+'.json')
   if not candidate.is_file():raise ValueError('UNKNOWN_RECIPE')
   return read(candidate)
  if family=='roof':
   candidates=[ROOT/'v4/presets'/(name+'.json'),ROOT/'experience/recipes'/(name+'.json')]
   candidate=next((p for p in candidates if p.is_file()),None)
   if candidate is None:raise ValueError('UNKNOWN_ROOF_OR_RECIPE')
   data=read(candidate)
   if data.get('schema_version')!=4:raise ValueError('NOT_A_ROOF_PRESET')
   return data
  if family=='measured':
   name=name.lower() if isinstance(name,str) else name
   if name not in ['g0916','g1031']:raise ValueError('UNKNOWN_PROFILE')
   return {'profile_id':name.upper(),'length_mm':12000,'span_mm':8000,'rise_mm':2000,'thickness_mm':100}
  if family=='bearing':return {'template':name or 'changkong-layered','width_mm':1200,'column_height_mm':1800,'beam_height_mm':180}
  if family=='eave':return {'width_mm':1200}
  raise ValueError('FAMILY_REQUIRED')
 p=a.get('parameters')
 if not isinstance(p,dict):raise ValueError('PARAMETERS_REQUIRED')
 return p
def validate(family,p):
 if family=='geometry':
  if not p.get('parts') and not p.get('roof_recipe'):raise ValueError('GEOMETRY_CONTRACT_REQUIRED')
  contract_input=json.loads(json.dumps(p))
  if contract_input.get('roof_recipe') is not None:
   # Public validation and compile must consume the same expanded recipe
   # mapping; otherwise massing rejects a valid roof_shell before compilation.
   contract_input=expand_roof_recipe(contract_input)
  validate_phase_contract(contract_input,[part.get('semantic_id') for part in contract_input.get('parts',[])])
 elif family=='source':
  from source_templates.compiler import validate as f;f(p)
 elif family=='roof':
  from contract import validate as f;f(p)
 elif family=='measured':
  if set(p)!={'profile_id','length_mm','span_mm','rise_mm','thickness_mm'}:raise ValueError('FIELD_MISMATCH')
  from prepare_measured_loft import mesh
  mesh(p['profile_id'],p['length_mm'],p['span_mm'],p['rise_mm'],p['thickness_mm'])
 elif family=='bearing':
  expected={'template','width_mm','column_height_mm','beam_height_mm'}
  if set(p)!=expected:raise ValueError('FIELD_MISMATCH')
  from source_templates.compiler import number,catalog
  if not isinstance(p['template'],str) or p['template'] not in catalog():raise ValueError('UNKNOWN_TEMPLATE')
  number(p['column_height_mm'],'COLUMN_HEIGHT',500,5000);number(p['beam_height_mm'],'BEAM_HEIGHT',80,500)
  import bearing_tool
  report=bearing_tool.inspect(p['template'],p['width_mm'])
  if not report['sample_supported']:raise ValueError(report['rejection'])
  if not 500<=p['column_height_mm']<=5000 or not 80<=p['beam_height_mm']<=500:raise ValueError('BEARING_DIMENSION_RANGE')
 elif family=='eave':
  if set(p)!= {'width_mm'}:raise ValueError('FIELD_MISMATCH')
  from source_templates.compiler import number
  number(p['width_mm'],'EAVE_SAMPLE_WIDTH_RANGE_900_1800',900,1800)
 else:raise ValueError('FAMILY_REQUIRED')
def validation_summary(family,p):
 if family=='geometry':
  parts=p.get('parts') if isinstance(p.get('parts'),list) else []
  return {'family':family,'project_id':p.get('project_id'),'phase':p.get('phase'),'parts_count':len(parts),'semantic_ids_sample':[str(x.get('semantic_id')) for x in parts[:16] if isinstance(x,dict) and x.get('semantic_id')]}
 keys=sorted(str(k) for k in p.keys()) if isinstance(p,dict) else []
 return {'family':family,'keys':keys[:32],'key_count':len(keys)}
def main(a):
 action=a['action'];family=a.get('family')
 if action=='list':
  cat=read(ROOT/'source_templates/catalog.json')['templates'];idx=read(ROOT/'experience/index.json')
  return {'experience_version':'0.4','runtime_version':'0.4.5','cards':idx,'recipes':[p.stem for p in sorted((ROOT/'experience/recipes').glob('*.json'))],'templates':{k:{x:v.get(x) for x in ['kind','status','default_width_mm','evidence','verified','unverified','current_compile_support']} for k,v in cat.items()},'roof_capabilities':read(ROOT/'v4/capabilities.json'),'roof_presets':[p.stem for p in sorted((ROOT/'v4/presets').glob('*.json'))],'read_formats':['json','markdown'],'recipe_route':'preset -> validate/compile with family=recipe and returned parameters','full_source_directory':str(ROOT.parents[1]/'experience-packages/AncientArchitectureExperience-0.4'),'families':['roof','source','bearing','eave','measured','geometry'],'geometry_contract':{'version':CONTRACT['contract_version'],'adapter_version':ADAPTER_VERSION,'phases':GEOMETRY_PHASES,'route':'geometry parameter object with a phase-bound formal wrapper; mapping is required before compile and real registration/readback occurs during managed step','registration_requirements':CONTRACT['geometry_adapter'].get('registration_requirements',{}),'verification':'see geometry/VALIDATION.md; compilation is not live SketchUp or visual acceptance'},'scope':'offline read/validation/diagnostic compilation; no SU writes','production_ready':False}
 if action=='read':
  idx=read(ROOT/'experience/index.json');row=next((r for r in idx['cards'] if r['id']==a.get('card_id')),None)
  if row is None:raise ValueError('UNKNOWN_CARD')
  fmt=a.get('format','json')
  if fmt not in ['json','markdown']:raise ValueError('INVALID_READ_FORMAT')
  card_path=ROOT/row['path']
  if fmt=='markdown':card_path=card_path.with_suffix('.md')
  text=card_path.read_text(encoding='utf-8-sig') if fmt=='markdown' else json.dumps(read(card_path),ensure_ascii=False,indent=2)
  offset=a.get('offset',0);limit=a.get('limit',6000)
  if type(offset)!=int or offset<0 or type(limit)!=int or not 256<=limit<=12000:raise ValueError('INVALID_PAGE')
  return {'card_id':row['id'],'format':fmt,'path':str(card_path),'content_sha256':hashlib.sha256(card_path.read_bytes()).hexdigest(),'source_scope':'upstream 0.4 historical guidance; runtime JSON includes integration updates' if fmt=='markdown' else 'adapted runtime card','text':text[offset:offset+limit],'next_offset':offset+limit if offset+limit<len(text) else None}
 if action=='check':
  proc=subprocess.run([sys.executable,'-B',str(ROOT/'experience_tool.py'),'check'],capture_output=True,text=True,encoding='utf8',timeout=60)
  data=json.loads(proc.stdout)
  if not data.get('ok'):raise ValueError(data.get('error','CHECK_FAILED'))
  return data['result']
 if action not in ['preset','validate','compile']:raise ValueError('UNKNOWN_ACTION')
 p=parameters(action,family,a)
 requested_family=family
 if family=='recipe':
  if p.get('schema')=='ark-template-1':family='source'
  elif p.get('schema_version')==4:family='roof'
  else:raise ValueError('UNKNOWN_RECIPE_SCHEMA')
 if action=='preset':
  validate(family,p)
  return {'parameters':p,'resolved_family':family,'requested_family':requested_family,'scope':'declared package preset; source/historical limits remain applicable'}
 validate(family,p)
 if action=='validate' and family=='geometry':
  from geometry_tool import compile_parts
  with tempfile.TemporaryDirectory(prefix='adai-geometry-validate-') as temp:compile_parts(p,Path(temp)/'compile')
 if action=='validate':
  summary=validation_summary(family,p)
  summary['parameter_sha256']=hashlib.sha256(json.dumps(p,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode('utf-8')).hexdigest()
  result={'validated':True,'resolved_family':family,'requested_family':requested_family,'validation_summary':summary,'scope':'input and supported-range contract only; not live geometry acceptance'}
  if a.get('detail') is True: result['parameters']=p
  else: result['detail_available']='Call sketchup_ancient_tool(action=validate, detail=true) to retrieve the full validated parameter object.'
  return result
 out=Path(a['output_directory'])
 if not out.is_absolute():raise ValueError('ABSOLUTE_OUTPUT_REQUIRED')
 out=out.resolve();asset=ROOT.parents[1]
 if out.is_relative_to(asset):raise ValueError('OUTPUT_INSIDE_INSTALLED_ASSET')
 if out.exists():raise ValueError('OUTPUT_EXISTS')
 if family=='geometry':
  from geometry_tool import compile_parts
  manifest=compile_parts(p,out)
  return {'manifest':manifest,'production_ready':False,'execution_contract':{'phase':p['phase'],'project_id':p['project_id'],'next_tool':'sketchup_project_step','requires_review':True},'scope':'phase-bound shared core; compilation only, source fidelity and complete building unverified'}
 if family=='source':
  from source_templates.compiler import prepare;manifest=prepare(p,out);prefix='ARKS_'
 elif family=='roof':
  from compile import prepare
  with tempfile.TemporaryDirectory(prefix='adai-roof-') as td:
   preset=Path(td)/'preset.json';preset.write_text(json.dumps(p),encoding='utf8');manifest=prepare([preset],out)
  # The managed step binds the compiled Ruby to the current project. Do not
  # require a development-only ARK4_ project-id prefix for normal projects.
  prefix=None
 elif family=='measured':
  from prepare_measured_loft import prepare
  prepare(p['profile_id'],p['length_mm'],p['span_mm'],p['rise_mm'],p['thickness_mm'],out);manifest=read(out/'manifest.json');prefix='ARK_Diagnostic_'
 elif family=='bearing':
  import bearing_tool;manifest=bearing_tool.prepare(p['template'],p['width_mm'],p['column_height_mm'],p['beam_height_mm'],out);prefix='ARKS_Bearing'
 else:
  import eave_tool;manifest=eave_tool.prepare(out,p['width_mm']);prefix='ARKS_Eave'
 contract={'phase':'massing','next_tool':'sketchup_project_step','requires_review':True}
 if prefix: contract['project_id_prefix']=prefix
 return {'manifest':manifest,'resolved_family':family,'production_ready':False,'execution_contract':contract,'scope':'compiled only; no SketchUp execution'}
if __name__=='__main__':
 try:print(json.dumps({'ok':True,'result':main(json.loads(sys.stdin.read()))},ensure_ascii=False))
 except (OSError,ValueError,TypeError,KeyError,ImportError,subprocess.TimeoutExpired) as e:print(json.dumps({'ok':False,'error':type(e).__name__+': '+str(e)},ensure_ascii=False));raise SystemExit(2)
