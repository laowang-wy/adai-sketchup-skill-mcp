'use strict';
// Review declared inputs with installed validators. This is not live SU readback.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const run = promisify(execFile);
const text = value => typeof value === 'string' && value.trim().length > 0;
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const validators = {geometry:'validate_geometry_measurements.py', dependencies:'validate_parameter_dependencies.py'};
const MAX_INPUT = 4 * 1024 * 1024;
function visualStatus(state) {
  return state === 'pass' ? 'matched' : state === 'fail' ? 'mismatch' : 'not_checked';
}

async function runValidator(kind, snapshotBytes, skillRoot) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'su-review-'));
  try {
    const input = path.join(temp,'input.json'), report = path.join(temp,'report.json');
    // Preserve lexical numbers (1600.0), Unicode and integer precision for the Python fingerprint contract.
    await fs.writeFile(input, snapshotBytes);
    try {
      await run(process.env.PIPCLAW_PYTHON || 'python',
        [path.join(skillRoot,'scripts',validators[kind]),'--input',input,'--report',report],
        {timeout:30000, maxBuffer:1024*1024, windowsHide:true, env:{...process.env,PYTHONIOENCODING:'utf-8'}});
    } catch (error) {
      if (error.code !== 1 || error.killed || error.signal) throw new Error(`Quality validator unavailable/failed: ${kind}: ${error.message}`);
    }
    return JSON.parse(await fs.readFile(report,'utf8'));
  } finally { await fs.rm(temp,{recursive:true,force:true}); }
}

function verifySnapshot(buffer, file) {
  if(!file || buffer.length>MAX_INPUT || (file.bytes!==undefined && buffer.length!==Number(file.bytes)) || crypto.createHash('sha256').update(buffer).digest('hex')!==file.sha256)
    throw Object.assign(new Error('Sealed review input bytes changed'),{code:'EVIDENCE_FILE_CHANGED'});
}

async function assembleVisualReview(input,state,phase,evidence) {
  if(input.quality_review!==undefined && input.visual_review!==undefined) throw new Error('REVIEW_INPUT_CONFLICT: supply quality_review or visual_review, not both');
  const files=evidence.files || {},names=['geometry_measurements','geometry_dependencies','geometry_review_draft'];
  const missing=names.filter(name=>!files[name]?.path);
  const checks=[];
  for (const kind of ['geometry','dependencies']) {
    const name=kind==='geometry'?'geometry_measurements':'geometry_dependencies';
    const file=files[name];
    if (!file?.path) checks.push({kind,state:'unverified',reason:`Machine attachment ${name} was not generated for this evidence; no machine pass is claimed.`});
    else checks.push({kind,input_path:file.path});
  }
  // The draft is an optional machine artifact. If present, verify its binding;
  // its absence is recorded by the engine instead of delegated to the Agent.
  const draftFile=files.geometry_review_draft;
  if(draftFile?.path) {
    if((await fs.stat(draftFile.path)).size>MAX_INPUT)throw new Error('Review draft exceeds 4 MiB');
    const bytes=await fs.readFile(draftFile.path);verifySnapshot(bytes,draftFile);
    const draft=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));
    if(draft.project_id!==state.project_id || draft.phase!==phase || draft.evidence_id!==input.evidence_id)throw new Error('Stale or unbound sealed review draft');
  }
  return {...input,quality_review:{schema_version:1,project_id:state.project_id,phase,evidence_id:input.evidence_id,visual:{...input.visual_review,inspected_views:(input.visual_review?.inspected_views || []).map(value => files[value]?.path || value)},checks}};
}

function reviewAvailability(files={}) {
  const missing=['geometry_measurements','geometry_dependencies','geometry_review_draft'].filter(name=>!files[name]?.path);
  return {visual_review_available:true,shorthand_available:true,missing_inputs:missing,machine_checks:missing.length?'partial_inputs':'pending_validation',visual:'agent_review_required'};
}

async function validateQualityReview(input, state, phase, skillRoot, sealedFiles=null) {
  const q = input.quality_review;
  if (q === undefined) {
    if (state.mode === 'test' || input.verdict === 'revise')
      return {state:'unverified', scope:'no_quality_report', geometry_readback:'unverified', visual_status:'not_checked'};
    throw new Error('Production continue requires quality_review; see SKILL references/managed-quality-review.md. Existing state is unchanged.');
  }
  if (!object(q) || q.schema_version !== 1 || q.project_id !== state.project_id || q.phase !== phase || q.evidence_id !== input.evidence_id)
    throw new Error('quality_review must bind to the current project, phase and evidence_id');
  const visual = q.visual;
  if (!object(visual) || !['pass','fail','unverified'].includes(visual.state) || !text(visual.observations) ||
      !Array.isArray(visual.inspected_views) || visual.inspected_views.some(x => !text(x)) ||
      (visual.state === 'pass' && visual.inspected_views.length === 0))
    throw new Error('Visual review needs state, concrete observations and inspected_views; it is agent-declared, not machine-certified');
  if (!Array.isArray(q.checks) || q.checks.length !== 2)
    throw new Error('quality_review.checks must account for geometry and dependencies exactly once');
  const seen = new Set(), results = [];
  for (const supplied of q.checks) {
    let entry = supplied;
    if (!object(entry) || typeof entry.kind !== 'string' || !Object.hasOwn(validators,entry.kind) || seen.has(entry.kind)) throw new Error('Invalid or duplicate quality check kind');
    seen.add(entry.kind);
    if (sealedFiles) {
      const file = sealedFiles[entry.kind === 'geometry' ? 'geometry_measurements' : 'geometry_dependencies'];
      if (file?.path) {
        if (entry.input_path && path.resolve(entry.input_path) !== path.resolve(file.path)) throw Object.assign(new Error('Review input must be the current sealed attachment'), {code:'EVIDENCE_INPUT_UNSEALED'});
        // A legacy full report cannot bypass a delivered machine check by
        // describing it as absent. The program already owns this information.
        entry = {kind:entry.kind, input_path:file.path};
      } else {
        if (entry.input_path) throw Object.assign(new Error('Undelivered machine input cannot certify this evidence'), {code:'EVIDENCE_INPUT_UNSEALED'});
        entry = {kind:entry.kind, state:'unverified', reason:'No sealed machine attachment was generated for this check.'};
      }
    }
    if (!Object.hasOwn(entry,'input_path')) {
      if (!['unverified','not_applicable'].includes(entry.state) || !text(entry.reason))
        throw new Error('Missing check input must be explicitly unverified/not_applicable with a reason; a claimed pass is not accepted');
      results.push({kind:entry.kind,state:entry.state,reason:entry.reason,scope:'agent_declared_limitation'});
      continue;
    }
    if (!text(entry.input_path) || !path.isAbsolute(entry.input_path)) throw new Error('Check input_path must be an absolute JSON file path');
    // Read a bounded immutable snapshot; validator never rereads the original path.
    const handle = await fs.open(entry.input_path,'r');
    let buffer;
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > MAX_INPUT) throw new Error('Check input must be a regular JSON file of at most 4 MiB');
      const bytes = Buffer.alloc(MAX_INPUT+1);
      let total=0;
      while(total<bytes.length) {
        const {bytesRead}=await handle.read(bytes,total,bytes.length-total,total);
        if(!bytesRead) break;
        total+=bytesRead;
      }
      if(total>MAX_INPUT) throw new Error('Check input exceeds 4 MiB');
      buffer=bytes.subarray(0,total);
    } finally { await handle.close(); }
    if(sealedFiles) {
      const file=sealedFiles[entry.kind==='geometry'?'geometry_measurements':'geometry_dependencies'];
      if(!file || path.resolve(file.path)!==path.resolve(entry.input_path))throw new Error('Review input is not the sealed attachment');
      verifySnapshot(buffer,file);
    }
    const data = JSON.parse(buffer.toString('utf8').replace(/^\uFEFF/,''));
    if (!object(data) || data.project_id !== state.project_id || data.phase !== phase || data.evidence_id !== input.evidence_id)
      throw new Error(`Stale or unbound ${entry.kind} input; project_id, phase and evidence_id must match`);
    let report;
    try { report = await runValidator(entry.kind,buffer,skillRoot); }
    catch (error) {
      // Hash/binding errors above remain fatal. A missing local validator is
      // an unavailable machine check, not a reason to make the model retype it.
      results.push({kind:entry.kind,state:'unverified',reason:String(error.message || error),scope:'validator_unavailable',input_path:entry.input_path,input_sha256:crypto.createHash('sha256').update(buffer).digest('hex')});
      continue;
    }
    if (!object(report) || !['pass','fail','invalid','needs_review','unverified'].includes(report.state)) throw new Error('Unexpected validator report');
    results.push({kind:entry.kind,state:report.state,input_path:entry.input_path,
      input_sha256:crypto.createHash('sha256').update(buffer).digest('hex'),report});
  }
  if (input.verdict === 'continue' && (visual.state !== 'pass' || results.some(x => ['fail','invalid','needs_review'].includes(x.state)))) {
    // Name the failing checks so the agent can fix inputs without a local rerun.
    const describe = x => {
      let reason = '';
      const rr = x.report && Array.isArray(x.report.results) ? x.report.results : [];
      const bad = rr.find(e => e && ['fail','invalid','needs_review'].includes(e.state) && typeof e.reason === 'string');
      if (bad) reason = ` (${bad.reason.slice(0, 160)})`;
      return `${x.kind}=${x.state}${reason}`;
    };
    const summary = [`visual=${visual.state}`, ...results.map(describe)].join('; ');
    throw new Error(`Quality review blocks continue: ${summary}. Use revise or correct the inputs; state is unchanged.`);
  }
  return {schema_version:1,project_id:state.project_id,phase,evidence_id:input.evidence_id,
    state:visual.state === 'fail' || results.some(x => ['fail','invalid','needs_review'].includes(x.state)) ? 'needs_review' :
      results.every(x=>x.state==='pass') && visual.state==='pass' ? 'declared_checks_pass' : 'accepted_with_unverified_items',
    scope:'bound_declared_inputs_and_agent_visual_review',geometry_readback:'unverified', visual_status: visualStatus(visual.state),
    visual:{...visual,scope:'agent_declared'},checks:results};
}
module.exports={validateQualityReview,assembleVisualReview,reviewAvailability,visualStatus};
