"""Offline geometry measurement checks; never reads/writes SketchUp or grants managed approval."""
import argparse
import json
import math
from pathlib import Path


def finite(v):
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
        raise ValueError('Expected finite number')
    return v


def tolerance(v):
    if finite(v) < 0:
        raise ValueError('Negative tolerance')
    return v


def dot(a, b):
    return sum(x*y for x, y in zip(a, b))


def check(row):
    kind = row['kind']
    if any(not isinstance(row.get(k), str) or not row[k].strip() for k in ('entity_path', 'source_evidence')):
        raise ValueError('Measurement requires entity_path and source_evidence')
    if kind == 'guard_mesh_topology':
        r=row['report']
        if type(row.get('persistent_id')) is not int or row['persistent_id']<=0:raise ValueError('Actual persistent_id required')
        if r.get('source')!='SketchUp Face.mesh / vertices readback' or not r.get('mesh_sha256'):raise ValueError('Live readback provenance required')
        components=r.get('components',[])
        if not components:raise ValueError('Connected components missing')
        good=(r.get('closed') is True and r.get('boundary_edges')==0 and r.get('orientation_conflicts')==0 and all(finite(c['signed_volume_mm3'])>0 for c in components))
        return good, {'components':components,'triangle_count':r.get('triangle_count'),'scope':'supplied live-readback report; provenance bound by MCP, not authenticated by offline checker'}
    if kind == 'guard_contact_samples':
        gaps=row.get('gaps_mm')
        if not isinstance(gaps,list) or not gaps:raise ValueError('Actual triangle contact samples required')
        errors=[abs(finite(v)-finite(row['expected_gap_mm'])) for v in gaps]
        return max(errors)<=tolerance(row['length_tolerance']), {'samples':len(gaps),'max_error_mm':max(errors),'scope':'sampled ray intersections only; not whole-interface certification'}
    if kind in ('rigid_transform', 'mirrored_transform'):
        # Row-major 4x4 matrices; root-to-leaf chain, column-vector convention.
        chain = row['parent_to_local_chain']
        if not chain:
            raise ValueError('Empty transform chain')
        world = [[int(i == j) for j in range(4)] for i in range(4)]
        for m in chain:
            if len(m) != 4 or any(len(a) != 4 for a in m):
                raise ValueError('Expected 4x4 matrix: each chain entry must be a nested row-major [[a,b,c,d],[e,f,g,h],[i,j,k,l],[0,0,0,1]], not a flat 16-element list')
            m = [[finite(v) for v in a] for a in m]
            if m[3] != [0,0,0,1]:
                raise ValueError('Expected affine matrix')
            world = [[sum(world[i][k]*m[k][j] for k in range(4)) for j in range(4)] for i in range(4)]
        axes = [[world[i][j] for i in range(3)] for j in range(3)]
        tol = tolerance(row['dimensionless_tolerance'])
        lengths = [math.sqrt(dot(a,a)) for a in axes]
        det = (axes[0][0]*(axes[1][1]*axes[2][2]-axes[1][2]*axes[2][1])
               -axes[1][0]*(axes[0][1]*axes[2][2]-axes[0][2]*axes[2][1])
               +axes[2][0]*(axes[0][1]*axes[1][2]-axes[0][2]*axes[1][1]))
        expected = row['expected_world_axes']
        if len(expected) != 3 or any(len(a)!=3 for a in expected):
            raise ValueError('Expected three host axes')
        expected = [[finite(v) for v in a] for a in expected]
        if any(abs(math.sqrt(dot(a,a))-1)>1e-6 for a in expected) or any(abs(dot(expected[i],expected[j]))>1e-6 for i,j in ((0,1),(0,2),(1,2))):
            raise ValueError('Expected host axes must be orthonormal')
        expected_det=dot(expected[0],[expected[1][1]*expected[2][2]-expected[1][2]*expected[2][1],expected[1][2]*expected[2][0]-expected[1][0]*expected[2][2],expected[1][0]*expected[2][1]-expected[1][1]*expected[2][0]])
        mirrored=kind=='mirrored_transform'
        if mirrored and (not isinstance(row.get('mirror_reason'),str) or not row['mirror_reason'].strip()):
            raise ValueError('Intentional mirror requires mirror_reason and explicit reflected host axes')
        if (expected_det < 0) != mirrored: raise ValueError('Expected axes handedness disagrees with check kind')
        angle_tol = tolerance(row['angle_tolerance_degrees'])
        angles = [math.degrees(math.acos(max(-1,min(1,dot(a,e)/n)))) if n else 180 for a,e,n in zip(axes,expected,lengths)]
        good = all(abs(n-1)<=tol for n in lengths) and all(abs(dot(axes[i],axes[j]))<=tol for i,j in ((0,1),(0,2),(1,2))) and (det<0 if mirrored else det>0) and all(a<=angle_tol for a in angles)
        return good, {'axis_lengths':lengths,'determinant':det,'host_angles_degrees':angles}
    if kind == 'instance_layout':
        from validate_instance_layout import check_layout
        return check_layout(row)
    if kind == 'centered_thickness':
        lo,hi,axis = [finite(row[k]) for k in ('minimum','maximum','column_axis')]
        if hi<=lo: raise ValueError('Invalid thickness bounds')
        error = abs((lo+hi)/2-axis)
        return error<=tolerance(row['length_tolerance']), {'center_error':error}
    if kind == 'wall_head':
        gap = finite(row['beam_underside'])-finite(row['wall_top'])
        error = abs(gap-finite(row['expected_gap']))
        return error<=tolerance(row['length_tolerance']), {'gap':gap,'gap_error':error}
    raise ValueError('Unknown check kind')


SUPPORTED_KINDS = {'guard_mesh_topology','guard_contact_samples','rigid_transform', 'mirrored_transform', 'instance_layout', 'centered_thickness', 'wall_head'}


def feedback(row, units):
    row = row if isinstance(row, dict) else {}
    kind = row.get('kind') if isinstance(row.get('kind'), str) else ''
    keys = {
        'rigid_transform': ['expected_world_axes', 'dimensionless_tolerance', 'angle_tolerance_degrees'],
        'centered_thickness': ['column_axis', 'length_tolerance'],
        'wall_head': ['expected_gap', 'length_tolerance'],
    }
    keys['mirrored_transform']=keys['rigid_transform']+['mirror_reason']
    keys['instance_layout']=['expected_slots','length_tolerance']
    inspections = {
        'rigid_transform': 'Inspect each parent transform, definition origin and host axes; do not assume translation is the cause.',
        'centered_thickness': 'Inspect extrusion normal, thickness extents and column axis in the same local frame.',
        'wall_head': 'Inspect story datum, height caps, intended opening and beam host; do not automatically fill an open gallery.',
    }
    inspections['mirrored_transform']='Inspect intended reflected axes, asymmetric parts, face/material orientation and host; this check does not validate those surfaces.'
    inspections['instance_layout']='Inspect actual occurrence paths and expected slots; do not derive expected positions from the same actual sample.'
    return {
        'id': row.get('id'), 'check_id': row.get('id'), 'entity_path': row.get('entity_path'), 'kind': kind,
        'coordinate_frame': 'composed_world' if kind in ('rigid_transform','mirrored_transform') else row.get('coordinate_frame', 'unverified'),
        'expected': {k: row.get(k) for k in keys.get(kind, [])},
        'units': {'length': units, 'angle': 'degrees', 'axis_scale': 'dimensionless'},
        'evidence': row.get('source_evidence'), 'affected_dependencies': row.get('affected_dependencies', []),
        'dependency_scope': 'caller_supplied_not_computed',
        'suggested_next_inspection': inspections.get(kind, 'Unsupported relationship: obtain supported measurements and review; no automatic repair.'),
    }


def verify(data):
    base = {'scope':'supplied_measurements_only', 'visual_acceptance':'unverified', 'surface_contact':'unverified', 'geometry_readback':'unverified', 'evidence_authentication':'unverified'}
    if not isinstance(data, dict):
        return {**base, 'state':'invalid', 'results':[], 'reason':'Expected input object'}
    if not isinstance(data.get('units'), str) or not data['units'].strip() or not data.get('checks'):
        return {**base, 'state':'unverified','results':[], 'reason':'No units or measurements'}
    if not isinstance(data['checks'], list):
        return {**base, 'state':'invalid','results':[], 'reason':'checks must be an array'}
    if data['units'] not in {'mm', 'cm', 'm', 'in', 'ft'}:
        return {**base, 'state':'invalid', 'results':[], 'reason':'Unsupported length units; no implicit conversion'}
    results=[]
    seen=set()
    for row in data['checks']:
        result=feedback(row, data['units'])
        try:
            if not isinstance(row, dict): raise ValueError('Expected check object')
            if not isinstance(row.get('id'), str) or not row['id'].strip(): raise ValueError('Missing check_id (id)')
            if row['id'] in seen: raise ValueError('Duplicate check id')
            seen.add(row['id'])
            if not isinstance(row.get('kind'), str): raise ValueError('Missing check kind')
            if row['kind'] not in SUPPORTED_KINDS:
                results.append({**result,'state':'unsupported','measured':None,'reason':'No implementation for this relationship'})
                continue
            passed, values=check(row)
            frame=row.get('coordinate_frame')
            frame_ok=isinstance(frame,str) and bool(frame.strip()) and frame not in {'unverified','unknown'}
            if row['kind'] in ('rigid_transform','mirrored_transform'): frame_ok=True
            if 'measurement_frames' in row:
                names={'centered_thickness':('minimum','maximum','column_axis'), 'wall_head':('wall_top','beam_underside','expected_gap')}.get(row['kind'],())
                frames=row['measurement_frames']
                if not isinstance(frames,dict) or any(frames.get(k)!=frame for k in names):
                    raise ValueError('Measurements must share the declared coordinate frame; convert explicitly')
            state='fail' if not passed else 'pass' if frame_ok else 'unverified'
            results.append({**result,'state':state,'arithmetic_state':'pass' if passed else 'fail',
                'frame_declaration':'provided' if frame_ok else 'unverified',
                'measurements':values,'measured':values})
        except (KeyError,ValueError,TypeError,IndexError,OverflowError) as e:
            results.append({**result,'state':'invalid','measured':None,'reason':str(e)})
    states={x['state'] for x in results}
    overall = 'fail' if states & {'fail','invalid'} else 'unverified' if states & {'unsupported','unverified'} else 'pass'
    return {**base,'state':overall,'results':results}


def self_test():
    import copy
    eye=[[int(i==j) for j in range(4)] for i in range(4)]
    base={'id':'brace','entity_path':'root/bay/brace','source_evidence':'audit.json','coordinate_frame':'world:model-origin','kind':'rigid_transform','parent_to_local_chain':[eye], 'expected_world_axes':[[1,0,0],[0,1,0],[0,0,1]],'dimensionless_tolerance':1e-6,'angle_tolerance_degrees':0.1}
    assert check(base)[0]
    for matrix in ([[2,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]], [[0,-1,0,0],[1,0,0,0],[0,0,1,0],[0,0,0,1]], [[-1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]], [[1,0.2,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]]):
        case=copy.deepcopy(base);case['parent_to_local_chain']=[matrix,eye];assert not check(case)[0]
    center={**base,'kind':'centered_thickness','minimum':-.15,'maximum':.15,'column_axis':0,'length_tolerance':.001}
    assert check(center)[0];assert not check({**center,'maximum':.45})[0]
    wall={**base,'kind':'wall_head','wall_top':5,'beam_underside':5,'expected_gap':0,'length_tolerance':.001}
    assert verify({'units':'m','checks':[wall]})['state']=='pass'
    missing=dict(wall);missing.pop('coordinate_frame')
    assert verify({'units':'m','checks':[missing]})['state']=='unverified'
    mixed={**wall,'measurement_frames':{'wall_top':'local','beam_underside':'world','expected_gap':'world'}}
    assert verify({'units':'m','checks':[mixed]})['state']=='fail'
    assert verify({'units':'m','checks':[wall,wall]})['state']=='fail'
    assert verify({'units':'bogus','checks':[wall]})['state']=='invalid'
    assert check(wall)[0];assert not check({**wall,'wall_top':3.1})[0]
    assert verify({'units':'m','checks':[]})['state']=='unverified'
    assert verify({'units':'m','checks':[{**wall,'wall_top':float('nan')}]})['state']=='fail'
    report=verify({'units':'m','checks':[{**wall,'wall_top':3.1,'affected_dependencies':['window_head','spandrel']}]})
    item=report['results'][0]
    assert item['state']=='fail' and item['check_id']=='brace' and item['entity_path']=='root/bay/brace'
    assert abs(item['measured']['gap']-1.9)<1e-9
    for key in ['expected','units','evidence','affected_dependencies','suggested_next_inspection']: assert key in item
    unsupported=verify({'units':'m','checks':[{**base,'kind':'surface_contact','bbox_overlap':True}]})
    assert unsupported['state']=='unverified' and unsupported['results'][0]['state']=='unsupported'
    assert unsupported['surface_contact']=='unverified'
    for invalid in [None,[],1,{'kind':[]}]:
        assert verify({'units':'m','checks':[invalid]})['state']=='fail'
    assert verify([])['state']=='invalid'
    print('PASS: structured feedback, unsupported contact despite bbox overlap, malformed inputs')
    print('PASS: rigid parent scale, wrong rotation, mirror, shear, centering, wall datum, missing and nonfinite measurements')


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input',type=Path);parser.add_argument('--report',type=Path);parser.add_argument('--self-test',action='store_true')
    a=parser.parse_args()
    if a.self_test: self_test()
    else:
        if not a.input or not a.report: parser.error('--input and --report required')
        if a.input.resolve()==a.report.resolve(): parser.error('report cannot overwrite input')
        try: result=verify(json.loads(a.input.read_text(encoding='utf-8-sig')))
        except (OSError, ValueError, TypeError, RecursionError) as e: result={'state':'invalid','scope':'supplied_measurements_only','reason':str(e)}
        try: a.report.write_text(json.dumps(result,ensure_ascii=False,indent=2,allow_nan=False),encoding='utf-8')
        except OSError as e: parser.exit(2, f'Cannot write report: {e}\n')
        raise SystemExit(0 if result['state']=='pass' else 1)
