'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const ERROR_RULES = [
  { pattern: /RESULT_UNKNOWN|result is unknown|结果未知/i, code: 'result_unknown', retryable: false, suggested_next_action: '先检查操作记录并确认目标应用是否已执行；禁止自动重放' },
  { pattern: /unknown (?:tool|command)|工具不存在|未知工具/i, code: 'unknown_tool', retryable: false, suggested_next_action: '调用 tools/list 确认可用工具' },
  { pattern: /invalid argument|arguments must|参数|must contain/i, code: 'invalid_arguments', retryable: false, suggested_next_action: '检查 inputSchema 与必填参数' },
  { pattern: /cancelled|canceled|已取消/i, code: 'cancelled', retryable: false, suggested_next_action: '请求已被取消；如需继续请重新发起' },
  { pattern: /timed out|timeout|超时|aborted/i, code: 'timeout', retryable: true, suggested_next_action: '可重试；先检查目标应用是否响应' },
  { pattern: /no active document|no documents|没有活动文档/i, code: 'no_active_document', retryable: false, suggested_next_action: '先调用状态工具确认或创建/打开文档' },
  { pattern: /no active model|active model|没有活动模型/i, code: 'no_active_model', retryable: false, suggested_next_action: '先调用模型状态工具或打开模型' },
  { pattern: /file not found|does not exist|cannot find path|找不到|不存在/i, code: 'file_not_found', retryable: false, suggested_next_action: '检查路径并确认文件存在' },
  { pattern: /access denied|permission denied|拒绝访问|权限/i, code: 'permission_denied', retryable: false, suggested_next_action: '检查文件权限或应用授权' },
  { pattern: /bridge|connection refused|econnrefused|回环|桥接/i, code: 'bridge_unavailable', retryable: true, suggested_next_action: '确认本地应用与 bridge 已启动' },
  { pattern: /com.*unavailable|application.*not found|未安装|不可用/i, code: 'external_app_unavailable', retryable: true, suggested_next_action: '启动或检查对应桌面应用安装状态' },
]

const HIGH_RISK_TOOLS = new Set([
  'sketchup_run_ruby', 'sketchup_run_ruby_file', 'sketchup_clear_model', 'sketchup_save_model', 'sketchup_open_model', 'sketchup_bridge_command',
  'sketchup_create_box', 'sketchup_loft_sections', 'sketchup_sweep_profile_path', 'sketchup_surface_grid', 'sketchup_shell_grid', 'sketchup_transform_entities', 'sketchup_create_beam_oriented', 'sketchup_create_column_grid', 'sketchup_array_on_path', 'sketchup_create_curved_eave', 'sketchup_create_tile_course', 'sketchup_export_validation_views', 'sketchup_create_bracket_unit', 'sketchup_create_roof_frame', 'sketchup_create_ridge_system',
  'photoshop_live_run_jsx', 'photoshop_live_save_active_document', 'photoshop_live_open_document', 'photoshop_live_create_document', 'photoshop_live_duplicate_active_layer', 'photoshop_live_content_aware_fill_selection', 'photoshop_live_create_solid_color_layer', 'photoshop_live_create_text_layer', 'photoshop_live_copy_patch_as_layer', 'photoshop_live_brush_stroke', 'photoshop_live_place_image', 'photoshop_live_draw_polyline', 'photoshop_live_draw_watercolor_scene', 'photoshop_live_create_poster_layout',
  'run_capcut_command', 'build_draft_from_spec',
  'execute_drawing_plan', 'draw_line', 'draw_polyline', 'draw_rectangle', 'draw_circle', 'draw_arc', 'draw_wall', 'draw_door', 'draw_window', 'add_text', 'add_mtext', 'create_layer', 'set_current_layer', 'new_drawing', 'open_autocad', 'save_as', 'send_command',
])

function requestId() { return `${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}` }
function classifyError(error) {
  const message = error instanceof Error ? error.message : String(error ?? '工具调用失败')
  const rule = ERROR_RULES.find((candidate) => candidate.pattern.test(message))
  return { ok: false, code: error?.code || rule?.code || 'runtime_error', message, retryable: rule?.retryable ?? false, suggested_next_action: rule?.suggested_next_action || '检查服务日志与目标应用状态' }
}
function redact(value) {
  if (value === undefined || value === null) return value
  if (typeof value === 'string') return value.replace(/(token|password|secret|authorization|api[_-]?key)([=:]\s*)[^\s,;]+/ig, '$1$2[REDACTED]')
  if (Array.isArray(value)) return value.slice(0, 20).map(redact)
  if (typeof value === 'object') {
    const out = {}
    for (const [key, item] of Object.entries(value).slice(0, 50)) out[key] = /token|password|secret|authorization|api[_-]?key/i.test(key) ? '[REDACTED]' : redact(item)
    return out
  }
  return value
}
function errorResult(error, meta = {}) {
  const envelope = { ...classifyError(error), request_id: meta.request_id || requestId(), phase: meta.phase || 'execute', duration_ms: Number.isFinite(meta.duration_ms) ? meta.duration_ms : undefined, details: redact(meta.details || {}), evidence: Array.isArray(meta.evidence) ? redact(meta.evidence) : [] }
  if (envelope.duration_ms === undefined) delete envelope.duration_ms
  return { isError: true, content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }] }
}
function traceRoot() { return process.env.MCP_TRACE_DIR || path.join(process.env.LOCALAPPDATA || process.env.TEMP || '.', 'PipClawMCP', 'traces') }
function traceEvent(event) {
  if (String(process.env.MCP_TRACE_ENABLED || '1').toLowerCase() === '0') return
  try {
    const dir = path.resolve(traceRoot()); fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, `${new Date().toISOString().slice(0, 10)}.jsonl`)
    fs.appendFileSync(file, JSON.stringify(redact({ schema_version: '1.0', timestamp: new Date().toISOString(), ...event })) + '\n', 'utf8')
  } catch (_) { /* trace must never break a tool call */ }
}
function validateToolArguments(schema, args) {
  const errors = []
  const value = args === undefined || args === null ? {} : args
  const typeMatches = (v, type) => {
    if (type === 'null') return v === null
    if (type === 'object') return v !== null && typeof v === 'object' && !Array.isArray(v)
    if (type === 'array') return Array.isArray(v)
    if (type === 'number') return typeof v === 'number' && Number.isFinite(v)
    if (type === 'integer') return Number.isInteger(v)
    if (type === 'boolean') return typeof v === 'boolean'
    if (type === 'string') return typeof v === 'string'
    return true
  }
  const check = (node, v, pth) => {
    if (!node) return
    if (node.anyOf) { if (!node.anyOf.some((candidate) => { const before = errors.length; check(candidate, v, pth); const passed = errors.length === before; errors.splice(before); return passed })) errors.push(issue('ARG_TYPE', 'value does not match any allowed schema', pth)); return }
    const types = Array.isArray(node.type) ? node.type : (node.type ? [node.type] : [])
    if (types.length && !types.some((t) => typeMatches(v, t))) { errors.push(issue('ARG_TYPE', `expected ${types.join(' or ')}`, pth)); return }
    if (node.enum && !node.enum.includes(v)) errors.push(issue('ARG_ENUM', `must be one of: ${node.enum.join(', ')}`, pth))
    if (typeof v === 'string') { if (node.minLength !== undefined && v.length < node.minLength) errors.push(issue('ARG_MIN_LENGTH', `minimum length is ${node.minLength}`, pth)); if (node.maxLength !== undefined && v.length > node.maxLength) errors.push(issue('ARG_MAX_LENGTH', `maximum length is ${node.maxLength}`, pth)) }
    if (typeof v === 'number') { if (node.minimum !== undefined && v < node.minimum) errors.push(issue('ARG_MINIMUM', `minimum is ${node.minimum}`, pth)); if (node.maximum !== undefined && v > node.maximum) errors.push(issue('ARG_MAXIMUM', `maximum is ${node.maximum}`, pth)) }
    if (Array.isArray(v)) { if (node.minItems !== undefined && v.length < node.minItems) errors.push(issue('ARG_MIN_ITEMS', `minimum items is ${node.minItems}`, pth)); if (node.maxItems !== undefined && v.length > node.maxItems) errors.push(issue('ARG_MAX_ITEMS', `maximum items is ${node.maxItems}`, pth)); if (node.items) v.forEach((item, i) => check(node.items, item, `${pth}[${i}]`)) }
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      for (const req of node.required || []) if (!(req in v)) errors.push(issue('ARG_REQUIRED', `missing required argument: ${req}`, `${pth}.${req}`))
      if (node.additionalProperties === false && node.properties) for (const key of Object.keys(v)) if (!(key in node.properties)) errors.push(issue('ARG_UNKNOWN', `unknown argument: ${key}`, `${pth}.${key}`))
      for (const [key, child] of Object.entries(node.properties || {})) if (key in v) check(child, v[key], `${pth}.${key}`)
    }
  }
  check(schema, value, 'arguments')
  return { ok: errors.length === 0, errors, warnings: [], counts: { errors: errors.length, warnings: 0 } }
}
function serverHealth(server, tools = [], details = {}) {
  const requests = listRequestStatus(server)
  const active = requests.filter((record) => ['running', 'cancelling'].includes(record.state))
  return {
    schema_version: '1.0',
    ok: true,
    server,
    uptime_ms: Math.round(process.uptime() * 1000),
    pid: process.pid,
    node: process.version,
    tool_count: tools.length,
    requests: {
      known: requests.length,
      active: active.length,
      states: requests.reduce((acc, record) => { acc[record.state] = (acc[record.state] || 0) + 1; return acc }, {}),
    },
    policy: {
      high_risk_mode: process.env.MCP_HIGH_RISK_MODE || 'audit',
      path_policy: process.env.MCP_PATH_POLICY || 'compat',
      allowed_roots: configuredAllowedRoots().length,
      trace_enabled: String(process.env.MCP_TRACE_ENABLED || '1').toLowerCase() !== '0',
      remote_opt_in: String(process.env.MCP_REMOTE_OPT_IN || '').toLowerCase() === 'true',
    },
    details,
  }
}
function serverCapabilities(server, tools = []) {
  const highRisk = tools.filter((tool) => HIGH_RISK_TOOLS.has(tool.name)).map((tool) => tool.name)
  return {
    schema_version: '1.0', server, transport: 'stdio', locality: 'local_only',
    supports: { lifecycle_trace: true, redaction: true, atomic_write: true, path_policy: true, evidence_manifest: true, bounded_repair: false },
    policy: { high_risk_mode: process.env.MCP_HIGH_RISK_MODE || 'audit', high_risk_tools: highRisk, remote_opt_in: false },
    tool_count: tools.length,
  }
}
function validateEvidenceManifest(input) {
  const errors = [], warnings = []
  let manifest
  try { manifest = readJsonInput(input, 'evidence') } catch (error) { return { ok: false, errors: [issue('EVIDENCE_INPUT', error.message)], warnings: [], counts: { errors: 1, warnings: 0 } } }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) errors.push(issue('EVIDENCE_SCHEMA', 'evidence must be an object', 'root'))
  if (!manifest?.subject) errors.push(issue('EVIDENCE_SUBJECT', 'subject is required', 'subject'))
  if (!['visual','semantic','machine','combined'].includes(manifest?.kind)) errors.push(issue('EVIDENCE_KIND', 'kind must be visual, semantic, machine, or combined', 'kind'))
  if (!Array.isArray(manifest?.artifacts) || manifest.artifacts.length === 0) errors.push(issue('EVIDENCE_ARTIFACTS', 'at least one artifact is required', 'artifacts'))
  for (const [i, artifact] of (manifest?.artifacts || []).entries()) {
    const pth = `artifacts[${i}]`
    if (!artifact?.path || typeof artifact.path !== 'string') errors.push(issue('EVIDENCE_PATH', 'artifact path is required', `${pth}.path`))
    if (!artifact?.sha256 || !/^[a-f0-9]{64}$/i.test(artifact.sha256)) warnings.push(issue('EVIDENCE_HASH', 'artifact sha256 is recommended', `${pth}.sha256`, 'WARN'))
    if (manifest.kind === 'visual' && artifact?.reviewed !== true) errors.push(issue('VISUAL_NOT_REVIEWED', 'visual artifact must be explicitly reviewed', `${pth}.reviewed`))
    if (!artifact?.summary || typeof artifact.summary !== 'string') warnings.push(issue('EVIDENCE_SUMMARY', 'artifact summary is recommended', `${pth}.summary`, 'WARN'))
  }
  return { ok: errors.length === 0, errors, warnings, counts: { errors: errors.length, warnings: warnings.length } }
}
function assertLocalUrl(rawUrl, options = {}) {
  const parsed = new URL(rawUrl)
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(`URL scheme is not allowed: ${parsed.protocol}`)
  const host = parsed.hostname.toLowerCase()
  const local = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
  if (!local && !options.allowRemote && String(process.env.MCP_REMOTE_OPT_IN || '').toLowerCase() !== 'true') throw new Error(`Remote URL blocked by default: ${host}`)
  return parsed.toString().replace(/(token|password|secret|authorization)=([^&]+)/ig, '$1=[REDACTED]')
}
function policyFor(tool) {
  if (!HIGH_RISK_TOOLS.has(tool)) return 'safe'
  return process.env.MCP_HIGH_RISK_MODE || 'audit'
}
function assertToolPolicy(tool) {
  const policy = policyFor(tool)
  if (policy === 'deny') {
    const error = new Error(`High-risk tool requires explicit enablement: ${tool}`)
    error.code = 'high_risk_confirmation_required'
    throw error
  }
  return policy
}
function invalidArgumentsResult(validation, meta = {}) {
  const error = new Error('Invalid tool arguments')
  error.code = 'invalid_arguments'
  return errorResult(error, { ...meta, phase: 'plan', details: { validation } })
}
async function runValidatedToolLifecycle(server, tools, tool, args, fn, options = {}) {
  const definition = tools.find((item) => item.name === tool)
  if (!definition) {
    const error = new Error(`Unknown tool: ${tool}`)
    error.code = 'unknown_tool'
    throw error
  }
  const validation = validateToolArguments(definition.inputSchema, args)
  if (!validation.ok) return invalidArgumentsResult(validation, { details: { tool } })
  return runToolLifecycle(server, tool, args, fn, options)
}
const REQUESTS = new Map()
const IDEMPOTENCY = new Map()

function publicRequest(record) {
  if (!record) return null
  const { result, promise, controller, ...safeRecord } = record
  return { ...safeRecord }
}

function beginRequest(server, tool, key = '') {
  const id = requestId()
  const controller = new AbortController()
  const record = {
    request_id: id,
    server,
    tool,
    state: 'running',
    started_at: new Date().toISOString(),
    cancelled: false,
    controller,
    promise: null,
  }
  REQUESTS.set(id, record)
  if (key) IDEMPOTENCY.set(`${server}:${key}`, id)
  return record
}

function requestStatus(request_id) { return publicRequest(REQUESTS.get(request_id)) }

function cancelRequest(request_id) {
  const record = REQUESTS.get(request_id)
  if (!record || ['done', 'failed', 'cancelled', 'timeout'].includes(record.state)) return false
  record.cancelled = true
  record.state = 'cancelling'
  record.controller.abort(cancellationError())
  return true
}

function listRequestStatus(server = '') {
  return [...REQUESTS.values()]
    .filter((record) => !server || record.server === server)
    .map(publicRequest)
}

function finishRequest(request_id, state = 'done', extra = {}) {
  const record = REQUESTS.get(request_id)
  if (record) Object.assign(record, { state, finished_at: new Date().toISOString(), ...extra })
  return record
}

function idempotentResult(server, key) {
  const id = key ? IDEMPOTENCY.get(`${server}:${key}`) : null
  return id ? REQUESTS.get(id) || null : null
}

function cleanupRequests(maxAgeMs = 3600000) {
  const cutoff = Date.now() - maxAgeMs
  const expired = []
  for (const [id, record] of REQUESTS) {
    if (record.finished_at && Date.parse(record.finished_at) < cutoff) {
      REQUESTS.delete(id)
      expired.push(id)
    }
  }
  for (const [key, id] of IDEMPOTENCY) if (expired.includes(id)) IDEMPOTENCY.delete(key)
}

function cancellationError(message = 'Tool request was cancelled') {
  const error = new Error(message)
  error.code = 'cancelled'
  return error
}

function timeoutError(timeoutMs) {
  const error = new Error(`Tool timed out after ${timeoutMs}ms`)
  error.code = 'timeout'
  return error
}

async function runToolLifecycle(server, tool, args, fn, options = {}) {
  cleanupRequests()
  const key = options.idempotency_key || args?.idempotency_key || ''
  const mapKey = key ? `${server}:${key}` : ''
  const prior = idempotentResult(server, key)
  if (prior && prior.state === 'done') {
    if (prior.result !== undefined) return prior.result
    return { content: [{ type: 'text', text: JSON.stringify({ ok: true, deduplicated: true, request_id: prior.request_id, state: prior.state }) }] }
  }
  if (prior && ['running', 'cancelling'].includes(prior.state) && prior.promise) {
    if (typeof options.on_start === 'function') options.on_start(prior)
    try {
      return await prior.promise
    } finally {
      if (typeof options.on_finish === 'function') options.on_finish(prior)
    }
  }
  if (prior && mapKey) IDEMPOTENCY.delete(mapKey)

  const record = beginRequest(server, tool, key)
  const request_id = record.request_id
  if (typeof options.on_start === 'function') options.on_start(record)
  const started = Date.now()
  let policy

  const execution = (async () => {
    let timer
    try {
      policy = assertToolPolicy(tool)
      traceEvent({ event: 'tool_start', server, tool, request_id, phase: 'plan', policy, arguments: redact(args) })
      const timeoutMs = Math.max(0, Number(options.timeout_ms || process.env.MCP_TOOL_TIMEOUT_MS || 0))
      const context = { signal: record.controller.signal, request_id, record }
      const work = Promise.resolve().then(() => fn(context))
      const cancelPromise = new Promise((_, reject) => {
        record.controller.signal.addEventListener('abort', () => reject(record.controller.signal.reason || cancellationError()), { once: true })
      })
      const racers = [work, cancelPromise]
      if (timeoutMs > 0) racers.push(new Promise((_, reject) => { timer = setTimeout(() => { const error = timeoutError(timeoutMs); record.controller.abort(error); reject(error) }, timeoutMs) }))
      const result = await Promise.race(racers)
      if (record.cancelled) throw cancellationError()
      finishRequest(request_id, 'done', { duration_ms: Date.now() - started, result })
      traceEvent({ event: 'tool_end', server, tool, request_id, phase: 'verify', policy, ok: true, duration_ms: Date.now() - started, evidence: extractEvidence(result) })
      return result
    } catch (error) {
      if (record.cancelled && error?.code !== 'cancelled') error = cancellationError()
      finishRequest(request_id, error?.code === 'timeout' ? 'timeout' : error?.code === 'cancelled' ? 'cancelled' : 'failed', { duration_ms: Date.now() - started, error: classifyError(error) })
      traceEvent({ event: 'tool_end', server, tool, request_id, phase: 'verify', policy, ok: false, duration_ms: Date.now() - started, error: classifyError(error) })
      error.__mcpMeta = { ...(error.__mcpMeta || {}), request_id, tool, duration_ms: Date.now() - started, policy }
      throw error
    } finally {
      if (timer) clearTimeout(timer)
      record.promise = null
    }
  })()

  record.promise = execution
  try {
    return await execution
  } finally {
    if (typeof options.on_finish === 'function') options.on_finish(record)
  }
}
function extractEvidence(result) {
  if (!result) return []
  const text = result?.content?.find?.((item) => item.type === 'text')?.text
  if (!text) return []
  return [{ kind: 'tool_result', summary: String(text).slice(0, 500) }]
}
function atomicWriteJson(filePath, value) {
  const target = path.resolve(filePath); const dir = path.dirname(target); fs.mkdirSync(dir, { recursive: true })
  const temp = path.join(dir, `.${path.basename(target)}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`)
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', 'utf8'); fs.renameSync(temp, target); return target
}
function assertAllowedPath(candidate, roots = []) {
  const target = path.resolve(candidate); const allowed = roots.map((root) => path.resolve(root))
  if (allowed.length && !allowed.some((root) => target === root || target.startsWith(root + path.sep))) throw new Error(`Path outside allowed roots: ${target}`)
  return target
}
function configuredAllowedRoots() {
  return String(process.env.MCP_ALLOWED_ROOTS || '').split(';').map((x) => x.trim()).filter(Boolean)
}
function guardWritePath(candidate, options = {}) {
  const target = assertAllowedPath(candidate, configuredAllowedRoots())
  if (path.parse(target).root === target) throw new Error(`Refusing to write filesystem root: ${target}`)
  if (String(process.env.MCP_PATH_POLICY || 'compat') === 'strict' && !configuredAllowedRoots().length) throw new Error('MCP_PATH_POLICY=strict requires MCP_ALLOWED_ROOTS')
  if (options.createParent !== false) fs.mkdirSync(path.dirname(target), { recursive: true })
  if (options.backup && fs.existsSync(target) && fs.statSync(target).isFile()) {
    const backup = `${target}.bak`
    fs.copyFileSync(target, backup)
    return { target, backup }
  }
  return { target, backup: null }
}
function writeEvidence(target, backup = null) {
  return [{ kind: 'write', path: redact(target), ...(backup ? { backup: redact(backup) } : {}) }]
}
function withCallMeta(name, fn) { const request_id = requestId(); const started = Date.now(); return Promise.resolve().then(fn).catch((error) => { throw Object.assign(error instanceof Error ? error : new Error(String(error)), { __mcpMeta: { request_id, tool: name, duration_ms: Date.now() - started } }) }).then((result) => ({ result, meta: { request_id, tool: name, duration_ms: Date.now() - started } })) }


function issue(code, message, pathName, severity = 'ERROR') {
  return { code, message, ...(pathName ? { path: pathName } : {}), severity }
}
function readJsonInput(input, label = 'input') {
  if (input === undefined || input === null) throw new Error(`${label} is required`)
  if (typeof input === 'object') return input
  if (typeof input === 'string') {
    const text = fs.readFileSync(path.resolve(input), 'utf8').replace(/^\uFEFF/, '')
    return JSON.parse(text)
  }
  throw new Error(`${label} must be an object or JSON file path`)
}
function validateSemanticPlan(input) {
  const errors = [], warnings = []
  let plan
  try { plan = readJsonInput(input, 'plan') } catch (error) { return { ok: false, errors: [issue('PLAN_INPUT', error.message)], warnings: [], counts: { errors: 1, warnings: 0 } } }
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) errors.push(issue('PLAN_SCHEMA', 'plan must be an object', 'root'))
  const meta = plan?.meta
  if (!meta || typeof meta !== 'object') errors.push(issue('PLAN_SCHEMA', 'meta is required', 'meta'))
  else {
    if (!meta.title || typeof meta.title !== 'string') errors.push(issue('PLAN_META', 'meta.title is required', 'meta.title'))
    if (!meta.source || typeof meta.source !== 'string') errors.push(issue('PLAN_META', 'meta.source is required', 'meta.source'))
    if (typeof meta.reference_required !== 'boolean') errors.push(issue('PLAN_REFERENCE_REQUIRED', 'meta.reference_required must be boolean', 'meta.reference_required'))
    if (meta.plan_size !== undefined && (!Array.isArray(meta.plan_size) || meta.plan_size.length !== 2 || !meta.plan_size.every(Number.isFinite))) errors.push(issue('PLAN_SIZE', 'meta.plan_size must be [width,height]', 'meta.plan_size'))
  }
  const arrays = ['layers','walls','openings','windows','sliding','doors','rooms','fixed_furniture','movable_furniture','fixtures','dims','notes','entities']
  for (const key of arrays) {
    if (plan && plan[key] === undefined) errors.push(issue('PLAN_ARRAY_REQUIRED', `${key} must be present as an array`, key))
    else if (plan && !Array.isArray(plan[key])) errors.push(issue('PLAN_ARRAY', `${key} must be an array`, key))
  }
  const seen = new Set()
  for (const key of arrays.slice(1)) for (let i = 0; i < (Array.isArray(plan?.[key]) ? plan[key].length : 0); i++) {
    const item = plan[key][i], pth = `${key}[${i}]`
    if (!item || typeof item !== 'object') { errors.push(issue('OBJECT_SCHEMA', 'object must be an object', pth)); continue }
    if (!item.id || typeof item.id !== 'string') errors.push(issue('OBJECT_ID', 'id is required and must be a string', pth))
    else if (seen.has(item.id)) errors.push(issue('OBJECT_ID_DUP', `duplicate id: ${item.id}`, pth))
    else seen.add(item.id)
    if (!['explicit','inferred','unresolved'].includes(item.confidence)) errors.push(issue('OBJECT_CONFIDENCE', 'confidence must be explicit, inferred, or unresolved', `${pth}.confidence`))
    if (!item.source || typeof item.source !== 'string') warnings.push(issue('OBJECT_SOURCE', 'source evidence is recommended', `${pth}.source`, 'WARN'))
    const numericArrays = ['rect','p0','p1','label','point','anchor','hinge','leaf_end']
    for (const field of numericArrays) if (item[field] !== undefined && (!Array.isArray(item[field]) || !item[field].every(Number.isFinite))) errors.push(issue('COORDINATE', `${field} must contain finite numbers`, `${pth}.${field}`))
    if (Array.isArray(item.rect) && item.rect.length === 4 && !(item.rect[0] < item.rect[2] && item.rect[1] < item.rect[3])) errors.push(issue('RECT_BOUNDS', 'rect must satisfy x0<x1 and y0<y1', `${pth}.rect`))
    if (Array.isArray(item.contacts) && item.contacts.some((v) => !['N','S','E','W'].includes(v))) errors.push(issue('CONTACTS', 'contacts may only contain N/S/E/W', `${pth}.contacts`))
    if (item.confidence !== 'explicit') warnings.push(issue('EVIDENCE_REVIEW', 'inferred/unresolved object must be reported for review', pth, 'WARN'))
  }
  const result = { ok: errors.length === 0, errors, warnings, counts: { errors: errors.length, warnings: warnings.length }, object_count: seen.size }
  return result
}
function validateTraceManifest(input) {
  const errors = [], warnings = []
  let manifest
  try { manifest = readJsonInput(input, 'manifest') } catch (error) { return { ok: false, errors: [issue('TRACE_INPUT', error.message)], warnings: [], counts: { errors: 1, warnings: 0 } } }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return { ok: false, errors: [issue('SCHEMA_ROOT', 'manifest must be an object', 'root')], warnings: [], counts: { errors: 1, warnings: 0 } }
  if (!manifest.meta || typeof manifest.meta !== 'object' || !manifest.meta.title || !manifest.meta.source) errors.push(issue('SCHEMA_META', 'meta.title and meta.source are required', 'meta'))
  if (manifest.meta?.tolerance_mm !== undefined && !(Number.isFinite(manifest.meta.tolerance_mm) && manifest.meta.tolerance_mm > 0)) errors.push(issue('SCHEMA_TOLERANCE', 'meta.tolerance_mm must be greater than zero', 'meta.tolerance_mm'))
  if (!Array.isArray(manifest.source_layers)) errors.push(issue('SCHEMA_SOURCE_LAYERS', 'source_layers must be an array', 'source_layers'))
  if (!Array.isArray(manifest.mappings)) errors.push(issue('SCHEMA_MAPPINGS', 'mappings must be an array', 'mappings'))
  for (const key of ['additions', 'exclusions']) if (manifest[key] !== undefined && !Array.isArray(manifest[key])) errors.push(issue('SCHEMA_ARRAY', `${key} must be an array`, key))
  const mappedLayers = new Set(), layerNames = new Set()
  for (const [i, layer] of (manifest.source_layers || []).entries()) {
    const pth = `source_layers[${i}]`
    if (!layer || !layer.name || layerNames.has(layer.name)) errors.push(issue('SL_SCHEMA', 'layer name is required and unique', pth))
    else layerNames.add(layer.name)
    if (!['mapped','excluded','empty'].includes(layer?.status)) errors.push(issue('SL_STATUS', 'status must be mapped, excluded, or empty', `${pth}.status`))
    if (layer?.status === 'mapped') mappedLayers.add(layer.name)
  }
  const refs = new Set(), mapNames = new Set()
  for (const [i, item] of (manifest.mappings || []).entries()) {
    const pth = `mappings[${i}]`
    if (!item || !item.su_name || mapNames.has(item?.su_name)) errors.push(issue('MAP_DUP', 'su_name is required and unique', pth)); else mapNames.add(item.su_name)
    for (const field of ['su_kind','source_layer','confidence','center_xy','footprint_wh']) if (item?.[field] === undefined) errors.push(issue('MAP_SCHEMA', `${field} is required`, `${pth}.${field}`))
    if (item?.source_layer) refs.add(item.source_layer)
    if (item?.confidence && !['explicit','inferred','user_confirmed'].includes(item.confidence)) errors.push(issue('MAP_CONF', 'invalid confidence', `${pth}.confidence`))
    if (item?.center_xy && (!Array.isArray(item.center_xy) || item.center_xy.length !== 2 || !item.center_xy.every(Number.isFinite))) errors.push(issue('MAP_GEOM', 'center_xy must be two finite numbers', `${pth}.center_xy`))
    if (item?.footprint_wh && (!Array.isArray(item.footprint_wh) || item.footprint_wh.length !== 2 || !item.footprint_wh.every(Number.isFinite) || item.footprint_wh.some((v) => v <= 0))) errors.push(issue('MAP_GEOM', 'footprint_wh must contain two positive numbers', `${pth}.footprint_wh`))
    if (Array.isArray(item?.contacts) && item.contacts.some((v) => !['N','S','E','W'].includes(v))) errors.push(issue('MAP_CONTACTS', 'contacts may only contain N/S/E/W', `${pth}.contacts`))
  }
  for (const layer of mappedLayers) if (!refs.has(layer)) errors.push(issue('COVERAGE_GAP', `mapped layer has no mapping: ${layer}`, 'source_layers'))
  for (const [i, add] of (manifest.additions || []).entries()) if (!add?.approved_by) errors.push(issue('ADD_NO_APPROVAL', 'addition requires approved_by', `additions[${i}]`))
  const excluded = new Set()
  for (const [i, item] of (manifest.exclusions || []).entries()) {
    if (!item?.layer || !item?.reason) errors.push(issue('EXCLUSION_SCHEMA', 'exclusion requires layer and reason', `exclusions[${i}]`))
    else excluded.add(item.layer)
  }
  for (const layer of (manifest.source_layers || [])) if (layer.status === 'excluded' && !excluded.has(layer.name)) warnings.push(issue('EXCLUSION_NO_REASON', `excluded layer has no exclusion record: ${layer.name}`, 'exclusions', 'WARN'))
  for (const layer of refs) if (!layerNames.has(layer)) errors.push(issue('MAP_SOURCE_LAYER', `mapping references unknown source layer: ${layer}`, 'mappings', 'ERROR'))
  return { ok: errors.length === 0, errors, warnings, counts: { errors: errors.length, warnings: warnings.length }, mapping_count: (manifest.mappings || []).length }
}

module.exports = { requestId, classifyError, redact, errorResult, withCallMeta, traceEvent, runToolLifecycle, atomicWriteJson, assertAllowedPath, configuredAllowedRoots, guardWritePath, writeEvidence, serverCapabilities, serverHealth, validateEvidenceManifest, validateToolArguments, runValidatedToolLifecycle, beginRequest, requestStatus, cancelRequest, listRequestStatus, finishRequest, cancellationError, assertLocalUrl, policyFor, assertToolPolicy, validateSemanticPlan, validateTraceManifest }
