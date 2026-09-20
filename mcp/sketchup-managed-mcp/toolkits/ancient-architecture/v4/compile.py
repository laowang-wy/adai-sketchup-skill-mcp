"""Compile verified mesh data into one managed SU2019 build; no live file requires."""
import argparse,base64,hashlib,json,math,sys,time
from pathlib import Path
from contract import read,validate
from roof_mesh import build,cross,unit,sub,mix,tile_surfaces
ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT.parent))
from geometry.contracts import validate as geometry_validate, triangulate, intersection_check, VERSION as GEOMETRY_VERSION

def tile_profile(width,length,cover=False):
 # Closed, curved tile with genuine thickness, not a rectangular rib.
 n=10;thick=8.;half=width/2
 top=[]
 for i in range(n+1):
  x=-half+width*i/n
  z=(math.sqrt(max(0,half*half-x*x)) if cover else 24*(x/half)**2)
  top.append((x,z))
 loop=top+[(x,z-thick) for x,z in reversed(top)]
 vertices=[[x,y,z] for y in [0.,length] for x,z in loop];k=len(loop);faces=[]
 # End polygons must be triangulated by SU, ordered consistently.
 faces.append(list(reversed(range(k))));faces.append(list(range(k,2*k)))
 for j in range(k):faces.append([j,(j+1)%k,(j+1)%k+k,j+k])
 return {'vertices':vertices,'faces':faces}

def frame(fn,t,u):
 dt=1e-5;du=1e-5;p=fn(t,u);across=unit(sub(fn(t,min(1,u+du)),fn(t,max(0,u-du))));uphill=unit(sub(fn(min(1,t+dt),u),fn(max(0,t-dt),u)));z=unit(cross(across,uphill))
 if z[2]<0:across=tuple(-x for x in across);z=tuple(-x for x in z)
 if hasattr(fn,'host_sample'):
  sample=fn.host_sample(t,u);z=tuple(sample['normal']);across=unit(tuple(across[i]-z[i]*sum(across[j]*z[j] for j in range(3)) for i in range(3)))
 y=unit(cross(z,across));return p,across,y,z

def details(mesh,p):
 paths=mesh.ridges if p['details']!='shell' else []
 instances=[];prototypes={}
 if p['details']=='tile_sample':
  # Explicit sample scope: one straight patch, five columns, four overlapping courses.
  fn=next(fn for name,fn in tile_surfaces(mesh,p) if not name.startswith(('hip','apron_end','wing')))
  width=p['tile_width'];length=p['tile_length'];pitch=length-p['tile_overlap']
  prototypes={'pan':tile_profile(width,length),'cover':tile_profile(width*.42,length,True)}
  t0=.08;u0=.5
  for row in range(4):
   t=t0
   # Arc length inversion along the centerline from the eave station.
   target=row*pitch;travel=0;last=fn(t0,u0)
   for j in range(1,1001):
    trial=t0+(.68-t0)*j/1000;point=fn(trial,u0);dist=math.dist(last,point)
    if travel+dist>=target:t=trial if target else t0;break
    travel+=dist;last=point
   else:raise ValueError('TILE_SAMPLE_TOO_LARGE')
   span=math.dist(fn(t,0),fn(t,1))
   if span<6*width:raise ValueError('TILE_SAMPLE_PATCH_TOO_NARROW')
   for col in range(-2,3):
    u=.5+col*width/span
    for kind,offset in [('pan',0),('cover',.5)]:
     uu=u+offset*width/span;pos,x,y,z=frame(fn,t,uu)
     # Bed raises each overlapping course slightly to avoid coplanar tile contact.
     pos=[pos[i]+z[i]*(10+row*8+(22 if kind=='cover' else 0)) for i in range(3)]
     instances.append({'prototype':kind,'origin':pos,'x':x,'y':y,'z':z,'row':row,'column':col})
 if p['details'] in ('tiled','detailed'):
  from surface_tiles import generate
  prototypes,instances=generate(mesh,p)
 extras=[]
 if p['details']=='detailed':
  from detail_geometry import xieshan_parts,helmet_parts
  if p['roof_type']=='si_shan':extras=xieshan_parts(p)
  if p['roof_type']=='helmet':extras=helmet_parts(p)
 return {'extras':extras,'ridge_paths':paths,'ridge_width':p['ridge_width'],'prototypes':prototypes,'instances':instances,'scope':p['details']}

def ridge_mesh(path,width,semantic):
 # Same eight-sided arched section as the legacy SU sweep, now checked offline.
 vertices=[];segments=8
 for i,p in enumerate(path):
  axis=unit(sub(path[min(i+1,len(path)-1)],path[max(i-1,0)]));x=unit(cross(axis,(0,0,1)));z=unit(cross(x,axis))
  if z[2]<0:z=tuple(-v for v in z)
  for j in range(segments+1):
   angle=math.pi*j/segments
   vertices.append([p[a]+x[a]*math.cos(angle)*width*.5+z[a]*(math.sin(angle)*width*.5+6) for a in range(3)])
 count=segments+1;faces=[]
 for i in range(len(path)-1):
  for j in range(count):
   a=i*count+j;b=i*count+(j+1)%count;c=(i+1)*count+(j+1)%count;d=(i+1)*count+j
   faces.extend([[c,b,a],[d,c,a]])
 for j in range(1,count-1):
  base=(len(path)-1)*count;faces.extend([[j,j+1,0],[base+j+1,base+j,base]])
 report=geometry_validate(vertices,faces,semantic);report['intersection_check']=intersection_check(vertices,faces,semantic)
 return {'vertices':vertices,'faces':faces,'expected':report}

def prepare(paths,output):
 started=time.perf_counter()
 output=Path(output).resolve()
 if output.exists():raise ValueError('OUTPUT_EXISTS')
 roofs=[]
 if len(paths)>1 and any(read(path).get('details') in ('tiled','detailed') for path in paths):raise ValueError('ONE_TILED_ROOF_PER_BUILD: avoid bridge timeout; compile separately')
 for i,path in enumerate(paths):
  p=validate(read(path));m=build(p)
  m.audit['intersection_check']=intersection_check(m.vertices,m.faces,'roof/'+p['roof_type'])
  roofs.append({'host':{'version':m.host.version,'sha256':m.host.fingerprint},'preset':p,'vertices':m.vertices,'triangles':m.faces,'expected':m.audit,'details':details(m,p),'offset':[i%3*18000,-(i//3)*17000,0] if len(paths)>1 else [0,0,0]})
 estimated=sum(len(r['triangles'])+sum(len(e['faces']) for e in r['details']['extras'])+sum(len(r['details']['prototypes'][i['prototype']]['faces']) for i in r['details']['instances']) for r in roofs)
 if estimated>230000:raise ValueError('GEOMETRY_BUDGET_EXCEEDED: use shell/tile_sample or larger tiles')
 for ri,r in enumerate(roofs):
  r['details']['ridge_meshes']=[ridge_mesh(path,r['details']['ridge_width'],'roof/%s/ridge/%s'%(ri,i)) for i,path in enumerate(r['details']['ridge_paths'])]
  for extra in r['details']['extras']:extra['expected']['intersection_check']=intersection_check(extra['vertices'],extra['faces'],extra['name'])
  for name,proto in r['details']['prototypes'].items():
   proto['faces']=[t for fi,f in enumerate(proto['faces']) for t in triangulate(proto['vertices'],f,'roof/%s/tile/%s'%(ri,name),fi)]
   geometry_validate(proto['vertices'],proto['faces'],'roof/%s/tile/%s'%(ri,name))
   proto['intersection_check']=intersection_check(proto['vertices'],proto['faces'],'roof/%s/tile/%s'%(ri,name))
  r['geometry_version']=GEOMETRY_VERSION
  r['generator_sha256']=hashlib.sha256(b''.join((ROOT/f).read_bytes() for f in ['compile.py','roof_mesh.py','managed_builder.rb'])+(ROOT.parent/'geometry/managed_guard.rb').read_bytes()+(ROOT.parent/'geometry/contracts.py').read_bytes()).hexdigest()
 estimated+=sum(len(mesh['faces']) for roof in roofs for mesh in roof['details']['ridge_meshes'])
 if estimated>230000:raise ValueError('GEOMETRY_BUDGET_EXCEEDED: includes ridge triangles')
 payload=json.dumps(roofs,separators=(',',':'));source=(ROOT.parent/'geometry/managed_guard.rb').read_text(encoding='utf-8-sig')+'\n'+(ROOT/'managed_builder.rb').read_text(encoding='utf8')
 ruby="require 'sketchup.rb'\nrequire 'json'\nrequire 'base64'\n"+source+"\nmodule PipClawManagedBuild\n extend self\n def build(entities,context)\n"
 ruby+="  raise 'ARK v4 test project required' unless context['project_id'].start_with?('ARK4_')\n  raise 'massing diagnostic only' unless context['phase']=='massing'\n"
 ruby+="  data=JSON.parse(Base64.strict_decode64('"+base64.b64encode(payload.encode()).decode()+"'))\n  AncientRoofKitV4.build(entities,context,data)\n end\nend\n"
 output.mkdir(parents=True);(output/'build.rb').write_text(ruby,encoding='utf8',newline='\n');(output/'mesh-data.json').write_text(json.dumps(roofs),encoding='utf8')
 manifest={'compile_seconds':time.perf_counter()-started,'geometry_kernel_version':GEOMETRY_VERSION,'schema_version':4,'ruby_file':str(output/'build.rb'),'build_sha256':hashlib.sha256(ruby.encode()).hexdigest(),'inputs':[r['preset'] for r in roofs],'geometry_checks':[r['expected'] for r in roofs],'source_sha256':{f:hashlib.sha256((ROOT/f).read_bytes()).hexdigest() for f in ['roof_mesh.py','contract.py','compile.py','managed_builder.rb','surface_tiles.py','detail_geometry.py','cut_tiles.py','helmet_profile.py']},'geometry_core_sha256':{f:hashlib.sha256((ROOT.parent/'geometry'/f).read_bytes()).hexdigest() for f in ['contracts.py','managed_guard.rb']},'estimated_expanded_faces':estimated,'recommended_timeout_ms':300000,'profile_sha256':hashlib.sha256((ROOT.parent/'study/measured-profiles.json').read_bytes()).hexdigest(),'historical_fidelity':'not certified; generic inferred families','details_scope':[r['details']['scope'] for r in roofs]}
 (output/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf8');return manifest
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('presets',nargs='+');p.add_argument('--output',required=True);a=p.parse_args()
 try:print(json.dumps({'ok':True,**prepare(a.presets,a.output)}))
 except (OSError,ValueError) as e:print(json.dumps({'ok':False,'error':str(e)}));raise SystemExit(2)
