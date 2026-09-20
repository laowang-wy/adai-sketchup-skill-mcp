"""Conservative source-footprint bearing study. No historic/structural inference."""
import argparse,json,math,base64,hashlib
from pathlib import Path
import numpy as np
from source_templates.compiler import ROOT,load_template,number,validate,placement_contract,prepare_source_geometry

def source_triangles(data,width):
 def walk(key,m):
  d=data['definitions'][key];parts=[]
  if d['triangles']:
   p=np.asarray(d['vertices_mm'])@m[:3,:3].T+m[:3,3];parts.append(p[np.asarray(d['triangles'])])
  for child in d['children']:parts.extend(walk(child['definition'],m@np.array(child['transform_mm']).reshape(4,4).T))
  return parts
 return np.concatenate(walk(data['root'],np.array(data['root_transform_mm']).reshape(4,4).T))*width/data['source_extent_mm'][0]

def rectangle_components(triangles,z,tol=.02):
 # Only accept a two-triangle, four-corner axis-aligned rectangular pad.
 # Other source surfaces are reported as unsupported rather than guessed.
 faces=[t for t in triangles if np.max(abs(t[:,2]-z))<=tol]
 points=lambda t:{tuple(np.round(p[:2],4)) for p in t}
 sets=[points(t) for t in faces];seen=set();rects=[]
 for i in range(len(faces)):
  if i in seen:continue
  group={i};queue=[i];seen.add(i)
  while queue:
   a=queue.pop()
   for j in range(len(faces)):
    if j not in seen and len(sets[a]&sets[j])>=2:seen.add(j);group.add(j);queue.append(j)
  if len(group)!=2:continue
  a,b=sorted(group);keys=sets[a]|sets[b]
  if len(keys)!=4 or len(sets[a]&sets[b])!=2:continue
  xy=np.array(list(keys));lo=xy.min(0);hi=xy.max(0)
  corners={(lo[0],lo[1]),(lo[0],hi[1]),(hi[0],lo[1]),(hi[0],hi[1])}
  if keys!=corners or min(hi-lo)<1:continue
  # Shared edge must be rectangle diagonal, ruling out overlap or missing area.
  shared=np.array(list(sets[a]&sets[b]));delta=np.abs(shared[1]-shared[0])
  if not np.allclose(delta,hi-lo,atol=1e-4):continue
  rects.append({'min_xy_mm':lo.tolist(),'max_xy_mm':hi.tolist(),'z_mm':z,'center_xy_mm':((lo+hi)/2).tolist(),'area_mm2':float(np.prod(hi-lo)),'source_triangle_count':2,'plane_tolerance_mm':tol})
 return rects,len(faces)

def inspect(template,width):
 number(width,'WIDTH_MM',200,30000);data=load_template(template);tt=source_triangles(data,width)
 low=float(tt[:,:,2].min());high=float(tt[:,:,2].max());bottom,nb=rectangle_components(tt,low);top,nt=rectangle_components(tt,high)
 return {'template':template,'width_mm':width,'source_sha256':data['source_sha256'],'bottom_z_mm':low,'top_z_mm':high,'bottom_pads':bottom,'top_pads':top,'extreme_planar_triangles':{'bottom':nb,'top':nt},'sample_supported':len(bottom)==1 and len(top)>0,'scope':'extreme horizontal rectangular pads only; pad surfaces from source mesh, not a structural design','rejection':None if len(bottom)==1 and top else 'NO_UNAMBIGUOUS_RECTANGULAR_EXTREME_SEAT: needs explicit source construction study'}

def prepare(template,width,column_height,beam_height,output):
 number(column_height,'COLUMN_HEIGHT',500,5000);number(beam_height,'BEAM_HEIGHT',80,500)
 report=inspect(template,width)
 if not report['sample_supported']:raise ValueError(report['rejection'])
 out=Path(output).resolve()
 if out.exists():raise ValueError('OUTPUT_EXISTS')
 bottom=report['bottom_pads'][0];tops=report['top_pads'];bmin=np.array(bottom['min_xy_mm']);bmax=np.array(bottom['max_xy_mm']);center=(bmin+bmax)/2;half=(bmax-bmin)*.4
 # Top beam requires a shared Y bearing strip across every top pad.
 y0=max(p['min_xy_mm'][1] for p in tops);y1=min(p['max_xy_mm'][1] for p in tops)
 if y1-y0<20:raise ValueError('TOP_PADS_NOT_ONE_BEAM_SEAT')
 beam_y0=y0+(y1-y0)*.1;beam_y1=y1-(y1-y0)*.1
 origin=[40000,10000,column_height];lo=report['bottom_z_mm'];hi=report['top_z_mm']
 column={'name':'Diagnostic_Column','min_mm':[center[0]-half[0],center[1]-half[1],lo-column_height],'max_mm':[center[0]+half[0],center[1]+half[1],lo]}
 beam={'name':'Diagnostic_EaveBeam','min_mm':[min(p['min_xy_mm'][0] for p in tops)-80,beam_y0,hi],'max_mm':[max(p['max_xy_mm'][0] for p in tops)+80,beam_y1,hi+beam_height]}
 contacts=[]
 for name,pad,rect,z in [('column_to_bracket',bottom,column,lo)]+[(f'bracket_to_beam_{i+1}',pad,beam,hi) for i,pad in enumerate(tops)]:
  x0=max(pad['min_xy_mm'][0],rect['min_mm'][0]);x1=min(pad['max_xy_mm'][0],rect['max_mm'][0]);y0=max(pad['min_xy_mm'][1],rect['min_mm'][1]);y1=min(pad['max_xy_mm'][1],rect['max_mm'][1])
  if min(x1-x0,y1-y0)<=0:raise ValueError('NO_PAD_OVERLAP')
  points=[[x0+(x1-x0)*u,y0+(y1-y0)*v,z] for u in [.15,.5,.85] for v in [.15,.5,.85]]
  contacts.append({'id':name,'overlap_area_mm2':(x1-x0)*(y1-y0),'points_local_mm':points,'expected_gap_mm':0,'tolerance_mm':.03})
 p=validate({'schema':'ark-template-1','template':template,'width_mm':width,'origin_mm':origin,'rotation_deg':0,'count':1,'spacing_mm':0});data=prepare_source_geometry(load_template(template));data['scale']=width/data['source_extent_mm'][0];data['preset']=p;data['expected_extent_mm']=[v*data['scale'] for v in data['source_extent_mm']];data['placement_contract']=placement_contract(data,p)
 payload={'bracket':data,'column':column,'beam':beam,'contacts':contacts,'report':report}
 ruby="require 'sketchup.rb'\nrequire 'json'\nrequire 'base64'\n"+(ROOT/'geometry/managed_guard.rb').read_text(encoding='utf-8-sig')+'\n'+(ROOT/'source_templates/managed_builder.rb').read_text(encoding='utf8')+'\n'+(ROOT/'bearing/managed_bearing.rb').read_text(encoding='utf8')
 ruby+="\nmodule PipClawManagedBuild\n extend self\n def build(entities,context)\n raise 'BEARING_DIAGNOSTIC_ONLY' unless context['project_id'].start_with?('ARKS_Bearing') && context['phase']=='massing'\n data=JSON.parse(Base64.strict_decode64('"+base64.b64encode(json.dumps(payload).encode()).decode()+"'))\n AncientBearing.build(entities,context,data)\n end\nend\n"
 manifest={'template':template,'width_mm':width,'source_seat_report':report,'diagnostic_column':column,'diagnostic_beam':beam,'origin_mm':origin,'contacts':contacts,'ruby_file':str(out/'build.rb'),'build_sha256':hashlib.sha256(ruby.encode()).hexdigest(),'production_ready':False,'scope':'column/bracket/beam contact sample; no rafters or roof, no historical or structural certification'}
 out.mkdir(parents=True);(out/'build.rb').write_text(ruby,encoding='utf8');(out/'data.json').write_text(json.dumps(payload),encoding='utf8');(out/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf8');return manifest

def main():
 p=argparse.ArgumentParser();sub=p.add_subparsers(dest='command',required=True)
 for name in ['inspect','compile']:
  a=sub.add_parser(name);a.add_argument('--template',required=True);a.add_argument('--width-mm',type=float,default=1200)
  if name=='compile':a.add_argument('--column-height-mm',type=float,default=1800);a.add_argument('--beam-height-mm',type=float,default=180);a.add_argument('--output',required=True)
 a=p.parse_args()
 try:
  result=inspect(a.template,a.width_mm) if a.command=='inspect' else prepare(a.template,a.width_mm,a.column_height_mm,a.beam_height_mm,a.output)
  print(json.dumps({'ok':True,'result':result},ensure_ascii=False));return 0
 except (ValueError,OSError,KeyError) as e:print(json.dumps({'ok':False,'error':str(e)},ensure_ascii=False));return 2
if __name__=='__main__':raise SystemExit(main())
