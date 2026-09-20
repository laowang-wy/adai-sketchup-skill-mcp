"""Source-bound editable templates. No geometric inference in this compiler."""
import argparse,base64,hashlib,json,math
from pathlib import Path
import numpy as np
from geometry.contracts import orient_source_triangles
ROOT=Path(__file__).resolve().parents[1]
def read(path):return json.loads(Path(path).read_text(encoding='utf-8-sig'))
def catalog():return read(ROOT/'source_templates/catalog.json')['templates']
def number(x,name,lo,hi):
 if type(x) not in (float,int) or not math.isfinite(x) or not lo<=x<=hi:raise ValueError(name)
 return float(x)
def validate(p):
 expected={'schema','template','width_mm','origin_mm','rotation_deg','count','spacing_mm'}
 if not isinstance(p,dict) or set(p)!=expected:raise ValueError('EXACT_FIELDS_REQUIRED: '+','.join(sorted(expected)))
 if p['schema']!='ark-template-1':raise ValueError('SCHEMA')
 if not isinstance(p['template'],str) or p['template'] not in catalog():raise ValueError('UNKNOWN_TEMPLATE')
 number(p['width_mm'],'WIDTH_MM',200,30000)
 if not isinstance(p['origin_mm'],list) or len(p['origin_mm'])!=3:raise ValueError('ORIGIN_MM')
 for v in p['origin_mm']:number(v,'ORIGIN_MM',-1000000,1000000)
 number(p['rotation_deg'],'ROTATION_DEG',-360,360)
 if type(p['count']) is not int or not 1<=p['count']<=32:raise ValueError('COUNT')
 number(p['spacing_mm'],'SPACING_MM',0,100000)
 if p['count']==1 and p['spacing_mm']!=0:raise ValueError('SINGLE_SPACING_MUST_BE_ZERO')
 if p['count']>1:
  if catalog()[p['template']]['kind']!='straight_dougong':raise ValueError('ARRAY_ONLY_FOR_CONFIRMED_STRAIGHT')
  if p['spacing_mm']<p['width_mm']*1.02:raise ValueError('OVERLAPPING_ARRAY')
 return p
def clean_triangles(vertices,triangles,face_ranges):
 # C API mesh helpers can emit collinear triangulation fragments.
 # Remove only mathematically negligible fragments and retain a quantitative record.
 if not triangles:return [],face_ranges,{'removed_triangles':0,'removed_area_local_mm2':0.0}
 v=np.asarray(vertices,dtype=float);t=np.asarray(triangles,dtype=int)
 a=v[t[:,1]]-v[t[:,0]];b=v[t[:,2]]-v[t[:,0]]
 area=np.linalg.norm(np.cross(a,b),axis=1)/2
 product=np.linalg.norm(a,axis=1)*np.linalg.norm(b,axis=1)
 drop=(area<1e-7)|(area<=product*1e-9)
 result=[];ranges=[]
 for start,count in face_ranges:
  begin=len(result)
  result.extend(triangles[i] for i in range(start,start+count) if not drop[i])
  ranges.append([begin,len(result)-begin])
 return result,ranges,{'removed_triangles':int(drop.sum()),'removed_area_local_mm2':float(area[drop].sum())}

def load_template(name):
 meta=catalog()[name];path=ROOT/meta['network'];raw=path.read_bytes()
 if hashlib.sha256(raw).hexdigest()!=meta['network_sha256']:raise ValueError('SOURCE_NETWORK_HASH_MISMATCH')
 network=json.loads(raw);defs=network['definitions'];needed={};centers={};cache={}
 def points(key,anc=()):
  if key in anc:raise ValueError('SOURCE_CYCLE')
  if key in cache:return cache[key]
  d=defs[key];parts=[]
  if d['vertices_mm']:parts.append(np.array(d['vertices_mm'],dtype=float))
  for child in d['children']:
   mat=np.array(child['transform']).reshape(4,4).T
   pp=points(child['definition'],anc+(key,));parts.append(pp@mat[:3,:3].T+mat[:3,3])
  pp=np.concatenate(parts) if parts else np.empty((0,3));cache[key]=pp
  centers[key]=(pp.min(0)+pp.max(0))/2 if len(pp) else np.zeros(3)
  return pp
 original=points(meta['root']);lin=np.array(meta['source_linear']);world=original@lin.T
 if not np.isfinite(world).all() or len(world)==0:raise ValueError('INVALID_SOURCE')
 low=world.min(0);high=world.max(0);anchor=np.array([(low[0]+high[0])/2,(low[1]+high[1])/2,low[2]])
 for key in cache:
  d=defs[key];o=centers[key];children=[]
  for child in d['children']:
   mat=np.array(child['transform']).reshape(4,4).T
   mat[:3,3]+=mat[:3,:3]@centers[child['definition']]-o
   children.append({'definition':child['definition'],'transform_mm':mat.T.flatten().tolist(),'hidden':child['hidden'],'name':child['name']})
  verts=(np.array(d['vertices_mm'])-o).tolist() if d['vertices_mm'] else []
  triangles,ranges,cleanup=clean_triangles(verts,d['triangles'],d['face_ranges'])
  needed[key]={'name':d['name'],'vertices_mm':verts,'triangles':triangles,'face_ranges':ranges,'children':children,'source_faces':d['source_faces'],'cleanup':cleanup}
 mat=np.eye(4);mat[:3,:3]=lin;mat[:3,3]=lin@centers[meta['root']]-anchor
 return {'definitions':needed,'root':meta['root'],'root_transform_mm':mat.T.flatten().tolist(),'source_extent_mm':(high-low).tolist(),'source_sha256':network['source_sha256'],'network_sha256':meta['network_sha256'],'limitations':network['limitations']}
def prepare_source_geometry(data):
 # Reading the original source remains read-only; repairs apply only to compiled copies.
 for key,d in data['definitions'].items():
  triangles,orientation=orient_source_triangles(d['vertices_mm'],d['triangles'],'source/'+key)
  d['triangles']=triangles;d['cleanup']['orientation_repair']=orientation
 return data

def placement_contract(data,p):
 # Flatten only vertices used by retained triangles; no conservative nested AABBs.
 def walk(key):
  d=data['definitions'][key];parts=[]
  used=sorted({i for tri in d['triangles'] for i in tri})
  if used:parts.append(np.asarray(d['vertices_mm'])[used])
  for child in d['children']:
   q=walk(child['definition']);m=np.array(child['transform_mm']).reshape(4,4).T
   if len(q):parts.append(q@m[:3,:3].T+m[:3,3])
  return np.concatenate(parts) if parts else np.empty((0,3))
 points=walk(data['root']);m=np.array(data['root_transform_mm']).reshape(4,4).T
 local=(points@m[:3,:3].T+m[:3,3])*data['scale']
 angle=math.radians(p['rotation_deg']);c=math.cos(angle);s=math.sin(angle)
 rotation=np.array([[c,-s,0],[s,c,0],[0,0,1]])
 bounds=[];centers=[]
 for i in range(p['count']):
  placed=(local+np.array([i*p['spacing_mm'],0,0]))@rotation.T+np.array(p['origin_mm'])
  lo=placed.min(0);hi=placed.max(0);bounds.append([lo.tolist(),hi.tolist()]);centers.append(((lo+hi)/2).tolist())
 return {'instances_bounds_mm':bounds,'instances_centers_mm':centers,'axis_world':[c,s,0.0],'pitch_mm':p['spacing_mm'],'local_clearance_mm':p['spacing_mm']-float(np.ptp(local[:,0])) if p['count']>1 else None,'scope':'true mesh extents and placement only; does not prove host contact'}

def prepare(p,output):
 validate(p);out=Path(output).resolve()
 if out.exists():raise ValueError('OUTPUT_EXISTS')
 data=prepare_source_geometry(load_template(p['template']));scale=p['width_mm']/data['source_extent_mm'][0];data['scale']=scale;data['preset']=p
 data['expected_extent_mm']=[v*scale for v in data['source_extent_mm']]
 data['placement_contract']=placement_contract(data,p)
 def expanded(k):return len(data['definitions'][k]['triangles'])+sum(expanded(x['definition']) for x in data['definitions'][k]['children'])
 expanded_triangles=expanded(data['root'])*p['count']
 if expanded_triangles>300000:raise ValueError('EXPANDED_BUDGET')
 code=(ROOT/'geometry/managed_guard.rb').read_text(encoding='utf-8-sig')+'\n'+(ROOT/'source_templates/managed_builder.rb').read_text(encoding='utf8')
 payload=base64.b64encode(json.dumps(data,separators=(',',':')).encode()).decode()
 code="require 'sketchup.rb'\nrequire 'json'\nrequire 'base64'\n"+code+"\nmodule PipClawManagedBuild\n extend self\n def build(entities,context)\n raise 'SOURCE_TEMPLATE_DIAGNOSTIC_ONLY' unless context['project_id'].start_with?('ARKS_') && context['phase']=='massing'\n data=JSON.parse(Base64.strict_decode64('"+payload+"'))\n AncientSourceTemplates.build(entities,context,data)\n end\nend\n"
 manifest={'preset':p,'template_verification':catalog()[p['template']]['status'],'production_ready':False,'placement_contract':data['placement_contract'],'source_sha256':data['source_sha256'],'network_sha256':data['network_sha256'],'expected_extent_mm':data['expected_extent_mm'],'definitions':len(data['definitions']),'unique_triangles':sum(len(d['triangles']) for d in data['definitions'].values()),'expanded_triangles':expanded_triangles,'removed_negligible_triangles':sum(d['cleanup']['removed_triangles'] for d in data['definitions'].values()),'ruby_file':str(out/'build.rb'),'build_sha256':hashlib.sha256(code.encode()).hexdigest(),'recommended_timeout_ms':300000,'status':'compiled_not_live_verified','limitations':data['limitations']+['only uniform shape scaling; no change of historical bracket order','no automatic host contact or corner ring layout','diagnostic build is not final SKP delivery']}
 out.mkdir(parents=True);(out/'build.rb').write_text(code,encoding='utf8');(out/'data.json').write_text(json.dumps(data),encoding='utf8');(out/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf8');return manifest

def main():
 parser=argparse.ArgumentParser();s=parser.add_subparsers(dest='cmd',required=True)
 s.add_parser('list')
 p=s.add_parser('preset');p.add_argument('--template',required=True);p.add_argument('--width-mm',type=float);p.add_argument('--output',required=True)
 p=s.add_parser('validate');p.add_argument('preset')
 p=s.add_parser('compile');p.add_argument('preset');p.add_argument('--output',required=True)
 a=parser.parse_args()
 try:
  if a.cmd=='list':result=catalog()
  elif a.cmd=='preset':
   meta=catalog().get(a.template)
   if not meta:raise ValueError('UNKNOWN_TEMPLATE')
   result=validate({'schema':'ark-template-1','template':a.template,'width_mm':a.width_mm if a.width_mm is not None else meta['default_width_mm'],'origin_mm':[0,0,0],'rotation_deg':0,'count':1,'spacing_mm':0})
   with open(a.output,'x',encoding='utf8') as f:json.dump(result,f,indent=2)
  elif a.cmd=='validate':result=validate(read(a.preset))
  else:result=prepare(read(a.preset),a.output)
  print(json.dumps({'ok':True,'result':result},ensure_ascii=False))
 except (OSError,ValueError,KeyError) as e:print(json.dumps({'ok':False,'error':str(e)},ensure_ascii=False));raise SystemExit(2)
if __name__=='__main__':main()
