'use strict';

const fail = (code, message) => { throw Object.assign(new Error(message), {code}); };
const selector = v => typeof v === 'string' && v.length > 0 && v.length <= 2000 && !/[\r\n\0]/.test(v);
function localRequest(input, expert) {
  const local = input.targets !== undefined || (!expert && input.operation_intent === 'update');
  if (!local) return null;
  if (input.operation_intent !== 'update') fail('LOCAL_UPDATE_INTENT_REQUIRED', 'Use operation_intent=update for existing target objects.');
  let targets = input.targets;
  if (targets === undefined && Array.isArray(input.operations)) {
    targets = input.operations.map(op => op.op === 'window_frame' ? op.wall : op.target).filter(Boolean);
  }
  if (!Array.isArray(targets) || !targets.length || targets.length > 128 || !targets.every(selector)) fail('LOCAL_TARGETS_REQUIRED', 'Supply existing object IDs or returned pid:/path: selectors; typed guided updates infer targets.');
  const editScope = input.edit_scope || 'instance';
  if (!['instance','definition'].includes(editScope)) fail('EDIT_SCOPE_INVALID', 'edit_scope is instance or definition.');
  if (editScope === 'definition' && input.operations !== undefined) fail('DEFINITION_RUBY_REQUIRED', 'Use targeted Ruby to change the shared definition; typed placement/material edits act on instances.');
  return {targets:[...new Set(targets)], edit_scope:editScope};
}
function localProgress(state, phase, stepIndex) {
  return {
    resume: state.local_update?.resume || {phase:state.phase,step_index:state.step_index,status:state.status==='finished'?'ready_to_finish':state.status,last_evidence_id:state.last_evidence_id || '',review_pending:!!state.revision_required},
    phase, step_index:stepIndex,
  };
}
function recordLocalCommit(state, operation) {
  if (operation.followup && !(state.delivery_history||[]).some(d=>d.followup_operation_id===operation.operation_id)) {
    state.delivery_history=[...(state.delivery_history||[]),{...operation.followup,followup_operation_id:operation.operation_id}];
    state.next_output_path=operation.followup.next_output_path;
    delete state.output_path;delete state.final_evidence_id;delete state.final_evidence_path;
  }
  if (!operation.local_update) return;
  state.local_update = {...operation.local_update, operation_id:operation.operation_id};
  // Evidence and reviews remain historical, never silently relabelled current.
  state.current_review = null;
  delete state.dimension_results;
}
function acceptLocalReview(state, input, quality) {
  const edit = state.local_update;
  state.quality_reviews = [...(state.quality_reviews || []), {phase:edit.phase,evidence_id:input.evidence_id,
    operation_id:edit.operation_id,local_update:true,state:quality.state,visual_status:quality.visual_status || 'not_checked'}];
  if (input.verdict === 'revise') {
    state.status = 'ready_for_step';
    state.revision_required = {phase:edit.phase,evidence_id:input.evidence_id,reason:String(input.note || 'Revise current local result.')};
    return;
  }
  const resume = edit.resume;
  state.phase = resume.phase; state.step_index = resume.step_index;
  // Reviewing a correction of the current pending stage also reviews that
  // stage's current complete evidence; the caller performs the normal advance.
  state.status = resume.status;
  delete state.local_update;
  delete state.revision_required;
}
module.exports = {localRequest,localProgress,recordLocalCommit,acceptLocalReview,selector};
