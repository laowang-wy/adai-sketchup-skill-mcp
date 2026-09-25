'use strict';
// One transport implementation for native MCP and the packaged stdio client.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const {setTimeout: delay} = require('node:timers/promises');
const normalize = value => path.resolve(value).toLowerCase();
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const execFileAsync = promisify(execFile);
async function processImages(processId = null) {
  if (process.platform !== 'win32') return null;
  try {
    const args = processId == null
      ? ['/FO', 'CSV', '/NH']
      : ['/FI', `PID eq ${Number(processId)}`, '/FO', 'CSV', '/NH'];
    const {stdout} = await execFileAsync('tasklist.exe', args, {windowsHide:true, maxBuffer:4 * 1024 * 1024});
    const images = new Map();
    for (const line of String(stdout).split(/\r?\n/)) {
      const match = line.match(/^"([^"]+)","(\d+)"/);
      if (match) images.set(Number(match[2]), String(match[1]).toLowerCase());
    }
    return images;
  } catch { return null; }
}
async function processResponsive(processId) {
  if (process.platform !== 'win32' || !Number.isFinite(Number(processId))) return null;
  try {
    const {stdout} = await execFileAsync('tasklist.exe', ['/V', '/FI', `PID eq ${Number(processId)}`, '/FO', 'CSV', '/NH'], {windowsHide:true, maxBuffer:1024 * 1024});
    const line = String(stdout).split(/\r?\n/).find(value => value.trim().startsWith('"'));
    if (!line) return false;
    const fields = []; const re = /"((?:[^"]|"")*)"(?=,|$)/g; let match;
    while ((match = re.exec(line))) fields.push(match[1].replace(/""/g, '"'));
    const status = String(fields[5] || '').trim().toLowerCase();
    if (!status) return null;
    if (status === 'running') return true;
    if (status === 'not responding') return false;
    // Console/background processes often report "Unknown". This is not proof
    // of a hung SketchUp window, so let the normal instance/receipt path decide.
    return null;
  } catch { return null; }
}
function requiresSketchUpImage(executable) {
  return process.platform === 'win32' && path.basename(String(executable)).toLowerCase() === 'sketchup.exe';
}
function processImageMatches(record, images) {
  if (!requiresSketchUpImage(record.executable)) return true;
  return Boolean(images && images.get(record.process_id) === 'sketchup.exe');
}
async function readJson(file) { return JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, '')); }
function bridgeError(message, code, details = {}) {
  const error = new Error(message);
  if (code) error.code = code;
  Object.assign(error, details);
  return error;
}
class BridgeClient {
  constructor(appData, env = process.env) {
    this.appData = appData;
    this.env = env;
    this.root = env.SKETCHUP_BRIDGE_DIR || path.join(appData, 'SketchUpLiveMCP', 'bridge');
    this.selectionFile = path.join(appData, 'SketchUpLiveMCP', 'runtime-instance.json');
    this.pinned = null;
    this.runtimeHashCache = null;
  }
  async token() {
    const value = this.env.SKETCHUP_BRIDGE_TOKEN || await fs.readFile(this.env.SKETCHUP_BRIDGE_TOKEN_FILE || path.join(this.appData, 'SketchUpLiveMCP', 'bridge.token'), 'utf8');
    if (!value.trim()) throw Error('BRIDGE_TOKEN_MISSING: start the installed SketchUp extension first');
    return value.trim();
  }
  async instances() {
    const dir = path.join(this.root, 'instances');
    let files;
    try { files = await fs.readdir(dir); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
    const images = await processImages();
    const result = [];
    for (const file of files.filter(f => /^\d+\.json$/.test(f))) {
      try {
        const record = await readJson(path.join(dir, file));
        if (record.protocol === 'sketchup-file-bridge/v3' && Number.isSafeInteger(record.process_id) &&
            record.process_id > 0 && file === `${record.process_id}.json` && /^[a-f0-9]{32}$/.test(record.session_id) &&
            path.isAbsolute(record.executable) && alive(record.process_id) && processImageMatches(record, images)) result.push(record);
      } catch { /* Ignore incomplete or stale registrations, never execute them. */ }
    }
    return result;
  }
  async select(processId) {
    const candidates = await this.candidates();
    const record = candidates.find(item => item.process_id === processId);
    if (!record) throw Error('INSTANCE_NOT_BOUND: PID must belong to the bound executable and protocol v3');
    const tmp = `${this.selectionFile}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.writeFile(tmp, JSON.stringify(record), {flag:'wx'});
      await fs.rename(tmp, this.selectionFile);
    } finally { await fs.rm(tmp, {force:true}).catch(()=>{}); }
    this.pinned = record;
    return {ok:true, selected:record};
  }
  async candidates() {
    let binding;
    try { binding = await readJson(path.join(this.appData, 'SketchUpLiveMCP', 'runtime-target.json')); }
    catch (e) { if (e.code === 'ENOENT') throw Error('RUNTIME_UNBOUND: bind the user-provided SketchUp executable first'); throw e; }
    if (!binding.executable || !path.isAbsolute(binding.executable)) throw Error('INVALID_RUNTIME_BINDING');
    if (!/^[a-f0-9]{64}$/.test(binding.executable_sha256 || '')) throw Error('INVALID_RUNTIME_BINDING');
    // Avoid hashing a large SketchUp executable before every read-only call.
    // The cache is short-lived and invalidated by file metadata changes;
    // instance/session checks still run for every request.
    const stat = await fs.stat(binding.executable);
    const cache = this.runtimeHashCache;
    const cacheValid = cache && cache.path === normalize(binding.executable) &&
      cache.size === stat.size && cache.mtimeMs === stat.mtimeMs &&
      Date.now() - cache.checkedAt < 1500;
    const digest = cacheValid
      ? cache.digest
      : crypto.createHash('sha256').update(await fs.readFile(binding.executable)).digest('hex');
    if (!cacheValid) this.runtimeHashCache = {path: normalize(binding.executable), size: stat.size, mtimeMs: stat.mtimeMs, digest, checkedAt: Date.now()};
    if (digest !== binding.executable_sha256) throw Error('RUNTIME_EXECUTABLE_CHANGED: inspect and rebind the designated executable');
    return (await this.instances()).filter(item => normalize(item.executable) === normalize(binding.executable));
  }
  async target() {
    const candidates = await this.candidates();
    let selected = this.pinned;
    if (!selected && this.env.SKETCHUP_TARGET_PID) {
      selected = candidates.find(item => item.process_id === Number(this.env.SKETCHUP_TARGET_PID));
      if (!selected) throw Error('INSTANCE_NOT_RUNNING: explicit PID is unavailable');
    }
    if (!selected) {
      try { selected = await readJson(this.selectionFile); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    }
    if (selected) {
      const match = candidates.find(item => item.process_id === selected.process_id && item.session_id === selected.session_id);
      if (!match) throw bridgeError('INSTANCE_CHANGED: use runtime instances/select_instance; no automatic process switching', 'INSTANCE_CHANGED', {delivery_state:'not_published', request_published:false});
      this.pinned = match;
      return match;
    }
    if (candidates.length !== 1) throw Error(candidates.length ? 'AMBIGUOUS_INSTANCES: select_instance with the intended PID' : 'BRIDGE_NOT_RUNNING: launch the bound executable with the v3 extension; do not guess another installation');
    this.pinned = candidates[0];
    return this.pinned;
  }
  async targetStillRegistered(target) {
    if (!target || !Number.isSafeInteger(Number(target.process_id)) || !target.session_id) return false;
    if (!alive(Number(target.process_id))) return false;
    try {
      const record = await readJson(path.join(this.root, 'instances', `${target.process_id}.json`));
      if (record.protocol !== 'sketchup-file-bridge/v3' || record.session_id !== target.session_id ||
          Number(record.process_id) !== Number(target.process_id) || normalize(record.executable) !== normalize(target.executable)) return false;
      const images = await processImages(target.process_id);
      return processImageMatches(record, images);
    } catch { return false; }
  }
  async targetLostError(target, requestId = null) {
    return bridgeError(`RESULT_UNKNOWN: target SketchUp instance ${target?.process_id || 'unknown'} disappeared after request publication; inspect the operation and do not replay`, 'RESULT_UNKNOWN', {delivery_state:'published_unknown', request_published:true, request_id:requestId});
  }
  async call(command, args = {}, timeoutMs = 30000, signal) {
    if (!Number.isFinite(timeoutMs) || timeoutMs < 100 || timeoutMs > 1800000) throw Error('INVALID_BRIDGE_TIMEOUT');
    let target;
    try { target = await this.target(); }
    catch (error) {
      if (error.delivery_state === undefined) Object.assign(error, {delivery_state:'not_published', request_published:false});
      throw error;
    }
    let token;
    try { token = await this.token(); } // Read per call: a server can start before the extension creates its token.
    catch (error) { Object.assign(error, {delivery_state:'not_published', request_published:false}); throw error; }
    const payload = {command,args,operation_id:args && args.operation_id ? String(args.operation_id) : null,timeout_ms:timeoutMs,target_process_id:target.process_id,target_session_id:target.session_id};
    if ((this.env.SKETCHUP_BRIDGE_MODE || 'file') === 'file') return this.fileCall(target, {...payload,token}, timeoutMs, signal);
    const url = this.env.SKETCHUP_BRIDGE_URL || `http://${this.env.SKETCHUP_BRIDGE_HOST || '127.0.0.1'}:${this.env.SKETCHUP_BRIDGE_PORT || 9876}`;
    if (!['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname.toLowerCase())) throw Error('LOCAL_RUNTIME_REQUIRED');
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    if (signal?.aborted) throw signal.reason || Error('Cancelled');
    signal?.addEventListener('abort', abort, {once:true});
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      if (!(await this.targetStillRegistered(target))) throw bridgeError('INSTANCE_CHANGED: selected SketchUp instance is no longer registered; request was not published', 'INSTANCE_CHANGED', {delivery_state:'not_published', request_published:false});
      const response = await fetch(`${url}/command`, {method:'POST',headers:{'content-type':'application/json','x-codex-sketchup-token':token},body:JSON.stringify(payload),signal:controller.signal});
      const result = await response.json();
      if (!response.ok || !result.ok) throw bridgeError(result.error || `Bridge HTTP ${response.status}`, result.code || 'BRIDGE_ERROR', {delivery_state:'response', request_published:true});
      return result;
    } catch (e) {
      // Never replay an HTTP write through a different transport after an unknown outcome.
      if (controller.signal.aborted) throw bridgeError('RESULT_UNKNOWN: inspect request/project state before retrying', 'RESULT_UNKNOWN', {delivery_state:'published_unknown', request_published:true});
      throw e;
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
  async fileCall(target, payload, timeoutMs, signal) {
    const dir = path.join(this.root, 'processes', String(target.process_id), target.session_id);
    const id = crypto.randomUUID();
    const request = path.join(dir, 'requests', `${id}.json`);
    const response = path.join(dir, 'responses', `${id}.json`);
    const temp = request + '.tmp';
    const deadline = Date.now() + timeoutMs;
    let nextTargetCheck = 0;
    if (signal?.aborted) throw signal.reason || Error('Cancelled');
    // Re-check immediately before dispatch. A selected PID may have exited or
    // been replaced after target() returned; never send into a stale process
    // directory or silently switch to a different SketchUp instance.
    if (!(await this.targetStillRegistered(target))) throw bridgeError('INSTANCE_CHANGED: selected SketchUp instance is no longer registered; request was not published', 'INSTANCE_CHANGED', {delivery_state:'not_published', request_published:false, request_id:id});
    const responsiveBeforePublish = await processResponsive(target.process_id);
    if (responsiveBeforePublish === false) throw bridgeError('INSTANCE_NOT_RESPONDING: selected SketchUp instance is not accepting work; request was not published', 'INSTANCE_NOT_RESPONDING', {delivery_state:'not_published', request_published:false, request_id:id});
    try {
      await fs.writeFile(temp, JSON.stringify({...payload,id,protocol:'sketchup-file-bridge/v3',created_at:new Date().toISOString(),expires_at:new Date(deadline).toISOString()}), {flag:'wx'});
      await fs.rename(temp, request);
    } catch (error) {
      Object.assign(error, {delivery_state:'not_published', request_published:false, request_id:id});
      throw error;
    } finally { await fs.rm(temp, {force:true}).catch(()=>{}); }
    try {
      while (Date.now() < deadline) {
        if (signal?.aborted) throw signal.reason || Error('Cancelled');
        // A claimed request can leave its outcome unknown if SketchUp exits.
        // Detect that boundary promptly instead of waiting for the full bridge
        // timeout. The caller must inspect the receipt/project before retrying.
        if (Date.now() >= nextTargetCheck) {
          if (!(await this.targetStillRegistered(target))) throw await this.targetLostError(target);
          // tasklist/registry validation is deliberately bounded; the bridge
          // remains responsive without spawning a process query every 100 ms.
          nextTargetCheck = Date.now() + 500;
        }
        try {
          const envelope = await readJson(response);
          if (envelope.id !== id) throw Error('BRIDGE_RESPONSE_ID_MISMATCH');
          await fs.unlink(response);
          if (!envelope.result?.ok) throw bridgeError(envelope.result?.error || 'BRIDGE_ERROR', envelope.result?.code || 'BRIDGE_ERROR', {delivery_state:'response', request_published:true, request_id:id});
          return envelope.result;
        } catch (e) { if (e.code !== 'ENOENT') throw e; }
        await delay(100, undefined, {signal});
      }
      throw bridgeError(`RESULT_UNKNOWN: request ${id} timed out; no automatic replay`, 'RESULT_UNKNOWN', {delivery_state:'published_unknown', request_published:true, request_id:id});
    } catch (e) {
      // Remove only this caller's unclaimed request; a claimed operation may still be completing.
      try { await fs.unlink(request); } catch (cleanup) { if (cleanup.code !== 'ENOENT') e.message += `; cleanup: ${cleanup.message}`; }
      throw e;
    }
  }
  async health() { return {protocol:'sketchup-file-bridge/v3',directory:this.root,instances:await this.instances(),selected:this.pinned,token_configured:await this.token().then(()=>true,()=>false)}; }
}
module.exports = {BridgeClient, __test:{processImageMatches, requiresSketchUpImage, processResponsive}};
