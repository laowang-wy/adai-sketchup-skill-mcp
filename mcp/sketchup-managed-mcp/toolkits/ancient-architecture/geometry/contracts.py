"""Fail-closed mesh contracts. mm; no SketchUp or host dependency."""
import math, hashlib, json
from collections import defaultdict, deque
import numpy as np
VERSION='0.1.1'
class GeometryError(ValueError): pass
def fail(code,semantic,**detail):
 raise GeometryError(json.dumps(dict(code=code,semantic_id=semantic,**detail),ensure_ascii=False))
def triangulate(vertices,polygon,semantic='mesh',face_id=0,tol=1e-7):
 v=np.asarray(vertices,float);ids=list(polygon)
 if len(ids)<3 or any(type(i) is not int or i<0 or i>=len(v) for i in ids) or len(set(ids))!=len(ids):fail('FACE_INDEX',semantic,face=face_id)
 p=v[ids]
 if len(ids)==3:
  if np.linalg.norm(np.cross(p[1]-p[0],p[2]-p[0]))<tol:fail('ZERO_AREA',semantic,face=face_id)
  return [ids]
 normal=np.zeros(3)
 for a,b in zip(p,np.roll(p,-1,axis=0)):normal+=np.cross(a,b)
 n=np.linalg.norm(normal)
 if n<tol:fail('ZERO_AREA_OR_SELF_INTERSECTION',semantic,face=face_id)
 normal/=n
 if np.max(np.abs((p-p[0])@normal))>tol:fail('NONPLANAR_POLYGON',semantic,face=face_id)
 xy=np.delete(p,int(np.argmax(np.abs(normal))),axis=1)
 def cross(a,b,c):return float(np.cross(b-a,c-a))
 def hit(a,b,c,d):
  u,vv=cross(a,b,c),cross(a,b,d);w,x=cross(c,d,a),cross(c,d,b)
  if u*vv < -tol*tol and w*x < -tol*tol:return True
  def on(a,b,c):return abs(cross(a,b,c))<=tol and np.all(c>=np.minimum(a,b)-tol) and np.all(c<=np.maximum(a,b)+tol)
  return on(a,b,c) or on(a,b,d) or on(c,d,a) or on(c,d,b)
 for i in range(len(ids)):
  for j in range(i+1,len(ids)):
   if j in (i,(i+1)%len(ids)) or i==(j+1)%len(ids):continue
   if hit(xy[i],xy[(i+1)%len(ids)],xy[j],xy[(j+1)%len(ids)]):fail('POLYGON_SELF_INTERSECTION',semantic,face=face_id)
 area=sum(np.cross(a,b) for a,b in zip(xy,np.roll(xy,-1,axis=0)));sign=1 if area>0 else -1
 remaining=list(range(len(ids)));out=[]
 while len(remaining)>3:
  found=False
  for k,b in enumerate(remaining):
   a=remaining[k-1];c=remaining[(k+1)%len(remaining)]
   if cross(xy[a],xy[b],xy[c])*sign<=tol:continue
   if any(all(cross(xy[u],xy[w],xy[q])*sign>=-tol for u,w in [(a,b),(b,c),(c,a)]) for q in remaining if q not in (a,b,c)):continue
   out.append([ids[a],ids[b],ids[c]]);remaining.pop(k);found=True;break
  if not found:fail('TRIANGULATION_FAILED',semantic,face=face_id)
 out.append([ids[i] for i in remaining]);return out

def validate(vertices,faces,semantic='mesh',closed=True,expected_boundary=None,allow_nested=False):
 v=np.asarray(vertices,float)
 if v.ndim!=2 or v.shape[1]!=3 or not np.isfinite(v).all() or len(v)<3:fail('VERTICES_INVALID',semantic)
 tris=[];mapping=[]
 for i,f in enumerate(faces):
  ts=triangulate(v,f,semantic,i);mapping.append([len(tris),len(ts)]);tris.extend(ts)
 if not tris:fail('EMPTY_MESH',semantic)
 # Canonical coordinates expose coincident-index cracks. Refuse ambiguous input rather than weld silently.
 keys=[tuple(np.round(p,7)) for p in v]
 if len(set(keys))!=len(keys):fail('DUPLICATE_VERTEX',semantic)
 incidence=defaultdict(list);adj=[[] for _ in tris];seen=set()
 for i,f in enumerate(tris):
  if tuple(sorted(f)) in seen:fail('DUPLICATE_FACE',semantic,face=i)
  seen.add(tuple(sorted(f)))
  for a,b in zip(f,f[1:]+f[:1]):incidence[tuple(sorted((a,b)))].append((i,1 if a<b else -1))
 boundary=[]
 for edge,entries in incidence.items():
  if len(entries)>2:fail('NONMANIFOLD_EDGE',semantic,edge=edge,faces=[x[0] for x in entries])
  if len(entries)==1:boundary.append(list(edge))
  else:
   (a,x),(b,y)=entries
   if x==y:fail('LOCAL_ORIENTATION',semantic,edge=edge,faces=[a,b])
   adj[a].append(b);adj[b].append(a)
 if closed and boundary:fail('OPEN_CLOSED_COMPONENT',semantic,boundary_count=len(boundary),edges=boundary[:12])
 if not closed:
  if expected_boundary is None:fail('EXPECTED_BOUNDARY_REQUIRED',semantic)
  if {tuple(sorted(x)) for x in expected_boundary}!={tuple(x) for x in boundary}:fail('BOUNDARY_MISMATCH',semantic)
 components=[];remaining=set(range(len(tris)))
 while remaining:
  todo=[remaining.pop()];comp=[]
  while todo:
   i=todo.pop();comp.append(i)
   for j in adj[i]:
    if j in remaining:remaining.remove(j);todo.append(j)
  pts=v[np.asarray([tris[i] for i in comp])];center=pts.reshape(-1,3).mean(0);q=pts-center
  volume=float(np.einsum('ij,ij->i',q[:,0],np.cross(q[:,1],q[:,2])).sum()/6)
  if closed and volume<=1e-7:fail('INWARD_COMPONENT',semantic,component=len(components),signed_volume_mm3=volume)
  components.append(dict(faces=comp,signed_volume_mm3=volume,bounds=[pts.reshape(-1,3).min(0).tolist(),pts.reshape(-1,3).max(0).tolist()]))
 # Conservative policy for multiple shells: overlapping component AABBs require explicit separate entities.
 # This rejects nested cavities, not falsely certifies disjoint surfaces from volume alone.
 if allow_nested:fail('NESTED_SHELLS_UNSUPPORTED',semantic)
 for i,a in enumerate(components):
  for b in components[i+1:]:
   if np.all(np.minimum(a['bounds'][1],b['bounds'][1])>=np.maximum(a['bounds'][0],b['bounds'][0])):fail('OVERLAPPING_COMPONENT_BOUNDS_UNSUPPORTED',semantic)
 return dict(version=VERSION,semantic_id=semantic,vertices=len(v),triangles=len(tris),boundary_edges=len(boundary),components=components,face_map=mapping,triangle_indices=tris,intersection_check='not_run',closed=closed)

def thicken(vertices,faces,thickness,expected_boundary,offset=(0,0,-1),semantic='open-sheet'):
 if not isinstance(thickness,(float,int)) or isinstance(thickness,bool) or not math.isfinite(thickness) or thickness<=0:fail('THICKNESS_INVALID',semantic)
 report=validate(vertices,faces,semantic,False,expected_boundary)
 direction=np.asarray(offset,float)
 if direction.shape!=(3,) or not np.isfinite(direction).all() or np.linalg.norm(direction)<1e-9:fail('OFFSET_DIRECTION_INVALID',semantic)
 v=np.asarray(vertices,float);delta=direction/np.linalg.norm(direction)*thickness;n=len(v)
 faces=report['triangle_indices'];inc=defaultdict(list)
 for f in faces:
  for a,b in zip(f,f[1:]+f[:1]):inc[tuple(sorted((a,b)))].append((a,b))
 out=list(faces)+[[i+n for i in reversed(f)] for f in faces]
 for entries in inc.values():
  if len(entries)==1:
   a,b=entries[0];out.extend([[b,a,a+n],[b,a+n,b+n]])
 verts=np.concatenate([v,v+delta]).tolist();check=validate(verts,out,semantic)
 return dict(vertices=verts,faces=out,report=check,added_vertices=n,added_faces=len(out)-len(faces),offset_mm=delta.tolist())

class SurfaceHost:
 """Piecewise planar XY locator on actual roof triangles, not analytic curves."""
 def __init__(self,vertices,triangles,semantic='roof',version='discrete-1',charts=None):
  self.vertices=np.asarray(vertices,float);self.triangles=np.asarray(triangles,int);self.semantic=semantic;self.version=version
  if self.vertices.ndim!=2 or self.vertices.shape[1]!=3 or not np.isfinite(self.vertices).all() or self.triangles.ndim!=2 or self.triangles.shape[1]!=3 or self.triangles.size==0 or self.triangles.min()<0 or self.triangles.max()>=len(self.vertices):fail('HOST_MESH_INVALID',semantic)
  self.charts={k:list(v) for k,v in (charts or {}).items()};self._chart_sets={k:frozenset(v) for k,v in self.charts.items()};self._locate_cache={};self.points=self.vertices[self.triangles];self.cells=defaultdict(list)
  self.lo=self.points.min((0,1))[:2];self.span=np.maximum(self.points.max((0,1))[:2]-self.lo,1);self.n=32
  self.fingerprint=hashlib.sha256(json.dumps([version,vertices,triangles,self.charts],sort_keys=True).encode()).hexdigest()
  for i,p in enumerate(self.points):
   a=self.index(p.min(0));b=self.index(p.max(0))
   for x in range(a[0],b[0]+1):
    for y in range(a[1],b[1]+1):self.cells[x,y].append(i)
 def index(self,p):return tuple(np.floor((np.asarray(p)[:2]-self.lo)/self.span*self.n).astype(int))
 def locate(self,x,y,offset_mm=0,chart=None):
  if any(isinstance(n,bool) or not isinstance(n,(int,float)) or not math.isfinite(n) for n in [x,y,offset_mm]):fail('HOST_COORDINATE_INVALID',self.semantic)
  if chart is not None and chart not in self.charts:fail('HOST_UNKNOWN_CHART',self.semantic,chart=chart)
  key=(x,y,offset_mm,chart)
  cached=self._locate_cache.get(key)
  if cached is not None:
   return {'point':list(cached['point']),'normal':list(cached['normal']),'cell':cached['cell'],'barycentric':list(cached['barycentric']),'offset_mm':cached['offset_mm'],'host_version':cached['host_version'],'host_sha256':cached['host_sha256'],'chart':cached['chart']}
  allowed=self._chart_sets.get(chart) if chart is not None else None
  result=[]
  for i in self.cells.get(self.index([x,y]),[]):
   if allowed is not None and i not in allowed:continue
   a,b,c=self.points[i];ab=b[:2]-a[:2];ac=c[:2]-a[:2];d=ab[0]*ac[1]-ab[1]*ac[0]
   if abs(d)<1e-10:continue
   p=np.array([x,y])-a[:2];u=(p[0]*ac[1]-p[1]*ac[0])/d;w=(ab[0]*p[1]-ab[1]*p[0])/d
   weights=np.array([1-u-w,u,w]);edge_lengths=np.array([np.linalg.norm(c[:2]-b[:2]),np.linalg.norm(a[:2]-c[:2]),np.linalg.norm(b[:2]-a[:2])])
   # Coordinate quantization is in mm. A fixed barycentric tolerance is too
   # strict for narrow terminal cells and too loose for very large triangles.
   if np.any(weights*abs(d)/np.maximum(edge_lengths,1e-12)<-1e-6):continue
   weights=np.maximum(weights,0);weights/=weights.sum();u,w=weights[1],weights[2]
   normal=np.cross(b-a,c-a);normal/=np.linalg.norm(normal)
   if normal[2]<0:normal=-normal
   pos=a+u*(b-a)+w*(c-a);result.append((i,pos,normal,[1-u-w,u,w]))
  if not result:fail('HOST_NO_CELL',self.semantic,x=x,y=y,chart=chart,tolerance_mm=1e-6)
  if max(p[1][2] for p in result)-min(p[1][2] for p in result)>1e-4:fail('HOST_AMBIGUOUS_CELL',self.semantic,x=x,y=y)
  i,p,n,weights=min(result,key=lambda t:t[0]);out=dict(point=(p+n*offset_mm).tolist(),normal=n.tolist(),cell=i,barycentric=list(weights),offset_mm=offset_mm,host_version=self.version,host_sha256=self.fingerprint,chart=chart)
  self._locate_cache[key]=out
  return {'point':list(out['point']),'normal':list(out['normal']),'cell':out['cell'],'barycentric':list(out['barycentric']),'offset_mm':out['offset_mm'],'host_version':out['host_version'],'host_sha256':out['host_sha256'],'chart':out['chart']}
 def wrapper(self,fn,chart=None):
  def located(t,u):
   p=fn(t,u);return tuple(self.locate(p[0],p[1],chart=chart)['point'])
  def sample(t,u,offset_mm=0):
   p=fn(t,u);return self.locate(p[0],p[1],offset_mm=offset_mm,chart=chart)
  located.host_sample=sample
  return located
def intersection_check(vertices,triangles,semantic='mesh'):
 """Scalar triangle sweep; topology-adjacent contacts permitted, no all-pairs matrix."""
 v=[tuple(p) for p in vertices];fs=triangles;ps=[[v[i] for i in f] for f in fs];tol=1e-7
 def sub(a,b):return (a[0]-b[0],a[1]-b[1],a[2]-b[2])
 def cross(a,b):return (a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0])
 def dot(a,b):return sum(x*y for x,y in zip(a,b))
 normals=[];lo=[];hi=[]
 for t in ps:
  n=cross(sub(t[1],t[0]),sub(t[2],t[0]));length=math.sqrt(dot(n,n))
  if length<1e-12:fail('ZERO_AREA',semantic)
  normals.append(tuple(x/length for x in n));lo.append(tuple(min(p[k] for p in t) for k in range(3)));hi.append(tuple(max(p[k] for p in t) for k in range(3)))
 def segment(a,b,t):
  # Signed plane distances avoid catastrophic division on almost coplanar edges.
  # Units are mm, so this tolerance does not grow with edge length/triangle area.
  e1=sub(t[1],t[0]);e2=sub(t[2],t[0]);n=cross(e1,e2);length=math.sqrt(dot(n,n));n=tuple(x/length for x in n)
  da=dot(sub(a,t[0]),n);db=dot(sub(b,t[0]),n)
  if (da>tol and db>tol) or (da<-tol and db<-tol) or abs(da-db)<=tol:return False
  pos=da/(da-db)
  if not tol<pos<1-tol:return False
  p=tuple(a[k]+(b[k]-a[k])*pos for k in range(3))
  # Project on the dominant plane; no ill-conditioned ray determinant.
  axis=max(range(3),key=lambda k:abs(n[k]));axes=[k for k in range(3) if k!=axis]
  xy=lambda q:tuple(q[k] for k in axes)
  aa,bb,cc,pp=map(xy,[t[0],t[1],t[2],p])
  den=orient(aa,bb,cc);u=orient(aa,pp,cc)/den;w=orient(aa,bb,pp)/den
  return u>=-tol and w>=-tol and u+w<=1+tol
 def orient(a,b,c):return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
 def overlap2(a,b,axis):
  a=[tuple(x for k,x in enumerate(p) if k!=axis) for p in a];b=[tuple(x for k,x in enumerate(p) if k!=axis) for p in b]
  for i in range(3):
   for j in range(3):
    x,y=a[i],a[(i+1)%3];z,w=b[j],b[(j+1)%3]
    if orient(x,y,z)*orient(x,y,w)<-tol**2 and orient(z,w,x)*orient(z,w,y)<-tol**2:return True
  for source,target in [(a,b),(b,a)]:
   center=tuple(sum(p[k] for p in source)/3 for k in range(2));signs=[orient(target[i],target[(i+1)%3],center) for i in range(3)]
   if min(signs)>tol or max(signs)<-tol:return True
  return False
 active=[]
 for i in sorted(range(len(fs)),key=lambda i:lo[i][0]):
  active=[j for j in active if hi[j][0]>=lo[i][0]-tol]
  for j in active:
   if any(hi[j][k]<lo[i][k]-tol or hi[i][k]<lo[j][k]-tol for k in (1,2)):continue
   a,b=ps[i],ps[j];na,nb=normals[i],normals[j];parallel=cross(na,nb)
   if dot(parallel,parallel)<tol**2 and max(abs(dot(sub(p,a[0]),na)) for p in b)<tol:
    hit=overlap2(a,b,max(range(3),key=lambda k:abs(na[k])))
   elif len(set(fs[i])&set(fs[j]))>=2:hit=False
   else:hit=any(segment(t[k],t[(k+1)%3],other) for t,other in [(a,b),(b,a)] for k in range(3))
   if hit:fail('TRIANGLE_SELF_INTERSECTION',semantic,faces=[i,j])
  active.append(i)
 return 'triangle_sweep_passed'

def normalize_outward(vertices,triangles,semantic='generated-solid'):
 """Generator opt-in: consistent closed components only. Never fixes holes/local reversals."""
 v=np.asarray(vertices,float);inc=defaultdict(list);neighbors=defaultdict(set)
 for i,f in enumerate(triangles):
  for a,b in zip(f,f[1:]+f[:1]):inc[tuple(sorted((a,b)))].append((i,1 if a<b else -1))
 for edge,items in inc.items():
  if len(items)!=2:fail('NORMALIZE_REQUIRES_CLOSED',semantic,edge=edge)
  (a,x),(b,y)=items
  if x==y:fail('LOCAL_ORIENTATION',semantic,edge=edge,faces=[a,b])
  neighbors[a].add(b);neighbors[b].add(a)
 faces=[list(f) for f in triangles];remaining=set(range(len(faces)));flipped=[]
 while remaining:
  queue=[remaining.pop()];comp=[]
  while queue:
   i=queue.pop();comp.append(i)
   for j in neighbors[i]:
    if j in remaining:remaining.remove(j);queue.append(j)
  ps=v[np.asarray([faces[i] for i in comp])];ps=ps-ps.reshape(-1,3).mean(0);vol=float(np.einsum('ij,ij->i',ps[:,0],np.cross(ps[:,1],ps[:,2])).sum()/6)
  if abs(vol)<1e-7:fail('ZERO_COMPONENT_VOLUME',semantic)
  if vol<0:
   for i in comp:faces[i].reverse();flipped.append(i)
 return faces,{'normalized_face_indices':flipped,'scope':'per closed component after local orientation check'}
def orient_source_triangles(vertices,triangles,semantic):
 """Explicit source-import repair: adjacency parity first; closed components outward.
 Preserves positions, face count and boundaries. Open component absolute side remains source-seeded.
 """
 if not triangles:return [],{'flipped_faces':[],'open_components':0}
 v=np.asarray(vertices,float);inc=defaultdict(list);neighbors=defaultdict(list)
 for i,f in enumerate(triangles):
  for a,b in zip(f,f[1:]+f[:1]):inc[tuple(sorted((a,b)))].append((i,1 if a<b else -1))
 for edge,items in inc.items():
  if len(items)>2:fail('SOURCE_NONMANIFOLD_EDGE',semantic,edge=edge)
  if len(items)==2:
   (i,a),(j,b)=items;neighbors[i].append((j,a==b));neighbors[j].append((i,a==b))
 flips={};components=[]
 for seed in range(len(triangles)):
  if seed in flips:continue
  flips[seed]=False;queue=[seed];comp=[]
  while queue:
   i=queue.pop();comp.append(i)
   for j,opposite in neighbors[i]:
    needed=flips[i]^opposite
    if j in flips:
     if flips[j]!=needed:fail('NONORIENTABLE_SOURCE',semantic)
    else:flips[j]=needed;queue.append(j)
  components.append(comp)
 faces=[f[::-1] if flips[i] else list(f) for i,f in enumerate(triangles)];open_components=0
 boundary_faces={items[0][0] for items in inc.values() if len(items)==1}
 for comp in components:
  if set(comp)&boundary_faces:open_components+=1;continue
  pts=v[np.asarray([faces[i] for i in comp])];pts-=pts.reshape(-1,3).mean(0);volume=float(np.einsum('ij,ij->i',pts[:,0],np.cross(pts[:,1],pts[:,2])).sum()/6)
  if abs(volume)<1e-7:fail('SOURCE_ZERO_COMPONENT_VOLUME',semantic)
  if volume<0:
   for i in comp:faces[i].reverse()
 return faces,{'flipped_faces':[i for i,f in enumerate(faces) if f!=triangles[i]],'open_components':open_components,'rule':'adjacency parity then individual closed volume; no new faces or vertices; open absolute orientation source-seeded'}
