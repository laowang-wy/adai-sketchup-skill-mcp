"""Normalize the existing read-only C API audit to occurrence/world-transform rows.
Snapshot-local child-index paths and definition IDs; never use them as live persistent IDs.
"""
import argparse
import hashlib
import json
from pathlib import Path


def multiply(a,b):return [[sum(a[i][k]*b[k][j] for k in range(4)) for j in range(4)] for i in range(4)]

def local_matrix(values):
    if not isinstance(values,list) or len(values)!=16:raise ValueError('Expected SketchUp flat transform')
    import math
    if any(type(v) not in (int,float) or not math.isfinite(v) for v in values):raise ValueError('Nonfinite transform')
    m=[[values[j*4+i] for j in range(4)] for i in range(4)]
    if m[3]!=[0,0,0,1]:raise ValueError('Expected affine transform')
    for i in range(3):m[i][3]*=.0254
    return m


def extract(data,scope='ROOT',limit=1000,depth_limit=12):
    if type(limit) is not int or not 1<=limit<=5000 or type(depth_limit) is not int or not 1<=depth_limit<=32:raise ValueError('Invalid traversal limit')
    definitions=data['definitions'];node=data['root'];chain=[];world=[[int(i==j) for j in range(4)] for i in range(4)]
    parts=scope.split('/')
    if parts[0]!='ROOT':raise ValueError('scope must start with ROOT')
    ancestors=[]
    for part in parts[1:]:
        if not part.isdecimal():raise ValueError('Expected snapshot child index')
        child=node['children'][int(part)];local=local_matrix(child['transform']);chain.append(local);world=multiply(world,local)
        ancestors.append(child['definition']);node=definitions[child['definition']]
    stack=[(c,f'{scope}/{i}',world,chain,ancestors,1) for i,c in enumerate(node['children'])]
    rows=[];reasons=[]
    while stack:
        if len(rows)>=limit:reasons.append('max_instances');break
        child,path,parent,parents,anc,depth=stack.pop();key=child['definition'];n=definitions[key]
        local=local_matrix(child['transform']);wm=multiply(parent,local);newchain=parents+[local]
        a,b,c=[[wm[i][j] for i in range(3)] for j in range(3)]
        det=a[0]*(b[1]*c[2]-b[2]*c[1])-b[0]*(a[1]*c[2]-a[2]*c[1])+c[0]*(a[1]*b[2]-a[2]*b[1])
        rows.append({'entity_path':path,'definition_id':key,'definition_name':n.get('name'),'instance_name':child.get('name'),'origin':[wm[i][3] for i in range(3)],'world_matrix':wm,'parent_to_local_chain':newchain,'determinant':det,'axis_lengths':[sum(v*v for v in x)**.5 for x in [a,b,c]],'hidden':child.get('hidden'),'tag':child.get('layer')})
        if n['children']:
            if depth>=depth_limit or key in anc:reasons.append('max_depth' if depth>=depth_limit else 'definition_cycle');continue
            stack.extend((ch,f'{path}/{i}',wm,newchain,anc+[key],depth+1) for i,ch in enumerate(n['children']))
    return {'schema_version':1,'scope':'c_api_audit_snapshot_occurrences','source':data['source'],'source_sha256':data['source_sha256'],'units':'m','coordinate_frame':'world:model-origin','scope_path':scope,'instances':rows,'truncated':bool(reasons),'truncation_reasons':sorted(set(reasons)),'geometry_readback':'source_audit_snapshot_not_active_document','identity_scope':'child_index_paths_and_definition_keys_valid_only_for_this_audit','surface_contact':'unverified'}


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--audit',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--scope',default='ROOT');p.add_argument('--limit',type=int,default=1000);p.add_argument('--depth',type=int,default=12);a=p.parse_args()
    if a.output.exists() or a.output.resolve()==a.audit.resolve():p.error('Use new output file')
    raw=a.audit.read_bytes();data=json.loads(raw.decode('utf-8-sig'));result=extract(data,a.scope,a.limit,a.depth)
    result['audit_sha256']=hashlib.sha256(raw).hexdigest();result['audit_path']=str(a.audit.resolve())
    a.output.write_text(json.dumps(result,ensure_ascii=False,indent=2,allow_nan=False),encoding='utf-8')
