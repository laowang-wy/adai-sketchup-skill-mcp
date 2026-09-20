"""Fixed physical-width wing courses clipped at the diagonal ridge boundary."""
import math,hashlib,json
from roof_mesh import Mesh

def clip(poly,A,margin):
 out=[]
 for a,b in zip(poly,poly[1:]+poly[:1]):
  da=A*(1-a[0])-margin-a[1];db=A*(1-b[0])-margin-b[1]
  if da>=0:out.append(a)
  # A vertex on the clipping line is already emitted by the inside branch.
  # Add intersections only for strictly crossing edges, otherwise the fan
  # contains duplicate boundary vertices and produces collapsed triangles.
  if (da>0 and db<0) or (da<0 and db>0):
   t=da/(da-db);out.append((a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])))
 clean=[]
 for point in out:
  if not clean or math.dist(point,clean[-1])>1e-9:clean.append(point)
 if len(clean)>1 and math.dist(clean[0],clean[-1])<=1e-9:clean.pop()
 return clean if len(clean)>=3 else []

def generate_wing(fn,p,name):
 A=(p['width']-p['ridge_length'])/2;pitch=p['tile_width'];length=math.dist(fn(0,0),fn(1,0));row_pitch=p['tile_length']-p['tile_overlap'];rows=math.ceil(length/row_pitch);margin=p['ridge_width']*.10
 protos={};instances=[]
 for row in range(rows):
  t0=row/rows;t1=min(1-margin/A,(row/rows)+p['tile_length']/length)
  if t1<=t0:continue
  for col in range(math.ceil(A/pitch)):
   for kind,q0,q1 in [('pan',col*pitch,(col+1)*pitch),('cover',(col+.78)*pitch,(col+1.22)*pitch)]:
    if q0>=A*(1-t0)-margin:continue
    poly=clip([(t0,q0),(t1,q0),(t1,q1),(t0,q1)],A,margin)
    if len(poly)<3:continue
    area=abs(sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(poly,poly[1:]+poly[:1])))/2
    if area*length<100:continue
    m=Mesh()
    def point(t,q):
     u=q/(A*(1-t));v=2*(q-q0)/(q1-q0)-1;x,y,z=fn(t,u)
     relief=40*math.sqrt(max(0,1-v*v)) if kind=='cover' else 24*v*v
     return (x,y,z+(34 if kind=='cover' else 12)+relief)
    for i in range(3):
     a=t0+(t1-t0)*i/3;b=t0+(t1-t0)*(i+1)/3
     for j in range(8):
      c=q0+(q1-q0)*j/8;d=q0+(q1-q0)*(j+1)/8
      cell=clip([(a,c),(b,c),(b,d),(a,d)],A,margin)
      for aa,bb in zip(cell,cell[1:]+cell[:1]):
       ia,ib=m.vertex(point(*aa)),m.vertex(point(*bb))
       if ia!=ib:m.declared_boundary[tuple(sorted((ia,ib)))]+=1
      for k in range(1,len(cell)-1):m.triangle(point(*cell[0]),point(*cell[k]),point(*cell[k+1]))
    m.close(8)
    # Vertices remain in roof coordinates; all placements identity.
    proto={'vertices':m.vertices,'faces':m.faces};key='cut_'+hashlib.sha256(json.dumps(proto).encode()).hexdigest()[:20];protos[key]=proto
    instances.append({'prototype':key,'origin':[0,0,0],'x':[1,0,0],'y':[0,1,0],'z':[0,0,1],'patch':name,'row':row,'column':col,'stock_width_mm':q1-q0,'clipped':any(q>A*(1-t)-margin for t,q in [(t0,q0),(t1,q0),(t1,q1),(t0,q1)]),'retained_parametric_area':area,'cut_boundary':'q <= wing_width*(1-t)-ridge_margin'})
 return protos,instances
