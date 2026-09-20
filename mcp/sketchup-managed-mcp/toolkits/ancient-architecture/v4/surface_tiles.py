"""Finite tile patches sampled on host surfaces; contact and roof seams share coordinates."""
import math,hashlib,json
from geometry.contracts import normalize_outward
from roof_mesh import sub,cross,unit,check_mesh,tile_surfaces

def host_frame(fn,t,u):
 a=fn(t,max(0,u-1e-5));b=fn(t,min(1,u+1e-5));x=unit(sub(b,a))
 a=fn(max(0,t-1e-5),u);b=fn(min(1,t+1e-5),u);y=unit(sub(b,a));z=unit(cross(x,y))
 if z[2]<0:x=tuple(-q for q in x);z=tuple(-q for q in z)
 if hasattr(fn,'host_sample'):
  sample=fn.host_sample(t,u);z=tuple(sample['normal']);x=unit(tuple(x[i]-z[i]*sum(x[j]*z[j] for j in range(3)) for i in range(3)))
 y=unit(cross(z,x));return fn(t,u),x,y,z

def tile_mesh(fn,t0,t1,u0,u1,kind,bed):
 # Surface-sampled tiles are warped only to the roof surface; six cross samples show concave/convex section.
 rows=3;cols=8;vertices=[];faces=[]
 center,axis_x,axis_y,axis_z=host_frame(fn,(t0+t1)/2,(u0+u1)/2)
 def local(pt):
  q=sub(pt,center);return [round(sum(q[i]*axis[i] for i in range(3)),3) for axis in (axis_x,axis_y,axis_z)]
 for lower in (False,True):
  for i in range(rows+1):
   t=t0+(t1-t0)*i/rows
   for j in range(cols+1):
    u=u0+(u1-u0)*j/cols;pt,x,y,z=host_frame(fn,t,u);v=2*j/cols-1
    relief=(math.sqrt(max(0,1-v*v))*40 if kind=='cover' else 24*v*v)
    h=bed+relief-(8 if lower else 0)
    vertices.append(local([pt[a]+axis_z[a]*h for a in range(3)]))
 k=(rows+1)*(cols+1)
 for i in range(rows):
  for j in range(cols):
   a=i*(cols+1)+j;b=a+1;d=a+cols+1;c=d+1
   faces.extend([[a,b,c],[a,c,d],[a+k,c+k,b+k],[a+k,d+k,c+k]])
 # Depending on patch direction, flip all triangles to positive volume before boundary closure.
 incidence={}
 for f in faces[:]:
  for a,b in zip(f,f[1:]+f[:1]):
   edge=tuple(sorted((a,b)));incidence.setdefault(edge,[]).append((a,b))
 # Only top boundary edges receive thickness closure.
 for edge,entries in incidence.items():
  if len(entries)==1 and max(edge)<k:
   a,b=entries[0];faces.extend([[b,a,a+k],[b,a+k,b+k]])
 faces,normalization=normalize_outward(vertices,faces,'tile')
 check_mesh(vertices,faces)
 return {'vertices':vertices,'faces':faces,'offset_rule':'fixed normal of center host cell for entire tile; sampled substrate; not pointwise normal distance'}, {'origin':center,'x':axis_x,'y':axis_y,'z':axis_z}

def generate(mesh,p):
 prototypes={};instances=[];tile_limit=5000
 for patch_name,fn in tile_surfaces(mesh,p):
  if p['details']=='detailed' and patch_name.startswith('wing_'):
   from cut_tiles import generate_wing
   pp,ii=generate_wing(fn,p,patch_name);prototypes.update(pp);instances.extend(ii);continue
  # t = eave to ridge; choose rows by measured centerline arc length.
  samples=[fn(j/400,.5) for j in range(401)];length=sum(math.dist(a,b) for a,b in zip(samples,samples[1:]));pitch=p['tile_length']-p['tile_overlap']
  nrows=max(2,math.ceil(length/pitch));fixed_columns=max(1,round(math.dist(fn(0,0),fn(0,1))/p['tile_width']));overlap=p['tile_overlap']/p['tile_length']
  arc=[0.]
  for a,b in zip(samples,samples[1:]):arc.append(arc[-1]+math.dist(a,b))
  def time_at(distance):
   distance=max(0,min(length,distance))
   for j in range(400):
    if arc[j+1]>=distance:return (j+(distance-arc[j])/max(arc[j+1]-arc[j],1e-9))/400
   return 1.
  for row in range(nrows):
   s0=row*length/nrows;s1=min(length-25,s0+length/nrows/(1-overlap))
   if s1<=s0:continue
   t0=time_at(s0);t1=time_at(s1);tm=(t0+t1)/2
   span=min(math.dist(fn(t0,0),fn(t0,1)),math.dist(fn(t1,0),fn(t1,1)))
   if span<250:continue
   # Reserve shared ridge strips. No guessed clipping outside a patch.
   eave_span=math.dist(fn(0,0),fn(0,1))
   margin=min(.08,p['ridge_width']*.12/eave_span)
   ncols=fixed_columns;du=(1-2*margin)/ncols
   for col in range(ncols):
    start=margin+col*du;end=start+du
    for kind,u0,u1,bed in [('pan',start,end,12+row%2*1),('cover',max(margin,end-du*.22),min(1-margin,end+du*.22),34+row%2*1)]:
     if u1-u0<1e-5:continue
     proto,placement=tile_mesh(fn,t0,t1,u0,u1,kind,bed)
     digest=hashlib.sha256(json.dumps(proto,separators=(',',':')).encode()).hexdigest()[:20]
     key=kind+'_'+digest
     prototypes.setdefault(key,proto);instances.append({'prototype':key,**placement,'patch':patch_name,'row':row,'column':col})
     if len(instances)>tile_limit:raise ValueError('TILE_BUDGET_EXCEEDED: enlarge tile dimensions or reduce roof size')
 return prototypes,instances
