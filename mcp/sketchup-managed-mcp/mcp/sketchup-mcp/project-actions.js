'use strict';
const { isExpert, initialStage, initialStageName, isAutonomous } = require('./execution-policy');
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
  const reviewAction = state.mode === 'single_image'
    ? 'Compare source and model outlines and spaces in corresponding views. sketchup_project_retry_evidence changes images only: comparison.view={azimuth_deg,elevation_deg} chooses direction; if the building is small in the picture, comparison.regions=[{name,source_box,candidate_box}] enlarges corresponding regions. Boxes are 0-1 [left,top,right,bottom] within the source/candidate originals in review_report, not the sheet. Inspect, then correct the visible differences or review.'
    : 'Inspect current views against the task and review the result, or correct the observed differences.';
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
        reviewAction, [write, capture]);
    }
    if (needsRepair) {
      return result(write,
        'Correct the observed architectural defect in its authorized system; records and prior geometry are preserved.', [capture]);
    }
    if (initialStage(state)) {
      return result(write, `Build or correct ${initialStageName(initialStage(state))} in the current unit; capture and review this step independently before advancing.`, [capture]);
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
  const localEdit=call('sketchup_project_step',{operation_intent:'update'},['ruby_file_or_operations']);
  if (state.status==='ready_for_step' && state.revision_required) return result(localEdit,'Correct the affected existing objects; typed targets infer scope, Ruby uses targets and context.edit_targets. The current stage is retained. Full replacement remains available.',[call('sketchup_project_step',{operation_intent:'replace'},['ruby_file_or_operations'])]);
  if (state.status === 'review_required' && state.last_evidence_id) {
    return result(call('sketchup_project_review', { evidence_id: state.last_evidence_id }, ['verdict', 'visual_review']),
      reviewAction,[localEdit,capture]);
  }
  if (state.status === 'ready_to_finish') {
    return result(call('sketchup_project_finish'), 'Save and verify the reviewed result.',[localEdit]);
  }
  if (state.status === 'ready_for_step') {
    const write = call('sketchup_project_step', {}, ['ruby_file_or_operations']);
    if (state.step_index > 0 && state.last_evidence_id) return result(write,
      'For further new construction, use the current task_card. For requested corrections, inspect the last captured result, find existing targets with geometry_diagnose, then step(operation_intent=update, targets=...) using the relevant construction method. The saved stage resumes after that edit; previous acceptance records the earlier review, not the new request.',
      [call('sketchup_project_geometry_diagnose'), localEdit]);
    return result(write, 'Construct the current task_card goal using its method and parameters, then submit the managed step.');
  }
  return result(null, 'Inspect the project state; no safe automatic action is available.');
}

module.exports = { pendingOperation, describeActions };
