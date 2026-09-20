"""Deterministic patch-based roof kernels. Coordinates in mm; no SketchUp dependency."""
import math, collections, hashlib, sys
from pathlib import Path
import json
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from geometry.contracts import SurfaceHost,validate as strict_validate
TYPES=('si_shan','wu_dian','zan_jian','juan_peng','helmet','xie_ding')
def mix(a,b,t):return tuple(x+(y-x)*t for x,y in zip(a,b))
def sub(a,b):return tuple(x-y for x,y in zip(a,b))
def cross(a,b):return (a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0])
def norm(a):return math.sqrt(sum(x*x for x in a))
def unit(a):
 n=norm(a)
 if n<1e-9:raise ValueError('DEGENERATE_FRAME')
 return tuple(x/n for x in a)
def profile(t,kind='measured'):
 if kind=='linear':return t
 if kind=='round':return t*t*(3-2*t)
 if kind=='helmet':
  from helmet_profile import value
  return value(t)
 stations=MEASURED
 for (a,z),(b,w) in zip(stations,stations[1:]):
  if t<=b:return z+(w-z)*(t-a)/(b-a)
 return 1.
PROFILE_BYTES=(Path(__file__).resolve().parents[1]/'study/measured-profiles.json').read_bytes()
if hashlib.sha256(PROFILE_BYTES).hexdigest()!='d7c43e45c8b12c1e679c2bfe90c0e7ffeaac1e64e4418b898ec06bbb936a8ded':raise ValueError('PROFILE_HASH_MISMATCH')
MEASURED=[(p[0]*2,p[1]) for p in json.loads(PROFILE_BYTES)['G0916']['normalized_full_section'][:13]]
class Mesh:
 def __init__(self):self.vertices=[];self.faces=[];self.lookup={};self.patches=[];self.ridges=[];self.chart_faces={};self.declared_boundary=collections.Counter();self.collapsed_cells=[]
 def vertex(self,p):
  k=tuple(round(x,6) for x in p)
  if k not in self.lookup:self.lookup[k]=len(self.vertices);self.vertices.append(list(k))
  return self.lookup[k]
 def triangle(self,a,b,c,collapse=None):
  ids=[self.vertex(x) for x in [a,b,c]]
  if len(set(ids))<3:
   if collapse is None:raise ValueError('UNDECLARED_COLLAPSED_TRIANGLE')
   self.collapsed_cells.append(collapse);return
  normal=cross(sub(b,a),sub(c,a))
  if norm(normal)<1e-5:raise ValueError('ZERO_AREA_TRIANGLE')
  if normal[2]<0:ids.reverse()
  self.faces.append(ids)
 def patch(self,name,fn,n,m):
  start=len(self.faces)
  grid=[[fn(i/n,j/m) for j in range(m+1)] for i in range(n+1)]
  for i in range(n):
   for j in range(m):
    a,b,c,d=grid[i][j],grid[i][j+1],grid[i+1][j+1],grid[i+1][j]
    collapse={'chart':name,'cell':[i,j],'reason':'declared terminal patch collapse'} if i==n-1 else None
    self.triangle(a,b,c,collapse);self.triangle(a,c,d,collapse)
  perimeter=grid[0]+[grid[i][-1] for i in range(1,n+1)]+list(reversed(grid[-1][:-1]))+[grid[i][0] for i in range(n-1,0,-1)]
  for a,b in zip(perimeter,perimeter[1:]+perimeter[:1]):
   a,b=self.vertex(a),self.vertex(b)
   if a!=b:self.declared_boundary[tuple(sorted((a,b)))]+=1
  self.patches.append((name,fn));self.chart_faces[name]=list(range(start,len(self.faces)))
 def close(self,thickness,gable_inset=False):
  top_count=len(self.vertices);upper=list(self.faces);inc=collections.defaultdict(list)
  for f in upper:
   for a,b in zip(f,f[1:]+f[:1]):inc[tuple(sorted((a,b)))].append((a,b))
  for k,v in inc.items():
   if len(v)>2:raise ValueError('TOP_NONMANIFOLD')
   if len(v)==2 and v[0]==v[1]:raise ValueError('TOP_ORIENTATION')
  observed={key for key,items in inc.items() if len(items)==1}
  declared={key for key,count in self.declared_boundary.items() if count%2}
  if observed!=declared:raise ValueError('OPEN_PATCH_BOUNDARY_MISMATCH: refusing to seal undeclared holes')
  if not math.isfinite(thickness) or thickness<=0:raise ValueError('THICKNESS_INVALID')
  # A vertically extruded gable boundary folds through the apron at its reentrant
  # shoulder. Inset the lower footprint for this family, leaving the exact top
  # host and source parameters unchanged. This is a declared bevel, not hole repair.
  inset_scale=1.0
  if gable_inset:
   radius=min(max(abs(v[i]) for v in self.vertices) for i in (0,1))
   inset_scale=1.0-thickness/radius
   if inset_scale<=0:raise ValueError('GABLE_INSET_EXCEEDS_FOOTPRINT')
  self.vertices += [[x*inset_scale,y*inset_scale,z-thickness] for x,y,z in self.vertices]
  self.faces += [[i+top_count for i in reversed(f)] for f in upper]
  self.boundary=[]
  for v in inc.values():
   if len(v)==1:
    a,b=v[0];self.boundary.append([self.vertices[a],self.vertices[b]])
    self.faces += [[b,a,a+top_count],[b,a+top_count,b+top_count]]
  self.audit=check_mesh(self.vertices,self.faces)
  for sign in [-1,1]:
   a='apron_long_'+str(sign);b='upper_'+str(sign)
   if a in self.chart_faces and b in self.chart_faces:self.chart_faces['central_'+str(sign)]=self.chart_faces[a]+self.chart_faces[b]
  self.host=SurfaceHost(self.vertices[:top_count],upper,charts=self.chart_faces)
  self.audit['declared_collapsed_cells']=self.collapsed_cells
  self.audit['thickening']={'direction':[0,0,-1],'lower_xy_scale':inset_scale,'rule':'gable_inset_bevel' if gable_inset else 'vertical_offset','thickness_mm':thickness,'added_vertices':top_count,'added_faces':len(self.faces)-len(upper),'expected_boundary_edges':len(declared)}
  self.top_face_count=len(upper)

def check_mesh(vertices,faces):
 inc=collections.defaultdict(list);volume=0
 for f in faces:
  a,b,c=[vertices[i] for i in f]
  if norm(cross(sub(b,a),sub(c,a)))<1e-5:raise ValueError('DEGENERATE_FACE')
  volume+=sum(a[i]*cross(b,c)[i] for i in range(3))/6
  for a,b in zip(f,f[1:]+f[:1]):inc[tuple(sorted((a,b)))].append(1 if a<b else -1)
 if any(len(v)!=2 or sum(v)!=0 for v in inc.values()):raise ValueError('CLOSED_SHELL_FAILURE')
 if volume<=0:raise ValueError('INVERTED_VOLUME')
 report=strict_validate(vertices,faces,'roof-mesh')
 return {'components':report['components'],'vertices':len(vertices),'triangles':len(faces),'boundary_edges':0,'nonmanifold_edges':0,'orientation_conflicts':0,'signed_volume_mm3':volume}

def xieshan_section(p,t):
 # One monotone C1 section for both lower and upper front/back patches.
 # a is the eave-to-shoulder fraction; b is normalized shoulder height.
 a=1-p['gable_span_ratio'];b=p['apron_rise_ratio']
 low=b/a;high=(1-b)/(1-a)
 joint=2*low*high/(low+high)
 def hermite(q,z0,z1,m0,m1,span):
  return (2*q**3-3*q*q+1)*z0+(q**3-2*q*q+q)*span*m0+(-2*q**3+3*q*q)*z1+(q**3-q*q)*span*m1
 if t<=a:return hermite(t/a,0,b,low*.5,joint,a)
 return hermite((t-a)/(1-a),b,1,joint,high*1.35,1-a)

def tile_surfaces(mesh,p):
 # The central tiles span the shoulder continuously: no restarted row grid.
 if p['roof_type']!='si_shan':return [(name,mesh.host.wrapper(fn,name)) for name,fn in mesh.patches]
 result=[(name,fn) for name,fn in mesh.patches if not name.startswith(('apron_long_','upper_'))]
 r=p['ridge_length']/2;d=p['depth']/2;h=p['rise']
 for sign in [-1,1]:
  def central(t,u,sign=sign):return ((2*u-1)*r,sign*d*(1-t),h*xieshan_section(p,t))
  key='central_'+str(sign)
  result.insert(0,(key,central))
 return [(name,mesh.host.wrapper(fn,name)) for name,fn in result]

def build(p):
 w=p['width']/2;d=p['depth']/2;h=p['rise'];lift=p['corner_lift'];r=p['ridge_length']/2;n=p['slope_segments'];m=p['span_segments'];kind=p['roof_type'];mesh=Mesh()
 def add(name,fn):mesh.patch(name,fn,n,m)
 if kind in ('wu_dian','xie_ding'):
  curve='linear' if kind=='xie_ding' else 'measured'
  for sign in [-1,1]:
   def front(t,u,sign=sign):
    v=2*u-1;return (v*(w+(r-w)*t),sign*d*(1-t),h*profile(t,curve)+lift*abs(v)**6*(1-t)**2)
   add('slope_'+str(sign),front)
   def end(t,u,sign=sign):
    v=2*u-1;return (sign*(w+(r-w)*t),v*d*(1-t),h*profile(t,curve)+lift*abs(v)**6*(1-t)**2)
   add('hip_'+str(sign),end)
  mesh.ridges.append([[-r,0,h],[r,0,h]])
  for sx in [-1,1]:
   for sy in [-1,1]:mesh.ridges.append([[sx*(w+(r-w)*t),sy*d*(1-t),h*profile(t,curve)+lift*(1-t)**2] for t in [i/n for i in range(n+1)]])
 elif kind=='si_shan':
  s=d*p['gable_span_ratio'];base=h*p['apron_rise_ratio']
  for sign in [-1,1]:
   # Parallel central front courses continue into upper slopes.
   # Only independent wing strips taper to the gable corner.
   def apron(t,u,sign=sign):
    return ((2*u-1)*r,sign*(d+(s-d)*t),h*xieshan_section(p,(1-p['gable_span_ratio'])*t))
   add('apron_long_'+str(sign),apron)
   for sx in [-1,1]:
    def wing(t,u,sign=sign,sx=sx):
     return (sx*(r+(w-r)*(1-t)*u),sign*(d+(s-d)*t),h*xieshan_section(p,(1-p['gable_span_ratio'])*t)+lift*u**6*(1-t)**2)
    add('wing_'+str(sx)+'_'+str(sign),wing)
   def end(t,u,sign=sign):
    v=2*u-1;return (sign*(w+(r-w)*t),v*(d+(s-d)*t),h*xieshan_section(p,(1-p['gable_span_ratio'])*t)+lift*abs(v)**6*(1-t)**2)
   add('apron_end_'+str(sign),end)
   def upper(t,u,sign=sign):return ((2*u-1)*r,sign*s*(1-t),h*xieshan_section(p,1-p['gable_span_ratio']+p['gable_span_ratio']*t))
   add('upper_'+str(sign),upper)
  mesh.ridges.append([[-r,0,h],[r,0,h]])
  for sx in [-1,1]:
   for sy in [-1,1]:
    mesh.ridges.append([[sx*(w+(r-w)*t),sy*(d+(s-d)*t),h*xieshan_section(p,(1-p['gable_span_ratio'])*t)+lift*(1-t)**2] for t in [i/n for i in range(n+1)]])
    mesh.ridges.append([[sx*r,sy*s*(1-t),h*xieshan_section(p,1-p['gable_span_ratio']+p['gable_span_ratio']*t)] for t in [i/n for i in range(n+1)]])
 elif kind=='juan_peng':
  for sign in [-1,1]:
   def barrel(t,u,sign=sign):return ((2*u-1)*w,sign*d*(1-t),h*profile(t,'round'))
   add('barrel_'+str(sign),barrel)
  # No longitudinal main ridge on a rounded crown.
  for sx in [-1,1]:mesh.ridges.append([[sx*w,d*(1-2*t),h*profile(1-abs(1-2*t),'round')] for t in [i/(2*n) for i in range(2*n+1)]])
 else:
  count=p['sides'] if kind=='zan_jian' else 4
  corners=([(w,d),(-w,d),(-w,-d),(w,-d)] if count==4 else [(w*math.cos(2*math.pi*i/count),d*math.sin(2*math.pi*i/count)) for i in range(count)])
  curve='helmet' if kind=='helmet' else 'measured'
  corner_decay=4 if kind=='helmet' else 2
  for i in range(count):
   a,b=corners[i],corners[(i+1)%count]
   def radial(t,u,a=a,b=b):
    x,y=mix(a,b,u);return (x*(1-t),y*(1-t),h*profile(t,curve)+lift*abs(2*u-1)**6*(1-t)**corner_decay)
   add('radial_'+str(i),radial)
   mesh.ridges.append([[a[0]*(1-t),a[1]*(1-t),h*profile(t,curve)+lift*(1-t)**corner_decay] for t in [j/n for j in range(n+1)]])
 mesh.close(p['thickness'],gable_inset=kind=='si_shan');return mesh
