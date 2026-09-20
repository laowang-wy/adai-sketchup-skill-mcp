"""Materialize bound review inputs from a newly completed managed readback. No SU writes."""
import argparse,json
from pathlib import Path
from validate_parameter_dependencies import verify

def materialize(request,out):
 out=Path(out);r=request['geometry_readback'];mapping=r['mapping']
 dependencies=r.get('dependencies')
 if dependencies is None:dependencies=[] # Optional Ruby field arrives as JSON null when omitted.
 if not isinstance(dependencies,list):raise ValueError('DEPENDENCIES_MUST_BE_ARRAY')
 if not mapping or any(not isinstance(v.get('persistent_id'),int) or v['persistent_id']<=0 for v in mapping.values()):raise ValueError('LIVE_PID_REQUIRED')
 if len({v['persistent_id'] for v in mapping.values()})!=len(mapping):raise ValueError('DUPLICATE_LIVE_PID')
 binding={k:request[k] for k in ['project_id','phase','evidence_id']};evidence=str((out/'geometry-readback.json').resolve())
 checks=[]
 for sid,entry in mapping.items():
  report=entry['report'];checks.append({'id':sid,'kind':'guard_mesh_topology','entity_path':sid,'source_evidence':evidence,'coordinate_frame':'SU local mm','persistent_id':entry['persistent_id'],'report':report,'expected_closed':True})
 for c in r.get('contacts',[]):
  checks.append({'id':c['id'],'kind':'guard_contact_samples','entity_path':' -> '.join(c['pair']),'source_evidence':evidence,'coordinate_frame':'SU world mm','gaps_mm':c['gaps_mm'],'expected_gap_mm':c['expected_gap_mm'],'length_tolerance':c['tolerance_mm']})
 measurements={**binding,'units':'mm','checks':checks,'readback_scope':'actual entities at this managed step; sampled contact only'}
 root={'id':'__generator_input__','kind':'parameter','revision':r['generator_sha256']+':'+r['parameter_sha256'],'value':1,'units':'dimensionless','depends_on':[],'evidence':evidence}
 nodes=[root]
 for sid,entry in mapping.items():
  deps=[e['producer'] for e in dependencies if e['consumer']==sid] or [root['id']]
  nodes.append({'id':sid,'kind':'assembly','revision':r['parameter_sha256']+':'+str(entry['persistent_id'])+':'+entry['report']['mesh_sha256'],'depends_on':deps,'built_from':{},'evidence':evidence,'entity_path':sid})
 graph={**binding,'schema_version':2,'nodes':nodes};first=verify(graph)
 if first['state'] not in ['needs_review','pass']:raise ValueError('GENERATED_DEPENDENCY_GRAPH_INVALID')
 # These are the consumption fingerprints of this fresh, successful generation only.
 for n in nodes[1:]:
  n['built_self']=first['self_fingerprints'][n['id']];n['built_from']={i:first['fingerprints'][i] for i in n['depends_on']}
 final=verify(graph)
 if final['state']!='pass':raise ValueError('GENERATED_DEPENDENCY_GRAPH_STALE')
 draft={'schema_version':1,**binding,'visual':{'state':'unverified','observations':'Inspect actual fixed views and defect closeups; no automated visual acceptance.','inspected_views':[]},'checks':[{'kind':'geometry','input_path':str((out/'geometry-measurements.json').resolve())},{'kind':'dependencies','input_path':str((out/'geometry-dependencies.json').resolve())}]}
 artifacts={'geometry-readback.json':r,'geometry-id-map.json':mapping,'geometry-measurements.json':measurements,'geometry-dependencies.json':graph,'geometry-review-draft.json':draft,'geometry-timing.json':{'write_readback_seconds':r['write_readback_seconds'],'review_state':'unverified','compile_state':'see compilation manifest'}}
 for name,data in artifacts.items():
  with (out/name).open('x',encoding='utf8') as f:json.dump(data,f,ensure_ascii=False,indent=2,allow_nan=False)
 return list(artifacts)
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--input',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args();print(json.dumps({'files':materialize(json.loads(a.input.read_text(encoding='utf-8-sig')),a.output)}))
