'use strict';

// Findings are owned by the program. Callers submit observations, not issue IDs
// or bookkeeping contracts. Legacy single markers are read without erasing them.
function issueKey(x) { return JSON.stringify([x.phase || null, x.work_unit_id || null, x.check || (x.kind === 'structure' ? 'phase_audit' : x.kind) || 'legacy']); }
function validationIssues(state) {
  const out = new Map();
  for (const item of [...(state.validation_issues || []), state.validation_failed].filter(Boolean)) out.set(issueKey(item), item);
  return [...out.values()];
}
function applyValidationResult(state, phase, check, error = null, evidenceId = null, scope = {}) {
  const target = { phase, work_unit_id: scope.work_unit_id !== undefined ? scope.work_unit_id : state.work_unit?.id || null, check };
  const key = issueKey(target);
  const issues = validationIssues(state).filter(x => issueKey(x) !== key);
  if (error) issues.push({ ...target, kind: check, code: error.code || 'VALIDATION_FAILED', message: String(error.message || error), evidence_id: evidenceId, operation_id: state.pending_execution?.operation_id || null });
  state.validation_issues = issues;
  if (issues.length) state.validation_failed = issues[0];
  else { delete state.validation_failed; delete state.structure_error; }
}
function revisionMatches(state, phase) {
  const r = state.revision_required;
  return !!r && r.phase === phase && (r.work_unit_id || null) === (state.work_unit?.id || null);
}
function qualitySummary(state, plan, expert = false) {
  const history = state.quality_reviews || [];
  const latest = new Map(history.filter(x => !x.invalidated_at).map(x => [x.phase, x]));
  const phases = expert ? [] : plan.map(p => {
    const r = latest.get(p.name);
    return { phase: p.name, state: r?.state || 'unreviewed', evidence_id: r?.evidence_id || null, checks: (r?.checks || []).map(({ kind, state }) => ({ kind, state })) };
  });
  const current = expert ? state.current_review : null;
  const checks = expert ? (current?.checks || []) : phases.flatMap(p => p.checks.map(c => ({ phase: p.phase, ...c })));
  const unverified = checks.filter(x => ['unverified', 'unsupported'].includes(x.state));
  for (const row of state.dimension_results || []) if (row.state === 'unverified') unverified.push({kind:'source_dimension',object:row.object,axis:row.axis,state:row.state,expected_mm:row.expected_mm,measured_mm:row.measured_mm,reason:row.reason});
  const unresolved = validationIssues(state).map(x => ({ kind: 'validation', value: x }));
  for (const row of state.dimension_results || []) if (row.state === 'fail') unresolved.push({kind:'source_dimension',value:row});
  if (state.revision_required) unresolved.push({ kind: 'revision_required', value: state.revision_required });
  if (state.recovery_recapture_required) unresolved.push({ kind: 'recovery_recapture_required', value: true });
  const gaps = history.flatMap(x => x.history_gaps || []);
  // Historical provenance is separate from a defect in the current model.
  return { ...(expert ? { scope: 'current_project_result', reviewed_revision: current?.scene_revision ?? null, current_revision: state.scene_revision || 0, current: !!current && current.scene_revision === state.scene_revision } : { reviewed_phases: phases.filter(p => p.state !== 'unreviewed').length, total_phases: plan.length, phases }), unverified, unresolved, history_gap_count: gaps.length, history_gaps: gaps.slice(-5), history_detail: 'sketchup_project_status(section=quality,detail=true)' };
}
module.exports = { validationIssues, applyValidationResult, revisionMatches, qualitySummary };
