'use strict';

// Progress is applied only after a confirmed commit, including receipt recovery.
function applyCommittedProgress(state, operation) {
  const progress=operation.progress;
  if (!progress) return; // Old receipts retain their existing interpretation.
  state.phase=progress.phase;
  state.step_index=progress.step_index;
  if (progress.previous_evidence_id) state.pending_unit_reviews=[...new Set([...(state.pending_unit_reviews||[]),progress.previous_evidence_id])];
  if (progress.abstraction_recheck) state.abstraction_rechecks={...(state.abstraction_rechecks||{}),[progress.phase]:progress.abstraction_recheck};
}

function pendingExecution(operation, buildResult) {
  return {phase:operation.phase,step_index:operation.step_index,script_path:operation.script_path,
    script_hash:operation.script_hash,build_result:buildResult,operation_id:operation.operation_id,
    intent:operation.intent,work_unit_id:operation.work_unit_id,operation_context:operation.operation_context,
    model_binding:operation.model_binding,committed:true};
}

function classifyEvidenceFailure(error, stage='evidence') {
  const code=error?.code;
  const structured=error?.diagnostic;
  let category='UNKNOWN_FAILURE';
  if (stage==='validation') category='VALIDATION_FAILED';
  else if (structured?.code==='EVIDENCE_INPUT_INVALID') category='EVIDENCE_INPUT_INVALID';
  else if (['ENOENT','ENOSYS'].includes(code)) category='EVIDENCE_TOOL_UNAVAILABLE';
  else if (['ETIMEDOUT','ERR_CHILD_PROCESS_TIMEOUT'].includes(code) || error?.killed===true) category='EVIDENCE_TIMEOUT';
  else if (['EACCES','EPERM','ENOSPC','EIO','EROFS'].includes(code)) category='EVIDENCE_IO_FAILED';
  return {code:category,stage,committed:true,original_code:code||null,message:String(error?.message||error),
    retryable:['EVIDENCE_TIMEOUT','EVIDENCE_IO_FAILED','EVIDENCE_TOOL_UNAVAILABLE'].includes(category),
    ...(structured?{diagnostic:structured}:{})};
}

module.exports={applyCommittedProgress,pendingExecution,classifyEvidenceFailure};
