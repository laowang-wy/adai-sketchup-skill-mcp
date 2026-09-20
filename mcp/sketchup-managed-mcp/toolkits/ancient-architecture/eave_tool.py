"""Compile a measured bracket + inferred notched-rafter/sheathing/roof diagnostic."""
import argparse,base64,json,sys,tempfile,hashlib
from pathlib import Path
ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT/'v4'))
from detail_geometry import strip_solid
from geometry.contracts import SurfaceHost,intersection_check
from surface_tiles import tile_mesh
import bearing_tool

def prepare(output,width=1200):
 out=Path(output).resolve()
 if out.exists():raise ValueError('OUTPUT_EXISTS')
 if not 900<=width<=1800:raise ValueError('EAVE_SAMPLE_WIDTH_RANGE_900_1800')
 with tempfile.TemporaryDirectory() as tmp:
  folder=Path(tmp)/'bearing';bearing_tool.prepare('changkong-layered',width,1800,180,folder);data=json.loads((folder/'data.json').read_text())
 beam=data['beam'];x0,y0,_=beam['min_mm'];x1,y1,z=beam['max_mm'];ya=y0-380;yb=y1+550
 def curve(y):
  t=y-y1;return z+.28*t+.00008*t*t
 ys=sorted(set([ya+(yb-ya)*i/24 for i in range(25)]+[y0-5,y0,y1]))
 tops=[curve(y)+140 for y in ys]
 parts=[];contacts=[];count=5;rafter_width=60
 def contact(name,a,b,points):contacts.append({'id':name,'pair':[a,b],'points_local_mm':points,'tolerance_mm':.03})
 for i in range(count):
  x=x0+50+(x1-x0-100)*i/(count-1);name='Rafter_'+str(i+1)
  # 5mm beveled notch shoulder at outer beam edge; horizontal notch bears across beam width.
  ry=[];lo=[];hi=[]
  for y in ys:
   ry.append(y);lo.append(z if y0<=y<=y1 else curve(y));hi.append(curve(y)+140)
  parts.append(strip_solid(ry,lo,hi,x-rafter_width/2,x+rafter_width/2,name))
  contact('beam_to_'+name,'beam',name,[[x+dx,y0+(y1-y0)*t,z] for dx in [-20,0,20] for t in [.15,.5,.85]])
  # Contact points at existing sampled stations avoid analytic-vs-mesh interpolation mismatch.
  contact(name+'_to_sheathing',name,'Sheathing',[[x+dx,ys[k],tops[k]] for dx in [-20,0,20] for k in [4,12,20]])
 parts.append(strip_solid(ys,tops,[t+25 for t in tops],x0,x1,'Sheathing'))
 parts.append(strip_solid(ys,[t+25 for t in tops],[t+75 for t in tops],x0,x1,'Roof_Substrate','roof'))
 contact('sheathing_to_roof','Sheathing','Roof_Substrate',[[x0+(x1-x0)*u,ys[k],tops[k]+25] for u in [.2,.5,.8] for k in [4,12,20]])
 def interp(y):
  for i in range(len(ys)-1):
   if y<=ys[i+1]:return tops[i]+(tops[i+1]-tops[i])*(y-ys[i])/(ys[i+1]-ys[i])+75
  return tops[-1]+75
 def host(t,u):
  y=ya+(yb-ya)*t;return (x0+(x1-x0)*u,y,interp(y))
 roof_part=next(p for p in parts if p['name']=='Roof_Substrate')
 top=[]
 for face in roof_part['faces']:
  if all(abs(roof_part['vertices'][i][2]-interp(roof_part['vertices'][i][1]))<1e-5 for i in face):top.append(face)
 discrete=SurfaceHost(roof_part['vertices'],top,'eave-roof')
 host=discrete.wrapper(host)
 for part in parts:part['expected']['intersection_check']=intersection_check(part['vertices'],part['faces'],part['name'])
 tiles=[]
 for row in range(3):
  for col in range(5):
   for kind,u0,u1,bed in [('pan',col/5,(col+1)/5,12),('cover',max(0,(col+.8)/5),min(1,(col+1.2)/5),34)]:
    if u1<=u0:continue
    proto,tr=tile_mesh(host,row/3,min(1,row/3+.40),u0,u1,kind,bed);intersection_check(proto['vertices'],proto['faces'],'eave/tile');tiles.append({'mesh':proto,'placement':tr,'name':'Tile_%s_%s_%s'%(row,col,kind)})
 payload={'bearing':data,'parts':parts,'contacts':contacts,'tiles':tiles,'stations_y_mm':ys,'scope':'source bracket; inferred notched rafters, sheathing and roof; single-beam cantilever contact sample, not structural design'}
 ruby="require 'sketchup.rb'\nrequire 'json'\nrequire 'base64'\n"
 for f in ['geometry/managed_guard.rb','source_templates/managed_builder.rb','bearing/managed_bearing.rb','v4/managed_builder.rb','eave/managed_eave.rb']:ruby+=(ROOT/f).read_text(encoding='utf8')+'\n'
 ruby+="module PipClawManagedBuild\n extend self\n def build(entities,context)\n raise 'EAVE_DIAGNOSTIC_ONLY' unless context['project_id'].start_with?('ARKS_Eave') && context['phase']=='massing'\n AncientEave.build(entities,context,JSON.parse(Base64.strict_decode64('"+base64.b64encode(json.dumps(payload).encode()).decode()+"')))\n end\nend\n"
 out.mkdir(parents=True);(out/'data.json').write_text(json.dumps(payload),encoding='utf8');(out/'build.rb').write_text(ruby,encoding='utf8')
 manifest={'ruby_file':str(out/'build.rb'),'sha256':hashlib.sha256(ruby.encode()).hexdigest(),'contact_pairs':len(contacts)+len(data['contacts']),'contact_samples':sum(len(c['points_local_mm']) for c in contacts+data['contacts']),'scope':payload['scope'],'width_mm':width}
 (out/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf8');return manifest
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--output',required=True);p.add_argument('--width-mm',type=float,default=1200);a=p.parse_args();print(json.dumps(prepare(a.output,a.width_mm),indent=2))
