#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const { errorResult, requestId, classifyError, runToolLifecycle, validateTraceManifest, guardWritePath, serverCapabilities, serverHealth, validateEvidenceManifest, runValidatedToolLifecycle, requestStatus, cancelRequest, listRequestStatus, cancellationError, assertLocalUrl } = require('../mcp-contract');
const { ManagedProjects } = require('./managed-project');

const DEFAULT_TIMEOUT_MS = Number(process.env.SKETCHUP_BRIDGE_TIMEOUT_MS || 30000);
const APP_DATA_DIR = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
const SKILL_ROOT = process.env.PIPCLAW_SKILL_ROOT || path.resolve(__dirname, '../../runtime-support/professional-sketchup-modeling');
const {BridgeClient} = require('./bridge-client');
const bridgeClient = new BridgeClient(APP_DATA_DIR);
const managedProjects = new ManagedProjects({ appDataDir: APP_DATA_DIR, skillRoot: SKILL_ROOT });

const serverInfo = {
  name: 'sketchup-mcp',
  version: '0.5.26',
  build_id: require('../../manifest.json').build_id,
};

// Guided mode receives the bounded starter card; autonomous mode only reduces
// repeated method exposition. Neither mode changes permissions or quality gates.
let startupSatisfied = !require('./agent-profile').agentProfile(APP_DATA_DIR).starter_required;
function requiresStartup(name) {
  return name.startsWith('sketchup_') && !['sketchup_runtime', 'sketchup_ref'].includes(name);
}
function assertStartup(name) {
  if (!startupSatisfied && requiresStartup(name)) {
    const error = new Error('SU-START/2 required. 下一步只能调 sketchup_runtime(action=startup)，读取返回 guidance 后再重试原工具；原用户任务不得改写。');
    error.code = 'STARTUP_GUIDANCE_REQUIRED';
    throw error;
  }
}

const tools = [
  require('./ref-schema.json'),
  require('./ancient-schema.json'),
  require('./toolkit-schema.json'),
  require('./attribution-schema.json'),
  {name:'sketchup_runtime',description:'Call action=startup once at SKILL activation/model change for bounded anti-hallucination guidance; no SU access. If sketchup_* tools are not visible in the host session, use host_enablement (installed does not mean enabled) instead of scanning disks or reading MCP source; client_binding writes the bounded fallback entry file. Other actions inspect user-provided shortcuts without launching. Baseline 2018/2019.',inputSchema:{type:'object',properties:{action:{type:'string',enum:['startup','status','capabilities','host_enablement','client_binding','inspect_shortcut','bind_shortcut','instances','select_instance']},process_id:{type:'integer',minimum:1},shortcut_path:{type:'string'},user_provided:{type:'boolean'}},required:['action'],additionalProperties:false}},
  {
    name:'sketchup_read_instance_layout',
    description:'Read-only bounded occurrence hierarchy and full world transforms of the active saved document. Requires expected_path; never opens/saves/changes geometry. scope_path is a root-to-container persistent-ID string array. Repeated definitions are expanded per occurrence; truncated results cannot certify full coverage. Returns decoded JSON directly, never parse result_inspect. transport.complete means intact transfer only; check truncated separately.',
    inputSchema:{type:'object',properties:{expected_path:{type:'string'},scope_path:{type:'array',items:{type:'string'}},max_instances:{type:'integer',minimum:1,maximum:5000},max_depth:{type:'integer',minimum:1,maximum:32}},required:['expected_path'],additionalProperties:false}
  },
  {
    name: 'get_health', description: 'Return local MCP process, dependency, policy, and request health.', inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_request_status', description: 'Return lifecycle status for one MCP request.', inputSchema: { type: 'object', properties: { request_id: { type: 'string' } }, required: ['request_id'], additionalProperties: false },
  },
  {
    name: 'cancel_request', description: 'Mark one running MCP request as cancelled.', inputSchema: { type: 'object', properties: { request_id: { type: 'string' } }, required: ['request_id'], additionalProperties: false },
  },
  {
    name: 'list_requests', description: 'List known MCP request lifecycle records.', inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_capabilities', description: 'Return MCP capabilities, locality and safety policy.', inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'validate_evidence_manifest', description: 'Validate a visual/semantic evidence manifest.', inputSchema: { type: 'object', properties: { evidence: {}, evidence_path: { type: 'string' } }, additionalProperties: false },
  },
  {
    name: 'validate_trace_manifest',
    description: 'Validate a SketchUp trace manifest before modeling; does not contact SketchUp.',
    inputSchema: {
      type: 'object',
      properties: { manifest: {}, manifest_path: { type: 'string' } },
      additionalProperties: false,
    },
  },
  {
    name: 'sketchup_project_begin',
    description: 'Begin a tool-managed SketchUp project. This creates an isolated project root, registers source evidence, and returns only the next modeling action.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['single_image', 'cad', 'freeform', 'refinement', 'test', 'attribution'] },
        source_image: { type: 'string', description: 'Required for single_image mode.' },
        attribution_command:{type:'string',enum:['显源'],description:'Required for attribution mode; only explicit user command.'},
        projection_brief: { type: 'object', description: 'Required for single_image mode: 1-8 source key-subject screen boxes with id, role and normalized bbox [x0,y0,x1,y1].' },
        output_directory: { type: 'string' },
        project_id: { type: 'string' },
        assistance_mode: { type: 'string', enum: ['guided', 'autonomous', 'auto'], description: 'Saved per-project assistance preference. auto is compatibility-only and resolves to guided.' },
        task_text: { type: 'string', description: 'Optional original task text. Only an exact first non-empty line command selects autonomous/guided; the remainder is retained.' },
        detail: { type: 'boolean', description: 'Return the original task text in the response; default false returns only a hash and readable reference.' },
      task_profile: { type: 'object', description: 'Optional bounded task routing hints. Use matching topics/features or explicitly choose roof_route=custom for a legitimate alternative construction. omit_phases is fixed at begin and can remove only irrelevant optional nodes; quality, evidence and transaction gates remain active for every route.', properties: { topics: { type: 'array', maxItems: 20, items: { type: 'string' } }, features: { type: 'array', maxItems: 20, items: { type: 'string' } }, roof_route:{type:'string',enum:['auto','ancient_roof','custom']}, method_family:{type:'string',maxLength:64,pattern:'^[A-Za-z0-9_.-]*$'}, omit_phases:{type:'array',maxItems:8,items:{type:'string',enum:['roof_profile','archetypes','replication','variants','facade_detail']}}, repetition:{type:'string',enum:['present','none']}, repetition_reason:{type:'string',maxLength:1000} }, additionalProperties: false },
      },
      required: ['mode', 'output_directory'],
      additionalProperties: false,
    },
  },
  {
    name: 'sketchup_project_step',
    description: 'Execute exactly one managed modeling step from a Ruby file. The MCP isolates the write, runs one transaction, generates signed evidence and blocks further geometry until review.',
    inputSchema: {
      type: 'object',
      properties: { project_id: { type: 'string' }, ruby_file: { type: 'string' }, timeout_ms: { type: 'number' }, abstraction_note: { type: 'string', description: 'Required after each third revise of the same phase: source evidence re-read and changed/defended geometric abstraction.' } },
      required: ['project_id', 'ruby_file'],
      additionalProperties: false,
    },
  },
  {
    name: 'sketchup_project_review',
    description: 'Accept or revise the latest automatically generated evidence. The agent makes the visual judgment; the MCP verifies evidence integrity and advances or rolls back.',
    inputSchema: {
      type: 'object',
      properties: { project_id: { type: 'string' }, evidence_id: { type: 'string' }, verdict: { type: 'string', enum: ['continue', 'revise'] }, note: { type: 'string' },
        visual_review: {type:'object',description:'Optional shorthand when this evidence seals machine inputs. The engine assembles and reruns checks from immutable attachments. Never combine with quality_review; visual judgment remains yours.',properties:{state:{type:'string',enum:['pass','fail','unverified']},observations:{type:'string'},inspected_views:{type:'array',items:{type:'string'}}},required:['state','observations','inspected_views'],additionalProperties:false},
        quality_review: { type: 'object', description: 'Full compatible review input; use this or visual_review for production continue. Schema version 1 binds project_id, phase, evidence_id and visual; checks account for geometry and dependencies with absolute input_path or explicit unverified/not_applicable reason. See managed-quality-review.md.', properties: { schema_version: {type:'integer',enum:[1]}, project_id:{type:'string'}, phase:{type:'string'}, evidence_id:{type:'string'}, visual:{type:'object'}, checks:{type:'array'} }, required:['schema_version','project_id','phase','evidence_id','visual','checks'] } },
      required: ['project_id', 'evidence_id', 'verdict'],
      additionalProperties: false,
    },
  },
  {
    name: 'sketchup_project_revise_from',
    description: 'Create a rollback checkpoint, invalidate accepted downstream reviews, and atomically remove one accepted upstream phase plus its materialized dependents.',
    inputSchema: { type: 'object', properties: { project_id: { type: 'string' }, target_phase: { type: 'string' }, reason: { type: 'string', minLength: 8 } }, required: ['project_id','target_phase','reason'], additionalProperties: false },
  },
  {
    name: 'sketchup_project_patch',
    description: 'Preview, apply, or rollback a narrow reversible patch on one already managed semantic instance. The first adapter supports only finite translation_mm and never edits all instances through a shared Definition.',
    inputSchema: { type: 'object', properties: { project_id: { type: 'string' }, action: { type: 'string', enum: ['preview','apply','rollback'] }, target_semantic_id: { type: 'string' }, target_phase: { type: 'string' }, scope: { type: 'string', enum: ['instance','definition'] }, change: { type: 'object' }, reason: { type: 'string', minLength: 8 }, preserve_semantic_ids: { type: 'array', maxItems: 100, items: { type: 'string' } }, preview_id: { type: 'string', pattern: '^[a-fA-F0-9]{64}$' }, patch_id: { type: 'string', pattern: '^[a-fA-F0-9]{64}$' } }, required: ['project_id','action'], additionalProperties: false },
  },
  {
    name: 'sketchup_project_finish',
    description: 'Save and audit a fully reviewed managed project, then seal a final signed evidence record.',
    inputSchema: {
      type: 'object', properties: { project_id: { type: 'string' }, output_path: { type: 'string' }, detail:{type:'boolean',description:'Include full review history; default false returns current delivery summary and evidence index.'} }, required: ['project_id'], additionalProperties: false,
    },
  },
  {
    name: 'sketchup_project_recover',
    description: 'Verify an already opened signed phase checkpoint and rebind the existing managed project after a restart. Does not open files, build geometry or grant visual approval.',
    inputSchema: { type: 'object', properties: { project_id: { type: 'string' }, action: { type: 'string', enum: ['inspect', 'reconcile', 'restore'] } }, required: ['project_id'], additionalProperties: false },
  },
  {
    name:'sketchup_project_retry_evidence',description:'Retry incomplete desktop viewport evidence without rerunning geometry. Verifies pending checkpoint, source hash and live audit, then requires normal visual review.',
    inputSchema:{type:'object',properties:{project_id:{type:'string'}},required:['project_id'],additionalProperties:false},
  },
  {
    name: 'sketchup_project_diagnose_viewport',
    description: 'Capture target SketchUp window views without moving the cursor or taking foreground, preserving geometry and review state. Occluded windows supported; minimized windows temporarily restored without activation and re-minimized.',
    inputSchema: {type:'object',properties:{project_id:{type:'string'}},required:['project_id'],additionalProperties:false},
  },
  {name:'sketchup_project_geometry_diagnose',description:'Read fresh topology and semantic-ID mapping from a signed managed project only. No arbitrary Ruby, no geometry edits. Writes a bounded diagnostic artifact; not visual acceptance.',inputSchema:{type:'object',properties:{project_id:{type:'string'}},required:['project_id'],additionalProperties:false}},
  {
    name: 'sketchup_project_status',
    description: 'Return the current managed project status and only the next action the agent needs.',
    inputSchema: { type: 'object', properties: { project_id: { type: 'string' }, detail:{type:'boolean',description:'Include the full phase method guidance.'}, section:{type:'string',enum:['delivery','quality','task','constraints'],description:'Read one bounded section; delivery/quality/constraints never include the original task text.'} }, required: ['project_id'], additionalProperties: false },
  },
  {
    name: 'sketchup_project_operation_receipt',
    description: 'Read the recorded receipt for one managed geometry operation. Unknown results stay blocked until this receipt is inspected.',
    inputSchema: { type: 'object', properties: { project_id: { type: 'string' }, operation_id: { type: 'string' } }, required: ['project_id', 'operation_id'], additionalProperties: false },
  },
  {
    name: 'sketchup_ping',
    description: 'Check whether the SketchUp Ruby bridge is running and return basic SketchUp/model information.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'sketchup_run_ruby',
    description: 'Execute arbitrary Ruby code inside the active SketchUp process. This is intentionally powerful.',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Ruby code to execute in SketchUp.' },
        timeout_ms: { type: 'number', description: 'Optional bridge wait timeout in milliseconds.' },
      },
      required: ['code'],
      additionalProperties: false,
    },
  },
  {
    name: 'sketchup_run_ruby_file',
    description: 'Read a local Ruby file and execute it inside SketchUp.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute or workspace-relative path to a Ruby file.' },
        timeout_ms: { type: 'number', description: 'Optional bridge wait timeout in milliseconds.' },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'sketchup_create_box',
    description: 'Create a grouped rectangular box in SketchUp using millimeter dimensions.',
    inputSchema: {
      type: 'object',
      properties: {
        width_mm: { type: 'number' },
        depth_mm: { type: 'number' },
        height_mm: { type: 'number' },
        origin_mm: {
          type: 'array',
          items: { type: 'number' },
          minItems: 3,
          maxItems: 3,
          description: 'Optional [x, y, z] origin in millimeters.',
        },
        name: { type: 'string', description: 'Optional group name.' },
        material: { type: 'string', description: 'Optional material name/color string.' },
      },
      required: ['width_mm', 'depth_mm', 'height_mm'],
      additionalProperties: false,
    },
  },
  {
    name: 'sketchup_loft_sections',
    description: 'Create a triangulated surface/solid by connecting equal-point-count polygon sections in millimeters.',
    inputSchema: { type: 'object', properties: { sections: { type: 'array' }, cap: { type: 'boolean' }, name: { type: 'string' }, material: { type: 'string' } }, required: ['sections'], additionalProperties: false },
  },
  {
    name: 'sketchup_sweep_profile_path',
    description: 'Sweep a closed 2D profile along a 3D path using local tangent frames; coordinates are millimeters.',
    inputSchema: { type: 'object', properties: { profile: { type: 'array' }, path: { type: 'array' }, cap: { type: 'boolean' }, name: { type: 'string' }, material: { type: 'string' } }, required: ['profile', 'path'], additionalProperties: false },
  },
  {
    name: 'sketchup_surface_grid',
    description: 'Create a triangulated surface from a shared rectangular control-point grid in millimeters.',
    inputSchema: { type: 'object', properties: { grid: { type: 'array' }, name: { type: 'string' }, material: { type: 'string' } }, required: ['grid'], additionalProperties: false },
  },
  {
    name: 'sketchup_shell_grid',
    description: 'Create a closed thick freeform shell from a rectangular control-point grid. Coordinates and thickness are millimeters.',
    inputSchema: { type: 'object', properties: { grid: { type: 'array' }, thickness_mm: { type: 'number' }, openings: { type: 'array', description: 'Optional [row,column] cells omitted from the shell and closed with reveal faces.' }, name: { type: 'string' }, material: { type: 'string' } }, required: ['grid', 'thickness_mm'], additionalProperties: false },
  },  {
    name: 'sketchup_transform_entities',
    description: 'Apply one translation and optional Z rotation to groups/components by persistent id.',
    inputSchema: { type: 'object', properties: { persistent_ids: { type: 'array', items: { type: 'integer' } }, translation_mm: { type: 'array', items: { type: 'number' } }, rotation_deg: { type: 'number' } }, required: ['persistent_ids'], additionalProperties: false },
  },
  {
    name: 'sketchup_create_beam_oriented',
    description: 'Create an oriented rectangular timber prism between millimeter endpoints using a local section.',
    inputSchema: { type: 'object', properties: { start_mm: { type: 'array' }, end_mm: { type: 'array' }, section_mm: { type: 'array' }, name: { type: 'string' }, material: { type: 'string' } }, required: ['start_mm', 'end_mm', 'section_mm'], additionalProperties: false },
  },
  {
    name: 'sketchup_create_column_grid',
    description: 'Create a named ancient-building column grid from bay counts and millimeter spacing.',
    inputSchema: { type: 'object', properties: { origin_mm: { type: 'array' }, bays_x: { type: 'integer' }, bays_y: { type: 'integer' }, spacing_x_mm: { type: 'number' }, spacing_y_mm: { type: 'number' }, section_mm: { type: 'array' }, height_mm: { type: 'number' }, name: { type: 'string' }, material: { type: 'string' } }, required: ['bays_x', 'bays_y', 'spacing_x_mm', 'spacing_y_mm', 'section_mm', 'height_mm'], additionalProperties: false },
  },
  {
    name: 'sketchup_array_on_path',
    description: 'Instance a validated component/group along explicit millimeter path points using local tangent rotation.',
    inputSchema: { type: 'object', properties: { source_persistent_id: { type: 'integer' }, path_mm: { type: 'array' }, name_prefix: { type: 'string' }, rotate_to_tangent: { type: 'boolean' } }, required: ['source_persistent_id', 'path_mm'], additionalProperties: false },
  },
  {
    name: 'sketchup_create_curved_eave',
    description: 'Create a triangulated curved eave from corresponding millimeter sections.',
    inputSchema: { type: 'object', properties: { sections: { type: 'array' }, cap: { type: 'boolean' }, name: { type: 'string' }, material: { type: 'string' } }, required: ['sections'], additionalProperties: false },
  },
  {
    name: 'sketchup_create_tile_course',
    description: 'Create repeated short tile-course members from a closed profile and slope path.',
    inputSchema: { type: 'object', properties: { profile: { type: 'array' }, path: { type: 'array' }, course_count: { type: 'integer' }, course_spacing_mm: { type: 'number' }, name: { type: 'string' }, material: { type: 'string' } }, required: ['profile', 'path', 'course_count', 'course_spacing_mm'], additionalProperties: false },
  },
  {
    name: 'sketchup_export_validation_views',
    description: 'Export fixed normal-shaded perspective, plan, front, side, and underside validation PNGs.',
    inputSchema: { type: 'object', properties: { directory: { type: 'string' }, prefix: { type: 'string' }, center_mm: { type: 'array' }, size_mm: { type: 'number' }, width: { type: 'integer' }, height: { type: 'integer' } }, required: ['directory', 'prefix'], additionalProperties: false },
  },
  {
    name: 'sketchup_create_bracket_unit',
    description: 'Create an isolated, single-jump ancient timber bracket unit with explicit bearing-chain parameters and named members.',
    inputSchema: { type: 'object', properties: { origin_mm: { type: 'array' }, span_mm: { type: 'number' }, width_mm: { type: 'number' }, member_mm: { type: 'number' }, level_mm: { type: 'number' }, name: { type: 'string' }, material: { type: 'string' } }, required: ['origin_mm', 'span_mm', 'width_mm', 'member_mm', 'level_mm'], additionalProperties: false },
  },
  {
    name: 'sketchup_create_roof_frame',
    description: 'Create an ancient roof frame from eave/ridge stations and a shared section datum, keeping purlins, rafters, and substrate separate.',
    inputSchema: { type: 'object', properties: { eave_left_mm: { type: 'array' }, eave_right_mm: { type: 'array' }, ridge_mm: { type: 'array' }, rafter_count: { type: 'integer' }, member_mm: { type: 'number' }, name: { type: 'string' }, material: { type: 'string' } }, required: ['eave_left_mm', 'eave_right_mm', 'ridge_mm', 'rafter_count', 'member_mm'], additionalProperties: false },
  },
  {
    name: 'sketchup_create_ridge_system',
    description: 'Create a named ridge, terminal caps, and short repeated ridge-tile members from a guide path.',
    inputSchema: { type: 'object', properties: { path_mm: { type: 'array' }, profile: { type: 'array' }, tile_count: { type: 'integer' }, name: { type: 'string' }, material: { type: 'string' } }, required: ['path_mm', 'profile', 'tile_count'], additionalProperties: false },
  },
  {
    name: 'sketchup_audit_subject_bounds',
    description: 'Recursively classify top-level subject candidates, exclude anomalous site/helper extents, and report component reuse.',
    inputSchema: { type: 'object', properties: { audit_path: { type: 'string' }, min_height_mm: { type: 'number' }, max_span_mm: { type: 'number' } }, required: ['audit_path'], additionalProperties: false },
  },
  {
    name: 'sketchup_get_model_summary',
    description: 'Fast top-level counts and metadata for the active SketchUp model. Do not use this to judge complexity; use sketchup_audit_active_model for recursive hierarchy, reuse, materials, scenes, and preview evidence.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'sketchup_audit_active_model',
    description: 'Read-only recursive audit of the active model. Exports JSON and optionally a PNG preview; validates expected_path before reading and never edits source geometry.',
    inputSchema: {
      type: 'object',
      properties: {
        audit_path: { type: 'string', description: 'Absolute output path for the audit JSON.' },
        preview_path: { type: 'string', description: 'Optional absolute output path for a PNG preview.' },
        expected_path: { type: 'string', description: 'Optional expected active .skp path; mismatch fails safely.' },
        feature_profile: { type: 'string', description: 'Optional category label such as modern-villa, courtyard-villa, chinese-ancient, curved-architecture, residential, fourth-gen, commercial, hotel, clubhouse, or demonstration.' },
        timeout_ms: { type: 'number' },
      },
      required: ['audit_path'],
      additionalProperties: false,
    },
  },
  {
    name: 'sketchup_clear_model',
    description: 'Erase all entities in the active SketchUp model.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'sketchup_save_model',
    description: 'Save the active SketchUp model, optionally to a specific path.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Optional .skp output path.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'sketchup_open_model',
    description: 'Open a local .skp file in SketchUp.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to a .skp file.' },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'sketchup_bridge_command',
    description: 'Send a raw command payload to the SketchUp bridge for advanced operations.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        args: { type: 'object', additionalProperties: true },
        timeout_ms: { type: 'number' },
      },
      required: ['command'],
      additionalProperties: false,
    },
  },
];

function exposedTools() {
  // Patch remains internal engineering code until every required recovery path passes.
  const released = tools.filter((tool) => tool.name !== 'sketchup_project_patch');
  return managedProjects.unsafeDiagnosticEnabled() ? released : released.filter((tool) => !managedProjects.isRawWriteTool(tool.name));
}

let outputFraming = 'line';
let activeRequests = 0;
let inputEnded = false;
const externalRequestIndex = new Map();

function maybeExit() {
  if (inputEnded && activeRequests === 0) process.exit(0);
}

function sendMessage(message) {
  const json = JSON.stringify(message);

  if (outputFraming === 'content-length') {
    const body = Buffer.from(json, 'utf8');
    process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
    process.stdout.write(body);
    return;
  }

  process.stdout.write(`${json}\n`);
}

function sendResult(id, result) {
  sendMessage({ jsonrpc: '2.0', id, result });
}

function sendError(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  sendMessage({ jsonrpc: '2.0', id, error });
}

function asToolContent(value) {
  return {
    content: [
      {
        type: 'text',
        text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

async function handleToolCall(name, input = {}, context = {}) {
  const bridge = (command, args = {}, timeoutMs = DEFAULT_TIMEOUT_MS) => bridgeClient.call(command, args, timeoutMs, context.signal);
  assertStartup(name);
  if (managedProjects.isRawWriteTool(name) && !managedProjects.unsafeDiagnosticEnabled()) {
    const error = new Error(`Raw SketchUp write tool '${name}' is locked. Begin a managed project and use sketchup_project_step; diagnostic bypass requires SKETCHUP_MCP_UNSAFE_DIAGNOSTIC=true.`);
    error.code = 'MANAGED_PROJECT_REQUIRED';
    throw error;
  }
  switch (name) {
    case 'sketchup_attribution': {
      const r=await require('./attribution-tool').attributionTool(input);
      return {...asToolContent(r),isError:!r.ok};
    }
    case 'sketchup_toolkit': {
      const r=await require('./toolkit-registry').toolkitTool(input,APP_DATA_DIR);
      return {...asToolContent(r),isError:!r.ok};
    }
    case 'sketchup_ancient_tool': {
      const r=await require('./ancient-tool').ancientTool(input,APP_DATA_DIR);
      return {...asToolContent(r),isError:!r.ok};
    }
    case 'sketchup_ref': {
      const r=await require('./ref-packs').refTool(input,APP_DATA_DIR);
      if(r.encoding==='base64' && r.mime_type?.startsWith('image/')) {const {data,...meta}=r;return {content:[{type:'text',text:JSON.stringify(meta)},{type:'image',mimeType:r.mime_type,data}],isError:!r.ok};}
      return {...asToolContent(r),isError:!r.ok};
    }
    case 'sketchup_runtime': {
      if(input.action==='instances') {
        const rows=await bridgeClient.instances();
        const instances=rows.map(row=>({process_id:row.process_id,session_id:row.session_id,executable:row.executable,version:row.version||null}));
        return asToolContent({ok:true,instances,selection_required:rows.length!==1,bridge_directory:bridgeClient.root,
          next_action:rows.length?'Select the intended PID if selection is needed; multiple live instances alone do not imply bridge contention.':'No live instance is registered; inspect runtime status before any write.'});
      }
      if(input.action==='select_instance') return asToolContent(await bridgeClient.select(input.process_id));
      const out = await require('./runtime-binding').runtimeBinding(input, APP_DATA_DIR, SKILL_ROOT);
      if (input && input.action === 'startup') startupSatisfied = true;
      if (input && input.action === 'status') out.agent_profile = out.agent_profile || require('./agent-profile').agentProfile(APP_DATA_DIR);
      return asToolContent({...out,startup_gate:{policy:'su-start-2',satisfied:startupSatisfied,scope:'this_mcp_process'}});
    }

    case 'get_health':
      return asToolContent({ ...serverHealth('sketchup-mcp', exposedTools(), {}), agent_profile: require('./agent-profile').agentProfile(APP_DATA_DIR), bridge:await bridgeClient.health(), recovery:{next_action:'Inspect request/project state after timeout; never replay an unknown write.'} });
    case 'get_request_status':
      return asToolContent(requestStatus(input.request_id) || { ok: false, request_id: input.request_id, state: 'not_found' });
    case 'cancel_request':
      return asToolContent({ ok: cancelRequest(input.request_id), request_id: input.request_id });
    case 'list_requests':
      return asToolContent(listRequestStatus('sketchup-mcp'));
    case 'get_capabilities':
      return asToolContent(serverCapabilities('sketchup-mcp', exposedTools()));
    case 'validate_evidence_manifest': {
      const result = validateEvidenceManifest(input.evidence !== undefined ? input.evidence : input.evidence_path);
      return asToolContent({ validator: 'evidence-manifest', ...result });
    }
    case 'validate_trace_manifest': {
      const result = validateTraceManifest(input.manifest !== undefined ? input.manifest : input.manifest_path);
      return asToolContent({ ok: result.ok, validator: 'trace-manifest', ...result });
    }
    case 'sketchup_project_begin':
      return asToolContent(await managedProjects.begin(input, bridge));
    case 'sketchup_project_step':
      return asToolContent(await managedProjects.step(input, bridge));
    case 'sketchup_project_review':
      return asToolContent(await managedProjects.review(input, bridge));
    case 'sketchup_project_revise_from':
      return asToolContent(await managedProjects.reviseFrom(input, bridge));
    case 'sketchup_project_patch':
      throw Object.assign(new Error('PATCH_NOT_RELEASED: patch remains closed pending complete recovery and shared-path acceptance; use the managed revision workflow.'), { code: 'PATCH_NOT_RELEASED' });
    case 'sketchup_project_finish':
      return asToolContent(await managedProjects.finish(input, bridge));
    case 'sketchup_project_recover':
      return asToolContent(await managedProjects.recover(input, bridge));
    case 'sketchup_project_retry_evidence':
      return asToolContent(await managedProjects.retryEvidence(input,bridge));
    case 'sketchup_project_diagnose_viewport':
      return asToolContent(await managedProjects.diagnoseViewport(input, bridge));
    case 'sketchup_project_geometry_diagnose':
      return asToolContent(await managedProjects.geometryDiagnose(input,bridge));
    case 'sketchup_project_status':
      return asToolContent(await managedProjects.status(input));
    case 'sketchup_project_operation_receipt':
      return asToolContent(await managedProjects.operationReceipt(input, bridge));

    case 'sketchup_ping':
      return asToolContent(await bridge('ping'));

    case 'sketchup_run_ruby':
      return asToolContent(await bridge('run_ruby', { code: input.code }, input.timeout_ms || DEFAULT_TIMEOUT_MS));

    case 'sketchup_run_ruby_file': {
      const filePath = path.resolve(process.cwd(), input.path);
      const code = await fs.readFile(filePath, 'utf8');
      return asToolContent(await bridge('run_ruby', { code, file: filePath }, input.timeout_ms || DEFAULT_TIMEOUT_MS));
    }

    case 'sketchup_create_box':
      return asToolContent(await bridge('create_box', input));

    case 'sketchup_loft_sections':
      return asToolContent(await bridge('loft_sections', input, input.timeout_ms || DEFAULT_TIMEOUT_MS));

    case 'sketchup_sweep_profile_path':
      return asToolContent(await bridge('sweep_profile_path', input, input.timeout_ms || DEFAULT_TIMEOUT_MS));

    case 'sketchup_surface_grid':
      return asToolContent(await bridge('surface_grid', input, input.timeout_ms || DEFAULT_TIMEOUT_MS));

    case 'sketchup_shell_grid':
      return asToolContent(await bridge('shell_grid', input, input.timeout_ms || DEFAULT_TIMEOUT_MS));

    case 'sketchup_transform_entities':
      return asToolContent(await bridge('transform_entities', input, input.timeout_ms || DEFAULT_TIMEOUT_MS));
    case 'sketchup_create_beam_oriented':
      return asToolContent(await bridge('create_beam_oriented', input, input.timeout_ms || DEFAULT_TIMEOUT_MS));
    case 'sketchup_create_column_grid':
      return asToolContent(await bridge('create_column_grid', input, input.timeout_ms || DEFAULT_TIMEOUT_MS));
    case 'sketchup_array_on_path':
      return asToolContent(await bridge('array_on_path', input, input.timeout_ms || DEFAULT_TIMEOUT_MS));
    case 'sketchup_create_curved_eave':
      return asToolContent(await bridge('create_curved_eave', input, input.timeout_ms || DEFAULT_TIMEOUT_MS));
    case 'sketchup_create_tile_course':
      return asToolContent(await bridge('create_tile_course', input, input.timeout_ms || DEFAULT_TIMEOUT_MS));
    case 'sketchup_export_validation_views':
      return asToolContent(await bridge('export_validation_views', input, input.timeout_ms || 120000));
    case 'sketchup_create_bracket_unit':
      return asToolContent(await bridge('create_bracket_unit', input, input.timeout_ms || DEFAULT_TIMEOUT_MS));
    case 'sketchup_create_roof_frame':
      return asToolContent(await bridge('create_roof_frame', input, input.timeout_ms || DEFAULT_TIMEOUT_MS));
    case 'sketchup_create_ridge_system':
      return asToolContent(await bridge('create_ridge_system', input, input.timeout_ms || DEFAULT_TIMEOUT_MS));
    case 'sketchup_audit_subject_bounds': {
      const auditPath = guardWritePath(input.audit_path).target;
      const script = path.join(SKILL_ROOT, 'scripts', 'audit_subject_bounds.rb').replaceAll('\\\\', '/');
      const ruby = 'load ' + JSON.stringify(script) + '; PipClawSubjectBoundsAudit.run(' + JSON.stringify(auditPath) + ', ' + JSON.stringify(input.min_height_mm || 300) + ', ' + JSON.stringify(input.max_span_mm || 100000) + ')';
      return asToolContent(await bridge('run_ruby', { code: ruby, file: script }, input.timeout_ms || 120000));
    }

    case 'sketchup_read_instance_layout': {
      if(typeof input.expected_path!=='string' || !path.isAbsolute(input.expected_path)) throw new Error('expected_path must be absolute');
      if(input.scope_path!==undefined && (!Array.isArray(input.scope_path) || input.scope_path.length>32 || input.scope_path.some(x=>typeof x!=='string' || !/^[0-9]+$/.test(x)))) throw new Error('Invalid scope_path');
      for(const [key,max,def] of [['max_instances',5000,1000],['max_depth',32,12]]) {
        const value=input[key]===undefined?def:input[key];
        if(!Number.isInteger(value)||value<1||value>max) throw new Error('Invalid '+key);
      }
      const script=path.join(SKILL_ROOT,'scripts','read_instance_layout.rb');
      const payload=Buffer.from(JSON.stringify(input),'utf8').toString('base64');
      const script64=Buffer.from(script.replaceAll('\\','/'),'utf8').toString('base64');
      const {decodeInstanceReadback,MAX_BYTES}=require('./instance-readback-transport');
      const marker='PIPCLAW_LAYOUT_'+crypto.randomBytes(16).toString('hex');
      // run_ruby result_inspect is a bounded debug string, never a data channel.
      // stdout is captured by the existing bridge; keep the evaluated result nil.
      const ruby="require 'base64'; require 'json'; require 'digest'; load Base64.strict_decode64('"+script64+"'); (lambda do; data=JSON.generate(PipClawInstanceReadback.run(JSON.parse(Base64.strict_decode64('"+payload+"')))); raise 'Instance readback exceeds 32 MiB; narrow scope_path/max_instances' if data.bytesize > "+MAX_BYTES+"; $stdout.write('"+marker+":'+data.bytesize.to_s+':'+Digest::SHA256.hexdigest(data)+':'+Base64.strict_encode64(data)+\"\\n\"); nil; end).call";
      const result=decodeInstanceReadback(await bridge('run_ruby',{code:ruby,file:script},30000),marker,input);
      return asToolContent(result);
    }

    case 'sketchup_get_model_summary':
      return asToolContent(await bridge('get_model_summary'));

    case 'sketchup_audit_active_model': {
      const auditPath = guardWritePath(input.audit_path).target;
      const previewPath = input.preview_path ? guardWritePath(input.preview_path).target : '';
      const expectedPath = input.expected_path || '';
      const featureProfile = input.feature_profile || '';
      const script = path.join(SKILL_ROOT, 'scripts', 'audit_active_model.rb').replaceAll('\\', '/');
      const ruby = 'load ' + JSON.stringify(script) + '; PipClawModelAudit.export(' + JSON.stringify(auditPath) + ', ' + JSON.stringify(previewPath) + ', ' + JSON.stringify(expectedPath) + ', ' + JSON.stringify(featureProfile) + ')';
      return asToolContent(await bridge('run_ruby', { code: ruby, file: script }, input.timeout_ms || 120000));
    }

    case 'sketchup_clear_model':
      return asToolContent(await bridge('clear_model'));

    case 'sketchup_save_model':
      return asToolContent(await bridge('save_model', input));

    case 'sketchup_open_model':
      return asToolContent(await bridge('open_model', input));

    case 'sketchup_bridge_command':
      return asToolContent(await bridge(input.command, input.args || {}, input.timeout_ms || DEFAULT_TIMEOUT_MS));

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function handleRequest(message) {
  if (!message || message.jsonrpc !== '2.0') return;

  const request_id = requestId();
  const started = Date.now();
  const { id, method, params } = message;
  const isNotification = id === undefined || id === null;

  try {
    if (method === 'initialize') {
      if (!isNotification) {
        sendResult(id, {
          protocolVersion: params?.protocolVersion || '2024-11-05',
          capabilities: { tools: {} },
          serverInfo,
        });
      }
      return;
    }

    if (method === 'notifications/initialized') return;
    if (method === 'notifications/cancelled') { const internalId = externalRequestIndex.get(String(params?.requestId)); if (internalId) cancelRequest(internalId); return; }

    if (method === 'tools/list') {
      if (!isNotification) sendResult(id, { tools: exposedTools() });
      return;
    }

    if (method === 'tools/call') {
      const result = await runValidatedToolLifecycle('sketchup-mcp', tools, params?.name, params?.arguments || {}, (context) => handleToolCall(params?.name, params?.arguments || {}, context), { idempotency_key: params?._meta?.idempotency_key || params?.idempotency_key || '', timeout_ms: params?._meta?.timeout_ms || 0, on_start: (record) => externalRequestIndex.set(String(id), record.request_id), on_finish: () => externalRequestIndex.delete(String(id)) });
      if (!isNotification) sendResult(id, result);
      return;
    }

    if (method === 'ping') {
      if (!isNotification) sendResult(id, {});
      return;
    }

    if (method === 'resources/list') {
      if (!isNotification) sendResult(id, { resources: [] });
      return;
    }

    if (method === 'prompts/list') {
      if (!isNotification) sendResult(id, { prompts: [] });
      return;
    }

    if (!isNotification) sendError(id, -32601, `Method not found: ${method}`, { ...classifyError(`Method not found: ${method}`), request_id, duration_ms: Date.now() - started });
  } catch (error) {
    if (!isNotification) {
      if (method === 'tools/call') {
        let savedMode = 'guided';
        try {
          if (params?.arguments?.project_id) {
            const project = await managedProjects.loadState(params.arguments.project_id);
            savedMode = project.assistance_selection ? project.assistance_mode || 'guided' : 'guided';
          }
        } catch { /* State errors must not be hidden by guidance lookup. */ }
        const assistance = require('./agent-profile').assistanceForError(savedMode, error);
        // Tool-execution failures are tool results (isError envelope), not JSON-RPC errors.
        sendResult(id, errorResult(error, { request_id: error.__mcpMeta?.request_id || request_id, duration_ms: error.__mcpMeta?.duration_ms || Date.now() - started, phase: 'verify', details: { tool: params?.name || null, assistance } }));
        return;
      }
      sendError(id, -32000, error.message, { ...classifyError(error), request_id: error.__mcpMeta?.request_id || request_id, duration_ms: error.__mcpMeta?.duration_ms || Date.now() - started, phase: 'verify', details: { stack: error.stack } });
    } else {
      console.error(error);
    }
  }
}

function dispatchRequest(message) {
  activeRequests += 1;
  Promise.resolve(handleRequest(message))
    .catch((error) => console.error(error))
    .finally(() => {
      activeRequests -= 1;
      maybeExit();
    });
}

let inputBuffer = Buffer.alloc(0);

function parseMessages() {
  while (true) {
    if (inputBuffer.length === 0) return;

    const prefix = inputBuffer.subarray(0, Math.min(inputBuffer.length, 64)).toString('utf8');
    if (!/^\s*content-length:/i.test(prefix)) {
      const lineEnd = inputBuffer.indexOf('\n');
      if (lineEnd === -1) return;

      const line = inputBuffer.subarray(0, lineEnd).toString('utf8').trim();
      inputBuffer = inputBuffer.subarray(lineEnd + 1);
      if (!line) continue;

      outputFraming = 'line';

      let message;
      try {
        message = JSON.parse(line);
      } catch (error) {
        console.error(`Invalid JSON-RPC line message: ${error.message}`);
        continue;
      }

      dispatchRequest(message);
      continue;
    }

    const headerEnd = inputBuffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) return;

    const headerText = inputBuffer.subarray(0, headerEnd).toString('utf8');
    const lengthMatch = headerText.match(/content-length:\s*(\d+)/i);
    if (!lengthMatch) {
      inputBuffer = inputBuffer.subarray(headerEnd + 4);
      continue;
    }

    const contentLength = Number(lengthMatch[1]);
    const messageStart = headerEnd + 4;
    const messageEnd = messageStart + contentLength;
    if (inputBuffer.length < messageEnd) return;

    const body = inputBuffer.subarray(messageStart, messageEnd).toString('utf8');
    inputBuffer = inputBuffer.subarray(messageEnd);
    outputFraming = 'content-length';

    let message;
    try {
      message = JSON.parse(body);
    } catch (error) {
      console.error(`Invalid JSON-RPC message: ${error.message}`);
      continue;
    }

    dispatchRequest(message);
  }
}

process.stdin.on('data', (chunk) => {
  inputBuffer = Buffer.concat([inputBuffer, chunk]);
  parseMessages();
});

process.stdin.on('end', () => {
  inputEnded = true;
  maybeExit();
});

process.on('uncaughtException', (error) => {
  console.error(error);
});

process.on('unhandledRejection', (error) => {
  console.error(error);
});
