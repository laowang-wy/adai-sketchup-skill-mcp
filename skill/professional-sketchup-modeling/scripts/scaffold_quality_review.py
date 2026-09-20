#!/usr/bin/env python3
"""Scaffold a managed quality-review JSON bound to the current project/phase/evidence.

This fills only mechanical fields (project_id, phase, evidence_id, verdict and
evidence file paths). It intentionally leaves visual observations and check
reasons EMPTY so the produced file cannot be submitted unchanged: the MCP
rejects empty observations and empty unverified reasons. The agent must open
the evidence images, write real observations, choose the views it actually
inspected, and either supply check input files or honest unverified reasons.

Usage:
  python scaffold_quality_review.py --step-result B3-result.json --out review.json
      [--visual-state pass|fail|unverified] [--observations "what was seen"]
      [--view review_sheet --view perspective]
      [--geometry-input measurements.json] [--dependencies-input dependency-graph.json]

--step-result accepts a saved sketchup_project_step / project_status response
JSON containing project_id, phase, evidence_id (or last_evidence_id) and a
files map. --view names are resolved against that files map.
"""
import argparse, json, sys
from pathlib import Path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--step-result', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--visual-state', default='unverified',
                    choices=['pass', 'fail', 'unverified'])
    ap.add_argument('--observations', default='')
    ap.add_argument('--view', action='append', default=[])
    ap.add_argument('--geometry-input', default='')
    ap.add_argument('--dependencies-input', default='')
    ap.add_argument('--note', default='')
    a = ap.parse_args()

    if Path(a.out).exists():
        raise SystemExit('Output already exists; choose a new draft path to preserve prior review')
    raw = Path(a.step_result).read_text(encoding='utf-8-sig')
    r = json.loads(raw)
    if not isinstance(r, dict) or not r.get('project_id'):
        raise SystemExit('step result JSON lacks project_id')
    phase = r.get('phase')
    evidence_id = r.get('evidence_id') or r.get('last_evidence_id')
    if not phase or not evidence_id:
        raise SystemExit('step result JSON lacks phase/evidence_id')

    files = r.get('files') or {}
    views = []
    for name in a.view:
        entry = files.get(name)
        if entry is None and name == 'review_sheet' and r.get('review_sheet'):
            entry = {'path': r['review_sheet']}
        if isinstance(entry, dict) and entry.get('path'):
            views.append(entry['path'])
        else:
            known = ', '.join(sorted(files)) or '(none)'
            raise SystemExit(f'unknown view {name!r}; available: {known}')

    checks = []
    for kind, inp in (('geometry', a.geometry_input),
                      ('dependencies', a.dependencies_input)):
        if inp:
            p = Path(inp)
            checks.append({'kind': kind, 'input_path': str(p.resolve())})
        else:
            # Empty reason is deliberate: the MCP rejects this until the agent
            # writes a concrete reason or supplies a real input file.
            checks.append({'kind': kind, 'state': 'unverified', 'reason': ''})

    q = {
        'project_id': r['project_id'],
        'evidence_id': evidence_id,
        'verdict': 'continue',
        'note': a.note,
        'quality_review': {
            'schema_version': 1,
            'project_id': r['project_id'],
            'phase': phase,
            'evidence_id': evidence_id,
            'visual': {
                'state': a.visual_state,
                'observations': a.observations,
                'inspected_views': views,
            },
            'checks': checks,
        },
    }
    Path(a.out).write_text(json.dumps(q, ensure_ascii=False, indent=2),
                           encoding='utf-8')
    print(f'wrote {a.out}')
    print('WARNING: empty observations/reasons are rejected by the MCP on purpose.')
    print('Open the evidence images first, then fill observations, choose only')
    print('the views actually inspected, and give each check a real input_path')
    print('or a concrete unverified/not_applicable reason.')


if __name__ == '__main__':
    main()
