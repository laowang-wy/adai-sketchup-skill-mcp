"""Bounded exact slot coverage over declared/read-back instance origins, no geometry mutations."""
import math


def check_layout(row):
    actual=row.get('instances');expected=row.get('expected_slots');tol=row.get('length_tolerance')
    if type(tol) not in (float,int) or not math.isfinite(tol) or tol<0:raise ValueError('Invalid length_tolerance')
    if row.get('truncated') is not False:raise ValueError('Full readback required: truncated must explicitly be false')
    if not isinstance(actual,list) or not isinstance(expected,list) or not expected or max(len(actual),len(expected))>1000:
        raise ValueError('Expected instances and nonempty expected_slots arrays, at most 1000 each; scope to one assembly')
    def validate(items,idkey):
        seen=set()
        for item in items:
            if not isinstance(item,dict):raise ValueError('Expected instance/slot object')
            key=item.get(idkey)
            if not isinstance(key,str) or not key.strip() or key in seen:raise ValueError('Missing/duplicate occurrence path or slot_id')
            seen.add(key)
            if not isinstance(item.get('definition_id'),str) or not item['definition_id']:raise ValueError('definition_id required')
            v=item.get('origin')
            if not isinstance(v,list) or len(v)!=3 or any(type(x) not in (int,float) or not math.isfinite(x) for x in v):raise ValueError('Expected finite XYZ origin')
    validate(actual,'entity_path');validate(expected,'slot_id')
    matches=[];missing=[];ambiguous=[];used={}
    for slot in expected:
        candidates=[a for a in actual if a['definition_id']==slot['definition_id'] and math.dist(a['origin'],slot['origin'])<=tol]
        if not candidates:missing.append(slot['slot_id']);continue
        if len(candidates)!=1:ambiguous.append({'slot_id':slot['slot_id'],'paths':[a['entity_path'] for a in candidates]});continue
        a=candidates[0];used.setdefault(a['entity_path'],[]).append(slot['slot_id'])
        matches.append({'slot_id':slot['slot_id'],'entity_path':a['entity_path'],'error':math.dist(a['origin'],slot['origin'])})
    multiply_used={k:v for k,v in used.items() if len(v)!=1}
    extra=[a['entity_path'] for a in actual if a['entity_path'] not in used]
    return not (missing or ambiguous or multiply_used or extra), {'actual_count':len(actual),'expected_count':len(expected),'matches':matches,'missing_slots':missing,'ambiguous_slots':ambiguous,'multiply_matched':multiply_used,'unexpected_paths':extra,'scope':'definition_and_origin_coverage_only','rotation_scale_surface_contact':'unverified'}
