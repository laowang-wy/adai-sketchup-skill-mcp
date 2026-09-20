"""Editable closure pieces; derived construction, not surveyed ornament."""
import math
from geometry.contracts import normalize_outward
from roof_mesh import check_mesh,cross,xieshan_section

def solid(vertices,faces,name,material='roof'):
 faces,normalization=normalize_outward(vertices,faces,name)
 return {'name':name,'vertices':vertices,'faces':faces,'expected':check_mesh(vertices,faces),'material':material,'normalization':normalization}

def strip_solid(xs,lower,upper,x0,x1,name,material='wood'):
 # Extruded graph strip in YZ; collapse zero-height endpoints explicitly.
 vertices=[];lookup={};faces=[]
 def vid(p):
  key=tuple(round(v,6) for v in p)
  if key not in lookup:lookup[key]=len(vertices);vertices.append(list(key))
  return lookup[key]
 def tri(a,b,c):
  ids=[vid(q) for q in (a,b,c)]
  if len(set(ids))==3:faces.append(ids)
 for i in range(len(xs)-1):
  y,z=xs[i],xs[i+1];l,h=lower[i],upper[i];ll,hh=lower[i+1],upper[i+1]
  for x,rev in [(x0,False),(x1,True)]:
   q=[(x,y,l),(x,z,ll),(x,z,hh),(x,y,h)]
   if rev:q.reverse()
   tri(q[0],q[1],q[2]);tri(q[0],q[2],q[3])
  for a,b,c,d in [((x0,y,h),(x0,z,hh),(x1,z,hh),(x1,y,h)),((x1,y,l),(x1,z,ll),(x0,z,ll),(x0,y,l))]:tri(a,b,c);tri(a,c,d)
 for i,rev in [(0,False),(-1,True)]:
  q=[(x0,xs[i],lower[i]),(x0,xs[i],upper[i]),(x1,xs[i],upper[i]),(x1,xs[i],lower[i])]
  if rev:q.reverse()
  tri(q[0],q[1],q[2]);tri(q[0],q[2],q[3])
 return solid(vertices,faces,name,material)

def lathe(stations,center,name,sides=16):
 v=[]
 for r,z in stations:
  for i in range(sides):v.append([center[0]+r*math.cos(2*math.pi*i/sides),center[1]+r*math.sin(2*math.pi*i/sides),center[2]+z])
 f=[]
 for j in range(len(stations)-1):
  for i in range(sides):
   a=j*sides+i;b=j*sides+(i+1)%sides;c=b+sides;d=a+sides;f.extend([[a,b,c],[a,c,d]])
 # ring caps are fans to explicit center; all ring radii positive.
 for j,rev in [(0,True),(len(stations)-1,False)]:
  k=len(v);v.append([*center[:2],center[2]+stations[j][1]])
  for i in range(sides):
   ids=[k,j*sides+i,j*sides+(i+1)%sides];f.append(ids[::-1] if rev else ids)
 return solid(v,f,name)

def xieshan_parts(p):
 result=[];r=p['ridge_length']/2;d=p['depth']/2;s=d*p['gable_span_ratio'];h=p['rise'];b=h*p['apron_rise_ratio'];th=p['thickness'];n=p['slope_segments']
 ys=[-s+2*s*i/(2*n) for i in range(2*n+1)]
 tops=[h*xieshan_section(p,1-abs(y)/d)-th for y in ys]
 for sign in [-1,1]:
  x=sign*r;xa,xb=sorted([x,x-sign*40])
  result.append(strip_solid(ys,[b-th]*len(ys),tops,xa,xb,'Gable_Infill_'+str(sign)))
  # Verge fascia shares the sampled underside curve; outward thickness 24mm.
  xa,xb=sorted([x,x+sign*24])
  result.append(strip_solid(ys,[z-60 for z in tops],tops,xa,xb,'Gable_Curved_Fascia_'+str(sign)))
  result.append(strip_solid([-s,s],[b-th-40]*2,[b-th+20]*2,xa,xb,'Gable_Sill_'+str(sign)))
  for i in range(-3,4):
   y=i*s/4;half=18;top=min(h*xieshan_section(p,1-abs(y-half)/d),h*xieshan_section(p,1-abs(y+half)/d))-th-62
   if top>b-th+22:result.append(strip_solid([y-half,y+half],[b-th+20]*2,[top]*2,xa,xb,'Gable_Batten_%s_%s'%(sign,i)))
 # Closed overlap fittings cover incident capped ridge ends. Intentional overlaps, no boolean claim.
 nodes=[([sx*r,0,h],'Crown_'+str(sx)) for sx in [-1,1]]+ [([sx*r,sy*s,b],'Shoulder_%s_%s'%(sx,sy)) for sx in [-1,1] for sy in [-1,1]]
 for center,name in nodes:
  w=p['ridge_width'];result.append(lathe([(w*.62,-w*.32),(w*.62,w*.40),(w*.28,w*.66)],center,'Ridge_Junction_'+name,12))
 return result


def helmet_parts(p):
 from helmet_profile import DATA
 h=p['width']*DATA['finial']['height_by_front_width'];z=p['rise'];result=[]
 # Base spans the four ridge endpoints and supports six connected beads.
 result.append(lathe([(p['ridge_width']*.7,-p['ridge_width']*.15),(p['ridge_width']*.7,h*.08),(p['width']*.014,h*.12)],[0,0,z],'Finial_Base'))
 step=h*.12
 for i,ratio in enumerate(DATA['finial']['inferred_radii_by_width']):
  radius=p['width']*ratio;bottom=h*.12+i*step
  stations=[(radius*(.30+.70*math.sin(math.pi*j/12)),bottom+step*j/12) for j in range(13)]
  result.append(lathe(stations,[0,0,z],'Finial_Bead_'+str(i+1),24))
 result.append(lathe([(p['width']*.0036,h*.84),(p['width']*.006,h*.9),(2,h)],[0,0,z],'Finial_Tip',24))
 return result
