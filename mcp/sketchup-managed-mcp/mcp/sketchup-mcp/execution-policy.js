'use strict';

// Version 1 projects retain their saved phase contract. Only new expert
// projects use version 2. A model name or an unversioned label cannot upgrade it.
const EXPERT_VERSION = 2;
const UNIT_PHASE = 'work_unit';
const ID = /^[A-Za-z][A-Za-z0-9_-]{2,63}$/;
const UNIT_HINT = 'Build or revise the authorized architectural system; capture current evidence when it is useful, then review the actual result.';

function policyError(message) {
  return Object.assign(new Error(message), { code: 'EXECUTION_POLICY_INVALID' });
}

function createPolicy(mode, assistanceMode, profile, planFor) {
  if (assistanceMode === 'autonomous') {
    return { version: EXPERT_VERSION, strategy: 'autonomous_work_unit', review_mode: 'current_result' };
  }
  return { version: 1, strategy: 'guided_phase', review_mode: 'phase_review', phase_plan: planFor(mode, profile) };
}

function policyFor(state) {
  const p = state.execution_policy;
  if (!p) {
    // Read old projects without mutating signed state or changing write semantics.
    return { version: 1, strategy: state.assistance_mode === 'autonomous' ? 'autonomous_work_unit' : 'guided_phase', review_mode: 'phase_review', phase_plan: state.phase_plan, legacy: true };
  }
  if (!p || typeof p !== 'object' || Array.isArray(p) || ![1, 2].includes(p.version) ||
      !['guided_phase', 'autonomous_work_unit'].includes(p.strategy)) throw policyError('Unknown execution strategy/version; no implicit downgrade is allowed.');
  if (state.assistance_mode && (state.assistance_mode === 'autonomous') !== (p.strategy === 'autonomous_work_unit')) throw policyError('Saved assistance and execution policy disagree; no write is allowed.');
  if (p.version === 2 && (p.strategy !== 'autonomous_work_unit' || p.review_mode !== 'current_result')) throw policyError('Version 2 requires the current-result expert strategy.');
  if (p.version === 1 && p.phase_plan !== undefined && (!Array.isArray(p.phase_plan) || !p.phase_plan.length)) throw policyError('Legacy phase plan is invalid.');
  return p;
}

function isExpert(state) { const p = policyFor(state); return p.version === EXPERT_VERSION; }
function isAutonomous(state) { return policyFor(state).strategy === 'autonomous_work_unit'; }
function planForState(state, plans) {
  if (isExpert(state)) return [{ name: UNIT_PHASE, hint: UNIT_HINT }]; // Internal adapter context, not a staged permission plan.
  return policyFor(state).phase_plan || state.phase_plan || plans[state.mode] || plans.single_image;
}

function resolveUnit(state, input, allocateId) {
  const units = state.work_units || {};
  if (input.work_unit_id && input.work_unit_name) throw policyError('Select an existing work_unit_id OR name a work_unit_name, not both.');
  let unit;
  if (input.work_unit_id) {
    if (!ID.test(input.work_unit_id) || !Object.hasOwn(units, input.work_unit_id)) throw policyError('Unknown work unit; select a returned ID or provide a new system name.');
    unit = units[input.work_unit_id];
  } else if (input.work_unit_name !== undefined) {
    if (typeof input.work_unit_name !== 'string' || !input.work_unit_name.trim() || input.work_unit_name.length > 160) throw policyError('work_unit_name must be a short architectural system name.');
    const name = input.work_unit_name.trim();
    const matches = Object.values(units).filter(u => u.name === name);
    if (matches.length > 1) throw policyError('Ambiguous system name; select its returned work_unit_id.');
    unit = matches[0] || { id: allocateId(), name, revision: 0 };
  } else {
    unit = units[state.work_unit?.id];
  }
  if (!unit || !ID.test(unit.id)) throw policyError('Current work unit is missing; inspect project state.');
  return { ...unit };
}

function commitUnit(state, operation, result) {
  if (!isExpert(state)) return;
  const unit = operation.unit;
  const scope = result.unit_scope;
  if (!unit || !scope || scope.work_unit_id !== unit.id || typeof scope.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(scope.fingerprint)) {
    throw Object.assign(new Error('Committed write lacks a trustworthy unit readback; reconcile the original operation, never replay it.'), { code: 'UNIT_READBACK_MISSING' });
  }
  const old = state.work_units?.[unit.id];
  const alreadyApplied = old?.last_operation_id === operation.operation_id;
  const next = { ...unit, ...scope, revision: alreadyApplied ? old.revision : (old?.revision || 0) + 1, last_operation_id: operation.operation_id };
  state.work_units = { ...(state.work_units || {}), [unit.id]: next };
  state.work_unit = { id: unit.id, name: unit.name, strategy: 'autonomous_work_unit' };
  state.phase = UNIT_PHASE;
  state.step_index = 0;
  if (!alreadyApplied) state.scene_revision = (state.scene_revision || 0) + 1;
  // With arbitrary Ruby and no complete visual dependency graph, a fresh full
  // result is required after any write. Operation IDs never confer visual approval.
  state.current_review = null;
  delete state.dimension_results;
  state.last_evidence_id = '';
  delete state.pending_evidence;
  state.status = 'ready_for_step';
}

module.exports = { EXPERT_VERSION, UNIT_PHASE, UNIT_HINT, createPolicy, policyFor, isExpert, isAutonomous, planForState, resolveUnit, commitUnit };
