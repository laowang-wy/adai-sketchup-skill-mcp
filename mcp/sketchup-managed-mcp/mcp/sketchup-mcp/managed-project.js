#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const { AsyncLocalStorage } = require('node:async_hooks');
const modelingMethodCards = require('./modeling-method-cards.json');
const { validateQualityReview, assembleVisualReview, reviewAvailability } = require('./quality-review.js');
const { resolveAssistanceMode, normalizeAssistanceMode, assistanceGuidance, SKILL_ATTRIBUTION } = require('./agent-profile.js');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execFileAsync = promisify(execFile);
const { resolveMethodBinding } = require('./toolkit-registry');
const { applyCommittedProgress, pendingExecution, classifyEvidenceFailure } = require('./operation-outcome');

// These are deliberately narrow production scales. A model may not jump from a
// reference image to a finished tower in one Ruby call: each scale is evidence
// reviewed before the next becomes available.
const MANAGED_CONTRACT = require('./contracts/managed-contract.json');
const PHASES = MANAGED_CONTRACT.mode_plans.single_image;

const ROOF_PROFILE_PHASE = {
  name: 'roof_profile',
  hint: 'Build and review one source-matched roof control prototype before broad components: shared ridge, body section, eave guide and corner-lift section; include one body bay and one corner condition. Do not copy all tiers yet.',
};
function normalizedProfile(value) {
  const profile = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const topics = Array.isArray(profile.topics) ? profile.topics.map((x)=>String(x).trim().toLowerCase()).filter(Boolean).slice(0,20) : [];
  const features = Array.isArray(profile.features) ? profile.features.map((x)=>String(x).trim().toLowerCase()).filter(Boolean).slice(0,20) : [];
  const roofRoute = ['auto','ancient_roof','custom'].includes(String(profile.roof_route || '').trim().toLowerCase()) ? String(profile.roof_route).trim().toLowerCase() : 'auto';
  const methodFamily = String(profile.method_family || '').trim().toLowerCase().slice(0,64);
  const omitPhases = Array.isArray(profile.omit_phases) ? [...new Set(profile.omit_phases.map((x)=>String(x).trim().toLowerCase()).filter(Boolean))] : [];
  const optionalPhases = new Set(['roof_profile','archetypes','replication','variants','facade_detail']);
  if (omitPhases.length > 8 || omitPhases.some((name)=>!optionalPhases.has(name))) throw new Error('omit_phases may contain only optional implemented phase names');
  const repetition = profile.repetition === 'none' ? 'none' : profile.repetition === 'present' ? 'present' : 'unspecified';
  const rationale=String(profile.repetition_reason||'').trim().slice(0,1000);
  if(repetition==='none' && rationale.length<20)throw new Error('Non-repeating route requires source-based repetition_reason (at least 20 characters).');
  return {topics:[...new Set(topics)],features:[...new Set(features)],roof_route:roofRoute,method_family:methodFamily,omit_phases:omitPhases,repetition,repetition_reason:rationale};
}
function ancientRoofRoute(profile) {
  if (profile?.roof_route === 'custom') return false;
  if (profile?.roof_route === 'ancient_roof') return true;
  if (profile?.method_family && !['ancient_roof','chinese_ancient_roof'].includes(profile.method_family)) return false;
  const words=[...(profile?.topics||[]),...(profile?.features||[])].join(' ');
  return /(古建|楼阁|塔|庙|殿|pagoda|temple|chinese[_ -]?ancient|multi[_ -]?tier[_ -]?roof|curved[_ -]?eave|upturned[_ -]?eave)/i.test(words);
}
function phasePlanFor(mode, profile) {
  const standard=PHASE_PLANS[mode] || PHASES;
  const base=profile?.repetition==='none' && ['single_image','freeform','cad'].includes(mode) ? standard.filter(p=>!['archetypes','replication'].includes(p.name)) : standard;
  // A declared repeated system always needs both its reusable prototype and
  // its real instances.  Method selection may omit unrelated optional phases,
  // but it cannot silently erase that task obligation.
  const omitted = new Set(profile?.omit_phases || []);
  if (profile?.repetition === 'present') {
    omitted.delete('archetypes');
    omitted.delete('replication');
  }
  // An omitted prototype cannot leave a replication phase with no legal source.
  if (omitted.has('archetypes')) omitted.add('replication');
  let selected = base.filter((phase)=>!omitted.has(phase.name));
  if (!ancientRoofRoute(profile) || !['single_image','freeform'].includes(mode)) return selected;
  if (omitted.has('roof_profile')) return selected;
  const index=selected.findIndex((x)=>x.name==='archetypes');
  const insert=index<0 ? 1 : index;
  return [...selected.slice(0,insert),ROOF_PROFILE_PHASE,...selected.slice(insert)];
}

const PHASE_PLANS = MANAGED_CONTRACT.mode_plans;

const RAW_WRITE_TOOLS = new Set([
  'sketchup_run_ruby', 'sketchup_run_ruby_file', 'sketchup_create_box',
  'sketchup_loft_sections', 'sketchup_sweep_profile_path', 'sketchup_surface_grid',
  'sketchup_shell_grid', 'sketchup_transform_entities', 'sketchup_create_beam_oriented',
  'sketchup_create_column_grid', 'sketchup_array_on_path', 'sketchup_create_curved_eave',
  'sketchup_create_tile_course', 'sketchup_create_bracket_unit', 'sketchup_create_roof_frame',
  'sketchup_create_ridge_system', 'sketchup_clear_model', 'sketchup_save_model',
  'sketchup_bridge_command',
]);

function safeId(value) {
  const text = String(value || '').trim();
  if (!/^[A-Za-z][A-Za-z0-9_-]{2,63}$/.test(text)) throw new Error('project_id must start with a letter and contain 3-64 letters, digits, underscores or hyphens');
  return text;
}

function patchChange(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Object.assign(new Error('PATCH_CHANGE_REQUIRED'), { code: 'PATCH_CHANGE_REQUIRED' });
  const keys = Object.keys(value).sort();
  if (keys.length !== 1 || keys[0] !== 'translation_mm' || !Array.isArray(value.translation_mm) || value.translation_mm.length !== 3 || value.translation_mm.some((n) => typeof n !== 'number' || !Number.isFinite(n))) {
    throw Object.assign(new Error('Only finite translation_mm=[x,y,z] is supported by the first object patch adapter'), { code: 'PATCH_UNSUPPORTED_CHANGE' });
  }
  return { translation_mm: value.translation_mm.map(Number) };
}

function patchScope(value) {
  const scope = String(value || '').trim();
  if (!['instance', 'definition'].includes(scope)) throw Object.assign(new Error('PATCH_SCOPE_REQUIRED'), { code: 'PATCH_SCOPE_REQUIRED' });
  if (scope === 'definition') throw Object.assign(new Error('Definition-wide patch is not enabled; select one instance explicitly'), { code: 'PATCH_UNSUPPORTED_SCOPE' });
  return scope;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

async function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  const handle = await fs.open(filePath, 'r');
  try {
    for await (const chunk of handle.createReadStream()) hash.update(chunk);
  } finally { await handle.close(); }
  return hash.digest('hex');
}

function auditContent(value) {
  const copy = JSON.parse(JSON.stringify(value));
  delete copy.created_at;
  delete copy.model; // Document identity is checked separately, including after checkpoint reopen.
  return canonical(copy);
}

function checkpointContent(value) {
  const copy=JSON.parse(JSON.stringify(value));
  // SketchUp may fit the view on reopen. Keep geometric bounds/signatures and
  // registrations exact; camera-dependent pixels require fresh visual review.
  delete copy.camera;
  for(const subject of copy.projection_subjects || []) delete subject.screen_bbox_normalized;
  return auditContent(copy);
}

function assertRecaptureScope(recorded, live, phase) {
  validateAuditReadback(recorded);
  validateAuditReadback(live);
  const before = recorded.recapture_protection?.[phase];
  const after = live.recapture_protection?.[phase];
  if (!before || !after || !before.boundary || !before.locked || canonical(before) !== canonical(after))
    throw Object.assign(new Error('Protected/locked scene changed or its historical boundary is unavailable; inspect or restore before recapture or deletion'), {code:'RECAPTURE_SCOPE_CONFLICT'});
}

async function fileEvidence(filePath) {
  const stat = await fs.stat(filePath);
  return { path: path.resolve(filePath), bytes: stat.size, sha256: await hashFile(filePath) };
}

function sameModelBinding(expected, actual) {
  if (!expected || !actual) return false;
  const normalize = (value) => path.resolve(String(value || '')).toLowerCase();
  if (expected.path || actual.path) {
    if (!expected.path || !actual.path || normalize(expected.path) !== normalize(actual.path)) return false;
  }
  if (expected.object_id !== undefined && expected.object_id !== null) {
    if (actual.object_id === undefined || actual.object_id === null || Number(expected.object_id) !== Number(actual.object_id)) return false;
  }
  return true;
}

function verifiedSaveCopyMigration(request, result, current, outputPath) {
  if (!result || result.ok !== true || result.strategy !== 'temporary_save_as_then_copy' || result.path_migrated !== true) return false;
  const before = result.model_binding_before;
  const after = result.model_binding_after;
  if (!before || !after || !sameModelBinding(request?.model_binding, before)) return false;
  if (String(before.path || '') !== '' || String(after.path || '') === '') return false;
  if (before.object_id === undefined || after.object_id === undefined || Number(before.object_id) !== Number(after.object_id)) return false;
  if (!sameModelBinding(after, current)) return false;
  if (!result.active_model_path || path.resolve(String(result.active_model_path)) !== path.resolve(String(after.path))) return false;
  const savedPath = result.saved_file?.path || result.path;
  return !!savedPath && path.resolve(String(savedPath)) === path.resolve(String(outputPath || ''));
}

function collectEvidenceFiles(value, found = []) {
  if (!value || typeof value !== 'object') return found;
  if (!Array.isArray(value) && typeof value.path === 'string' && /^[a-f0-9]{64}$/i.test(String(value.sha256 || ''))) found.push(value);
  for (const child of Array.isArray(value) ? value : Object.values(value)) collectEvidenceFiles(child, found);
  return found;
}

async function verifyEvidenceFiles(record) {
  for (const file of collectEvidenceFiles(record)) {
    const resolved = path.resolve(file.path);
    let stat;
    try { stat = await fs.lstat(resolved); } catch (error) {
      if (error.code === 'ENOENT') throw Object.assign(new Error(`Evidence attachment is missing: ${resolved}`), { code: 'EVIDENCE_FILE_MISSING' });
      throw error;
    }
    if (stat.isSymbolicLink() || !stat.isFile()) throw Object.assign(new Error(`Evidence attachment path is not a regular file: ${resolved}`), { code: 'EVIDENCE_FILE_UNTRUSTED' });
    if ((file.bytes !== undefined && Number(file.bytes) !== stat.size) || String(file.sha256).toLowerCase() !== await hashFile(resolved)) {
      throw Object.assign(new Error(`Evidence attachment changed after sealing: ${resolved}`), { code: 'EVIDENCE_FILE_CHANGED' });
    }
  }
}

function validateProjectionBrief(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('single_image mode requires projection_brief');
  const targets = value.targets;
  if (!Array.isArray(targets) || targets.length < 1 || targets.length > 8) throw new Error('projection_brief.targets must contain 1-8 key projected subjects');
  const seen = new Set();
  for (const target of targets) {
    const id = String(target?.id || '').trim();
    const role = String(target?.role || '').trim();
    const box = target?.bbox;
    if (!/^[A-Za-z][A-Za-z0-9_-]{1,47}$/.test(id) || seen.has(id)) throw new Error('Every projection target requires a unique stable id');
    if (!role || !Array.isArray(box) || box.length !== 4 || box.some((n) => typeof n !== 'number' || !Number.isFinite(n))) throw new Error(`Projection target ${id} needs role and bbox [x0,y0,x1,y1]`);
    const b = box.map(Number);
    if (b.some((n) => n < 0 || n > 1) || b[2] <= b[0] || b[3] <= b[1]) throw new Error(`Projection target ${id} bbox must be ordered normalized coordinates in 0..1`);
    if (target.tolerance !== undefined && (typeof target.tolerance !== 'number' || !Number.isFinite(target.tolerance) || target.tolerance <= 0)) throw new Error(`Projection target ${id} tolerance must be a finite positive number`);
    seen.add(id);
  }
  if (!targets.some((item) => ['focal_building', 'primary_building', 'main_subject'].includes(String(item.role)))) throw new Error('projection_brief must contain a focal_building, primary_building or main_subject');
  return { schema_version: 1, perspective_required: value.perspective_required !== false, targets: targets.map((item) => ({ id: String(item.id), role: String(item.role), bbox: item.bbox.map(Number), tolerance: Math.min(0.2, Math.max(0.05, Number(item.tolerance ?? 0.1))), cue: String(item.cue || '') })) };
}

function validateProjectionAudit(state, audit) {
  if (state.mode !== 'single_image') return [];
  if (state.projection_brief?.perspective_required && audit?.camera?.perspective === false) throw new Error('Projection contract failed: perspective camera required for single-image reconstruction');
  const actual = new Map((audit?.projection_subjects || []).map((item) => [String(item.id), item]));
  const failures = [];
  const ordered = [];
  for (const expected of state.projection_brief.targets) {
    const subject = actual.get(expected.id);
    if (!subject || !Array.isArray(subject.screen_bbox_normalized)) { failures.push(`${expected.id}: missing registered subject`); continue; }
    const e = expected.bbox, a = subject.screen_bbox_normalized.map(Number);
    if (subject.screen_bbox_normalized.length !== 4 || subject.screen_bbox_normalized.some((n) => typeof n !== 'number' || !Number.isFinite(n)) || a[2] <= a[0] || a[3] <= a[1]) { failures.push(`${expected.id}: invalid projected bounds`); continue; }
    ordered.push({ id: expected.id, role: expected.role, e, a });
    const ew = e[2] - e[0], eh = e[3] - e[1], aw = a[2] - a[0], ah = a[3] - a[1];
    const deltaX = Math.abs((a[0] + a[2] - e[0] - e[2]) / 2), deltaY = Math.abs((a[1] + a[3] - e[1] - e[3]) / 2);
    if (deltaX > expected.tolerance || deltaY > expected.tolerance) failures.push(`${expected.id}: wrong projected position`);
    if (aw < ew * 0.58 || aw > ew * 1.75 || ah < eh * 0.62 || ah > eh * 1.55) failures.push(`${expected.id}: wrong projected scale`);
  }
  // Reject only an unmistakable near/far inversion. A cropped side frame can be
  // narrow and the focal building is not necessarily farther away, so role names
  // alone must not impose a strict width/height ordering. Compare near frames only
  // with explicitly distant background bodies and fail when the near object is
  // both markedly smaller or sits markedly higher in screen space.
  const near = ordered.filter((item) => ['near_frame', 'frame_left', 'frame_right', 'near'].includes(item.role));
  const far = ordered.filter((item) => ['far_background', 'far'].includes(item.role));
  for (const n of near) {
    for (const f of far) {
      const nW = n.a[2] - n.a[0], nH = n.a[3] - n.a[1];
      const fW = f.a[2] - f.a[0], fH = f.a[3] - f.a[1];
      if (nW < fW * 0.7 && nH < fH * 0.7) failures.push(`${n.id}: near frame is markedly smaller than explicit far background ${f.id}`);
      if (n.a[3] < f.a[3] - 0.1) failures.push(`${n.id}: near frame sits markedly higher than explicit far background ${f.id}`);
    }
  }
  if (failures.length) throw new Error(`Projection contract failed; rebuild massing/camera before later phases: ${[...new Set(failures)].join('; ')}`);
  return [...actual.values()];
}


function validateAntiSlabTowerAudit(state, audit) {
  if (state.mode !== 'single_image') return null;
  const camera = audit?.camera || {};
  if (state.projection_brief?.perspective_required && camera.perspective === false) {
    throw new Error('Massing audit rejected: single-image reconstruction must keep a perspective camera, not a flat orthographic view');
  }
  const summary = audit?.massing_summary || {};
  const bodies = Array.isArray(summary.bodies) ? summary.bodies : [];
  const root = audit?.root_form_summary || {};
  const failures = [];
  if (Number(summary.main_body_count || 0) <= 0) failures.push('no dominant massing bodies were detected');
  // A single observed building may legitimately occupy its entire footprint.
  // Generic multi-mass heuristics must not force invented context into such a photo.
  const singleSubject = state.projection_brief?.targets?.length === 1;
  if (singleSubject) {
    if (failures.length) throw new Error('Massing audit rejected: ' + failures.join('; '));
    return { main_body_count: Number(summary.main_body_count), dominant_body_footprint_ratio: Number(summary.dominant_body_footprint_ratio || 0), geometry_heuristics: 'single_subject_visual_review_required' };
  }
  if (Number(summary.main_body_count || 0) === 1 && Number(root.height_to_width || 0) >= 3.0) failures.push('single isolated skinny tower massing is inconsistent with perspective photo reconstruction');
  if (Number(summary.main_body_count || 0) === 1 && Number(root.plan_aspect || 0) >= 3.5 && Number(root.height_to_thickness || 0) <= 2.0) failures.push('single slab-like monolith massing detected');
  if (Number(summary.dominant_body_footprint_ratio || 0) > 0.78) failures.push('one body occupies too much of the whole footprint; likely a collapsed one-shot mass');
  const thinTallBodies = bodies.filter((body) => Number(body.height_to_width || 0) >= 4.2 && Number(body.footprint_share || 0) >= 0.08);
  if (thinTallBodies.length >= 1 && Number(summary.main_body_count || 0) <= 2) failures.push('detected a dominant thin-tall body pattern; rebuild from framing masses and shared courtyard/wing relationships');
  if (failures.length) throw new Error('Massing audit rejected: ' + [...new Set(failures)].join('; '));
  return { main_body_count: Number(summary.main_body_count || 0), dominant_body_footprint_ratio: Number(summary.dominant_body_footprint_ratio || 0) };
}

function validateStructureAudit(state, phase, audit) {
  const structure = audit?.structure || {};
  if (phase.name === 'archetypes' && ['single_image', 'cad', 'refinement'].includes(state.mode)) {
    const valid = (structure.archetypes || []).filter((item) => item?.valid && Number(item?.counts?.entities || 0) >= 3);
    if (!valid.length) throw new Error('Archetype contract failed: no registered reusable prototype with real geometry was found. Build one correct component before copying it.');
    return { archetypes: valid.map((item) => item.id) };
  }
  if (phase.name === 'replication' && ['single_image', 'cad', 'refinement'].includes(state.mode)) {
    const known = new Set((structure.archetypes || []).filter((item) => item?.valid).map((item) => String(item.id)));
    const systems = Array.isArray(structure.replication_systems) ? structure.replication_systems : [];
    const invalid = systems.filter((item) => item?.valid === false || (item?.invalid_instance_pids || []).length || (item?.duplicate_instance_pids || []).length || (item?.definition_mismatch_pids || []).length || (item?.placement_mismatch_pids || []).length || item?.placement_contract_missing);
    if (invalid.length) throw new Error('Replication contract failed: every required replication system must be valid; invalid systems=' + JSON.stringify(invalid.map((item) => ({ id: item.id, invalid_instance_pids: item.invalid_instance_pids || [], duplicate_instance_pids: item.duplicate_instance_pids || [], definition_mismatch_pids: item.definition_mismatch_pids || [] }))).slice(0, 2000));
    const valid = systems.filter((item) => {
      const detailed = item?.valid !== undefined || item?.expected_instances !== undefined || item?.invalid_instance_pids !== undefined || item?.duplicate_instance_pids !== undefined || item?.definition_mismatch_pids !== undefined;
      const accepted = detailed ? item?.valid === true : item?.valid !== false;
      return accepted && Number(item?.actual_instances || 0) >= 2 && Number(item?.expected_instances || item?.actual_instances || 0) === Number(item.actual_instances || 0) && !(item?.duplicate_instance_pids || []).length && !(item?.invalid_instance_pids || []).length && !(item?.definition_mismatch_pids || []).length && !(item?.placement_mismatch_pids || []).length && !item?.placement_contract_missing && known.has(String(item.archetype_id));
    });
    if (!valid.length) throw new Error('Replication contract failed: no accepted archetype was instantiated at least twice. Audit=' + JSON.stringify({ archetypes: structure.archetypes || [], replication_systems: structure.replication_systems || [], phase: (audit.phases || []).find((item) => item.phase === 'replication') || null }).slice(0, 2000));
    return { replication_systems: valid.map((item) => ({ id: item.id, archetype_id: item.archetype_id, instances: item.actual_instances })) };
  }
  return null;
}

function phaseTaskCard(phase, mode, taskProfile = {}) {
  const method = mode === 'test'
    ? { version: modelingMethodCards.version, scope: 'diagnostic_only', evidence_checks: ['Validate the requested diagnostic contract; do not invent source-image observations or claim photographic acceptance.'] }
    : { version: modelingMethodCards.version, scope: modelingMethodCards.scope, review_record_fields: [...modelingMethodCards.review_record_fields], ...JSON.parse(JSON.stringify(modelingMethodCards.phases[phase.name] || {})) };
  const shared = { quality_review_contract: { version: 1, production_continue_required: mode !== 'test', reference: 'references/managed-quality-review.md', checks: ['geometry','dependencies'], unverified_requires_reason: true, live_readback: 'unverified' }, phase: phase.name, objective: phase.hint, method, agent_review: 'Inspect actual returned evidence; record object/view, source constraint, observation and unresolved defects. Continue only when this scale meets the source. A checklist is not approval evidence.' };
  if (phase.name === 'source_alignment') return { ...shared, required: ['Preserve source units, coordinates, counts, rotation and host relationships; build only source-aligned primary geometry.'], forbidden: ['Invented source dimensions', 'Facade detail before source alignment'] };
  if (phase.name === 'correction_scope') return { ...shared, required: ['Identify the user-authorized defect, affected entities and target constraints; preserve unrelated geometry.'], forbidden: ['Unrelated rebuilding', 'Invented defect evidence'] };
  if (phase.name === 'primary_corrections') return { ...shared, required: ['Correct the identified host contacts, dimensions or primary form; verify affected dependencies.'], forbidden: ['Decoration that hides the defect', 'Unrelated changes'] };
  if (phase.name === 'component_cleanup') return { ...shared, required: ['Repair authorized component hierarchy, definitions, variants and terminations; verify sibling instances.'], forbidden: ['Unintended shared-definition propagation', 'Deleting unrelated objects'] };
  if (phase.name === 'massing') {
    const required = mode === 'single_image' ? ['Set perspective camera.', 'Build visible primary solids and voids, including source-visible open corridors/recesses.', 'Register every projection-brief subject with register_projection_subject.'] : ['Build primary solids, voids and source topology.'];
    if (ancientRoofRoute(taskProfile)) required.push('Even at massing resolution, drive each visible roof silhouette from ridge_profile + eave_curve + corner_lift_section and return roof_control_contract.');
    const forbidden = ['Premature detail arrays without source justification (necessary multi-roof/faceted primary form is allowed)', 'Facade grids', 'Context used to hide a wrong form'];
    if (ancientRoofRoute(taskProfile)) forbidden.push('Flat slab or single-frustum roof', 'Corner lift implemented only by raising plan-ring points', 'Solid tower body that fills source-visible galleries/corridors');
    return {...shared,required,forbidden};
  }
  if (phase.name === 'roof_profile') return { ...shared, required: ['Return roof_control_contract with ridge_profile, eave_curve and corner_lift_section; each control has at least three points.', 'Build one body-section roof bay and one corner condition using loft/sweep/shared-boundary mesh.', 'Keep the roof shell connected and visually inspect profile, underside and corner transition before replication.'], forbidden: ['Flat slab plus frustum', 'Only raising four plan-ring corners', 'Copying the unreviewed roof to every tier', 'Using dark material to hide missing curvature or open seams'] };
  if (phase.name === 'archetypes') return { ...shared, required: ['Build one visually complete real ComponentInstance for each repeated family.', 'Include repeatable windows, balconies, railings, frames, recesses and shadow detail inside the archetype.', 'Register the component with register_archetype and at least one source-visible reusable system, with additional systems when the source/task contract requires them with register_visible_detail.'], forbidden: ['Broad arrays', 'Copying an unreviewed prototype through the building', 'Deferring repeatable component detail to facade_detail'] };
  if (phase.name === 'replication') return { ...shared, required: ['Use instantiate_archetype with a previously registered archetype.', 'Create at least two true ComponentInstances for a repeated system.'], forbidden: ['Redrawing repeated floors independently', 'Changing roof/podium/unique levels here'] };
  if (phase.name === 'variants') return { ...shared, required: ['Build source-visible non-repeating conditions only.', 'Register each important unique entity with register_variant.'], forbidden: ['Generic facade dressing'] };
  if (phase.name === 'facade_detail') return { ...shared, required: ['Build source-visible one-off details that cannot belong to a reusable archetype.', 'Bind each actual detail entity with register_unique_detail.', 'Inspect automatic close-ups.', 'Compare the source skin grammar: opaque/open ratio, band rhythm, recess/projection depth, corner/termination conditions and base/crown transitions; accepted massing does not prove facade fidelity.'], forbidden: ['Rebuilding repeated window/balcony systems', 'Generic grid or uniform curtain wall used as a substitute for source evidence', 'Treating geometry, entity count or material color as proof that the source facade is correct'] };
  return { ...shared, required: ['Add restrained material/ground/roof closure only after form and visible detail already read correctly.'], forbidden: ['Changing accepted primary massing'] };
}

function stripRubyComments(source) {
  return String(source).split(/\r?\n/).map((line) => {
    let quote = null, escaped = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (quote) {
        if (escaped) { escaped = false; continue; }
        if (ch === '\\') { escaped = true; continue; }
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === "'" || ch === '"') { quote = ch; continue; }
      if (ch === '#') return line.slice(0, i);
    }
    return line;
  }).join('\n');
}
function normalizedWorkUnit(value, mode) {
  if (value === undefined || value === null || value === '') return null;
  if (mode !== 'autonomous') throw new Error('WORK_UNIT_AUTONOMOUS_ONLY');
  const id = String(value).trim();
  if (!/^[A-Za-z][A-Za-z0-9_-]{2,63}$/.test(id)) throw new Error('work_unit_id must start with a letter and contain 3-64 letters, digits, underscores or hyphens');
  return { id, strategy: 'autonomous_work_unit' };
}
function validateBuildScript(source, phaseName = '', mode = '', taskProfile = {}) {
  // Ruby comments are guidance, not executed method calls.  Use a small
  // line-level lexical boundary for phase gates; lifecycle checks remain
  // conservative and the real managed execution/readback contracts still
  // decide whether geometry was actually registered.
  const executableSource = stripRubyComments(source);
  const forbidden = [
    [/Sketchup\s*\.\s*open_file/i, 'opening another model'],
    [/Sketchup\s*\.\s*quit/i, 'quitting SketchUp'],
    [/\.\s*save_copy\s*\(/i, 'saving from a build step'],
    [/\.\s*save\s*(?:\(|$)/im, 'saving from a build step'],
    [/\.\s*close(?:_active)?\s*\(/i, 'closing the model'],
    [/\.\s*start_operation\s*\(/i, 'starting a nested transaction'],
    [/\.\s*commit_operation\b/i, 'committing the MCP-owned transaction'],
    [/\.\s*abort_operation\b/i, 'aborting the MCP-owned transaction'],
    [/Sketchup\s*\.\s*send_action/i, 'sending UI actions'],
  ];
  const violations = forbidden.filter(([pattern]) => pattern.test(executableSource)).map(([, label]) => label);
  if (violations.length) throw new Error(`Managed build file contains forbidden lifecycle operation(s): ${[...new Set(violations)].join(', ')}`);
  if (!/module\s+PipClawManagedBuild\b/.test(executableSource) || !/def\s+(?:self\.)?build\b/.test(executableSource)) {
    throw new Error('Managed build file must define module PipClawManagedBuild with build(entities, context)');
  }
  // The generated adapter records its phase in a metadata comment.  Keep that
  // declaration visible to the gate while still ignoring commented-out calls.
  const compiledPhase = String(source).match(/ADAI_COMPILED_PHASE\s*:\s*([a-z_]+)/i)?.[1]?.toLowerCase() || '';
  if (compiledPhase && compiledPhase !== String(phaseName).toLowerCase()) throw new Error(`Compiled geometry phase ${compiledPhase} does not match managed phase ${phaseName}`);
  if (phaseName === 'massing' && /register_visible_detail/i.test(executableSource)) {
    const formalAdapterRoute = compiledPhase === 'massing' && /ADAIGeometryAdapter\.build/i.test(executableSource) && /(?:if|elsif)\s+context\[['"]phase['"]\]\s*==\s*['"]archetypes['"]/i.test(executableSource);
    const detailCallCount = (executableSource.match(/register_visible_detail/gi) || []).length;
    if (!formalAdapterRoute || detailCallCount !== 1) throw new Error('Massing may not register facade detail systems; build only the major form first');
  }
  if (phaseName === 'massing' && mode === 'single_image' && !/register_projection_subject/i.test(executableSource)) {
    throw new Error('Single-image massing must register each source projection subject through PipClawManagedProject.register_projection_subject');
  }
  if (ancientRoofRoute(taskProfile) && ['massing','roof_profile'].includes(phaseName) && /upturn/i.test(executableSource) && !/(ridge_profile|eave_curve|corner_lift_section)/i.test(executableSource)) {
    throw new Error('Ancient-roof script appears to use plan-ring upturn without ridge/profile/eave controls. Rebuild the abstraction before adding detail.');
  }
  if (phaseName === 'archetypes' && ['single_image', 'cad', 'refinement'].includes(mode) && !/register_archetype/i.test(executableSource)) {
    throw new Error('Archetype step must register a real reusable prototype through PipClawManagedProject.register_archetype');
  }
  if (phaseName === 'archetypes' && ['single_image', 'cad', 'refinement'].includes(mode) && !/register_visible_detail/i.test(executableSource)) {
    throw new Error('Archetype step must include and register its source-visible reusable detail systems; do not defer repeatable detail to facade_detail');
  }
  if (phaseName === 'replication' && ['single_image', 'cad', 'refinement'].includes(mode) && !/instantiate_archetype/i.test(executableSource)) {
    throw new Error('Replication step must create true instances of an accepted prototype through PipClawManagedProject.instantiate_archetype');
  }
  if (phaseName === 'primary_corrections' && mode === 'refinement' && !/register_primary_correction/i.test(executableSource)) {
    throw new Error('Primary-corrections step must bind each declared correction to an accepted target through PipClawManagedProject.register_primary_correction');
  }
  if (phaseName === 'facade_detail' && ['single_image', 'cad', 'refinement'].includes(mode) && !/register_unique_detail/i.test(executableSource)) {
    throw new Error('Facade-detail step must bind actual one-off detail geometry through PipClawManagedProject.register_unique_detail');
  }
}

function declaredDetailSystems(buildResult) {
  const systems = buildResult?.build_result?.visible_detail_systems;
  return Array.isArray(systems) ? systems : [];
}

function declaredUniqueDetails(buildResult) {
  const details = buildResult?.build_result?.unique_details;
  return Array.isArray(details) ? details : [];
}

// Advisory only: counts do not distinguish a curved shell from a facade array.
function complexityWarning(result) {
  const m = result?.complexity_metrics;
  if (!m || m.source !== 'su_entity_readback') return {code:'complexity_unverified', reason:'Repetition metrics unavailable; inspect geometry. Do not reduce curved/faceted massing to satisfy raw counts.'};
  if (!Array.isArray(m.families) || m.families.some(f => !['instances','entity_share','max_bbox_volume_ratio'].every(k=>Number.isFinite(f[k]) && f[k]>=0))) return {code:'complexity_unverified',reason:'Invalid repetition metrics; inspect actual geometry.'};
  const repeated = m.families.filter(f => f.instances >= 9 && f.entity_share >= 0.35 && f.max_bbox_volume_ratio <= 0.1);
  return repeated.length ? {code:'complexity_warning', advisory:true, families:repeated, metrics:m, thresholds:{min_instances:9,min_entity_share:0.35,max_bbox_volume_ratio:0.1},
    decision:'Inspect whether repetition is necessary primary form or premature detail; continue with rationale or explicitly revise. Geometry preserved.'} : null;
}
function abstractionRecheckNeeded(state, phaseName) {
  const attempts=Number(state?.revision_attempts?.[phaseName] || 0);
  const acknowledged=Number(state?.abstraction_rechecks?.[phaseName]?.attempt || 0);
  return attempts >= 3 && Math.floor(attempts / 3) > Math.floor(acknowledged / 3);
}
function taskCard(state, phase, detail=false) {
  const warning=abstractionRecheckNeeded(state,phase.name) ? {code:'abstraction_recheck_required',revision_attempts:Number(state.revision_attempts?.[phase.name]||0),required_action:'Re-read source evidence and change or defend the geometric abstraction. The next step must provide abstraction_note; adding detail to the same failed abstraction is forbidden.'} : null;
  const card=phaseTaskCard(phase,state.mode,state.task_profile);
  if(!detail) {
    delete card.method.review_record_fields;
    card.method.full_guidance='references/managed-ruby-api.md';
    card.method.detail_tool='sketchup_project_status(detail=true)';
    if(assistanceSummary(state).mode==='autonomous') {
      card.method.guidance='Use the current phase constraints; consult full guidance for unfamiliar operations.';
      delete card.method.decisions;
    }
  }
  return {...card, work_unit: state.work_unit || null, shared_foundation: 'references/shared-architectural-foundation.md', complexity_warning:state.complexity_warning || null, abstraction_warning:warning};
}
function assistanceSummary(state, detail=false) {
  const mode = state?.assistance_selection ? normalizeAssistanceMode(state.assistance_mode) || 'guided' : 'guided';
  const text=String(state?.task_text||'');
  const profile=state?.task_profile||{};const brief=state?.projection_brief||{};
  const summary={ ...assistanceGuidance(mode), work_unit: state?.work_unit || null, source: state?.assistance_selection?.source || 'default_guided', task_text_ref: {sha256:crypto.createHash('sha256').update(text).digest('hex'),length:text.length,version:Number(state?.task_text_version||1),read:'sketchup_project_status(detail=true)'}, active_constraints:{mode:state?.mode||null,topics:Array.isArray(profile.topics)?profile.topics.slice(0,20):[],features:Array.isArray(profile.features)?profile.features.slice(0,20):[],roof_route:profile.roof_route||'auto',repetition:profile.repetition||null,source_sha256:state?.source?.sha256||null,projection_targets:Array.isArray(brief.targets)?brief.targets.map(x=>x.id).filter(Boolean):[]}, provider_attribution: SKILL_ATTRIBUTION, brand_delivery: 'tool_text_only' };
  if(detail) summary.task_text=text;
  return summary;
}

function pendingOperation(state) {
  const journal=Array.isArray(state?.operation_journal)?state.operation_journal:[];
  const last=journal.length?journal[journal.length-1]:null;
  const pending=[...journal].reverse().find(item=>item&&['dispatched','write_in_progress','result_unknown','recovery_required'].includes(item.status));
  return {pending_operation:pending?{operation_id:pending.operation_id,kind:pending.kind||null,status:pending.status,phase:pending.phase||state?.phase||null}:null,last_operation_id:last?.operation_id||null};
}

function nextCallForState(state) {
  const id=state?.project_id, status=state?.status;
  const op=pendingOperation(state).pending_operation;
  if(op && ['result_unknown','recovery_required','dispatched','write_in_progress'].includes(op.status)) return {tool:'sketchup_project_operation_receipt',arguments:{project_id:id,operation_id:op.operation_id},required_fields:[]};
  if(state?.recovery_recapture_required) return {tool:'sketchup_project_retry_evidence',arguments:{project_id:id},required_fields:[]};
  if(status==='evidence_pending') {
    const error=String(state?.evidence_error||'');
    if (/consumer|producer|materializ|GEOMETRY_DERIVED_INPUT_INVALID/i.test(error) && state?.pending_evidence) {
      return {tool:'sketchup_project_recover',arguments:{project_id:id,action:'abort_pending',reason:'撤回当前未审阶段并保留原始取证记录，修正派生证据输入后重新提交'},required_fields:['reason'],alternatives:[{tool:'sketchup_project_retry_evidence',arguments:{project_id:id}}]};
    }
    return {tool:'sketchup_project_retry_evidence',arguments:{project_id:id},required_fields:[]};
  }
  if(status==='review_required'&&state.last_evidence_id) return {tool:'sketchup_project_review',arguments:{project_id:id,evidence_id:state.last_evidence_id},required_fields:['verdict','visual_review_or_quality_review']};
  if(status==='ready_to_finish') return {tool:'sketchup_project_finish',arguments:{project_id:id},required_fields:[]};
  if(status==='finished') return null;
  if(status==='ready_for_step') return {tool:'sketchup_project_step',arguments:{project_id:id},required_fields:['ruby_file']};
  return null;
}

function qualityReviewSummary(state) {
  const plan=(state?.phase_plan||PHASE_PLANS[state?.mode]||PHASES).map(p=>p.name);
  const history=Array.isArray(state?.quality_reviews)?state.quality_reviews:[];
  const latest=new Map(history.map(item=>[item.phase,item]));
  const phases=plan.map(phase=>{const item=latest.get(phase);return {phase,state:item?.state||'unreviewed',evidence_id:item?.evidence_id||null,checks:(item?.checks||[]).map(c=>({kind:c.kind,state:c.state}))};});
  const unverified=[];for(const row of phases)for(const check of row.checks)if(['unverified','not_applicable','unsupported'].includes(check.state))unverified.push({phase:row.phase,kind:check.kind,state:check.state});
  const unresolved=[];for(const key of ['validation_failed','structure_error','recovery_recapture_required'])if(state?.[key])unresolved.push({kind:key,value:key==='recovery_recapture_required'?true:state[key]});
  return {reviewed_phases:phases.filter(p=>p.state!=='unreviewed').length,total_phases:plan.length,phases,unverified,unresolved};
}

function validateRoofControlContract(state, phase, buildResult) {
  if (!ancientRoofRoute(state.task_profile) || !['massing','roof_profile'].includes(phase.name)) return null;
  const c=buildResult?.build_result?.roof_control_contract;
  if(!c || typeof c!=='object') throw new Error('Ancient-roof route requires build_result.roof_control_contract; flat slab/frustum approximations cannot advance.');
  const pointList=(value)=>Array.isArray(value)&&value.length>=3&&value.every(p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite));
  for(const key of ['ridge_profile','eave_curve','corner_lift_section']) if(!pointList(c[key])) throw new Error(`roof_control_contract.${key} must contain at least three finite 3D points.`);
  if(!['loft','sweep','shared_boundary_mesh'].includes(String(c.construction||''))) throw new Error('roof_control_contract.construction must be loft, sweep or shared_boundary_mesh.');
  if(c.plan_ring_corner_lift_only===true) throw new Error('Corner lift may not be implemented only by raising plan-ring points.');
  if(phase.name==='massing' && c.open_corridor_preserved!==true) throw new Error('Ancient massing must preserve source-visible corridor/gallery voids; set open_corridor_preserved only after actual geometry does so.');
  if(phase.name==='roof_profile') {
    const kinds=Array.isArray(c.prototype_kinds)?c.prototype_kinds.map(String):[];
    if(!kinds.includes('body')||!kinds.includes('corner')) throw new Error('roof_profile requires both body and corner prototypes before tier replication.');
  }
  return c;
}

function validatePhaseOutput(state, phase, buildResult) {
  validateRoofControlContract(state,phase,buildResult);
  const counts = buildResult?.counts || {};
  const entities = Number(counts.entities || 0);
  const edges = Number(counts.edges || 0);
  if (phase.name === 'massing') return complexityWarning(buildResult);
  if (phase.name === 'roof_profile') { if (entities < 30 || edges < 40) throw new Error('roof_profile contains too little actual geometry for body and corner prototypes.'); return; }
  if (!['single_image', 'cad', 'refinement'].includes(state.mode)) return;
  if (phase.name === 'archetypes') {
    if (entities < 20 || edges < 30) throw new Error('Archetype contains too little actual geometry to represent a complete reusable source-matched component.');
  }
  if (phase.name === 'facade_detail') {
    if (entities < 6 || edges < 8) throw new Error('Facade-detail step contains too little actual geometry for a visible one-off architectural detail.');
  }
}

function validateDetailAudit(state, audit) {
  if (!['single_image', 'cad', 'refinement'].includes(state.mode)) return [];
  const systems = Array.isArray(audit?.visible_detail_systems) ? audit.visible_detail_systems : [];
  const valid = systems.filter((item) => item && typeof item.id === 'string' && item.id.trim());
  // The required detail set comes from the task/source contract. A single
  // repeated system is valid when that is all the source requires; missing
  // source-required systems are rejected by the task-specific audit.
  if (valid.length < 1) throw new Error('Managed audit found no registered visible detail system required by this task.');
  return valid;
}

function validateUniqueDetailAudit(state, audit) {
  if (!['single_image', 'cad', 'refinement'].includes(state.mode)) return [];
  const details = Array.isArray(audit?.unique_details) ? audit.unique_details.filter((item) => item?.valid && Number(item?.counts?.entities || 0) >= 3) : [];
  if (details.length < 1) throw new Error('Managed audit found no valid source-visible one-off detail geometry.');
  return details;
}

function validateInspectedViews(qualityReview, evidenceRecord) {
  const views = qualityReview?.visual?.inspected_views;
  if (!Array.isArray(views) || views.length === 0) throw new Error('EVIDENCE_VIEW_REQUIRED: inspected_views must name delivered evidence files');
  const delivered = new Set(Object.entries(evidenceRecord?.files || {}).filter(([key, file]) => {
    if (!file?.path) return false;
    const name = String(file.path);
    if (/\.(?:json|rb|skp|skb|txt|py|js|cjs|mjs)$/i.test(name)) return false;
    return /\.(?:png|jpe?g|webp|gif|bmp|tiff?)$/i.test(name) || /^(?:view|reference|preview|image|shot)/i.test(key) || !path.extname(name);
  }).map(([, file]) => path.resolve(file.path).toLowerCase()));
  for (const view of views) {
    const resolved = path.resolve(String(view || '')).toLowerCase();
    if (!delivered.has(resolved)) throw new Error(`EVIDENCE_VIEW_NOT_DELIVERED: inspected view is not one of the sealed evidence files: ${view}`);
  }
}

function validateAuditReadback(value) {
  if (!value || typeof value !== 'object') return;
  if (value.incomplete === true || value.geometry_summary?.complete === false) throw Object.assign(new Error('AUDIT_INCOMPLETE: geometry readback is incomplete; it cannot prove an unchanged or valid model'), { code: 'AUDIT_INCOMPLETE' });
  for (const child of Object.values(value)) validateAuditReadback(child);
}

function validateFinalAudit(state, audit, plannedNames = []) {
  validateAuditReadback(audit);
  const names = new Set(plannedNames.map(String));
  const result = {};
  if (names.has('massing')) {
    result.projection_subjects = validateProjectionAudit(state, audit);
    result.massing_summary = validateAntiSlabTowerAudit(state, audit);
  }
  if (names.has('archetypes')) result.visible_detail_systems = validateDetailAudit(state, audit);
  if (names.has('archetypes')) {
    const archetypes = Array.isArray(audit?.structure?.archetypes) ? audit.structure.archetypes.filter((item) => item?.valid && Number(item?.counts?.entities || 0) >= 3) : [];
    if (!archetypes.length) throw new Error('Archetype contract failed at final audit: no surviving reusable prototype with audited geometry was found.');
    result.archetypes = archetypes.map((item) => item.id);
  }
  if (names.has('replication')) result.structure = validateStructureAudit(state, { name: 'replication' }, audit);
  if (names.has('facade_detail')) result.unique_details = validateUniqueDetailAudit(state, audit);
  return result;
}

function parseManagedResult(bridgeResult) {
  const stdout = String(bridgeResult?.stdout || '');
  const line = stdout.split(/\r?\n/).find((row) => row.startsWith('PIPCLAW_MANAGED_RESULT='));
  if (!line) throw new Error(`Managed Ruby result marker missing: ${JSON.stringify(bridgeResult).slice(0, 600)}`);
  const parsed = JSON.parse(line.slice('PIPCLAW_MANAGED_RESULT='.length));
  if (!parsed.ok) {
    const error = new Error(parsed.error || 'Managed Ruby execution failed');
    error.managedResult = parsed;
    error.code = parsed.rollback_unconfirmed ? 'ROLLBACK_UNCONFIRMED' : parsed.commit_unconfirmed ? 'RESULT_UNKNOWN' : 'MANAGED_EXECUTION_FAILED';
    throw error;
  }
  return parsed;
}

class ManagedProjects {
  constructor({ appDataDir, skillRoot }) {
    this.appDataDir = appDataDir;
    this.root = path.join(appDataDir, 'SketchUpLiveMCP', 'managed-projects');
    this.keyPath = path.join(this.root, '.evidence.key');
    this.renderProfilePath = path.join(appDataDir, 'SketchUpLiveMCP', 'runtime-render-profile.json');
    this.skillRoot = skillRoot;
    this.helperPath = path.join(skillRoot, 'scripts', 'managed_project.rb').replaceAll('\\', '/');
    this.sheetScript = path.join(skillRoot, 'scripts', 'make_visual_review_sheet.py');
    this._projectLockContext = new AsyncLocalStorage();
  }

  async modelIdentity(bridge) {
    // Identity is read-only, but exporting it from a large accepted model can
    // exceed the generic bridge default. Keep identity verification mandatory
    // and use the same bounded window as managed evidence reads.
    const response = await bridge('run_ruby', { code: this.rubyCall('model_identity', []), file: this.helperPath }, 120000);
    return parseManagedResult(response);
  }

  async assertModelBinding(state, bridge) {
    const current = await this.modelIdentity(bridge);
    const bound = state.model_binding || { path: state.model_path || '', object_id: null };
    const normalize = (value) => path.resolve(String(value || '')).toLowerCase();
    if (bound.path) {
      if (!current.path || normalize(current.path) !== normalize(bound.path)) {
        throw new Error(`Managed project is bound to another SketchUp document: expected '${bound.path}', active '${current.path || '<unsaved>'}'`);
      }
    } else if (bound.object_id !== null && Number(current.object_id) !== Number(bound.object_id)) {
      throw new Error('Managed project is bound to a different unsaved SketchUp document');
    }
    return current;
  }

  isRawWriteTool(name) { return RAW_WRITE_TOOLS.has(name); }
  unsafeDiagnosticEnabled() { return String(process.env.SKETCHUP_MCP_UNSAFE_DIAGNOSTIC || '').toLowerCase() === 'true'; }

  async ensureRoot() {
    await fs.mkdir(this.root, { recursive: true });
    if (!fsSync.existsSync(this.keyPath)) {
      const entries = await fs.readdir(this.root, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        try {
          await fs.access(path.join(this.root, entry.name, 'state.json'));
          throw this.stateError('STATE_KEY_MISSING', 'Managed state signing key is missing; existing state prevents replacement');
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      }
    }
    // Initialize through a complete private file, then publish it with an
    // exclusive hard link. Readers never observe a partially written key and
    // concurrent initializers cannot replace a key that won the race.
    const temporary = `${this.keyPath}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
    try {
      const handle = await fs.open(temporary, 'wx', 0o600);
      try {
        await handle.writeFile(crypto.randomBytes(32));
        await handle.sync().catch(() => {});
      } finally {
        await handle.close().catch(() => {});
      }
      try {
        await fs.link(temporary, this.keyPath);
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => {});
    }
    return this.readKey();
  }

  async readKey() {
    let key;
    try {
      key = await fs.readFile(this.keyPath);
    } catch (error) {
      if (error.code === 'ENOENT') throw this.stateError('STATE_KEY_MISSING', 'Managed state signing key is missing; read refused without creating a replacement');
      throw error;
    }
    if (key.length !== 32) throw this.stateError('STATE_KEY_INVALID', 'Managed state signing key must contain exactly 32 bytes; read refused');
    return key;
  }

  async key({ create = true } = {}) {
    return create ? this.ensureRoot() : this.readKey();
  }
  projectDir(projectId) { return path.join(this.root, safeId(projectId)); }
  statePath(projectId) { return path.join(this.projectDir(projectId), 'state.json'); }

  async withProjectLock(projectId, operation) {
    const inherited = this._projectLockContext.getStore();
    if (inherited?.projectId === projectId && inherited.active) return operation();
    const directory = this.projectDir(projectId);
    await fs.mkdir(directory, { recursive: true });
    const lockPath = path.join(directory, '.lock');
    let handle;
    try {
      handle = await fs.open(lockPath, 'wx', 0o600);
      await handle.writeFile(JSON.stringify({ pid: process.pid, acquired_at: new Date().toISOString() }));
      await handle.sync().catch(() => {});
    } catch (error) {
      await handle?.close().catch(() => {});
      if (error.code === 'EEXIST') throw this.stateError('STATE_BUSY', 'Managed project is busy; inspect the recorded operation before retrying');
      throw error;
    }
    const owner = { projectId, active: true };
    try {
      return await this._projectLockContext.run(owner, operation);
    } finally {
      owner.active = false;
      await handle.close().catch(() => {});
      await fs.rm(lockPath, { force: true }).catch(() => {});
    }
  }

  documentBindingKey(binding) {
    // A saved file reopened in a new SU session must not evade an unresolved write.
    return binding?.path ? canonical({ path: path.resolve(String(binding.path)).toLowerCase() }) : canonical({ path: '', object_id: binding?.object_id ?? null });
  }

  async unresolvedDocumentOperation(binding, excludeProjectId = '') {
    const wanted = this.documentBindingKey(binding);
    let entries = [];
    try { entries = await fs.readdir(this.root, { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === safeId(excludeProjectId)) continue;
      try {
        const state = await this.readStoredStateForCas(entry.name);
        if (!state || this.documentBindingKey(state.model_binding || { path: state.model_path, object_id: null }) !== wanted) continue;
        const operation = (Array.isArray(state.operation_journal) ? state.operation_journal : []).find((item) => ['result_unknown','dispatched'].includes(item.status));
        if (operation || ['recovery_required','step_in_progress','patch_in_progress','write_in_progress'].includes(state.status)) return { project_id: state.project_id, operation: operation || null, status: state.status };
      } catch (error) {
        // An integrity failure makes every field in that state untrusted.
        // Do not use its path, object id, status, or journal to decide that
        // the current document is unrelated or already safe. The owning
        // project must be recovered through its signed state/reconciliation
        // path before another write can proceed.
        if (['STATE_INTEGRITY_CHECK_FAILED','STATE_INTEGRITY_FORMAT_INVALID','STATE_PARSE_FAILED'].includes(error.code)) {
          const guarded = this.stateError('STATE_RECOVERY_REQUIRED', `Project ${entry.name} has untrusted state; recover its signed state before writing to this document`);
          guarded.project_id = entry.name;
          guarded.cause = error.code;
          throw guarded;
        }
        throw error;
      }
    }
    return null;
  }

  async withDocumentWriteLock(binding, operation) {
    const key = crypto.createHash('sha256').update(this.documentBindingKey(binding)).digest('hex');
    const lockPath = path.join(this.root, `.document-write-${key}.lock`);
    await fs.mkdir(this.root, { recursive: true });
    let handle;
    try {
      handle = await fs.open(lockPath, 'wx', 0o600);
      await handle.writeFile(JSON.stringify({ pid: process.pid, acquired_at: new Date().toISOString(), binding }));
      await handle.sync().catch(() => {});
    } catch (error) {
      await handle?.close().catch(() => {});
      if (error.code === 'EEXIST') throw this.stateError('DOCUMENT_WRITE_BUSY', 'The bound SketchUp document has another write in progress; inspect its operation before retrying');
      throw error;
    }
    try { return await operation(); }
    finally { await handle.close().catch(() => {}); await fs.rm(lockPath, { force: true }).catch(() => {}); }
  }

  async dispatchAuxiliaryWrite(state, method, args, bridge, context = {}) {
    return this.withProjectLock(state.project_id, async () => {
      const binding = await this.assertModelBinding(state, bridge);
      return this.withDocumentWriteLock(binding, async () => {
        const other = await this.unresolvedDocumentOperation(binding, state.project_id);
        if (other) throw this.stateError('DOCUMENT_WRITE_UNCERTAIN', `Document write blocked by project ${other.project_id}`);
        if ((state.operation_journal || []).some(item => ['dispatched','result_unknown'].includes(item.status))) throw this.stateError('RESULT_UNKNOWN', 'Resolve the existing write before any save, deletion or rollback');
        const priorStatus = state.status;
        const operation = { operation_id: crypto.randomUUID(), kind: method, project_id: state.project_id, model_binding: binding, arguments: args, input_sha256:crypto.createHash('sha256').update(canonical(args)).digest('hex'), prior_status:priorStatus, context, status: 'dispatched', dispatched_at: new Date().toISOString() };
        operation.request={operation_id:operation.operation_id,kind:method,project_id:state.project_id,model_binding:binding,arguments:args,input_sha256:operation.input_sha256};
        state.operation_journal = [...(state.operation_journal || []), operation].slice(-32);
        state.status = 'write_in_progress';
        await this.saveState(state);
        try {
          const receipted = ['save_copy','remove_phase','remove_phases'].includes(method);
          const response = await bridge('run_ruby', { code: receipted ? this.rubyCall('auxiliary_with_receipt',[JSON.stringify(operation.request)]) : this.rubyCall(method, args), file: this.helperPath }, 120000);
          operation.result = parseManagedResult(response);
          operation.status = 'completed';
          state.status = priorStatus;
          await this.saveState(state);
          return response;
        } catch (error) {
          const result = error.managedResult;
          const confirmed = result && !result.commit_unconfirmed && !result.rollback_unconfirmed && (result.write_attempted === false || result.transaction_started === false || result.rollback_confirmed === true);
          operation.status = confirmed ? 'failed_confirmed' : 'result_unknown';
          operation.error = String(error.message || error);
          state.status = confirmed ? priorStatus : 'recovery_required';
          if (!confirmed) {
            state.recovery_error = operation.error;
            state.transaction_result = { code: 'RESULT_UNKNOWN', result_unknown: true, operation_id: operation.operation_id, message: operation.error };
          }
          await this.saveState(state);
          if (!confirmed) throw this.stateError('RESULT_UNKNOWN', `${method} result is unknown; operation ${operation.operation_id} must not be replayed`);
          throw error;
        }
      });
    });
  }

  async readStoredStateForCas(projectId) {
    const target = this.statePath(projectId);
    try {
      const state = JSON.parse(await fs.readFile(target, 'utf8'));
      if (!state || typeof state !== 'object' || Array.isArray(state)) throw this.stateError('STATE_PARSE_FAILED', 'Managed project state must be a JSON object; it was left unchanged');
      const signature = state.integrity;
      if (typeof signature !== 'string' || !/^[a-f0-9]{64}$/i.test(signature)) throw this.stateError('STATE_INTEGRITY_FORMAT_INVALID', 'Managed project state integrity format is invalid; it was left unchanged');
      const clean = { ...state };
      delete clean.integrity;
      const expected = await this.signObject(clean, { create: false });
      const actualBytes = Buffer.from(signature, 'hex');
      const expectedBytes = Buffer.from(expected, 'hex');
      if (actualBytes.length !== expectedBytes.length || !crypto.timingSafeEqual(actualBytes, expectedBytes)) throw this.stateError('STATE_INTEGRITY_CHECK_FAILED', 'Managed project state integrity check failed; it was left unchanged');
      return state;
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      if (error instanceof SyntaxError) throw this.stateError('STATE_PARSE_FAILED', 'Managed project state is not valid JSON; it was left unchanged');
      throw error;
    }
  }

  async signObject(object, { create = false } = {}) {
    const key = await this.key({ create });
    return crypto.createHmac('sha256', key).update(canonical(object)).digest('hex');
  }

  stateError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  async saveState(state) {
    const projectId = safeId(state.project_id);
    if (state.schema_version !== 1) throw this.stateError('STATE_SCHEMA_UNSUPPORTED', 'Unsupported state schema; save refused without migration');
    if (state.state_revision !== undefined && (!Number.isSafeInteger(state.state_revision) || state.state_revision < 0 || state.state_revision >= Number.MAX_SAFE_INTEGER)) {
      throw this.stateError('STATE_REVISION_INVALID', 'State revision cannot be safely incremented; save refused');
    }
    const target = this.statePath(projectId);
    // begin() initializes the key before its first save. Keep direct callers
    // compatible for a brand-new project, but never recreate a key for an
    // existing state after credentials have gone missing.
    if (!fsSync.existsSync(this.keyPath) && !fsSync.existsSync(target)) await this.ensureRoot();
    return this.withProjectLock(projectId, async () => {
      const existing = await this.readStoredStateForCas(projectId);
      const expectedRevision = state.state_revision;
      const actualRevision = existing?.state_revision;
      if ((existing && actualRevision !== expectedRevision) || (!existing && expectedRevision !== undefined)) {
        throw this.stateError('STATE_CONFLICT', 'Managed project state changed since it was read; reload before saving');
      }
      const priorRevision = expectedRevision === undefined ? 0 : expectedRevision;
      const clean = { ...state, state_revision: priorRevision + 1 };
      if (!clean.assistance_selection && !['recovery_required','step_in_progress','patch_in_progress','write_in_progress'].includes(clean.status)) {
        clean.assistance_mode = 'guided';
        clean.assistance_selection = { source: 'migration_default', selected_at: new Date().toISOString() };
      }
      delete clean.integrity;
      clean.integrity = await this.signObject(clean, { create: false });
      const temporary = `${target}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
      try {
        await fs.writeFile(temporary, JSON.stringify(clean, null, 2), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        await fs.rename(temporary, target);
      } finally {
        await fs.rm(temporary, { force: true }).catch(() => {});
      }
      Object.assign(state, clean);
      return clean;
    });
  }

  async loadState(projectId) {
    const target = this.statePath(projectId);
    let state;
    try {
      state = JSON.parse(await fs.readFile(target, 'utf8'));
    } catch (error) {
      if (error instanceof SyntaxError) throw this.stateError('STATE_PARSE_FAILED', 'Managed project state is not valid JSON; it was left unchanged');
      throw error;
    }
    if (!state || typeof state !== 'object' || Array.isArray(state)) throw this.stateError('STATE_PARSE_FAILED', 'Managed project state must be a JSON object; it was left unchanged');
    const signature = state.integrity;
    if (typeof signature !== 'string' || !/^[a-f0-9]{64}$/i.test(signature)) throw this.stateError('STATE_INTEGRITY_FORMAT_INVALID', 'Managed project state integrity format is invalid; it was left unchanged');
    const clean = { ...state };
    delete clean.integrity;
    const expected = await this.signObject(clean, { create: false });
    const actualBytes = Buffer.from(signature, 'hex');
    const expectedBytes = Buffer.from(expected, 'hex');
    if (actualBytes.length !== expectedBytes.length || !crypto.timingSafeEqual(actualBytes, expectedBytes)) throw this.stateError('STATE_INTEGRITY_CHECK_FAILED', 'Managed project state integrity check failed; it was left unchanged');
    if (state.schema_version !== 1) throw this.stateError('STATE_SCHEMA_UNSUPPORTED', `Managed project state schema ${JSON.stringify(state.schema_version)} is unsupported; it was left unchanged`);
    if (state.state_revision !== undefined && (!Number.isSafeInteger(state.state_revision) || state.state_revision < 0)) throw this.stateError('STATE_REVISION_INVALID', 'Managed project state revision is invalid; it was left unchanged');
    return state;
  }

  async writeEvidence(state, record) {
    const clean = { ...record, previous_record_hash: state.last_record_hash || '' };
    clean.record_hash = crypto.createHash('sha256').update(canonical(clean)).digest('hex');
    clean.signature = await this.signObject(clean, { create: false });
    const dir = path.join(this.projectDir(state.project_id), 'evidence');
    await fs.mkdir(dir, { recursive: true });
    const target = path.join(dir, `${clean.evidence_id}.json`);
    await fs.writeFile(target, JSON.stringify(clean, null, 2), 'utf8');
    state.last_record_hash = clean.record_hash;
    state.last_evidence_id = clean.evidence_id;
    return { record: clean, path: target };
  }

  async verifyEvidence(state, evidenceId, currentModel = null, options = {}) {
    const target = path.join(this.projectDir(state.project_id), 'evidence', `${evidenceId}.json`);
    const record = JSON.parse(await fs.readFile(target, 'utf8'));
    const signature = record.signature;
    const clean = { ...record };
    delete clean.signature;
    const expected = await this.signObject(clean, { create: false });
    if (!signature || !crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'))) throw new Error('Evidence signature verification failed');
    const withoutHash = { ...clean };
    const recordHash = withoutHash.record_hash;
    delete withoutHash.record_hash;
    const expectedHash = crypto.createHash('sha256').update(canonical(withoutHash)).digest('hex');
    if (recordHash !== expectedHash) throw new Error('Evidence record hash verification failed');
    if (record.project_id !== state.project_id || record.evidence_id !== evidenceId) throw new Error('Evidence does not belong to this project');
    if (options.verifyFiles !== false) await verifyEvidenceFiles(record);
    if (!options.restoringCheckpoint && record.model_binding && state.model_binding && !sameModelBinding(record.model_binding, state.model_binding)) {
      throw this.stateError('EVIDENCE_MODEL_BINDING_MISMATCH', 'Evidence is bound to a different SketchUp document or session');
    }
    if (currentModel && record.model_binding && !sameModelBinding(record.model_binding, currentModel)) {
      throw this.stateError('EVIDENCE_MODEL_CHANGED', 'Current SketchUp document or session does not match sealed evidence');
    }
    if (record.scene_revision !== undefined && state.scene_revision !== undefined && Number(record.scene_revision) !== Number(state.scene_revision)) {
      throw this.stateError('EVIDENCE_SCENE_REVISION_MISMATCH', 'Evidence scene revision is stale for the current managed project');
    }
    return { record, path: target };
  }

  async assertEvidenceCurrent(state, evidence, bridge) {
    const auditFile = evidence?.record?.files?.audit;
    if (!auditFile?.path) throw this.stateError('EVIDENCE_AUDIT_MISSING', 'Sealed evidence has no project audit attachment');
    const livePath = path.join(this.projectDir(state.project_id), `.evidence-live-audit-${process.pid}-${Date.now()}.json`);
    try {
      parseManagedResult(await bridge('run_ruby', { code: this.rubyCall('export_project_audit', [state.project_id, livePath.replaceAll('\\', '/')]), file: this.helperPath }, 120000));
      const recorded = JSON.parse(await fs.readFile(auditFile.path, 'utf8'));
      const live = JSON.parse(await fs.readFile(livePath, 'utf8'));
      validateAuditReadback(recorded);
      validateAuditReadback(live);
      const comparable = (value) => { const copy = JSON.parse(JSON.stringify(value)); delete copy.created_at; return copy; };
      if (canonical(comparable(recorded)) !== canonical(comparable(live))) {
        const error = this.stateError('EVIDENCE_MODEL_CHANGED', 'Current SketchUp geometry or audit summary differs from sealed evidence');
        error.recordedAudit = recorded;
        error.liveAudit = live;
        throw error;
      }
      return live;
    } finally {
      await fs.rm(livePath, { force: true }).catch(() => {});
    }
  }

  rubyCall(method, args) {
    const rubyArgs = args.map((value) => JSON.stringify(value)).join(', ');
    return `load ${JSON.stringify(this.helperPath)}; r=PipClawManagedProject.${method}(${rubyArgs}); puts 'PIPCLAW_MANAGED_RESULT='+r; r`;
  }

  async begin(input, bridge) {
    await this.ensureRoot();
    const mode = String(input.mode || 'single_image');
    if (!['single_image', 'cad', 'freeform', 'refinement', 'test','attribution'].includes(mode)) throw new Error('Unsupported managed project mode');
    if(mode==='attribution' && input.attribution_command!=='显源')throw new Error('EXPLICIT_ATTRIBUTION_COMMAND_REQUIRED');
    const sourcePath = path.resolve(input.source_image || '');
    if (mode === 'single_image' && !fsSync.existsSync(sourcePath)) throw new Error(`Source image not found: ${sourcePath}`);
    const outputDirectory = path.resolve(input.output_directory || path.join(process.cwd(), 'sketchup-managed-output'));
    await fs.mkdir(outputDirectory, { recursive: true });
    const projectId = safeId(input.project_id || `su_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`);
    if (fsSync.existsSync(this.statePath(projectId))) throw new Error(`Managed project already exists: ${projectId}`);
    const ping = await bridge('ping');
    const source = mode === 'single_image' ? await fileEvidence(sourcePath) : null;
    const projectionBrief = mode === 'single_image' ? validateProjectionBrief(input.projection_brief) : null;
    const taskProfile = normalizedProfile(input.task_profile);
    const toolkitBinding = taskProfile.method_family ? await resolveMethodBinding(this.appDataDir, taskProfile.method_family) : null;
    if (Object.hasOwn(input, 'assistance_mode') && !normalizeAssistanceMode(input.assistance_mode)) throw this.stateError('ASSISTANCE_MODE_INVALID', 'assistance_mode must be guided, autonomous, or compatibility value auto');
    const assistance = resolveAssistanceMode(input);
    if (assistance.command_required) throw this.stateError('ASSISTANCE_COMMAND_REQUIRED', 'autonomous requires an exact first non-empty task line: ADAI老王，开启专家模式 or 开启ADAI老王专家模式');
    const workUnit = normalizedWorkUnit(input.work_unit_id, assistance.mode) || (assistance.mode === 'autonomous' ? { id: `unit_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`, strategy: 'autonomous_work_unit' } : null);
    const response = await bridge('run_ruby', { code: this.rubyCall('begin_project', [projectId]), file: this.helperPath });
    parseManagedResult(response);
    const modelBinding = await this.modelIdentity(bridge);
    const phasePlan = phasePlanFor(mode, taskProfile);
    const state = {
      schema_version: 1, project_id: projectId, mode, assistance_mode: assistance.mode, work_unit: workUnit, assistance_selection: { source: assistance.source, command_detected: assistance.command_detected, selected_at: new Date().toISOString() }, task_text: assistance.task_text, attribution_command:mode==='attribution'?'显源':null, source, projection_brief: projectionBrief, task_profile: taskProfile, output_directory: outputDirectory,
      model_path: modelBinding.path || ping.model_path || '', model_binding: modelBinding,
      toolkit_bindings: toolkitBinding ? [toolkitBinding] : [],
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      status: 'ready_for_step', step_index: 0, phase: phasePlan[0].name, phase_plan: phasePlan,
      last_record_hash: '', last_evidence_id: '',
    };
    await this.saveState(state);
    return { ok: true, project_id: projectId, status: state.status, assistance: assistanceSummary(state,input.detail===true), projection_brief: projectionBrief, toolkit_bindings: state.toolkit_bindings, task_card: taskCard(state,phasePlan[0]), next_action: phasePlan[0].hint };
  }

  async captureViewportSet(state, phase, directory, bridge) {
    await fs.mkdir(directory, {recursive:true});
    // Large but already accepted scenes can take longer than the generic
    // 30-second bridge default just to read the active camera/viewport state.
    // This helper is read-only; keep the existing capture and identity checks
    // intact while using the same bounded 120-second limit as the evidence
    // capture calls below.
    const runHelper=async(name,args=[])=>parseManagedResult(await bridge('run_ruby',{code:this.rubyCall(name,args),file:this.helperPath},120000));
    const savedCamera=await runHelper('camera_state');
    let plan, prepared=false, selectionSaved=false;
    const files={},metadata=[];
    const script=path.join(path.dirname(this.helperPath),'capture_window.py');
    const prepareOutput=path.join(directory,'window-prepare.png');
    const capture=async(output,pid,action)=>{
      const args=[script,output,String(pid)];if(action)args.push(action);
      const result=await execFileAsync(process.env.PIPCLAW_PYTHON || 'python',args,{windowsHide:true,timeout:25000});
      const data=JSON.parse(result.stdout);if(!data.ok)throw new Error('Window capture failed');return data;
    };
    let sourceCamera;
    try {
      // Save selection once; do not overwrite it with a second viewport_plan call.
      selectionSaved=true;
      plan=await runHelper('viewport_plan',[state.project_id,phase]);
      prepared=true;
      const preparation=await capture(prepareOutput,plan.process_id,'--prepare');
      await runHelper('restore_camera',[JSON.stringify(state.source_camera || savedCamera)]);
      sourceCamera=await runHelper('camera_state');
      plan.shots[0].camera=sourceCamera;
      for(const shot of plan.shots){
        await runHelper('restore_camera',[JSON.stringify(shot.camera)]);
        const expected=await runHelper('camera_state');
        const output=path.join(directory,shot.label+'.png');
        const pixels=await capture(output,plan.process_id);
        const actual=await runHelper('camera_state');
        const delta=Math.max(...['eye','target','up'].flatMap(k=>actual[k].map((v,i)=>Math.abs(v-expected[k][i]))));
        const lens=expected.perspective?'fov':'height';
        if(delta>0.001 || Math.abs(actual[lens]-expected[lens])>0.001 || actual.perspective!==expected.perspective)throw new Error('Camera changed during window capture; evidence rejected');
        files[shot.label]=output;
        metadata.push({label:shot.label,camera:expected,verified_camera:actual,...pixels});
      }
      const manifest=path.join(directory,'viewport-capture.json');
      await fs.writeFile(manifest,JSON.stringify({backend:'window_print',preparation,render_options:plan.render_options,shots:metadata},null,2));
      files.capture_manifest=manifest;
    } finally {
      // Attempt every restoration even if a preceding restoration fails.
      const errors=[];
      try {await runHelper('restore_camera',[JSON.stringify(savedCamera)]);} catch(e){errors.push(e.message);}
      if(selectionSaved)try{await runHelper('restore_viewport_selection');}catch(e){errors.push(e.message);}
      if(prepared && plan)try{await capture(prepareOutput,plan.process_id,'--restore');}catch(e){errors.push(e.message);}
      if(errors.length)throw new Error('Window capture restoration incomplete: '+errors.join('; '));
    }
    return {files,camera:sourceCamera};
  }

  async diagnoseViewport(input, bridge) {
    const state = await this.loadState(safeId(input.project_id));
    // Once evidence is sealed, an extra viewport diagnostic can move the
    // active camera and invalidate the very evidence the agent is reviewing.
    // Keep the normal capture -> review path adjacent; recovery recapture has
    // its own explicit retry tool and remains available.
    if (state.status === 'review_required' && !state.recovery_recapture_required) {
      throw this.stateError('REVIEW_CAPTURE_LOCKED', 'Evidence is sealed for review; do not change the SketchUp viewport before review. Use the returned review sheet and evidence views, or submit review first.');
    }
    // A crashed project may have an unsealed checkpoint open. Diagnostic capture
    // is permitted but never advances status or manufactures phase approval.
    const dir=path.join(state.output_directory,'viewport-diagnostic',Date.now().toString(36));
    const result=await this.captureViewportSet(state,state.phase,dir,bridge);
    return {ok:true,status_preserved:state.status,directory:dir,...result};
  }

  async automaticEvidence(state, phase, scriptPath, scriptHash, bridge, buildResult) {
    // A consistency retry follows a scene transition observed during the
    // initial capture. The build result belongs to the earlier scene and must
    // never be re-labelled as a measurement for this new evidence id. There
    // is no independent live geometry readback adapter in this route, so keep
    // the fresh audit/views but explicitly omit machine geometry inputs.
    const consistencyRetry = state.pending_evidence?.consistency_retry === true;
    const evidenceBuildResult = consistencyRetry && buildResult && typeof buildResult === 'object'
      ? JSON.parse(JSON.stringify(buildResult))
      : buildResult;
    if (consistencyRetry && evidenceBuildResult?.build_result) {
      delete evidenceBuildResult.build_result.geometry_readback;
      evidenceBuildResult.build_result.geometry_readback_status = 'not_measured_after_scene_change';
    }
    if (consistencyRetry && evidenceBuildResult && typeof evidenceBuildResult === 'object') delete evidenceBuildResult.geometry_readback;
    const evidenceId = `ev_${String(state.step_index + 1).padStart(2, '0')}_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
    const evidenceDir = path.join(state.output_directory, 'managed-evidence', evidenceId);
    await fs.mkdir(evidenceDir, { recursive: true });
    const checkpointPath = state.recovered_checkpoint?.path || path.join(evidenceDir, 'phase-checkpoint.skp');
    if (state.recovered_checkpoint) await verifyEvidenceFiles({checkpoint:state.recovered_checkpoint});
    else {
      const checkpointBridge = await this.dispatchAuxiliaryWrite(state, 'save_copy', [state.project_id, checkpointPath.replaceAll('\\', '/')], bridge, {purpose:'phase_checkpoint',phase,script_path:scriptPath,script_hash:scriptHash,build_result:buildResult});
      parseManagedResult(checkpointBridge);
    }
    if (!fsSync.existsSync(checkpointPath) || (await fs.stat(checkpointPath)).size <= 0) throw new Error('Phase checkpoint did not produce a nonzero SKP');
    state.model_binding = await this.modelIdentity(bridge);
    state.last_checkpoint = { path: checkpointPath, phase, evidence_id: evidenceId, review_status: 'not_yet_reviewed' };
    const beforeAuditPath=path.join(evidenceDir,'pre-capture-audit.json');
    parseManagedResult(await bridge('run_ruby',{code:this.rubyCall('export_project_audit',[state.project_id,beforeAuditPath.replaceAll('\\','/')]),file:this.helperPath},120000));
    state.pending_evidence={phase,script_path:scriptPath,script_hash:scriptHash,build_result:evidenceBuildResult,checkpoint:await fileEvidence(checkpointPath),audit:await fileEvidence(beforeAuditPath)};
    delete state.recovered_checkpoint;
    await this.saveState(state);
    if (state.source_camera) {
      const sourceRestore = await bridge('run_ruby', { code: this.rubyCall('restore_camera', [JSON.stringify(state.source_camera)]), file: this.helperPath }, 120000);
      parseManagedResult(sourceRestore);
    }
    const referencePath = path.join(evidenceDir, 'reference.png');
    const profile=fsSync.existsSync(this.renderProfilePath) ? JSON.parse(await fs.readFile(this.renderProfilePath,'utf8')) : {};
    let cameraState;
    const detailViews = {};
    let viewportCaptured = false;
    if (['window_print','desktop_viewport'].includes(profile.capture_backend)) {
      try {
      const captured = await this.captureViewportSet(state,phase,evidenceDir,bridge);
      cameraState=captured.camera;
      for (const [label,file] of Object.entries(captured.files)) if(label!=='reference') detailViews[label]=file;
      viewportCaptured = true;
      } catch (error) {
        if (/restoration incomplete/.test(error.message)) throw error;
        await fs.writeFile(path.join(evidenceDir,'capture-fallback.json'),JSON.stringify({from:profile.capture_backend,to:'ruby_native',error:error.message}));
      }
    }
    if (!viewportCaptured) {
    const capture = await bridge('run_ruby', { code: this.rubyCall('capture_reference', [state.project_id, referencePath.replaceAll('\\', '/')]), file: this.helperPath }, 120000);
    parseManagedResult(capture);
    const cameraBridge = await bridge('run_ruby', { code: this.rubyCall('camera_state', []), file: this.helperPath }, 120000);
    cameraState = parseManagedResult(cameraBridge);
    // The sealed geometry views below cover the whole model. The legacy
    // diagnostic export remains callable explicitly but adds no sealed views.
    if (phase === 'archetypes') {
      const prototypeBridge = await bridge('run_ruby', { code: this.rubyCall('capture_archetype_views', [state.project_id, evidenceDir.replaceAll('\\', '/')]), file: this.helperPath }, 120000);
      const prototypes = parseManagedResult(prototypeBridge);
      for (const [index, prototypePath] of (prototypes.paths || []).entries()) detailViews[prototypes.labels?.[index] || `prototype_${index}`] = prototypePath;
    }
    if (phase === 'facade_detail') {
      const detailBridge = await bridge('run_ruby', { code: this.rubyCall('capture_detail_views', [state.project_id, evidenceDir.replaceAll('\\', '/')]), file: this.helperPath }, 120000);
      const detail = parseManagedResult(detailBridge);
      for (const [index, detailPath] of (detail.paths || []).entries()) detailViews[`detail_${detail.labels?.[index] || index}`] = detailPath;
    }
    }
    const geometryViewStart=Date.now();
    const geometryViews=parseManagedResult(await bridge('run_ruby',{code:this.rubyCall('capture_geometry_views',[state.project_id,phase,evidenceDir.replaceAll('\\','/')]),file:this.helperPath},120000));
    const geometryCameraPath=path.join(evidenceDir,'geometry-cameras.json');
    await fs.writeFile(geometryCameraPath,JSON.stringify(geometryViews,null,2));
    detailViews.geometry_cameras=geometryCameraPath;
    for(const item of geometryViews.views||[])detailViews['geometry_'+item.label]=item.path;
    const geometryViewSeconds=(Date.now()-geometryViewStart)/1000;
    const auditOutput = path.join(evidenceDir, 'audit.json');
    const auditPreview = path.join(evidenceDir, 'audit-preview.png');
    const auditBridge = await bridge('run_ruby', { code: this.rubyCall('export_project_audit', [state.project_id, auditOutput.replaceAll('\\', '/')]), file: this.helperPath }, 120000);
    parseManagedResult(auditBridge);
    const beforeAudit = JSON.parse(await fs.readFile(beforeAuditPath, 'utf8'));
    const afterAudit = JSON.parse(await fs.readFile(auditOutput, 'utf8'));
    if (checkpointContent(beforeAudit) !== checkpointContent(afterAudit)) {
      state.pending_evidence = { ...(state.pending_evidence || {}), consistency_retry: true, consistency_error: 'EVIDENCE_MODEL_CHANGED', consistency_basis: await fileEvidence(beforeAuditPath) };
      await this.saveState(state);
      throw this.stateError('EVIDENCE_MODEL_CHANGED', 'Geometry or protected scene changed during initial capture; retry evidence only');
    }
    const evidenceModelBinding = await this.modelIdentity(bridge);
    state.model_binding = evidenceModelBinding;
    await fs.copyFile(referencePath, auditPreview);

    let reviewSheet = '';
    let reviewReport = '';
    if (state.source) {
      reviewSheet = path.join(evidenceDir, 'review-sheet.png');
      reviewReport = path.join(evidenceDir, 'review-evidence.json');
      const python = process.env.PIPCLAW_PYTHON || 'python';
      await execFileAsync(python, [this.sheetScript, '--source', state.source.path, '--candidate', referencePath, '--output', reviewSheet, '--report', reviewReport], { windowsHide: true, timeout: 120000 });
    }

    const geometryArtifacts={};
    const evidenceWarnings=[];
    if(evidenceBuildResult?.build_result?.geometry_readback){
      const materializeInput=path.join(evidenceDir,'geometry-materialize-input.json');
      await fs.writeFile(materializeInput,JSON.stringify({project_id:state.project_id,phase,evidence_id:evidenceId,geometry_readback:evidenceBuildResult.build_result.geometry_readback}));
      try {
        await execFileAsync(process.env.PIPCLAW_PYTHON||'python',[path.join(path.dirname(this.helperPath),'materialize_geometry_review.py'),'--input',materializeInput,'--output',evidenceDir],{windowsHide:true,timeout:30000,env:{...process.env,PYTHONIOENCODING:'utf-8'}});
        for(const name of ['readback','id-map','measurements','dependencies','review-draft','timing'])geometryArtifacts['geometry_'+name.replaceAll('-','_')]=path.join(evidenceDir,'geometry-'+name+'.json');
      } catch(error) {
        // A malformed optional derived field must not strand a committed model in
        // evidence_pending. Preserve the raw readback and exact formatter error;
        // review can continue with these machine inputs explicitly unverified.
        const diagnostic=path.join(evidenceDir,'geometry-materialization-error.json');
        await fs.writeFile(diagnostic,JSON.stringify({code:'GEOMETRY_DERIVED_INPUT_INVALID',message:String(error.message||error),source:materializeInput,required_correction:'Fix the producer output and rerun the phase if these measurements are required; no geometry was replayed.'},null,2));
        geometryArtifacts.geometry_materialization_error=diagnostic;
        evidenceWarnings.push({code:'GEOMETRY_DERIVED_INPUT_INVALID',state:'unverified',message:'Optional geometry review artifacts were not materialized; raw geometry_readback is preserved.'});
      }
    }
    const files = {};
    for (const [name, file] of Object.entries({ checkpoint: checkpointPath, reference: referencePath, audit: auditOutput, audit_preview: auditPreview, review_sheet: reviewSheet, review_report: reviewReport, capture_fallback: path.join(evidenceDir,'capture-fallback.json'), ...geometryArtifacts, ...detailViews })) {
      if (file && fsSync.existsSync(file)) files[name] = await fileEvidence(file);
    }
    const record = {
      schema_version: 1, evidence_id: evidenceId, project_id: state.project_id, mode: state.mode,
      phase, step_index: state.step_index, created_at: new Date().toISOString(), source: state.source,
      script: { path: path.resolve(scriptPath), sha256: scriptHash }, build_result: evidenceBuildResult, files,
      model_binding: evidenceModelBinding, scene_revision: buildResult?.build_result?.scene_revision ?? state.scene_revision ?? null,
      task_contract: { mode: state.mode, phase, task_profile: state.task_profile || {} }, camera_state: cameraState,
      timing:{geometry_views_seconds:geometryViewSeconds,geometry_write_readback_seconds:evidenceBuildResult?.build_result?.geometry_readback?.write_readback_seconds??null},
      model_path: state.model_path,
      ...(evidenceWarnings.length ? {evidence_warnings:evidenceWarnings,missing_machine_inputs:['geometry_measurements','geometry_dependencies']} : {}),
      ...(consistencyRetry ? {geometry_readback_status:'not_measured_after_scene_change',missing_machine_inputs:['geometry_readback','geometry_measurements','geometry_dependencies'],note:'Fresh audit and views only; the prior build readback was not relabelled after the scene changed.'} : {}),
    };
    const saved = await this.writeEvidence(state, record);
    return { evidence_id: evidenceId, evidence_path: saved.path, files, camera_state: cameraState, review_input:reviewAvailability(files) };
  }

  async step(input, bridge) {
    return this.withProjectLock(safeId(input.project_id), () => this._stepUnlocked(input, bridge));
  }

  async _stepUnlocked(input, bridge) {
    const state = await this.loadState(safeId(input.project_id));
    const continueWorkUnit = state.status === 'review_required' && state.assistance_mode === 'autonomous' && state.work_unit && input.continue_work_unit === true;
    if (state.status !== 'ready_for_step' && !continueWorkUnit) throw new Error(state.status === 'evidence_pending' ? '下一步只能调 sketchup_project_retry_evidence；禁止重放建模。' : `Project is ${state.status}; review the current evidence before another geometry step`);
    let continuationTarget = state.step_index;
    if (continueWorkUnit && state.last_evidence_id) {
      const plan = state.phase_plan || PHASE_PLANS[state.mode] || PHASES;
      if (input.next_phase) {
        const target = plan.findIndex((item) => item.name === String(input.next_phase).trim());
        if (target < 0) throw this.stateError('WORK_UNIT_PHASE_UNKNOWN', 'next_phase is not in the saved project plan');
        if (target <= state.step_index) throw this.stateError('WORK_UNIT_PHASE_ORDER', 'next_phase must be a later planned phase in the same autonomous work unit');
        continuationTarget = target;
      }
    }
    if (state.work_unit && input.work_unit_id && String(input.work_unit_id) !== state.work_unit.id) throw new Error('WORK_UNIT_MISMATCH');
    // Work-unit identity is derived for the operation; never mutate the
    // caller's input object while preparing a write.
    await this.assertModelBinding(state, bridge);
    const phasePlan = state.phase_plan || PHASE_PLANS[state.mode] || PHASES;
    const phase = phasePlan[continuationTarget];
    if (!phase) throw new Error('All managed phases are complete; call sketchup_project_finish');
    const unresolved = await this.unresolvedDocumentOperation(state.model_binding || { path: state.model_path, object_id: null }, state.project_id);
    if (unresolved) throw this.stateError('DOCUMENT_WRITE_UNCERTAIN', `The bound SketchUp document has an unresolved write for project ${unresolved.project_id}; reconcile operation ${unresolved.operation?.operation_id || '<unknown>'} before any new project can write`);
    let abstractionRecheckRecord = null;
    if (abstractionRecheckNeeded(state, phase.name)) {
      const note=String(input.abstraction_note || '').trim();
      if (note.length < 20) throw new Error(`After ${state.revision_attempts?.[phase.name]} revisions of ${phase.name}, the next step must provide abstraction_note (at least 20 characters) explaining the source evidence re-read and the changed or defended geometric abstraction.`);
      abstractionRecheckRecord={attempt:Number(state.revision_attempts?.[phase.name]||0),note,recorded_at:new Date().toISOString()};
    }
    const scriptPath = path.resolve(input.ruby_file || '');
    if (!fsSync.existsSync(scriptPath)) throw new Error(`Ruby build file not found: ${scriptPath}`);
    const scriptSource = await fs.readFile(scriptPath, 'utf8');
    if(state.mode==='attribution') {
      const manifest=JSON.parse(await fs.readFile(path.join(path.dirname(scriptPath),'attribution-manifest.json'),'utf8'));
      if(state.attribution_command!=='显源' || manifest.command!=='显源' || manifest.user_requested!==true || path.resolve(manifest.ruby_file)!==path.resolve(scriptPath) || manifest.build_sha256!==crypto.createHash('sha256').update(scriptSource).digest('hex'))throw new Error('ATTRIBUTION_BUILD_MISMATCH');
    }
    validateBuildScript(scriptSource, phase.name, state.mode, state.task_profile);
    const scriptHash = await hashFile(scriptPath);
    const requestedIntent = input.operation_intent == null ? 'append' : String(input.operation_intent).trim();
    if (!['append','update','replace'].includes(requestedIntent)) throw this.stateError('OPERATION_INTENT_INVALID', 'operation_intent must be append, update, or replace');
    const intent = state.assistance_mode === 'autonomous' ? requestedIntent : 'replace';
    const priorStatus = state.status;
    const progress = { phase: phase.name, step_index: continuationTarget,
      ...(continueWorkUnit && state.last_evidence_id ? { previous_evidence_id: state.last_evidence_id } : {}),
      ...(abstractionRecheckRecord ? { abstraction_recheck: abstractionRecheckRecord } : {}) };
    const operation = { operation_id: crypto.randomUUID(), kind: 'geometry_step', project_id: state.project_id, phase: phase.name, step_index: continuationTarget, work_unit_id: state.work_unit?.id || null, intent, status: 'prepared', prior_status: priorStatus, progress };
    operation.script_path = scriptPath;
    operation.script_hash = scriptHash;
    operation.model_binding = state.model_binding;
    const operationContext = { strategy: state.assistance_mode === 'autonomous' ? 'expert_work_unit' : 'guided_phase', work_unit_id: state.work_unit?.id || null, intent, operation_id: operation.operation_id, progress };
    operation.operation_context = operationContext;
    operation.request = { operation_id: operation.operation_id, project_id: state.project_id, phase: phase.name, step_index: continuationTarget, script_sha256: scriptHash, model_binding: operation.model_binding, operation_context: operationContext };
    const ruby = this.rubyCall('execute_step_with_receipt', [state.project_id, phase.name, continuationTarget, scriptPath.replaceAll('\\', '/'), JSON.stringify(state.projection_brief || {}), operation.operation_id, JSON.stringify(operationContext)]);
    let response;
    let dispatched = false;
    try {
      response = await this.withDocumentWriteLock(operation.model_binding, async () => {
        // All checks above are preparatory. Re-check the live binding and
        // unresolved writes after the document lock, then persist progress
        // immediately before dispatch. A lock refusal therefore cannot move
        // the project cursor or create a new stage record.
        const currentBinding = await this.assertModelBinding(state, bridge);
        const other = await this.unresolvedDocumentOperation(operation.model_binding, state.project_id);
        if (other) throw this.stateError('DOCUMENT_WRITE_UNCERTAIN', `Document write blocked by project ${other.project_id}`);
        if (await hashFile(scriptPath) !== scriptHash) throw this.stateError('SCRIPT_CHANGED_BEFORE_DISPATCH', 'Ruby build file changed after preparation; no geometry was dispatched');
        operation.model_binding = currentBinding;
        operation.request.model_binding = currentBinding;
        operation.dispatched_at = new Date().toISOString();
        operation.status = 'dispatched';
        state.operation_journal = [...(Array.isArray(state.operation_journal) ? state.operation_journal : []), operation].slice(-32);
        state.status = 'step_in_progress';
        state.updated_at = new Date().toISOString();
        await this.saveState(state);
        dispatched = true;
        return bridge('run_ruby', { code: ruby, file: scriptPath }, input.timeout_ms || 120000);
      });
    } catch (error) {
      if (!dispatched) throw error;
      operation.status = 'result_unknown';
      operation.completed_at = new Date().toISOString();
      operation.error = String(error.message || error);
      state.status = 'recovery_required';
      state.recovery_error = operation.error;
      state.transaction_result = { code: 'RESULT_UNKNOWN', result_unknown: true, message: operation.error, operation_id: operation.operation_id };
      state.updated_at = new Date().toISOString();
      await this.saveState(state);
      const unknown = this.stateError('RESULT_UNKNOWN', `Geometry dispatch result is unknown; inspect operation ${operation.operation_id} before any retry`);
      unknown.operation_id = operation.operation_id;
      throw unknown;
    }
    let buildResult;
    try {
      buildResult = parseManagedResult(response);
    } catch (error) {
      const managed = error.managedResult;
      if (managed && !managed.rollback_unconfirmed && !managed.commit_unconfirmed && (managed.transaction_started===false || managed.rollback_confirmed===true)) {
        operation.status = 'failed_confirmed';
        operation.result = managed;
        operation.error = error.message;
        state.status = priorStatus;
        await this.saveState(state);
        throw error;
      }
      if (managed?.rollback_unconfirmed || managed?.commit_unconfirmed) {
        operation.status = 'result_unknown';
        operation.result = managed;
        state.status = 'recovery_required';
        state.recovery_error = error.message;
        state.transaction_result = managed;
        state.updated_at = new Date().toISOString();
        await this.saveState(state);
        throw new Error(`Managed transaction requires reconciliation (${error.code}): ${error.message}`);
      }
      operation.status = 'result_unknown';
      operation.completed_at = new Date().toISOString();
      operation.error = String(error.message || error);
      state.status = 'recovery_required';
      state.recovery_error = operation.error;
      state.transaction_result = { code: 'RESULT_UNKNOWN', result_unknown: true, message: operation.error, operation_id: operation.operation_id };
      state.updated_at = new Date().toISOString();
      await this.saveState(state);
      const unknown = this.stateError('RESULT_UNKNOWN', `Geometry dispatch result is unknown; inspect operation ${operation.operation_id} before any retry`);
      unknown.operation_id = operation.operation_id;
      throw unknown;
    }
    operation.status = 'result_known';
    operation.completed_at = new Date().toISOString();
    operation.result = buildResult;
    applyCommittedProgress(state, operation);
    state.pending_execution = pendingExecution(operation, buildResult);
    state.status = 'evidence_pending';
    await this.saveState(state);
    let evidenceStage = 'validation';
    try {
      state.complexity_warning = validatePhaseOutput(state, phase, buildResult) || null;
      let evidence;
      try { evidenceStage = 'evidence'; evidence = await this.automaticEvidence(state, phase.name, scriptPath, scriptHash, bridge, buildResult); }
      catch (e) { e.capturePending = !!state.pending_evidence; throw e; }
      evidenceStage = 'validation';
      const needsAudit = ['massing', 'archetypes', 'replication', 'facade_detail'].includes(phase.name);
      const audit = needsAudit ? JSON.parse(await fs.readFile(evidence.files.audit.path, 'utf8')) : null;
      if (phase.name === 'massing' && state.mode === 'single_image') {
        state.projection_subjects = validateProjectionAudit(state, audit);
        state.massing_summary = validateAntiSlabTowerAudit(state, audit);
        state.source_camera = evidence.camera_state;
      }
      const structure = validateStructureAudit(state, phase, audit);
      if (structure) state.structure = { ...(state.structure || {}), ...structure };
      if (phase.name === 'archetypes') {
        state.visible_detail_systems = validateDetailAudit(state, audit);
      }
      if (phase.name === 'facade_detail') {
        state.unique_details = validateUniqueDetailAudit(state, audit);
      }
      state.status = 'review_required';
      delete state.pending_evidence;
      state.updated_at = new Date().toISOString();
      await this.saveState(state);
      return { ok: true, project_id: state.project_id, phase: phase.name, status: state.status, operation_id: operation.operation_id, work_unit_id: state.work_unit?.id || null, task_card: taskCard(state, phase), ...evidence, review_sheet: evidence.files.review_sheet?.path || '', next_action: state.work_unit ? 'For an autonomous unit, another bounded managed step may use continue_work_unit=true; otherwise inspect evidence and review.' : 'Inspect the returned evidence yourself, then call sketchup_project_review with continue or revise.' };
    } catch (error) {
      if (error.capturePending && state.pending_evidence) {
        const category = classifyEvidenceFailure(error, 'evidence');
        state.status='evidence_pending';state.evidence_error=category;
        await this.saveState(state);
        throw new Error(`Geometry preserved, visual evidence is incomplete: ${error.message}. 下一步只能调 sketchup_project_retry_evidence；禁止重放建模。`);
      }
      if (state.status === 'recovery_required') throw error;
      // Geometry is already committed. Evidence/validation failure records a
      // blocked result and retains the cumulative expert work; automatic
      // remove_phase is only legal for an explicit, scoped compensation call.
      const category = classifyEvidenceFailure(error, evidenceStage);
      state.evidence_error = category;
      if (category.stage === 'validation') state.validation_failed = category;
      state.status = 'evidence_pending';
      state.updated_at = new Date().toISOString();
      await this.saveState(state);
      const blocked = new Error(`Geometry committed, but ${category.code} prevents review until evidence is repaired: ${category.message}`);
      blocked.code = category.code;
      blocked.committed = true;
      blocked.operation_id = operation.operation_id;
      throw blocked;
    }
  }

  async geometryDiagnose(input,bridge){
    const state=await this.loadState(safeId(input.project_id));
    await this.assertModelBinding(state,bridge);
    const result=parseManagedResult(await bridge('run_ruby',{code:this.rubyCall('geometry_diagnose',[state.project_id]),file:this.helperPath},60000));
    const file=path.join(this.projectDir(state.project_id),'geometry-diagnostic-'+Date.now()+'.json');
    await fs.writeFile(file,JSON.stringify(result,null,2));
    return {ok:true,project_id:state.project_id,root_exists:result.root_exists,diagnostic_path:file,phase_count:result.phases?.length||0,scope:result.scope};
  }

  async retryEvidence(input, bridge) {
    const state=await this.loadState(safeId(input.project_id));
    if (state.status === 'evidence_pending' && !state.pending_evidence && state.pending_execution) {
      await this.assertModelBinding(state, bridge);
      const execution = state.pending_execution;
      if (await hashFile(execution.script_path) !== execution.script_hash) throw this.stateError('RECOVERY_SCRIPT_CHANGED', 'Recorded build source changed; do not replay it');
      const phase = (state.phase_plan || PHASES)[state.step_index];
      if (!phase || phase.name !== execution.phase) throw this.stateError('RECOVERY_PHASE_MISMATCH', 'Receipt phase does not match current project');
      const evidence = await this.automaticEvidence(state, phase.name, execution.script_path, execution.script_hash, bridge, execution.build_result);
      try {
        state.complexity_warning = validatePhaseOutput(state, phase, execution.build_result) || null;
        const audit = JSON.parse(await fs.readFile(evidence.files.audit.path, 'utf8'));
        if (phase.name === 'massing' && state.mode === 'single_image') { state.projection_subjects = validateProjectionAudit(state, audit); state.massing_summary = validateAntiSlabTowerAudit(state, audit); state.source_camera = evidence.camera_state; }
        const structure = validateStructureAudit(state, phase, audit);
        if (structure) state.structure = { ...(state.structure || {}), ...structure };
        if (phase.name === 'archetypes') state.visible_detail_systems = validateDetailAudit(state, audit);
        if (phase.name === 'facade_detail') state.unique_details = validateUniqueDetailAudit(state, audit);
        delete state.validation_failed;
        delete state.structure_error;
      } catch (error) {
        state.validation_failed = { phase: phase.name, kind: 'structure', evidence_id: evidence.evidence_id, message: error.message };
        state.structure_error = error.message;
      }
      state.status = 'review_required';
      delete state.pending_evidence;
      delete state.recovery_error;
      await this.saveState(state);
      return { ok: !state.validation_failed, project_id: state.project_id, status: state.status, ...evidence, validation_failed: state.validation_failed || null, next_action: state.validation_failed ? 'Revise the failed phase; continue is blocked.' : 'Inspect fresh evidence and review the recovered operation. No geometry was replayed.' };
    }
    if (state.status === 'recovery_required' && state.transaction_result?.code === 'PATCH_EVIDENCE_CAPTURE_FAILED' && state.patch_recovery) {
      const current = await this.assertModelBinding(state, bridge);
      const recovery = state.patch_recovery;
      const dir = path.join(this.projectDir(state.project_id), 'patch-previews', `${recovery.patch_id}-recovery-${Date.now().toString(36)}`);
      await fs.mkdir(dir, { recursive: true });
      const auditPath = path.join(dir, 'after-audit.json');
      const referencePath = path.join(dir, 'after-reference.png');
      try {
        parseManagedResult(await bridge('run_ruby', { code: this.rubyCall('export_project_audit', [state.project_id, auditPath.replaceAll('\\', '/')]), file: this.helperPath }, 120000));
        parseManagedResult(await bridge('run_ruby', { code: this.rubyCall('capture_reference', [state.project_id, referencePath.replaceAll('\\', '/')]), file: this.helperPath }, 120000));
        if (!fsSync.existsSync(referencePath) || (await fs.stat(referencePath)).size <= 0) throw this.stateError('PATCH_EVIDENCE_CAPTURE_FAILED', 'Patch evidence retry did not deliver a nonzero visual file');
        const evidence = await this.writeEvidence(state, { schema_version: 1, evidence_id: `patch_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`, project_id: state.project_id, phase: recovery.phase, record_type: 'patch_applied', created_at: new Date().toISOString(), patch_preview_id: recovery.patch_id, target_semantic_id: recovery.target_semantic_id, scope: recovery.scope, change: recovery.change, reason: recovery.reason, scene_revision: recovery.applied_scene_revision, model_binding: current, files: { audit: await fileEvidence(auditPath), reference: await fileEvidence(referencePath) }, visual: 'unverified' });
        const operation = (state.operation_journal || []).find((item) => item.operation_id === state.transaction_result.operation_id);
        if (operation) { operation.status = 'completed_evidence_recovered'; operation.completed_at = new Date().toISOString(); operation.result = { evidence_id: evidence.record.evidence_id }; }
        state.model_binding = current;
        state.patch_review = { patch_id: recovery.patch_id, phase: recovery.phase, return_status: recovery.return_status, target_semantic_id: recovery.target_semantic_id, scope: recovery.scope, original_transform: recovery.original_transform, after_target_fingerprint: recovery.after_target_fingerprint, evidence_id: evidence.record.evidence_id, previous_evidence_id: recovery.previous_evidence_id || '', applied_scene_revision: recovery.applied_scene_revision };
        delete state.patch_recovery;
        delete state.recovery_error;
        delete state.transaction_result;
        state.status = 'review_required';
        state.updated_at = new Date().toISOString();
        await this.saveState(state);
        return { ok: true, project_id: state.project_id, status: state.status, patch_id: recovery.patch_id, evidence_id: evidence.record.evidence_id, evidence_path: evidence.path, next_action: 'Inspect the recovered patch evidence and submit an explicit review; no geometry was replayed.' };
      } catch (error) {
        state.recovery_error = String(error.message || error);
        state.updated_at = new Date().toISOString();
        await this.saveState(state);
        throw error;
      }
    }
    if (state.status === 'review_required' && state.recovery_recapture_required && !state.pending_evidence) {
      const current = await this.assertModelBinding(state, bridge);
      const dir = path.join(this.projectDir(state.project_id), 'final-recapture', Date.now().toString(36));
      await fs.mkdir(dir, { recursive: true });
      const auditPath = path.join(dir, 'final-audit.json');
      const referencePath = path.join(dir, 'final-reference.png');
      parseManagedResult(await bridge('run_ruby', { code: this.rubyCall('export_project_audit', [state.project_id, auditPath.replaceAll('\\', '/')]), file: this.helperPath }, 120000));
      const audit = JSON.parse(await fs.readFile(auditPath, 'utf8'));
      validateAuditReadback(audit);
      const recapturePlan = state.phase_plan || PHASE_PLANS[state.mode] || PHASES;
      const phase = state.recapture_phase || recapturePlan[Math.min(state.step_index,recapturePlan.length-1)]?.name || state.phase;
      if (state.recapture_basis) {
        await verifyEvidenceFiles({basis:state.recapture_basis});
        const basis = JSON.parse(await fs.readFile(state.recapture_basis.path,'utf8'));
        if (state.recapture_exact) {
          if (checkpointContent(basis) !== checkpointContent(audit)) throw this.stateError('RECAPTURE_SCOPE_CONFLICT','Restored scene changed before recapture');
        } else assertRecaptureScope(basis,audit,phase);
      }
      parseManagedResult(await bridge('run_ruby', { code: this.rubyCall('capture_reference', [state.project_id, referencePath.replaceAll('\\', '/')]), file: this.helperPath }, 120000));
      if (!fsSync.existsSync(referencePath) || (await fs.stat(referencePath)).size <= 0) throw this.stateError('EVIDENCE_CAPTURE_FAILED', 'Final recapture did not deliver a nonzero visual file');
      const isFinal = state.step_index >= (state.phase_plan || PHASE_PLANS[state.mode] || PHASES).length;
      const files = {audit:await fileEvidence(auditPath),reference:await fileEvidence(referencePath)};
      const geometry = parseManagedResult(await bridge('run_ruby',{code:this.rubyCall('capture_geometry_views',[state.project_id,phase,dir.replaceAll('\\','/')]),file:this.helperPath},120000));
      for (const view of geometry.views || []) files['geometry_'+view.label] = await fileEvidence(view.path);
      if (['archetypes','facade_detail'].includes(phase)) {
        const detail = parseManagedResult(await bridge('run_ruby',{code:this.rubyCall(phase==='archetypes'?'capture_archetype_views':'capture_detail_views',[state.project_id,dir.replaceAll('\\','/')]),file:this.helperPath},120000));
        for (const [i,file] of (detail.paths || []).entries()) files['detail_'+i] = await fileEvidence(file);
      }
      const afterPath = path.join(dir,'post-capture-audit.json');
      parseManagedResult(await bridge('run_ruby',{code:this.rubyCall('export_project_audit',[state.project_id,afterPath.replaceAll('\\','/')]),file:this.helperPath},120000));
      if (auditContent(audit) !== auditContent(JSON.parse(await fs.readFile(afterPath,'utf8')))) throw this.stateError('EVIDENCE_MODEL_CHANGED','Scene or camera changed during recapture');
      const currentPhase = !isFinal && state.recapture_return_status !== 'ready_for_step';
      const evidence = await this.writeEvidence(state, { schema_version: 1, evidence_id: `recapture_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`, project_id: state.project_id, phase: isFinal ? 'finish' : phase, record_type: isFinal ? 'final_recapture' : currentPhase ? 'phase_evidence' : 'continuation_recapture', created_at: new Date().toISOString(), scene_revision: Number(state.scene_revision || 0), model_binding: current, files, visual: 'unverified', geometry_readback: 'unverified', missing_machine_inputs:['geometry_measurements','geometry_dependencies'], note:'Fresh audit and views only; historical geometric measurements were not relabelled.' });
      if (!isFinal) {
        try {
          if(phase==='massing' && state.mode==='single_image') {
            state.projection_subjects=validateProjectionAudit(state,audit);
            state.massing_summary=validateAntiSlabTowerAudit(state,audit);
            state.source_camera=audit.camera;
          }
          const structure=validateStructureAudit(state,{name:phase},audit);
          if(structure)state.structure={...(state.structure||{}),...structure};
          if(phase==='archetypes')state.visible_detail_systems=validateDetailAudit(state,audit);
          if(phase==='facade_detail')state.unique_details=validateUniqueDetailAudit(state,audit);
          delete state.validation_failed;
          delete state.structure_error;
        }
        catch(error){state.validation_failed={phase,kind:'structure',message:error.message,evidence_id:evidence.record.evidence_id};}
      }
      if (currentPhase) { delete state.recapture_return_status; delete state.recapture_phase; }
      delete state.recapture_basis;
      delete state.recapture_exact;
      delete state.recovery_recapture_required;
      delete state.recovery_error;
      await this.saveState(state);
      return { ok: true, project_id: state.project_id, status: state.status, evidence_id: evidence.record.evidence_id, evidence_path: evidence.path, files, missing_machine_inputs:evidence.record.missing_machine_inputs, next_action: 'Inspect fresh views and review this evidence_id. No geometry was rebuilt; missing measurements remain unverified.' };
    }
    if((state.status!=='evidence_pending' && !(state.status==='review_required' && state.recovery_recapture_required)) || !state.pending_evidence) throw new Error('No pending evidence; geometry cannot be replayed by this tool');
    if (state.recovery_recapture_required) state.status = 'evidence_pending';
    await this.assertModelBinding(state,bridge);
    const pending=state.pending_evidence;
    // The first capture attempt may already have sealed the phase checkpoint
    // before a later viewport step failed. Reuse that verified file on retry;
    // dispatching another save_copy would violate the one-save recovery rule.
    if (pending.checkpoint) state.recovered_checkpoint = pending.checkpoint;
    for(const file of [pending.checkpoint,pending.audit]) if(await hashFile(file.path)!==file.sha256) throw new Error('Pending evidence integrity mismatch');
    if(await hashFile(pending.script_path)!==pending.script_hash) throw new Error('Build source changed since checkpoint');
    const phase=(state.phase_plan || PHASE_PLANS[state.mode] || PHASES)[state.step_index];
    if(phase.name!==pending.phase) throw new Error('Pending phase mismatch');
    const livePath=path.join(this.projectDir(state.project_id),'retry-live-audit.json');
    parseManagedResult(await bridge('run_ruby',{code:this.rubyCall('export_project_audit',[state.project_id,livePath.replaceAll('\\','/')]),file:this.helperPath},120000));
    const live=JSON.parse(await fs.readFile(livePath,'utf8'));const prior=JSON.parse(await fs.readFile(pending.audit.path,'utf8'));
    if (pending.consistency_retry) {
      // The initial capture itself observed a scene transition. Permit only the
      // existing mutable-phase recapture route; protected content remains exact.
      assertRecaptureScope(prior, live, phase.name);
    } else if(canonical(live.root)!==canonical(prior.root)) {
      throw new Error('Live geometry changed since pending capture; refusing automatic approval');
    }
    state.complexity_warning = validatePhaseOutput(state,phase,pending.build_result) || null;
    let evidence;
    try { evidence=await this.automaticEvidence(state,phase.name,pending.script_path,pending.script_hash,bridge,pending.build_result); }
    catch(error) { if(state.status==='recovery_required') throw error; state.status='evidence_pending';state.evidence_error=error.message;await this.saveState(state);throw new Error(`取证仍未完成：${error.message}。下一步只能调 sketchup_project_retry_evidence；禁止重放建模。`); }
    const audit=JSON.parse(await fs.readFile(evidence.files.audit.path,'utf8'));
    try {
      if(phase.name==='massing' && state.mode==='single_image') {
        state.projection_subjects=validateProjectionAudit(state,audit);state.massing_summary=validateAntiSlabTowerAudit(state,audit);state.source_camera=evidence.camera_state;
      }
      const structure=validateStructureAudit(state,phase,audit);
      if(structure) state.structure={...(state.structure||{}),...structure};
      if(phase.name==='archetypes') state.visible_detail_systems=validateDetailAudit(state,audit);
      if(phase.name==='facade_detail') state.unique_details=validateUniqueDetailAudit(state,audit);
    } catch (error) {
      state.status = 'review_required';
      state.structure_error = String(error.message || error);
      state.validation_failed = { phase: phase.name, kind: 'structure', evidence_id: evidence.evidence_id, message: state.structure_error, recorded_at: new Date().toISOString() };
      delete state.pending_evidence;
      state.updated_at = new Date().toISOString();
      await this.saveState(state);
      throw new Error(`Capture succeeded but structure validation requires correction: ${error.message}. Review the captured evidence and revise the phase; geometry was not replayed.`);
    }
    state.status='review_required';delete state.pending_evidence;delete state.evidence_error;delete state.recovery_recapture_required;delete state.validation_failed;delete state.structure_error;
    await this.saveState(state);
    return {ok:true,project_id:state.project_id,status:state.status,phase:phase.name,task_card:taskCard(state,phase),...evidence,review_sheet:evidence.files.review_sheet?.path || '',next_action:'Inspect the sealed visual evidence and submit an explicit review. No geometry was rebuilt.'};
  }

  async review(input, bridge) {
    if(input.quality_review!==undefined && input.visual_review!==undefined)throw this.stateError('REVIEW_INPUT_CONFLICT','Supply quality_review or visual_review, not both');
    const state = await this.loadState(safeId(input.project_id));
    if (state.status !== 'review_required') throw new Error(`Project is ${state.status}; no phase is awaiting review`);
    if (state.recovery_recapture_required) {
      return { ok: true, project_id: state.project_id, status: state.status, recapture_required: true, next_action: 'Call sketchup_project_retry_evidence, then inspect and review its new evidence_id.' };
    }
    if (state.work_unit && input.work_unit_id && String(input.work_unit_id) !== state.work_unit.id) throw new Error('WORK_UNIT_MISMATCH');
    const currentModel = await this.assertModelBinding(state, bridge);
    if (input.evidence_id !== state.last_evidence_id) throw new Error('Only the latest evidence can advance or revise the project');
    const sealedEvidence = await this.verifyEvidence(state, input.evidence_id, currentModel);
    try { await this.assertEvidenceCurrent(state, sealedEvidence, bridge); }
    catch (error) {
      if (error.code !== 'EVIDENCE_MODEL_CHANGED' || !error.liveAudit) throw error;
      const phase = (state.phase_plan || PHASES)[state.step_index]?.name;
      if (!phase || state.patch_review) throw error;
      assertRecaptureScope(error.recordedAudit, error.liveAudit, phase);
      if (input.verdict !== 'revise') {
        state.recapture_phase = phase;
        state.recapture_return_status = 'review_required';
        state.recapture_basis = sealedEvidence.record.files.audit;
        state.recovery_recapture_required = true;
        await this.saveState(state);
        error.message += '; call sketchup_project_retry_evidence, then review the new evidence_id';
        throw error;
      }
      // Explicit revise may remove only the current phase after this scope check.
    }
    const verdict = String(input.verdict || '');
    const phasePlan = state.phase_plan || PHASE_PLANS[state.mode] || PHASES;
    const patchReview = state.patch_review || null;
    const finalReview = ['final_recapture','continuation_recapture'].includes(sealedEvidence.record.record_type);
    const phase = patchReview ? { name: patchReview.phase, hint: 'Inspect the patch result and continue the existing managed phase.' } : finalReview ? { name: sealedEvidence.record.phase, hint: 'Review the fresh evidence before continuing.' } : phasePlan[state.step_index];
    if (!phase) throw new Error('No review phase is bound to the current project state');
    if (!['continue', 'revise'].includes(verdict)) throw new Error("verdict must be 'continue' or 'revise'");
    if (verdict === 'continue' && state.validation_failed) {
      const error = this.stateError('VALIDATION_FAILED', `The latest evidence failed ${state.validation_failed.kind || 'phase'} validation; revise the phase before continue`);
      error.validation_failed = state.validation_failed;
      throw error;
    }
    const prepared = input.visual_review!==undefined ? await assembleVisualReview(input,state,phase.name,sealedEvidence.record) : input;
    const qualityReview = await validateQualityReview(prepared, state, phase.name, this.skillRoot, input.visual_review!==undefined ? sealedEvidence.record.files : null);
    if (verdict === 'continue') validateInspectedViews(qualityReview, sealedEvidence.record);
    await this.writeEvidence(state, {
      schema_version: 1,
      evidence_id: `decision_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`,
      project_id: state.project_id,
      phase: phase.name,
      created_at: new Date().toISOString(),
      record_type: 'agent_review_decision',
      reviewed_evidence_id: input.evidence_id,
      verdict,
      note: String(input.note || ''),
      quality_review: qualityReview,
      complexity_warning: state.complexity_warning || null,
    });
    if (patchReview) {
      if (verdict === 'revise') {
        const rollback = await this.rollbackPatch(state.project_id, { patch_id: patchReview.patch_id }, bridge);
        return { ok: true, project_id: state.project_id, status: rollback.status, patch_id: patchReview.patch_id, next_action: rollback.next_action };
      }
      const returnStatus = patchReview.return_status;
      state.quality_reviews = [...(state.quality_reviews || []), { phase: phase.name, evidence_id: input.evidence_id, patch_id: patchReview.patch_id, state: qualityReview.state, checks: (qualityReview.checks || []).map(({kind,state}) => ({kind,state})), geometry_readback: 'unverified' }];
      delete state.patch_review;
      state.status = returnStatus;
      state.updated_at = new Date().toISOString();
      await this.saveState(state);
      return { ok: true, project_id: state.project_id, status: state.status, patch_id: patchReview.patch_id, next_action: state.status === 'ready_to_finish' ? 'Call sketchup_project_finish after the accepted patch.' : 'Inspect project status before the next managed write.' };
    }
    if (finalReview) {
      if (verdict === 'continue') {
        const audit = JSON.parse(await fs.readFile(sealedEvidence.record.files.audit.path, 'utf8'));
        if (sealedEvidence.record.record_type === 'final_recapture') validateFinalAudit(state, audit, phasePlan.map((item) => item.name));
        else validateStructureAudit(state, phase, audit);
        state.quality_reviews = [...(state.quality_reviews || []), { phase: phase.name, evidence_id: input.evidence_id, state: qualityReview.state, checks: (qualityReview.checks || []).map(({kind,state}) => ({kind,state})), geometry_readback: 'unverified' }];
        state.status = state.recapture_return_status || 'ready_to_finish';
        if (state.status === 'review_required') state.last_evidence_id = input.evidence_id;
        delete state.recapture_return_status;
        delete state.recapture_phase;
      } else {
        state.last_evidence_id = input.evidence_id;
      }
      state.updated_at = new Date().toISOString();
      await this.saveState(state);
      return { ok: true, project_id: state.project_id, status: state.status, next_action: verdict === 'continue' ? (state.status==='ready_for_step' ? 'Continue with the existing next phase using sketchup_project_step.' : 'Call sketchup_project_finish; the final evidence was reviewed without rebuilding geometry.') : 'Review rejected. Use revise_from for the affected accepted phase.' };
    }
    if (verdict === 'revise') {
      state.revision_attempts={...(state.revision_attempts||{}),[phase.name]:Number(state.revision_attempts?.[phase.name]||0)+1};
      if (state.assistance_mode === 'autonomous') {
        // A work-unit review cannot erase the whole phase container: it may
        // include accepted wall/window objects from earlier appends. Keep the
        // committed scene and require a scoped update/replace operation on the
        // next call. The existing patch/revise_from routes remain explicit
        // alternatives when their write scope is proven.
        state.revision_required = { phase: phase.name, evidence_id: input.evidence_id, reason: String(input.note || 'review requested revision'), requested_at: new Date().toISOString() };
        state.status = 'review_required';
        state.updated_at = new Date().toISOString();
        await this.saveState(state);
        return { ok: true, project_id: state.project_id, status: state.status, phase: phase.name, revision_required: state.revision_required, next_action: 'Submit a scoped autonomous update or replace for this work unit; no committed geometry was deleted.' };
      }
      const response = await this.dispatchAuxiliaryWrite(state, 'remove_phase', [state.project_id, phase.name], bridge);
      parseManagedResult(response);
      if (phase.name === 'archetypes') delete state.visible_detail_systems;
      if (phase.name === 'facade_detail') delete state.unique_details;
      delete state.validation_failed;
      delete state.structure_error;
      state.status = 'ready_for_step';
      state.updated_at = new Date().toISOString();
      await this.saveState(state);
      return { ok: true, project_id: state.project_id, status: state.status, task_card: taskCard(state, phase), next_action: `Rebuild ${phase.name}. ${phase.hint}` };
    }
    const mergedEvidenceIds=[...(state.pending_unit_reviews || []), input.evidence_id];
    const mergedCoverage=[];
    const historyGaps=[];
    for (const evidenceId of mergedEvidenceIds) {
      try {
        const item = (evidenceId === input.evidence_id)
          ? sealedEvidence.record
          : (await this.verifyEvidence(state, evidenceId, null, { verifyFiles: false })).record;
        if (item.phase) mergedCoverage.push({ phase: item.phase, evidence_id: evidenceId, provenance: evidenceId === input.evidence_id ? 'current' : 'verified_history' });
      } catch (error) {
        historyGaps.push({ evidence_id: evidenceId, code: error.code || 'HISTORY_UNAVAILABLE', message: String(error.message || error) });
      }
    }
    state.quality_reviews = [...(state.quality_reviews || []), { phase: phase.name, evidence_id: input.evidence_id, merged_evidence_ids: mergedEvidenceIds, merged_coverage: mergedCoverage, history_gaps: historyGaps, work_unit_id: state.work_unit?.id || null, state: qualityReview.state, checks: (qualityReview.checks || []).map(({kind,state}) => ({kind,state})), geometry_readback: 'unverified' }];
    delete state.pending_unit_reviews;
    delete state.complexity_warning;
    state.step_index += 1;
    state.updated_at = new Date().toISOString();
    if (state.step_index >= phasePlan.length) {
      state.phase = 'complete';
      state.status = 'ready_to_finish';
      await this.saveState(state);
      return { ok: true, project_id: state.project_id, status: state.status, next_action: 'Call sketchup_project_finish to save, audit and seal the evidence chain.' };
    }
    state.phase = phasePlan[state.step_index].name;
    state.status = 'ready_for_step';
    await this.saveState(state);
    return { ok: true, project_id: state.project_id, phase: state.phase, status: state.status, review_checks:{state:qualityReview.state,scope:qualityReview.scope,geometry_readback:qualityReview.geometry_readback,checks:qualityReview.checks?.map(({kind,state,reason})=>({kind,state,reason}))}, task_card: taskCard(state,phasePlan[state.step_index]), next_action: phasePlan[state.step_index].hint };
  }


  async reviseFrom(input, bridge) {
    const state = await this.loadState(safeId(input.project_id));
    const allowed = new Set(['ready_for_step','review_required','ready_to_finish']);
    if (!allowed.has(state.status)) {
      if (state.status === 'evidence_pending') throw new Error('Cannot revise upstream while evidence_pending; next action must be sketchup_project_retry_evidence.');
      throw new Error(`Cannot revise upstream while project is ${state.status}.`);
    }
    await this.assertModelBinding(state, bridge);
    const plan = state.phase_plan || PHASE_PLANS[state.mode] || PHASES;
    const targetName = String(input.target_phase || '').trim();
    const targetIndex = plan.findIndex((item) => item.name === targetName);
    if (targetIndex < 0) throw new Error(`Unknown target_phase '${targetName}' for this project route.`);
    const acceptedCount = state.status === 'ready_to_finish' ? plan.length : state.step_index;
    if (targetIndex >= acceptedCount) throw new Error('target_phase must be an already accepted upstream phase; revise the current pending phase with sketchup_project_review(verdict=revise).');
    const reason = String(input.reason || '').trim();
    if (reason.length < 8) throw new Error('reason must identify the observed upstream defect in at least 8 characters.');
    const materializedEnd = state.status === 'review_required' ? state.step_index : acceptedCount - 1;
    const affected = plan.slice(targetIndex, materializedEnd + 1).map((item) => item.name);
    if (!affected.length) throw new Error('No accepted phase geometry is available to revise.');
    const revisionId = `revision_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
    const revisionDir = path.join(this.projectDir(state.project_id), 'managed-revisions', revisionId);
    await fs.mkdir(revisionDir, {recursive:true});
    const checkpointPath = path.join(revisionDir, 'before-revision.skp');
    const auditPath = path.join(revisionDir, 'before-revision-audit.json');
    try {
      parseManagedResult(await this.dispatchAuxiliaryWrite(state, 'save_copy', [state.project_id,checkpointPath.replaceAll('\\','/')], bridge));
      if (!fsSync.existsSync(checkpointPath) || (await fs.stat(checkpointPath)).size <= 0) throw new Error('Revision checkpoint did not produce a nonzero SKP.');
      parseManagedResult(await bridge('run_ruby', {code:this.rubyCall('export_project_audit',[state.project_id,auditPath.replaceAll('\\','/')]),file:this.helperPath},120000));
      if (!fsSync.existsSync(auditPath) || (await fs.stat(auditPath)).size <= 0) throw new Error('Revision audit was not written.');
      const removalOrder = [...affected].reverse();
      const removal = parseManagedResult(await this.dispatchAuxiliaryWrite(state, 'remove_phases', [state.project_id,JSON.stringify(removalOrder)], bridge, {purpose:'upstream_revision',affected,targetIndex,targetName,reason,revisionId,checkpointPath,auditPath}));
      const removed = new Set((removal.removed || []).map(String));
      const missing = affected.filter((name) => !removed.has(name));
      if (missing.length) throw new Error(`SketchUp did not confirm removal of materialized phases: ${missing.join(', ')}`);
      const invalidated = (state.quality_reviews || []).filter((review) => affected.includes(review.phase));
      state.quality_reviews = (state.quality_reviews || []).filter((review) => !affected.includes(review.phase));
      state.invalidated_reviews = [...(state.invalidated_reviews || []), ...invalidated.map((review) => ({...review, invalidated_by:revisionId, invalidated_at:new Date().toISOString(), reason}))];
      if (affected.some((name) => ['massing','source_alignment'].includes(name))) {
        delete state.projection_subjects; delete state.massing_summary; delete state.source_camera;
      }
      if (affected.includes('archetypes')) { delete state.visible_detail_systems; delete state.structure; }
      else if (affected.includes('replication') && state.structure) delete state.structure.replication_systems;
      if (affected.includes('facade_detail')) delete state.unique_details;
      delete state.pending_evidence; delete state.evidence_error; delete state.complexity_warning;
      state.last_checkpoint = null;
      state.step_index = targetIndex;
      state.phase = plan[targetIndex].name;
      state.status = 'ready_for_step';
      state.updated_at = new Date().toISOString();
      const record = {schema_version:1,evidence_id:`revise_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`,project_id:state.project_id,record_type:'upstream_revision',created_at:state.updated_at,target_phase:targetName,affected_phases:affected,removal_order:removalOrder,reason,checkpoint:await fileEvidence(checkpointPath),audit:await fileEvidence(auditPath),invalidated_reviews:invalidated.map((item)=>({phase:item.phase,evidence_id:item.evidence_id}))};
      const sealed = await this.writeEvidence(state, record);
      state.revision_history = [...(state.revision_history || []), {revision_id:revisionId,target_phase:targetName,affected_phases:affected,reason,checkpoint_path:checkpointPath,evidence_path:sealed.path,created_at:state.updated_at,status:'applied'}];
      await this.saveState(state);
      return {ok:true,project_id:state.project_id,status:state.status,phase:state.phase,revision_id:revisionId,affected_phases:affected,invalidated_review_count:invalidated.length,rollback_checkpoint:checkpointPath,evidence_path:sealed.path,task_card:taskCard(state,plan[targetIndex]),next_action:`Rebuild ${targetName} from the corrected abstraction; only downstream affected phases were removed.`};
    } catch (error) {
      state.status = 'recovery_required';
      state.recovery_error = `Upstream revision unconfirmed: ${error.message}`;
      state.revision_history = [...(state.revision_history || []), {revision_id:revisionId,target_phase:targetName,affected_phases:affected,reason,checkpoint_path:fsSync.existsSync(checkpointPath)?checkpointPath:'',created_at:new Date().toISOString(),status:'unconfirmed',error:error.message}];
      state.updated_at = new Date().toISOString();
      await this.saveState(state);
      throw new Error(`${state.recovery_error}. Preserve the revision checkpoint and inspect the active document before any write.`);
    }
  }

  async patch(input, bridge) {
    const action = String(input.action || '').trim();
    if (!['preview', 'apply', 'rollback'].includes(action)) throw Object.assign(new Error('PATCH_ACTION_REQUIRED'), { code: 'PATCH_ACTION_REQUIRED' });
    const projectId = safeId(input.project_id);
    const state = await this.loadState(projectId);
    const previewRecovery = action === 'preview' && state.status === 'recovery_required';
    if ((!['ready_for_step', 'review_required', 'ready_to_finish'].includes(state.status) && !previewRecovery) || (state.recovery_error && action !== 'preview')) {
      throw Object.assign(new Error(`Object patch is unavailable while project is ${state.status}`), { code: 'PATCH_STATE_NOT_EDITABLE' });
    }
    if (action === 'rollback') return this.rollbackPatch(projectId, input, bridge);
    const targetSemanticId = String(input.target_semantic_id || '').trim();
    if (!targetSemanticId) throw Object.assign(new Error('PATCH_TARGET_REQUIRED'), { code: 'PATCH_TARGET_REQUIRED' });
    const scope = patchScope(input.scope);
    const change = patchChange(input.change);
    const reason = String(input.reason || '').trim();
    if (reason.length < 8) throw Object.assign(new Error('PATCH_REASON_REQUIRED'), { code: 'PATCH_REASON_REQUIRED' });
    const targetPhase = String(input.target_phase || state.phase || '').trim();
    if (!targetPhase) throw Object.assign(new Error('PATCH_PHASE_REQUIRED'), { code: 'PATCH_PHASE_REQUIRED' });
    if (action === 'preview') {
      const binding = await this.assertModelBinding(state, bridge);
      const target = parseManagedResult(await bridge('run_ruby', { code: this.rubyCall('patch_preview', [projectId, targetSemanticId, scope, JSON.stringify(change)]), file: this.helperPath }, 120000));
      const baseStateRevision = Number(state.state_revision || 0);
      const previewId = crypto.createHash('sha256').update(canonical({ project_id: projectId, base_state_revision: baseStateRevision, target_semantic_id: targetSemanticId, target_phase: targetPhase, scope, change, reason, protected_objects: Array.isArray(input.preserve_semantic_ids) ? input.preserve_semantic_ids.map(String) : [], target_fingerprint: target.target_fingerprint })).digest('hex');
      const preview = { schema_version: 1, preview_id: previewId, project_id: projectId, base_state_revision: baseStateRevision, target_phase: targetPhase, target_semantic_id: targetSemanticId, scope, change, reason, model_binding: binding, target, protected_objects: Array.isArray(input.preserve_semantic_ids) ? input.preserve_semantic_ids.map(String) : [], invalidated_evidence_ids: state.last_evidence_id ? [state.last_evidence_id] : [], write_set: { target_semantic_ids: [targetSemanticId], operation: 'instance_transform', definition_scope: 'instance' }, recovery_strategy: 'restore the recorded local transformation only after target fingerprint and state revision still match', created_at: new Date().toISOString() };
      preview.previous_evidence_id = state.last_evidence_id || '';
      const dir = path.join(this.projectDir(projectId), 'patch-previews');
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, `${previewId}.json`), JSON.stringify(preview, null, 2), { encoding: 'utf8', mode: 0o600, flag: 'wx' }).catch((error) => { if (error.code !== 'EEXIST') throw error; });
      return { ok: true, action, preview_id: previewId, project_id: projectId, base_state_revision: baseStateRevision, target: preview.target, write_set: preview.write_set, protected_objects: preview.protected_objects, invalidated_evidence_ids: preview.invalidated_evidence_ids, recovery_strategy: preview.recovery_strategy, requires_apply_confirmation: true, live_sketchup: 'target inspection only; no geometry changed' };
    }
    const previewId = String(input.preview_id || '').trim();
    if (!/^[a-f0-9]{64}$/i.test(previewId)) throw Object.assign(new Error('PATCH_PREVIEW_REQUIRED'), { code: 'PATCH_PREVIEW_REQUIRED' });
    return this.withProjectLock(projectId, async () => {
      const fresh = await this.loadState(projectId);
      const previewPath = path.join(this.projectDir(projectId), 'patch-previews', `${previewId}.json`);
      let preview;
      try { preview = JSON.parse(await fs.readFile(previewPath, 'utf8')); } catch (error) { throw Object.assign(new Error('Patch preview not found'), { code: 'PATCH_PREVIEW_NOT_FOUND', cause: error }); }
      if (fresh.state_revision !== preview.base_state_revision || fresh.status !== state.status) throw Object.assign(new Error('Patch preview is stale; reload state and preview again'), { code: 'PATCH_PREVIEW_STALE' });
      if (preview.target_semantic_id !== targetSemanticId || preview.scope !== scope || canonical(preview.change) !== canonical(change)) throw Object.assign(new Error('Patch input does not match the preview'), { code: 'PATCH_PREVIEW_MISMATCH' });
      if (preview.protected_objects?.map(String).includes(targetSemanticId)) throw Object.assign(new Error('PATCH_TARGET_PROTECTED: the requested target is explicitly preserved; no write was attempted'), { code: 'PATCH_TARGET_PROTECTED' });
      const binding = await this.assertModelBinding(fresh, bridge);
      const unresolved = await this.unresolvedDocumentOperation(binding, projectId);
      if (unresolved) throw this.stateError('DOCUMENT_WRITE_UNCERTAIN', `The bound SketchUp document has an unresolved write for project ${unresolved.project_id}; no patch write is permitted`);
      const current = parseManagedResult(await bridge('run_ruby', { code: this.rubyCall('patch_preview', [projectId, targetSemanticId, scope, JSON.stringify(change)]), file: this.helperPath }, 120000));
      if (current.target_fingerprint !== preview.target.target_fingerprint) throw Object.assign(new Error('Patch target changed after preview; no write was attempted'), { code: 'PATCH_TARGET_CHANGED' });
      const operation = { operation_id: crypto.randomUUID(), kind: 'patch', project_id: projectId, target_semantic_id: targetSemanticId, scope, preview_id: previewId, dispatched_at: new Date().toISOString(), status: 'dispatched' };
      fresh.operation_journal = [...(Array.isArray(fresh.operation_journal) ? fresh.operation_journal : []), operation].slice(-32);
      const priorStatus = fresh.status;
      fresh.status = 'patch_in_progress';
      await this.saveState(fresh);
      let applied;
      try {
        applied = parseManagedResult(await this.withDocumentWriteLock(binding, () => bridge('run_ruby', { code: this.rubyCall('patch_apply', [projectId, targetSemanticId, scope, JSON.stringify(change)]), file: this.helperPath }, 120000)));
        operation.status = 'completed';
        operation.result = applied;
      } catch (error) {
        operation.status = ['DOCUMENT_WRITE_BUSY','DOCUMENT_WRITE_UNCERTAIN'].includes(error.code) ? 'not_dispatched' : error.managedResult && !error.managedResult.commit_unconfirmed && !error.managedResult.rollback_unconfirmed ? 'failed_confirmed' : 'result_unknown';
        operation.error = String(error.message || error);
        if (operation.status === 'result_unknown') {
          fresh.status = 'recovery_required';
          fresh.recovery_error = operation.error;
          fresh.transaction_result = { code: 'RESULT_UNKNOWN', result_unknown: true, operation_id: operation.operation_id, message: operation.error };
        } else fresh.status = priorStatus;
        await this.saveState(fresh);
        throw error;
      }
      const revision = Number(fresh.scene_revision || 0) + 1;
      fresh.scene_revision = revision;
      fresh.patch_recovery = { patch_id: previewId, phase: targetPhase, return_status: priorStatus, target_semantic_id: targetSemanticId, scope, original_transform: applied.original_transform, after_target_fingerprint: applied.after_target_fingerprint, previous_evidence_id: preview.previous_evidence_id || '', applied_scene_revision: revision, binding, change, reason };
      await this.saveState(fresh);
      const auditPath = path.join(this.projectDir(projectId), 'patch-previews', `${previewId}-after-audit.json`);
      const referencePath = path.join(this.projectDir(projectId), 'patch-previews', `${previewId}-after-reference.png`);
      let evidence;
      try {
        parseManagedResult(await bridge('run_ruby', { code: this.rubyCall('export_project_audit', [projectId, auditPath.replaceAll('\\', '/')]), file: this.helperPath }, 120000));
        parseManagedResult(await bridge('run_ruby', { code: this.rubyCall('capture_reference', [projectId, referencePath.replaceAll('\\', '/')]), file: this.helperPath }, 120000));
        if (!fsSync.existsSync(referencePath) || (await fs.stat(referencePath)).size <= 0) throw this.stateError('PATCH_EVIDENCE_CAPTURE_FAILED', 'Patch committed but no nonzero visual evidence was delivered; preserve the result and retry evidence before review');
        evidence = await this.writeEvidence(fresh, { schema_version: 1, evidence_id: `patch_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`, project_id: projectId, phase: targetPhase, record_type: 'patch_applied', created_at: new Date().toISOString(), patch_preview_id: previewId, target_semantic_id: targetSemanticId, scope, change, reason, base_state_revision: preview.base_state_revision, scene_revision: revision, model_binding: binding, files: { audit: await fileEvidence(auditPath), reference: await fileEvidence(referencePath) }, target_before: applied.target_before, target_after: applied.target_after, visual: 'unverified' });
      } catch (error) {
        operation.status = 'evidence_failed';
        operation.error = String(error.message || error);
        fresh.status = 'recovery_required';
        fresh.recovery_error = operation.error;
        fresh.transaction_result = { code: 'PATCH_EVIDENCE_CAPTURE_FAILED', result_known: true, operation_id: operation.operation_id, message: operation.error };
        fresh.updated_at = new Date().toISOString();
        await this.saveState(fresh);
        const failure = this.stateError('PATCH_EVIDENCE_CAPTURE_FAILED', 'Patch committed but evidence is incomplete; call sketchup_project_retry_evidence before review or another write');
        failure.operation_id = operation.operation_id;
        throw failure;
      }
      fresh.model_binding = binding;
      fresh.patch_review = { patch_id: previewId, phase: targetPhase, return_status: priorStatus, target_semantic_id: targetSemanticId, scope, original_transform: applied.original_transform, after_target_fingerprint: applied.after_target_fingerprint, evidence_id: evidence.record.evidence_id, previous_evidence_id: preview.previous_evidence_id || '', applied_scene_revision: revision };
      delete fresh.patch_recovery;
      fresh.status = 'review_required';
      fresh.updated_at = new Date().toISOString();
      await this.saveState(fresh);
      return { ok: true, action, project_id: projectId, status: fresh.status, patch_id: previewId, evidence_id: evidence.record.evidence_id, target_semantic_id: targetSemanticId, write_set: preview.write_set, invalidated_evidence_ids: preview.invalidated_evidence_ids, next_action: 'Inspect the patch evidence and call sketchup_project_review for the target phase; use sketchup_project_patch(action=rollback) if the patch is rejected.' };
    });
  }

  async rollbackPatch(projectId, input, bridge) {
    const state = await this.loadState(projectId);
    const patch = state.patch_review;
    const patchId = String(input.patch_id || '').trim();
    if (!patch || patch.patch_id !== patchId) throw Object.assign(new Error('No matching applied patch is awaiting review'), { code: 'PATCH_NOT_FOUND' });
    if (Number(state.scene_revision || 0) !== Number(patch.applied_scene_revision)) throw Object.assign(new Error('Patch rollback would overwrite a newer scene revision'), { code: 'PATCH_ROLLBACK_CONFLICT' });
    return this.withProjectLock(projectId, async () => {
      const fresh = await this.loadState(projectId);
      if (!fresh.patch_review || fresh.patch_review.patch_id !== patchId || Number(fresh.scene_revision || 0) !== Number(patch.applied_scene_revision)) throw Object.assign(new Error('Patch rollback became stale while waiting for the project lock'), { code: 'PATCH_ROLLBACK_CONFLICT' });
      await this.assertModelBinding(fresh, bridge);
      const unresolved = await this.unresolvedDocumentOperation(fresh.model_binding || { path: fresh.model_path, object_id: null }, projectId);
      if (unresolved) throw this.stateError('DOCUMENT_WRITE_UNCERTAIN', `The bound SketchUp document has an unresolved write for project ${unresolved.project_id}; no rollback write is permitted`);
      const current = parseManagedResult(await bridge('run_ruby', { code: this.rubyCall('patch_preview', [projectId, patch.target_semantic_id, patch.scope, JSON.stringify({ translation_mm: [0, 0, 0] })]), file: this.helperPath }, 120000));
      if (current.target_fingerprint !== patch.after_target_fingerprint) throw Object.assign(new Error('Patch target changed after apply; rollback refused'), { code: 'PATCH_ROLLBACK_TARGET_CHANGED' });
      const result = parseManagedResult(await this.dispatchAuxiliaryWrite(fresh, 'patch_rollback', [projectId, patch.target_semantic_id, patch.scope, patch.original_transform], bridge));
      const rollbackEvidence = await this.writeEvidence(fresh, { schema_version: 1, evidence_id: `patch_rollback_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`, project_id: projectId, phase: patch.phase, record_type: 'patch_rolled_back', created_at: new Date().toISOString(), patch_id: patchId, target_semantic_id: patch.target_semantic_id, target_after_rollback: result.target_after, visual: 'unverified' });
      fresh.scene_revision = Number(fresh.scene_revision || 0) + 1;
      fresh.status = 'review_required';
      fresh.recapture_return_status = patch.return_status;
      fresh.recapture_phase = patch.return_status === 'review_required' ? fresh.phase : patch.phase;
      delete fresh.patch_review;
      fresh.recovery_recapture_required = true;
      fresh.updated_at = new Date().toISOString();
      await this.saveState(fresh);
      return { ok: true, action: 'rollback', project_id: projectId, status: fresh.status, patch_id: patchId, target_semantic_id: patch.target_semantic_id, next_action: 'The patch was reverted. Call sketchup_project_retry_evidence and review the restored scene before continuing; historical evidence stays unchanged.' };
    });
  }

  async finish(input, bridge) {
    const state = await this.loadState(safeId(input.project_id));
    if (state.status !== 'ready_to_finish') throw new Error(`Project is ${state.status}; all phases must be reviewed before finish`);
    const currentBinding = await this.assertModelBinding(state, bridge);
    const plannedNames=(state.phase_plan || PHASE_PLANS[state.mode] || PHASES).map(p=>p.name);
    if (plannedNames.includes('archetypes') && ['single_image', 'cad', 'refinement'].includes(state.mode) && (!Array.isArray(state.visible_detail_systems) || state.visible_detail_systems.length < 1)) {
      throw new Error('Delivery blocked: reusable archetypes do not contain an audited source-visible detail system required by this task. Rebuild and review the archetypes step.');
    }
    if (plannedNames.includes('facade_detail') && ['single_image', 'cad', 'refinement'].includes(state.mode) && (!Array.isArray(state.unique_details) || state.unique_details.length < 1)) {
      throw new Error('Delivery blocked: no audited source-visible one-off detail is registered. Rebuild and review the facade_detail step.');
    }
    if (state.mode === 'single_image' && state.source_camera) {
      const restoreCode = this.rubyCall('restore_camera', [JSON.stringify(state.source_camera)]);
      const restored = await bridge('run_ruby', { code: restoreCode, file: this.helperPath }, 120000);
      parseManagedResult(restored);
    }
    const outputPath = path.resolve(input.output_path || state.pending_delivery?.model?.path || path.join(state.output_directory, `${state.project_id}.skp`));
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    const pending = state.pending_delivery;
    const pendingMigration = !!(pending && pending.save_result?.strategy === 'temporary_save_as_then_copy' && pending.save_result.path_migrated === true);
    if (pending) {
      if (path.resolve(pending.model.path) !== outputPath) throw this.stateError('PENDING_DELIVERY_PATH','Finish the confirmed pending delivery before choosing another path');
      await verifyEvidenceFiles({model:pending.model});
      if (!sameModelBinding(pending.model_binding,currentBinding)) throw this.stateError('PENDING_DELIVERY_BINDING','Pending delivery is bound to a different document');
      if (pendingMigration) {
        const before = pending.model_binding_before;
        const after = pending.model_binding_after;
        if (!pending.operation_id || !before || !after || !verifiedSaveCopyMigration({model_binding:before}, pending.save_result, currentBinding, outputPath) || !sameModelBinding(after, currentBinding)) {
          throw this.stateError('PENDING_DELIVERY_MIGRATION_UNVERIFIED','The pending temporary-save migration is missing a verified before/after binding or operation receipt');
        }
        const savedFile = pending.save_result.saved_file;
        if (!savedFile || path.resolve(savedFile.path) !== outputPath || savedFile.bytes !== pending.model.bytes || String(savedFile.sha256).toLowerCase() !== String(pending.model.sha256).toLowerCase()) {
          throw this.stateError('PENDING_DELIVERY_FILE_MISMATCH','The confirmed migration file no longer matches its saved receipt');
        }
        await verifyEvidenceFiles({savedFile});
      }
    } else if (fsSync.existsSync(outputPath)) throw new Error('OUTPUT_EXISTS: choose a new output path; existing user files are never deleted before save');
    const preflightAuditPath = path.join(this.projectDir(state.project_id), `final-preflight-audit-${process.pid}-${Date.now()}.json`);
    let preflightAudit;
    try {
      parseManagedResult(await bridge('run_ruby', { code: this.rubyCall('export_project_audit', [state.project_id, preflightAuditPath.replaceAll('\\', '/')]), file: this.helperPath }, 120000));
      preflightAudit = JSON.parse(await fs.readFile(preflightAuditPath, 'utf8'));
      validateFinalAudit(state, preflightAudit, plannedNames);
    } finally {
      await fs.rm(preflightAuditPath, { force: true }).catch(() => {});
    }
    const approvedEvidenceId = state.quality_reviews?.length ? state.quality_reviews[state.quality_reviews.length - 1].evidence_id : (state.last_checkpoint?.evidence_id || state.last_evidence_id);
    if (pending && auditContent(pending.approved_audit)!==auditContent(preflightAudit)) {
      state.delivery_candidates=[...(state.delivery_candidates||[]),{...pending,reason:'scene_changed_before_delivery_resume'}];
      delete state.pending_delivery;
      state.status='review_required';state.recovery_recapture_required=true;state.recapture_return_status='ready_to_finish';await this.saveState(state);
      throw this.stateError('DELIVERY_SCENE_CHANGED','Confirmed saved candidate preserved; current scene changed. Recapture/review and select a new explicit output version.');
    }
    if (approvedEvidenceId) {
      // Historical approved evidence remains bound to the unsaved document
      // (A). For one receipt-verified A→B temporary migration, validate that
      // record against A, then compare current geometry by audit content. The
      // general binding rules remain strict everywhere else.
      const approvedBinding = pendingMigration ? pending.model_binding_before : currentBinding;
      const approvedState = pendingMigration ? {...state, model_binding: approvedBinding} : state;
      const approved = await this.verifyEvidence(approvedState, approvedEvidenceId, approvedBinding);
      const recordedAudit = approved.record.files?.audit?.path ? JSON.parse(await fs.readFile(approved.record.files.audit.path, 'utf8')) : null;
      const comparableAudit = pendingMigration ? auditContent : (value) => { const copy = JSON.parse(JSON.stringify(value)); delete copy.created_at; return copy; };
      if (recordedAudit && canonical(comparableAudit(recordedAudit)) !== canonical(comparableAudit(preflightAudit))) {
        const stale = this.stateError('EVIDENCE_MODEL_CHANGED', 'Current final audit differs from the latest approved evidence; recapture and review before delivery');
        state.status = 'review_required';
        state.recovery_recapture_required = true;
        state.recovery_error = stale.message;
        state.updated_at = new Date().toISOString();
        await this.saveState(state);
        throw stale;
      }
    }
    let save = pending?.save_result;
    if (!pending) {
      const saveBridge = await this.dispatchAuxiliaryWrite(state, 'save_copy', [state.project_id, outputPath.replaceAll('\\', '/')], bridge, {purpose:'delivery',approved_audit:preflightAudit,approved_evidence_id:approvedEvidenceId});
      save = parseManagedResult(saveBridge);
    }
    if (!fsSync.existsSync(outputPath) || (await fs.stat(outputPath)).size <= 0) throw new Error(`SketchUp save_copy did not create a nonzero file: ${outputPath}`);
    if (!pending) {
      const saveOperation = [...(state.operation_journal || [])].reverse().find((entry) => entry.kind === 'save_copy' && entry.status === 'completed' && entry.context?.purpose === 'delivery' && Array.isArray(entry.arguments) && path.resolve(String(entry.arguments[1])) === outputPath);
      const savedBinding = await this.modelIdentity(bridge);
      const beforeBinding = save.model_binding_before || saveOperation?.model_binding || currentBinding;
      const afterBinding = save.model_binding_after || savedBinding;
      if (!saveOperation?.operation_id || !beforeBinding || !afterBinding || !sameModelBinding(afterBinding, savedBinding) || (save.model_binding_before && !sameModelBinding(saveOperation.model_binding, save.model_binding_before)) || (save.model_binding_after && !sameModelBinding(save.model_binding_after, savedBinding)) || (save.strategy === 'temporary_save_as_then_copy' && !verifiedSaveCopyMigration(saveOperation.request || saveOperation, save, savedBinding, outputPath))) {
        throw this.stateError('DELIVERY_SAVE_METADATA_MISSING','Completed save receipt is missing a verified operation or model migration binding');
      }
      state.pending_delivery={model:await fileEvidence(outputPath),approved_audit:preflightAudit,approved_evidence_id:approvedEvidenceId,model_binding:afterBinding,model_binding_before:beforeBinding,model_binding_after:afterBinding,operation_id:saveOperation.operation_id,save_result:save,remaining:['post_save_audit','visual_capture','seal']};
      state.model_binding=afterBinding;
      await this.saveState(state);
    }
    const activeAfterSave = await bridge('ping');
    const finalDir = path.join(state.output_directory, 'managed-evidence', `final-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`);
    await fs.mkdir(finalDir, { recursive: true });
    const auditOutput = path.join(finalDir, 'final-audit.json');
    const previewPath = path.join(finalDir, 'final-preview.png');
    const auditBridge = await bridge('run_ruby', { code: this.rubyCall('export_project_audit', [state.project_id, auditOutput.replaceAll('\\', '/')]), file: this.helperPath }, 120000);
    parseManagedResult(auditBridge);
    const savedAudit = JSON.parse(await fs.readFile(auditOutput,'utf8'));
    validateFinalAudit(state,savedAudit,plannedNames);
    if (auditContent(preflightAudit) !== auditContent(savedAudit)) {
      state.delivery_candidates = [...(state.delivery_candidates || []), {model:await fileEvidence(outputPath),audit:await fileEvidence(auditOutput),reason:'scene_changed_across_save',approved_evidence_id:approvedEvidenceId}];
      state.status='review_required';state.recovery_recapture_required=true;state.recapture_return_status='ready_to_finish';
      delete state.pending_delivery;
      await this.saveState(state);
      throw this.stateError('DELIVERY_SCENE_CHANGED','Saved candidate preserved. Recapture/review the current scene and use a new explicit output path; the previous candidate is not final.');
    }
    const profile=fsSync.existsSync(this.renderProfilePath) ? JSON.parse(await fs.readFile(this.renderProfilePath,'utf8')) : {};
    let capturedFinal = false;
    if(['window_print','desktop_viewport'].includes(profile.capture_backend)) {
      try {
        const captured=await this.captureViewportSet(state,'finish',path.dirname(previewPath),bridge);
        await fs.copyFile(captured.files.reference,previewPath);capturedFinal=true;
      } catch(error) {
        if (/restoration incomplete/.test(error.message)) throw error;
        await fs.writeFile(path.join(finalDir,'capture-fallback.json'),JSON.stringify({from:profile.capture_backend,to:'ruby_native',error:error.message}));
      }
    }
    if (!capturedFinal) {
      const previewBridge = await bridge('run_ruby', {code:this.rubyCall('capture_reference',[state.project_id,previewPath.replaceAll('\\','/')]),file:this.helperPath},120000);
      parseManagedResult(previewBridge);
    }
    const postCapture = path.join(finalDir,'post-capture-audit.json');
    parseManagedResult(await bridge('run_ruby',{code:this.rubyCall('export_project_audit',[state.project_id,postCapture.replaceAll('\\','/')]),file:this.helperPath},120000));
    if (auditContent(savedAudit)!==auditContent(JSON.parse(await fs.readFile(postCapture,'utf8')))) {
      state.delivery_candidates=[...(state.delivery_candidates||[]),{model:await fileEvidence(outputPath),reason:'scene_changed_during_delivery_capture'}];
      delete state.pending_delivery;
      state.status='review_required';state.recovery_recapture_required=true;state.recapture_return_status='ready_to_finish';await this.saveState(state);
      throw this.stateError('DELIVERY_SCENE_CHANGED','Scene changed during delivery capture; saved candidate preserved, recapture and use a new output path.');
    }
    await verifyEvidenceFiles({model:state.pending_delivery.model});
    const evidenceId = `ev_final_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
    const record = {
      schema_version: 1, evidence_id: evidenceId, project_id: state.project_id, phase: 'final', created_at: new Date().toISOString(),
      quality_review_history: state.quality_reviews || [], quality_history_scope: 'Recorded since quality-review v1; absent earlier phases remain unverified',
      source: state.source, model: await fileEvidence(outputPath), audit: await fileEvidence(auditOutput), preview: await fileEvidence(previewPath), save_result: save,
      ...(pendingMigration ? {delivery_recovery:{operation_id:pending.operation_id,strategy:pending.save_result.strategy,path_migrated:true,model_binding_before:pending.model_binding_before,model_binding_after:pending.model_binding_after,approved_evidence_id:pending.approved_evidence_id}} : {}),
      readback: { status: 'save_copy_verified_nonzero', active_model: activeAfterSave, note: 'The copy is byte/hash verified; automatic reopen is intentionally avoided because opening another file can trigger a dirty-model modal.' },
    };
    const saved = await this.writeEvidence(state, record);
    state.status = 'finished';
    delete state.pending_delivery;
    state.output_path = outputPath;
    state.final_evidence_id = evidenceId;
    state.final_evidence_path = saved.path;
    state.updated_at = new Date().toISOString();
    await this.saveState(state);
    const history=Array.isArray(state.quality_reviews)?state.quality_reviews:[];
    return { ok: true, project_id: state.project_id, status: state.status, output_path: outputPath, evidence_id: evidenceId, evidence_path: saved.path, evidence_index:{final:evidenceId,path:saved.path,source:record.source?.sha256||null,model:record.model?.sha256||null,audit:record.audit?.sha256||null}, quality_review_summary:qualityReviewSummary(state), ...(input.detail===true?{quality_review_history:history}:{}), geometry_readback: 'unverified' };
  }

  async abortPendingEvidence(input, bridge) {
    return this.withProjectLock(safeId(input.project_id), async () => {
      const state = await this.loadState(safeId(input.project_id));
      if (state.status !== 'evidence_pending' || !state.pending_evidence) throw this.stateError('ABORT_PENDING_NOT_AVAILABLE', 'Only an unreviewed phase with frozen evidence may be withdrawn');
      if (pendingOperation(state).pending_operation) throw this.stateError('RESULT_UNKNOWN', 'Reconcile the original operation before withdrawal');
      const reason = String(input.reason || '').trim();
      if (reason.length < 8) throw this.stateError('ABORT_REASON_REQUIRED', 'Explain why this unreviewed phase must be withdrawn');
      const pending = state.pending_evidence;
      const phase = (state.phase_plan || PHASE_PLANS[state.mode] || PHASES)[state.step_index];
      if (!phase || phase.name !== pending.phase || state.phase !== pending.phase || state.recovery_recapture_required) throw this.stateError('ABORT_PENDING_SCOPE_MISMATCH', 'Withdrawal cannot remove accepted or recapture-only geometry');
      await this.assertModelBinding(state, bridge);
      if (!pending.checkpoint || !pending.audit) throw this.stateError('ABORT_PENDING_BASIS_MISSING', 'A verified checkpoint and frozen audit are required');
      await verifyEvidenceFiles({checkpoint: pending.checkpoint, audit: pending.audit});
      const livePath = path.join(this.projectDir(state.project_id), 'withdraw-live-' + crypto.randomUUID() + '.json');
      parseManagedResult(await bridge('run_ruby', {code:this.rubyCall('export_project_audit',[state.project_id,livePath.replaceAll('\\','/')]),file:this.helperPath},120000));
      const live = JSON.parse(await fs.readFile(livePath,'utf8'));
      const prior = JSON.parse(await fs.readFile(pending.audit.path,'utf8'));
      validateAuditReadback(live); validateAuditReadback(prior);
      if ((state.quality_reviews || []).some(x=>x.phase===phase.name)) throw this.stateError('ABORT_ACCEPTED_PHASE','Accepted phases require the existing revision route');
      if (!live.root || !prior.root || canonical(live.root)!==canonical(prior.root)) throw this.stateError('ABORT_PENDING_SCENE_CHANGED', 'Live geometry differs from the frozen phase; withdrawal refused');
      const record = await this.writeEvidence(state, {
        schema_version:1, evidence_id:'withdraw_'+crypto.randomUUID(), project_id:state.project_id,
        phase:phase.name, record_type:'pending_evidence_withdrawal', created_at:new Date().toISOString(),
        reason, pending_evidence:pending, pending_execution:state.pending_execution || null,
        original_operation_journal:state.operation_journal || [], evidence_error:state.evidence_error || null,
        files:{checkpoint:pending.checkpoint,audit:pending.audit,live_audit:await fileEvidence(livePath)},
      });
      await this.saveState(state);
      const context = {purpose:'withdraw_pending_evidence',reason,withdrawal_evidence_id:record.record?.evidence_id || state.last_evidence_id,withdrawal_evidence_path:record.path};
      const response = await this.dispatchAuxiliaryWrite(state,'remove_phase',[state.project_id,phase.name],bridge,context);
      parseManagedResult(response);
      const operation = state.operation_journal[state.operation_journal.length-1];
      try { await this.resumeAuxiliaryResult(state,operation,null,bridge); }
      catch(error) { state.status='recovery_required'; operation.status='result_unknown'; state.recovery_error=error.message; await this.saveState(state); throw error; }
      await this.saveState(state);
      return {ok:true,project_id:state.project_id,status:state.status,operation_id:operation.operation_id,withdrawal_evidence_path:record.path,next_call:nextCallForState(state),next_action:'Correct the Ruby file and submit a new managed step. Original frozen inputs and checkpoint are preserved; nothing was accepted.'};
    });
  }

  async recoveryInspect(input, bridge) {
    let state;
    try {
      state = await this.loadState(safeId(input.project_id));
    } catch (error) {
      const code=String(error.code||'');
      if (!['STATE_INTEGRITY_CHECK_FAILED','STATE_INTEGRITY_FORMAT_INVALID','STATE_PARSE_FAILED','STATE_RECOVERY_REQUIRED'].includes(code)) throw error;
      return {ok:false,project_id:safeId(input.project_id),status:'recovery_required',trusted_state:false,recovery_error:{code,message:'Stored project state is not trusted; no path, status or journal field from the damaged file was used.'},operation_id:error.operation_id||null,allowed_actions:['inspect'],can_retry_write:false,next_action:'Preserve the model and obtain an independent operation receipt or checkpoint; do not edit the state file or replay geometry.'};
    }
    let currentModel = null;
    let modelError = null;
    try { currentModel = await this.modelIdentity(bridge); } catch (error) { modelError = String(error.message || error); }
    const checkpoint = state.last_checkpoint || null;
    return {
      ok: true,
      project_id: state.project_id,
      status: state.status,
      recovery_error: state.recovery_error || null,
      transaction_result: state.transaction_result || null,
      checkpoint,
      model_binding: state.model_binding || null,
      current_model: currentModel,
      model_error: modelError,
      can_retry_write: false,
      allowed_actions: checkpoint ? (state.transaction_result?.commit_unconfirmed || state.transaction_result?.rollback_unconfirmed || state.transaction_result?.result_unknown || state.status === 'recovery_required' ? ['inspect', 'reconcile'] : ['inspect', 'reconcile', 'restore']) : state.operation_journal?.length ? ['inspect', 'reconcile'] : ['inspect'],
      next_action: checkpoint ? 'Reconcile the current readback or open the exact recorded checkpoint before restore; do not replay geometry.' : 'Inspect the bridge and operation record; no write retry is safe yet.',
    };
  }

  async resumeAuxiliaryResult(state, operation, receipt, bridge) {
    const result=operation.result,context=operation.context || {};
    if (operation.kind==='save_copy') {
      const file=result.saved_file;
      if (!file || path.resolve(file.path)!==path.resolve(operation.arguments[1])) throw this.stateError('RECOVERY_SAVE_MISMATCH','Save receipt is not bound to the requested file');
      await verifyEvidenceFiles({file});
      const currentBinding = await this.modelIdentity(bridge);
      if (result.model_binding_before && !sameModelBinding(operation.model_binding, result.model_binding_before)) throw this.stateError('RECOVERY_SAVE_BINDING_MISMATCH','Save receipt before-binding does not match the dispatched document');
      if (result.model_binding_after && !sameModelBinding(result.model_binding_after, currentBinding)) throw this.stateError('RECOVERY_SAVE_BINDING_MISMATCH','Save receipt after-binding does not match the active document');
      if (result.strategy === 'temporary_save_as_then_copy' && !verifiedSaveCopyMigration(operation.request || operation, result, currentBinding, operation.arguments[1])) throw this.stateError('RECOVERY_SAVE_BINDING_MISMATCH','Temporary save migration is not verified by the completed receipt');
      state.model_binding=currentBinding;
      if (context.purpose==='delivery') {
        state.pending_delivery={model:file,approved_audit:context.approved_audit,approved_evidence_id:context.approved_evidence_id,model_binding:state.model_binding,model_binding_before:result.model_binding_before || operation.model_binding,model_binding_after:result.model_binding_after || state.model_binding,operation_id:operation.operation_id,save_result:result,remaining:['post_save_audit','visual_capture','seal']};
        state.status='ready_to_finish';
      } else if(context.purpose==='phase_checkpoint') {
        state.pending_execution={...context,operation_id:operation.operation_id};state.recovered_checkpoint=file;state.status='evidence_pending';
      } else {
        state.recovered_saves=[...(state.recovered_saves||[]),{file,operation_id:operation.operation_id}];state.status=operation.prior_status;
      }
      return;
    }
    if(!result.post_action_audit) throw this.stateError('RECOVERY_AUDIT_MISSING','Deletion receipt lacks actual post-action readback');
    const live=parseManagedResult(await bridge('run_ruby',{code:this.rubyCall('deletion_readback',[state.project_id]),file:this.helperPath},120000));validateAuditReadback(live);
    if(auditContent(live)!==auditContent(result.post_action_audit))throw this.stateError('RECOVERY_SCENE_CHANGED','Scene changed after deletion; preserve the receipt and inspect');
    const affected=operation.kind==='remove_phase'?[operation.arguments[1]]:context.affected;
    if(!Array.isArray(affected)||!affected.length)throw this.stateError('RECOVERY_CONTEXT_MISSING','Deletion has no recorded continuation context');
    if(operation.kind==='remove_phases' && affected.some(x=>!(result.removed||[]).includes(x)))throw this.stateError('RECOVERY_DELETE_MISMATCH','Deletion did not remove every recorded phase');
    if(operation.kind==='remove_phases') {
      const invalidated=(state.quality_reviews||[]).filter(x=>affected.includes(x.phase));
      state.quality_reviews=(state.quality_reviews||[]).filter(x=>!affected.includes(x.phase));
      state.invalidated_reviews=[...(state.invalidated_reviews||[]),...invalidated.map(x=>({...x,invalidated_by:context.revisionId,reason:context.reason}))];
      state.step_index=context.targetIndex;state.phase=context.targetName;state.last_checkpoint=null;
    }
    if(affected.includes('archetypes')){delete state.visible_detail_systems;delete state.structure;}
    else if(affected.includes('replication') && state.structure)delete state.structure.replication_systems;
    if(affected.includes('facade_detail'))delete state.unique_details;
    if(affected.some(x=>['massing','source_alignment'].includes(x))){delete state.projection_subjects;delete state.massing_summary;delete state.source_camera;}
    delete state.pending_evidence;delete state.validation_failed;delete state.structure_error;delete state.evidence_error;delete state.complexity_warning;
    if (context.purpose==='withdraw_pending_evidence') {
      state.withdrawn_evidence = [...(state.withdrawn_evidence || []), {operation_id:operation.operation_id,...context}];
      delete state.pending_execution;
      delete state.recovered_checkpoint;
    }
    state.status='ready_for_step';
  }

  async recoveryReconcile(input, bridge) {
    const state = await this.loadState(safeId(input.project_id));
    const unresolved = (Array.isArray(state.operation_journal) ? state.operation_journal : []).find((item) => ['result_unknown', 'dispatched'].includes(item.status));
    // A client timeout can leave an auxiliary save receipt completed while the
    // state write that follows it was not returned to the caller.  The receipt
    // is still reconciled through this existing recovery entry point, but only
    // for a dispatched, receipted auxiliary operation. Geometry writes remain
    // blocked until the normal recovery_required path is established.
    const pendingAuxiliaryWrite = state.status === 'write_in_progress'
      && unresolved?.status === 'dispatched'
      && ['save_copy', 'remove_phase', 'remove_phases'].includes(unresolved.kind);
    if (state.status !== 'recovery_required' && !pendingAuxiliaryWrite) throw this.stateError('RECOVERY_NOT_REQUIRED', 'Reconcile is only available while recovery is required or a dispatched auxiliary receipt is pending');
    if (unresolved) {
      const receiptResult = await this.operationReceipt({ project_id: state.project_id, operation_id: unresolved.operation_id }, bridge);
      const receipt = receiptResult.receipt;
      if (receipt?.found) {
        const request = receipt.receipt?.request;
        const current = await this.assertModelBinding(state, bridge);
        const receiptResult = receipt.receipt?.result;
        const directBinding = sameModelBinding(request?.model_binding, current);
        const migratedBinding = unresolved.kind === 'save_copy' && verifiedSaveCopyMigration(request, receiptResult, current, unresolved.arguments?.[1]);
        if (!request || request.operation_id !== unresolved.operation_id || request.project_id !== state.project_id || (!directBinding && !migratedBinding) || (unresolved.script_hash && request.script_sha256 !== unresolved.script_hash) || (unresolved.request && canonical(request)!==canonical(unresolved.request))) {
          throw this.stateError('RECOVERY_RECEIPT_MISMATCH', 'Receipt identity, input hash or current document does not match the recorded operation; no write is unlocked');
        }
        const result = receipt.receipt?.result;
        if (receipt.receipt?.status === 'completed' && result?.ok === true) {
          const marker = crypto.createHash('sha256').update(canonical(request)).digest('hex');
          if (receipt.commit_marker !== marker) throw this.stateError('RECOVERY_COMMIT_MARKER_MISMATCH', 'Receipt has no matching commit marker in the active model; preserve the unresolved result');
        }
      }
      if (receipt?.found && receipt.receipt?.status === 'completed') {
        const outcome = receipt.receipt.result;
        if (outcome?.ok !== true) {
          if (!outcome || outcome.commit_unconfirmed || outcome.rollback_unconfirmed || !(outcome.transaction_started === false || (outcome.rollback_confirmed === true && outcome.rollback_fingerprint && outcome.rollback_fingerprint===receipt.current_rollback_fingerprint))) throw this.stateError('RECOVERY_RESULT_UNCERTAIN', 'The completed receipt contains an unconfirmed transaction result');
          unresolved.status = 'failed_confirmed';
          state.status = unresolved.prior_status || 'ready_for_step';
          state.transaction_result = outcome;
          delete state.recovery_error;
          await this.saveState(state);
          return { ok: true, project_id: state.project_id, status: state.status, reconciled: true, can_retry_write: true, result: 'confirmed_no_commit' };
        }
        unresolved.status = 'result_known';
        unresolved.result = receipt.receipt.result || null;
        unresolved.completed_at = new Date().toISOString();
        state.transaction_result = { code: 'RESULT_KNOWN', operation_id: unresolved.operation_id, result: unresolved.result, resolution: 'committed' };
        state.recovery_resolution = { resolved_at: new Date().toISOString(), result: 'committed_receipt', operation_id: unresolved.operation_id };
        if (['save_copy','remove_phase','remove_phases'].includes(unresolved.kind)) {
          await this.resumeAuxiliaryResult(state,unresolved,receipt,bridge);
          delete state.recovery_error;
          await this.saveState(state);
          return {ok:true,project_id:state.project_id,status:state.status,reconciled:true,result:'committed_receipt',can_retry_write:false,operation_id:unresolved.operation_id,next_action:state.pending_delivery?'Call sketchup_project_finish to finish evidence for the confirmed file; do not save again.':state.status==='evidence_pending'?'Call sketchup_project_retry_evidence; do not rebuild.':'Continue at the recovered phase. The auxiliary write was not replayed.'};
        }
        if (unresolved.kind !== 'geometry_step' || !unresolved.script_path) throw this.stateError('RECOVERY_KIND_UNSUPPORTED', 'This receipt requires a supported action-specific recovery adapter; no write is unlocked');
        applyCommittedProgress(state, unresolved);
        state.pending_execution = pendingExecution(unresolved, unresolved.result);
        state.status = 'evidence_pending';
        delete state.recovery_error;
        await this.saveState(state);
        return { ok: true, project_id: state.project_id, status: state.status, reconciled: true, result: 'committed_receipt', can_retry_write: false, operation_id: unresolved.operation_id, next_action: 'Call sketchup_project_retry_evidence, then review; do not replay the committed operation.' };
      }
      const not_executed_or_aborted = receipt?.found && ['aborted', 'not_executed'].includes(String(receipt.receipt?.status || '').toLowerCase());
      if (not_executed_or_aborted) {
        throw this.stateError('RECOVERY_RESULT_UNCERTAIN','A terminal label without a verified rollback/dispatch result cannot unlock writes');
      }
    }
    const checkpoint = state.last_checkpoint;
    if (!checkpoint?.path || !checkpoint.evidence_id) throw this.stateError('RECOVERY_CHECKPOINT_MISSING', 'No trusted checkpoint is available for read-only reconciliation');
    const sealed = await this.verifyEvidence(state, checkpoint.evidence_id, null, { verifyFiles: false });
    const file = sealed.record.files?.checkpoint;
    const auditFile = sealed.record.files?.audit;
    if (!file?.path || !auditFile?.path || path.resolve(file.path) !== path.resolve(checkpoint.path)) throw this.stateError('RECOVERY_CHECKPOINT_UNSEALED', 'Checkpoint is not sealed by the recorded evidence');
    if (await hashFile(checkpoint.path) !== file.sha256) throw this.stateError('RECOVERY_CHECKPOINT_CHANGED', 'Checkpoint hash changed; reconciliation remains blocked');
    if (await hashFile(auditFile.path) !== auditFile.sha256) throw this.stateError('RECOVERY_AUDIT_CHANGED', 'Trusted audit attachment changed; reconciliation remains blocked');
    const uncertain = state.transaction_result?.commit_unconfirmed || state.transaction_result?.rollback_unconfirmed || state.transaction_result?.result_unknown;
    const explicitResolution = ['not_executed', 'aborted'].includes(String(state.transaction_result?.resolution || '').toLowerCase());
    if (uncertain && !explicitResolution) return { ok: true, project_id: state.project_id, status: state.status, reconciled: false, result: 'result_unknown', can_retry_write: false, next_action: 'The transaction result is still unknown; inspect the operation receipt or explicitly reconcile a confirmed abort/not-executed result before any new write.' };
    const current = await this.modelIdentity(bridge);
    const bound = state.model_binding || {};
    if (bound.path && path.resolve(current.path || '').toLowerCase() !== path.resolve(bound.path).toLowerCase()) throw this.stateError('RECOVERY_MODEL_MISMATCH', 'Current SketchUp document does not match the recovery binding');
    if (bound.object_id !== undefined && bound.object_id !== null && Number(current.object_id) !== Number(bound.object_id)) throw this.stateError('RECOVERY_MODEL_MISMATCH', 'Current SketchUp model session does not match the recovery binding');
    const livePath = path.join(this.projectDir(state.project_id), 'reconcile-live-audit.json');
    parseManagedResult(await bridge('run_ruby', { code: this.rubyCall('export_project_audit', [state.project_id, livePath.replaceAll('\\', '/')]), file: this.helperPath }, 120000));
    const live = JSON.parse(await fs.readFile(livePath, 'utf8'));
    const prior = JSON.parse(await fs.readFile(auditFile.path, 'utf8'));
    const sameRoot = canonical(live.root) === canonical(prior.root);
    if (!sameRoot) {
      return { ok: true, project_id: state.project_id, status: state.status, reconciled: false, result: 'result_unknown', can_retry_write: false, next_action: 'Preserve the current model and use inspect/restore with an explicit human decision; geometry must not be replayed.' };
    }
    return {ok:true,project_id:state.project_id,status:state.status,reconciled:false,result:'result_unknown',can_retry_write:false,next_action:'The scene matches the checkpoint but queued execution cannot be excluded. Inspect the original operation receipt; do not replay.'};
  }

  async recover(input, bridge) {
    const action = input.action || 'restore';
    if (action === 'abort_pending') return this.abortPendingEvidence(input, bridge);
    if (!['inspect', 'reconcile', 'restore'].includes(action)) throw this.stateError('RECOVERY_ACTION_INVALID', 'Recovery action must be inspect, reconcile, or restore');
    if (action === 'inspect') return this.recoveryInspect(input, bridge);
    if (action === 'reconcile') return this.recoveryReconcile(input, bridge);
    const state = await this.loadState(safeId(input.project_id));
    const checkpoint = state.last_checkpoint;
    if (!checkpoint?.path || !checkpoint.evidence_id) throw new Error('No managed checkpoint is recorded');
    if (!['ready_for_step', 'review_required'].includes(state.status)) throw new Error('Recovery requires a fully recorded phase; do not infer incomplete evidence approval');
    // A checkpoint predates a previous restore's session binding. Its sealed bytes,
    // exact open path and full scene content are independently verified below.
    const sealed = await this.verifyEvidence(state, checkpoint.evidence_id, null, {restoringCheckpoint:true});
    const file = sealed.record.files?.checkpoint;
    if (!file || path.resolve(file.path) !== path.resolve(checkpoint.path)) throw new Error('Checkpoint is not sealed by its phase evidence');
    if (await hashFile(checkpoint.path) !== file.sha256) throw new Error('Checkpoint hash mismatch');
    const plan = state.phase_plan || PHASE_PLANS[state.mode] || PHASES;
    const index = plan.findIndex(p => p.name === checkpoint.phase);
    if (index < 0 || (state.status === 'ready_for_step' && state.step_index !== index + 1) || (state.status === 'review_required' && state.step_index !== index)) throw new Error('Checkpoint phase does not match current review/continuation state');
    const current = await this.modelIdentity(bridge);
    if (path.resolve(current.path || '').toLowerCase() !== path.resolve(checkpoint.path).toLowerCase()) throw new Error('Open the exact recorded checkpoint before recovery');
    const liveResponse = await bridge('run_ruby', { code: this.rubyCall('export_project_audit', [state.project_id, path.join(this.projectDir(state.project_id), 'recovery-live-audit.json').replaceAll('\\', '/')]), file: this.helperPath }, 120000);
    parseManagedResult(liveResponse);
    const live = JSON.parse(await fs.readFile(path.join(this.projectDir(state.project_id), 'recovery-live-audit.json'), 'utf8'));
    const old = JSON.parse(await fs.readFile(sealed.record.files.audit.path, 'utf8'));
    validateAuditReadback(live);
    validateAuditReadback(old);
    if (checkpointContent(live) !== checkpointContent(old)) throw new Error('Loaded checkpoint content does not match sealed phase audit');
    const returnStatus = state.status;
    state.model_binding = current;
    state.recovery_recapture_required = true;
    state.recapture_phase = checkpoint.phase;
    state.recapture_return_status = returnStatus;
    state.recapture_basis = sealed.record.files.audit;
    state.recapture_exact = true;
    state.status = 'review_required';
    delete state.pending_evidence;
    const priorEvidenceId = state.last_evidence_id;
    await this.writeEvidence(state, { schema_version: 1, evidence_id: `recovery_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`, project_id: state.project_id, record_type: 'checkpoint_recovery', created_at: new Date().toISOString(), checkpoint: file, phase: checkpoint.phase, status_preserved: state.status });
    state.last_evidence_id = priorEvidenceId;
    state.updated_at = new Date().toISOString();
    await this.saveState(state);
    return { ok: true, project_id: state.project_id, status: state.status, phase: state.phase, recovered_checkpoint: checkpoint.path, model_binding: current, next_action: 'Call sketchup_project_retry_evidence and review the new evidence_id; the continuation index is preserved.' };
  }

  async status(input) {
    const state = await this.loadState(safeId(input.project_id));
    const phasePlan = state.phase_plan || PHASE_PLANS[state.mode] || PHASES;
    const phase = phasePlan[state.step_index];
    let reviewSheet = '';
    let evidencePath = '';
    let reviewInput = null;
    if (state.status === 'review_required' && state.last_evidence_id && !state.recovery_recapture_required) {
      const verified = await this.verifyEvidence(state, state.last_evidence_id);
      reviewInput=reviewAvailability(verified.record.files);
      reviewSheet = verified.record.files?.review_sheet?.path || '';
      evidencePath = verified.path;
    }
    const operations=pendingOperation(state);const includeTask=input.detail===true&&(!input.section||input.section==='task');
    const pendingEvidenceRepair = state.status === 'evidence_pending' && /consumer|producer|materializ|GEOMETRY_DERIVED_INPUT_INVALID/i.test(String(state.evidence_error||'')) && state.pending_evidence;
    const response={ ok: true, project_id: state.project_id, mode: state.mode, assistance: assistanceSummary(state,includeTask), status: state.status, phase: state.phase, step_index: state.step_index, last_evidence_id: state.last_evidence_id, final_evidence_id:state.final_evidence_id||null, output_path:state.output_path||null, last_checkpoint: state.last_checkpoint || null, toolkit_bindings: state.toolkit_bindings || [], evidence_path: state.status==='finished'?(state.final_evidence_path||''):evidencePath, review_sheet: reviewSheet, recapture_required:!!state.recovery_recapture_required, validation_failed:state.validation_failed || null, pending_delivery:state.pending_delivery ? {model:state.pending_delivery.model,remaining:state.pending_delivery.remaining} : null, review_input:reviewInput, ...operations, next_call:nextCallForState(state), task_card: phase && state.status !== 'finished' ? taskCard(state, phase, input.detail===true) : null, next_action: state.recovery_recapture_required ? 'Call sketchup_project_retry_evidence, then review the new evidence_id.' : state.status === 'ready_for_step' && phase ? phase.hint : state.status === 'step_in_progress' || state.status === 'patch_in_progress' || state.status === 'write_in_progress' ? 'A write is in progress or its result is unresolved; inspect the operation receipt before any new write.' : state.status === 'review_required' ? 'Inspect the latest review sheet and submit continue or revise.' : state.status === 'ready_to_finish' ? 'Call sketchup_project_finish.' : pendingEvidenceRepair ? '派生几何证据格式错误但几何已保留：可调用 sketchup_project_recover(action=abort_pending) 撤回当前未审阶段并保留审计，再修正输入；也可先重试取证。' : state.status === 'evidence_pending' ? '下一步调 sketchup_project_retry_evidence；若错误属于派生证据格式，可用 recover(action=abort_pending) 合法撤回当前未审阶段。' : state.status === 'recovery_required' ? 'Recovery required: inspect the operation receipt and active document; do not replay the step.' : state.status === 'finished' ? 'Project is finished.' : 'Unknown state: inspect the project journal before any write.' };
    if(input.section==='delivery') return {ok:true,project_id:state.project_id,status:state.status,output_path:response.output_path,final_evidence_id:response.final_evidence_id,evidence_path:response.evidence_path,review_sheet:response.review_sheet,quality:qualityReviewSummary(state),unverified:qualityReviewSummary(state).unverified,unresolved:qualityReviewSummary(state).unresolved,next_call:response.next_call};
    if(input.section==='quality') return {ok:true,project_id:state.project_id,status:state.status,quality:qualityReviewSummary(state),validation_failed:response.validation_failed,unverified:qualityReviewSummary(state).unverified,unresolved:qualityReviewSummary(state).unresolved};
    if(input.section==='constraints') return {ok:true,project_id:state.project_id,status:state.status,assistance:{active_constraints:response.assistance.active_constraints,task_text_ref:response.assistance.task_text_ref}};
    if(input.section==='task') return {ok:true,project_id:state.project_id,status:state.status,assistance:assistanceSummary(state,true)};
    return response;
  }

  async operationReceipt(input, bridge) {
    const projectId = safeId(input.project_id);
    const operationId = String(input.operation_id || '').trim();
    if (!/^[0-9a-f-]{36}$/i.test(operationId)) throw this.stateError('OPERATION_ID_INVALID', 'operation_id must be a UUID returned by sketchup_project_step');
    const state = await this.loadState(projectId);
    const journal = (Array.isArray(state.operation_journal) ? state.operation_journal : []).find((entry) => entry.operation_id === operationId);
    if (!journal) throw this.stateError('OPERATION_NOT_FOUND', 'No operation with this ID is recorded for the project');
    let receipt = null;
    try {
      receipt = parseManagedResult(await bridge('run_ruby', { code: this.rubyCall('operation_receipt', [projectId, operationId]), file: this.helperPath }, 30000));
    } catch (error) {
      receipt = { ok: false, code: error.code || 'RECEIPT_UNAVAILABLE', message: String(error.message || error) };
    }
    return { ok: true, project_id: projectId, operation_id: operationId, journal: journal, receipt, retry_allowed: journal.status === 'completed' || journal.status === 'result_known' ? false : false, next_action: journal.status === 'result_unknown' ? 'Reconcile the recorded receipt or confirm not_executed/aborted; do not dispatch a new write.' : 'Use the recorded operation outcome; no automatic replay is permitted.' };
  }
}

module.exports = { ManagedProjects, PHASES, RAW_WRITE_TOOLS, __test: { normalizedProfile, normalizedWorkUnit, ancientRoofRoute, phasePlanFor, abstractionRecheckNeeded, validateRoofControlContract, complexityWarning, taskCard, assistanceSummary, pendingOperation, nextCallForState, qualityReviewSummary, validateBuildScript, validatePhaseOutput, validateDetailAudit, validateUniqueDetailAudit, validateFinalAudit, validateInspectedViews, validateProjectionBrief, validateProjectionAudit, validateAntiSlabTowerAudit, validateStructureAudit, phaseTaskCard, declaredDetailSystems, declaredUniqueDetails, fileEvidence, sameModelBinding, collectEvidenceFiles, verifyEvidenceFiles, patchChange, patchScope } };
