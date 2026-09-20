"""Measured, source-bound double-slope loft. No guessed roof-family dispatch."""
import argparse, base64, collections, hashlib, json, math
from pathlib import Path
ROOT=Path(__file__).resolve().parent
PROFILE_HASH='d7c43e45c8b12c1e679c2bfe90c0e7ffeaac1e64e4418b898ec06bbb936a8ded'

def mesh(profile_id, length_mm, span_mm, rise_mm, thickness_mm):
    for name,value,lo,hi in [('length',length_mm,500,100000),('span',span_mm,500,100000),('rise',rise_mm,100,30000),('thickness',thickness_mm,10,1000)]:
        if type(value) not in (int,float) or not math.isfinite(value) or not lo<=value<=hi:raise ValueError('INVALID_DIMENSION '+name)
    if thickness_mm>=rise_mm:raise ValueError('thickness must be below rise')
    raw=(ROOT/'study/measured-profiles.json').read_bytes()
    if hashlib.sha256(raw).hexdigest()!=PROFILE_HASH:raise ValueError('PROFILE_HASH_MISMATCH: re-study and review changed source data')
    profiles=json.loads(raw)
    if profile_id not in ('G0916','G1031'):raise ValueError('UNKNOWN_PROFILE: choose G0916 or G1031')
    p=profiles[profile_id];stations=p['normalized_full_section'];n=len(stations)
    vertices=[]
    for lower in [False,True]:
        for x in [-length_mm/2,length_mm/2]:
            vertices.extend([[x,(u-.5)*span_mm,z*rise_mm-(thickness_mm if lower else 0)] for u,z in stations])
    faces=[]
    for j in range(n-1):
        faces.extend([[j,n+j,n+j+1,j+1],[2*n+j+1,3*n+j+1,3*n+j,2*n+j]])
        faces.extend([[j+1,2*n+j+1,2*n+j,j],[n+j,3*n+j,3*n+j+1,n+j+1]])
    faces.extend([[0,2*n,3*n,n],[n-1,2*n-1,4*n-1,3*n-1]])
    incidence=collections.defaultdict(list)
    for face in faces:
        for a,b in zip(face,face[1:]+face[:1]):incidence[tuple(sorted((a,b)))].append(1 if a<b else -1)
    assert all(len(v)==2 and sum(v)==0 for v in incidence.values()),'mesh topology'
    return {'vertices_mm':vertices,'quads':faces,'profile_id':profile_id,'source_sha256':p['source_sha256'],'profile_file_sha256':PROFILE_HASH,'scope':'measured double-slope loft; no hip/corner/helmet geometry','dimensions_mm':[length_mm,span_mm,rise_mm,thickness_mm],'topology':{'boundary_edges':0,'orientation_conflicts':0,'nonmanifold_edges':0}}

def prepare(profile_id,length_mm,span_mm,rise_mm,thickness_mm,output):
    data=mesh(profile_id,length_mm,span_mm,rise_mm,thickness_mm);out=Path(output).resolve()
    if out.exists():raise ValueError('OUTPUT_EXISTS')
    from geometry.contracts import validate,intersection_check
    report=validate(data['vertices_mm'],data['quads'],'measured/'+profile_id);data['triangles']=report['triangle_indices'];report['intersection_check']=intersection_check(data['vertices_mm'],data['triangles'],'measured/'+profile_id)
    payload=base64.b64encode(json.dumps(data,separators=(',',':')).encode()).decode()
    ruby="require 'sketchup.rb'\nrequire 'json'\nrequire 'base64'\n"+(ROOT/'geometry/managed_guard.rb').read_text(encoding='utf-8-sig')+"\nmodule PipClawManagedBuild\n extend self\n def build(entities,context)\n"
    ruby+="  raise 'diagnostic project/phase required' unless context['project_id'].start_with?('ARK_Diagnostic_') && context['phase']=='massing'\n"
    ruby+="  data=JSON.parse(Base64.strict_decode64('"+payload+"'))\n"
    ruby+='''  group=entities.add_group; group.name='ARK_Measured_DoubleSlope_'+data['profile_id']
  report=ADAIGeometryGuard.add_mesh(group.entities,data['vertices_mm'],data['triangles'],group.name)
  faces=group.entities.grep(Sketchup::Face)
  expected=data['vertices_mm']
  actual=faces.flat_map { |f| f.vertices.map { |v| v.position.to_a.map { |x| x.to_mm } } }
  deviation=actual.map { |a| expected.map { |b| Math.sqrt(a.zip(b).map { |x,y| (x-y)**2 }.inject(0.0,:+)) }.min }.max
  raise 'PROFILE_READBACK_MISMATCH' unless deviation<0.01
  data['live_readback']={'faces'=>faces.length,'manifold'=>group.manifold?,'max_vertex_deviation_mm'=>deviation,'boundary_edges'=>0,'orientation_conflicts'=>0}
  group.set_attribute('ARK_study','report_json',JSON.generate(data.reject { |k,v| ['vertices_mm','quads'].include?(k) }))
  PipClawManagedProject.register_projection_subject(context['phase_group'],group,{'id'=>'roof','role'=>'focal_building'})
  center=group.bounds.center
  context['model'].active_view.camera.set(center+Geom::Vector3d.new(16000.mm,-20000.mm,11000.mm),center,Z_AXIS)
  {'created'=>1,'live_readback'=>data['live_readback'],'scope'=>data['scope']}
 end
end
'''
    out.mkdir(parents=True);(out/'build.rb').write_text(ruby,encoding='utf8',newline='\n');(out/'mesh.json').write_text(json.dumps(data,indent=2),encoding='utf8')
    (out/'manifest.json').write_text(json.dumps({'build_sha256':hashlib.sha256(ruby.encode()).hexdigest(),'generator_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'profile_sha256':PROFILE_HASH,'source_sha256':data['source_sha256'],'production_ready':False,'ruby_file':str(out/'build.rb')},indent=2),encoding='utf8')
    return str(out/'build.rb')

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--profile',choices=['G0916','G1031'],required=True)
    for name in ['length','span','rise','thickness']:p.add_argument('--'+name,type=float,required=True,help='millimeters')
    p.add_argument('--output',required=True);a=p.parse_args()
    try:print(json.dumps({'ok':True,'ruby_file':prepare(a.profile,a.length,a.span,a.rise,a.thickness,a.output)}))
    except (OSError,ValueError) as e:print(json.dumps({'ok':False,'error':str(e)}));raise SystemExit(2)
