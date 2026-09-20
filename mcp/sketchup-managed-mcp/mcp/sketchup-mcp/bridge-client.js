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
async function processImages() {
  if (process.platform !== 'win32') return null;
  try {
    const {stdout} = await execFileAsync('tasklist.exe', ['/FO', 'CSV', '/NH'], {windowsHide:true, maxBuffer:4 * 1024 * 1024});
    const images = new Map();
    for (const line of String(stdout).split(/\r?\n/)) {
      const match = line.match(/^"([^"]+)","(\d+)"/);
      if (match) images.set(Number(match[2]), String(match[1]).toLowerCase());
    }
    return images;
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
class BridgeClient {
  constructor(appData, env = process.env) {
    this.appData = appData;
    this.env = env;
    this.root = env.SKETCHUP_BRIDGE_DIR || path.join(appData, 'SketchUpLiveMCP', 'bridge');
    this.selectionFile = path.join(appData, 'SketchUpLiveMCP', 'runtime-instance.json');
    this.pinned = null;
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
    const digest = crypto.createHash('sha256').update(await fs.readFile(binding.executable)).digest('hex');
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
      if (!match) throw Error('INSTANCE_CHANGED: use runtime instances/select_instance; no automatic process switching');
      this.pinned = match;
      return match;
    }
    if (candidates.length !== 1) throw Error(candidates.length ? 'AMBIGUOUS_INSTANCES: select_instance with the intended PID' : 'BRIDGE_NOT_RUNNING: launch the bound executable with the v3 extension; do not guess another installation');
    this.pinned = candidates[0];
    return this.pinned;
  }
  async call(command, args = {}, timeoutMs = 30000, signal) {
    if (!Number.isFinite(timeoutMs) || timeoutMs < 100 || timeoutMs > 1800000) throw Error('INVALID_BRIDGE_TIMEOUT');
    const target = await this.target();
    const token = await this.token(); // Read per call: a server can start before the extension creates its token.
    const payload = {command,args,timeout_ms:timeoutMs,target_process_id:target.process_id,target_session_id:target.session_id};
    if ((this.env.SKETCHUP_BRIDGE_MODE || 'file') === 'file') return this.fileCall(target, {...payload,token}, timeoutMs, signal);
    const url = this.env.SKETCHUP_BRIDGE_URL || `http://${this.env.SKETCHUP_BRIDGE_HOST || '127.0.0.1'}:${this.env.SKETCHUP_BRIDGE_PORT || 9876}`;
    if (!['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname.toLowerCase())) throw Error('LOCAL_RUNTIME_REQUIRED');
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    if (signal?.aborted) throw signal.reason || Error('Cancelled');
    signal?.addEventListener('abort', abort, {once:true});
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${url}/command`, {method:'POST',headers:{'content-type':'application/json','x-codex-sketchup-token':token},body:JSON.stringify(payload),signal:controller.signal});
      const result = await response.json();
      if (!response.ok || !result.ok) throw Error(result.error || `Bridge HTTP ${response.status}`);
      return result;
    } catch (e) {
      // Never replay an HTTP write through a different transport after an unknown outcome.
      if (controller.signal.aborted) throw Error('RESULT_UNKNOWN: inspect request/project state before retrying');
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
    if (signal?.aborted) throw signal.reason || Error('Cancelled');
    try {
      await fs.writeFile(temp, JSON.stringify({...payload,id,protocol:'sketchup-file-bridge/v3',created_at:new Date().toISOString(),expires_at:new Date(deadline).toISOString()}), {flag:'wx'});
      await fs.rename(temp, request);
    } finally { await fs.rm(temp, {force:true}).catch(()=>{}); }
    try {
      while (Date.now() < deadline) {
        if (signal?.aborted) throw signal.reason || Error('Cancelled');
        try {
          const envelope = await readJson(response);
          if (envelope.id !== id) throw Error('BRIDGE_RESPONSE_ID_MISMATCH');
          await fs.unlink(response);
          if (!envelope.result?.ok) throw Error(envelope.result?.error || 'BRIDGE_ERROR');
          return envelope.result;
        } catch (e) { if (e.code !== 'ENOENT') throw e; }
        await delay(100, undefined, {signal});
      }
      throw Error(`RESULT_UNKNOWN: request ${id} timed out; no automatic replay`);
    } catch (e) {
      // Remove only this caller's unclaimed request; a claimed operation may still be completing.
      try { await fs.unlink(request); } catch (cleanup) { if (cleanup.code !== 'ENOENT') e.message += `; cleanup: ${cleanup.message}`; }
      throw e;
    }
  }
  async health() { return {protocol:'sketchup-file-bridge/v3',directory:this.root,instances:await this.instances(),selected:this.pinned,token_configured:await this.token().then(()=>true,()=>false)}; }
}
module.exports = {BridgeClient, __test:{processImageMatches, requiresSketchUpImage}};
