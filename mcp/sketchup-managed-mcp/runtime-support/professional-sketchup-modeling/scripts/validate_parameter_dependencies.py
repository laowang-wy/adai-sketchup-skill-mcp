"""Offline declared dependency audit; never changes SketchUp or managed state."""
import argparse
import hashlib
import json
import math
from collections import deque
from pathlib import Path

UNITS = {'mm', 'm', 'degrees', 'dimensionless'}
KINDS = {'parameter', 'derived', 'assembly'}
EXCLUDED = {'built_from', 'built_self', 'evidence', 'entity_path'}


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
        allow_nan=False, separators=(',', ':')).encode('utf-8')).hexdigest()


def nonempty(value):
    return isinstance(value, str) and bool(value.strip())


def verify(data):
    report = {'schema_version': 2, 'state': 'invalid',
        'scope': 'declared_dependency_graph_only', 'geometry_readback': 'unverified',
        'results': [], 'fingerprints': {}, 'self_fingerprints': {}, 'recheck': []}
    def issue(code, node, reason, **more):
        report['results'].append({'check_id': code, 'node_id': node, 'reason': reason, **more})
    if not isinstance(data, dict) or type(data.get('schema_version')) is not int or data['schema_version'] not in (1, 2) or not isinstance(data.get('nodes'), list):
        issue('SCHEMA', None, 'Expected schema_version 1 or 2 and nodes array'); return report
    # Reject non-JSON/nonfinite metadata too, before hashing any graph node.
    try:
        fingerprint(data)
    except (ValueError, TypeError, RecursionError, OverflowError):
        issue('JSON_VALUE', None, 'Expected finite JSON-compatible metadata'); return report
    if not data['nodes']:
        report['state'] = 'unverified'; return report
    nodes = {}
    for n in data['nodes']:
        if not isinstance(n, dict) or not nonempty(n.get('id')):
            issue('NODE', None, 'Node needs a nonempty id'); continue
        k = n['id']
        if k in nodes:
            issue('DUPLICATE', k, 'Duplicate source of truth'); continue
        nodes[k] = n
        kind = n.get('kind')
        if not isinstance(kind, str) or kind not in KINDS:
            issue('UNSUPPORTED_KIND', k, 'Supported: parameter, derived, assembly'); continue
        for field in ('revision', 'evidence'):
            if not nonempty(n.get(field)): issue(field.upper(), k, 'Nonempty string required')
        deps = n.get('depends_on')
        if not isinstance(deps, list) or any(not nonempty(x) for x in deps):
            issue('DEPENDENCIES', k, 'depends_on must be a nonempty-string array')
        elif len(set(deps)) != len(deps): issue('DEPENDENCIES', k, 'Repeated dependency')
        if 'positive' in n and type(n['positive']) is not bool:
            issue('POSITIVE', k, 'positive must be boolean')
        if kind == 'parameter':
            value = n.get('value')
            valid = type(value) in (int, float)
            try: valid = valid and math.isfinite(value)
            except OverflowError: valid = False
            if not valid: issue('VALUE', k, 'Finite numeric value required')
            if not isinstance(n.get('units'), str) or n['units'] not in UNITS:
                issue('UNITS', k, 'Unsupported units; no implicit conversions')
            if valid and n.get('positive') is True and value <= 0: issue('SCALE', k, 'Declared positive parameter is not positive')
            if deps: issue('PARAMETER_PARENT', k, 'Source parameter cannot depend on another node; use derived')
        else:
            if not deps: issue('DEPENDENCIES', k, 'Consumer requires dependencies')
            if not isinstance(n.get('built_from'), dict) or any(not isinstance(v, str) for v in n.get('built_from', {}).values()):
                issue('BUILT_FROM', k, 'Recorded dependency fingerprints must be a string-valued object')
            if 'built_self' in n and not isinstance(n['built_self'], str):
                issue('BUILT_SELF', k, 'built_self must be a string fingerprint')
    if report['results']: return report
    children = {k: [] for k in nodes}; degree = {}
    for k, n in nodes.items():
        degree[k] = len(n['depends_on'])
        for dep in n['depends_on']:
            if dep not in nodes: issue('MISSING_REFERENCE', k, 'Unknown dependency', dependency=dep)
            else: children[dep].append(k)
        expected = n.get('expected_units', {})
        if not isinstance(expected, dict):
            issue('UNITS', k, 'expected_units must be an object'); continue
        for dep, unit in expected.items():
            if dep not in n['depends_on']: issue('UNITS', k, 'Unit expectation must name a declared dependency', dependency=dep)
            elif not isinstance(unit, str) or unit not in UNITS or nodes.get(dep, {}).get('units') != unit:
                issue('UNIT_MISMATCH', k, 'Explicit conversion or corrected input required', dependency=dep, expected=unit, measured=nodes.get(dep, {}).get('units'))
    if report['results']: return report
    ready = deque(k for k in nodes if degree[k] == 0); order = []
    while ready:
        k = ready.popleft(); order.append(k)
        for child in children[k]:
            degree[child] -= 1
            if degree[child] == 0: ready.append(child)
    if len(order) != len(nodes):
        issue('CYCLE', None, 'Dependency cycle; cannot determine regeneration order', blocked_nodes=[k for k in nodes if degree[k]]); return report
    stale = set()
    for k in order:
        n = nodes[k]
        own = {a: v for a, v in n.items() if a not in EXCLUDED}
        own_hash = fingerprint(own); report['self_fingerprints'][k] = own_hash
        expected = {dep: report['fingerprints'][dep] for dep in n['depends_on']}
        # Retain v1 combined fingerprint format for legitimate old upstream records.
        report['fingerprints'][k] = fingerprint({'node': own, 'upstream': expected})
        if n['kind'] == 'parameter': continue
        actual = n['built_from']
        mismatches = [dep for dep in n['depends_on'] if actual.get(dep) != expected[dep]]
        extra = sorted(set(actual) - set(expected))
        upstream_stale = [dep for dep in n['depends_on'] if dep in stale]
        own_changed = n.get('built_self') != own_hash
        if own_changed or mismatches or extra or upstream_stale:
            stale.add(k)
            issue('STALE_INPUT', k, 'Own build inputs or upstream consumption are missing/stale',
                entity_path=n.get('entity_path'), expected=expected, measured=actual,
                expected_self=own_hash, measured_self=n.get('built_self'),
                self_status='missing' if not n.get('built_self') else 'changed' if own_changed else 'current',
                changed_dependencies=mismatches, upstream_stale=upstream_stale,
                unexpected_dependencies=extra, evidence=n['evidence'],
                suggested_next_inspection='Rebuild/review in the owning managed phase; record inputs actually consumed. Never stamp old geometry with current hashes just to pass.')
    report['recheck'] = [k for k in order if k in stale]
    report['state'] = 'needs_review' if stale else 'pass'
    return report


def self_test():
    import unittest
    suite = unittest.defaultTestLoader.discover(str(Path(__file__).parent), pattern='test_parameter_dependencies.py')
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    if not result.wasSuccessful(): raise SystemExit(1)


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--input', type=Path); p.add_argument('--report', type=Path)
    p.add_argument('--self-test', action='store_true'); a = p.parse_args()
    if a.self_test: self_test()
    else:
        if not a.input or not a.report: p.error('--input and --report required')
        if a.input.resolve() == a.report.resolve(): p.error('report cannot overwrite input')
        try: result = verify(json.loads(a.input.read_text(encoding='utf-8-sig')))
        except (OSError, ValueError, TypeError, RecursionError) as e:
            result = {'state': 'invalid', 'scope': 'declared_dependency_graph_only', 'reason': str(e)}
        try: a.report.write_text(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False), encoding='utf-8')
        except OSError as e: p.exit(2, f'Cannot write report: {e}\n')
        raise SystemExit(0 if result['state'] == 'pass' else 1)
