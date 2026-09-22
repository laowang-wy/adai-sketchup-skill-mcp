'use strict';
const { isExpert, isAutonomous } = require('./execution-policy');
const { validationIssues } = require('./review-state');

const UNRESOLVED = new Set(['dispatched', 'write_in_progress', 'result_unknown', 'recovery_required']);

function pendingOperation(state) {
  const journal = Array.isArray(state.operation_journal) ? state.operation_journal : [];
  const pending = [...journal].reverse().find(operation => UNRESOLVED.has(operation.status));
  return {
    pending_operation: pending ? {
      operation_id: pending.operation_id,
      kind: pending.kind || null,
      status: pending.status,
      phase: pending.phase || state.phase || null,
    } : null,
    last_operation_id: journal.at(-1)?.operation_id || null,
  };
}

// One decision produces both machine actions and human-readable guidance.
// Descriptions never infer a destructive recovery action from error prose.
function describeActions(state) {
  const call = (tool, args = {}, fields = []) => ({
    tool,
    arguments: { project_id: state.project_id, ...args },
    required_fields: fields,
  });
  const result = (next_call, next_action, alternatives = []) => ({
    next_call,
    next_action,
    ...(alternatives.length ? { alternatives } : {}),
  });
  const pending = pendingOperation(state).pending_operation;
  if (pending) {
    return result(call('sketchup_project_operation_receipt', { operation_id: pending.operation_id }),
      'Inspect the original operation receipt; do not replay an unknown write.');
  }
  if (state.status === 'finished') return result(null, 'Project is finished.');
  if (state.status === 'recovery_required') {
    return result(call('sketchup_project_recover', { action: 'inspect' }),
      'Inspect recovery state before any new write.');
  }
  const capture = call('sketchup_project_retry_evidence');
  if (state.recovery_recapture_required || state.status === 'evidence_pending') {
    return result(capture, 'Capture or repair current evidence without replaying geometry.');
  }

  if (isExpert(state)) {
    const write = call('sketchup_project_step', {}, ['ruby_file_or_operations']);
    const dimensions = state.dimension_results || [];
    const rejectedSnapshot = state.revision_required &&
      state.revision_required.repair_evidence_id !== state.last_evidence_id;
    const needsRepair = validationIssues(state).length > 0 ||
      dimensions.some(row => row.state === 'fail') || rejectedSnapshot;

    if (state.status === 'ready_to_finish') {
      if (dimensions.some(row => row.state !== 'pass')) {
        return result(write,
          'Complete or resolve the explicitly required object dimensions; capture and review the updated result before delivery.',
          [capture]);
      }
      return result(call('sketchup_project_finish'),
        'Deliver the reviewed current result, or continue authorized edits (which invalidate this review).', [write]);
    }
    if (state.status === 'review_required' && state.last_evidence_id && !needsRepair) {
      return result(call('sketchup_project_review', { evidence_id: state.last_evidence_id }, ['verdict', 'visual_review']),
        'Inspect current views and review the result, or continue authorized construction.', [write, capture]);
    }
    if (needsRepair) {
      return result(write,
        'Correct the observed architectural defect in its authorized system; records and prior geometry are preserved.', [capture]);
    }
    return result(write, 'Continue the current system or capture current evidence when ready to inspect it.', [capture]);
  }

  // Explicit compatibility for existing version-1 projects, not the primary
  // expert path. Existing signed projects retain their original phase meaning.
  if (state.status === 'review_required' && state.revision_required &&
      !state.revision_required.repair_evidence_id && isAutonomous(state)) {
    return result(call('sketchup_project_step', { continue_work_unit: true, operation_intent: 'update' }, ['ruby_file']),
      'Submit a scoped corrective build; committed geometry is preserved.');
  }
  if (state.status === 'review_required' && state.last_evidence_id) {
    return result(call('sketchup_project_review', { evidence_id: state.last_evidence_id }, ['verdict', 'visual_review']),
      'Inspect current evidence and review the current phase.');
  }
  if (state.status === 'ready_to_finish') {
    return result(call('sketchup_project_finish'), 'Save and verify the reviewed result.');
  }
  if (state.status === 'ready_for_step') {
    return result(call('sketchup_project_step', {}, ['ruby_file']), 'Build the current guided phase.');
  }
  return result(null, 'Inspect the project state; no safe automatic action is available.');
}

module.exports = { pendingOperation, describeActions };
