'use strict';
/**
 * ADAI SketchUp 底座 — 经验包（REF Pack）加载器
 *
 * 定位：底座负责“怎么操作 SketchUp”，经验包负责“该怎么建”。
 * 经验包是纯文本 + 图片的离线文件夹，本模块只读取、匹配、返回，
 * 普通包仅作为数据读取。编译 provider 需要显式信任后执行，返回内容不改变 MCP 策略。
 *
 * 磁盘布局（全部离线，位于 %APPDATA%\SketchUpLiveMCP\ref-packs）：
 *   registry.json     已安装经验包索引
 *   packs/<id>/       包本体（REF.md + assets/）
 *   inbox/            拖入即装的收件箱（list 时自动导入）
 *   drafts/           由修复经验生成的待审草稿，永不自动启用
 *   usage.jsonl       每次使用记录（项目 / 包 / 版本 / 指纹）
 */
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const runFile = promisify(execFile);

const SCHEMA_VERSION = 1;
const REF_FILE = 'REF.md';
const MAX_FILES = 200;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;
const MAX_SINGLE_BYTES = 2 * 1024 * 1024;
const MAX_SECTIONS = 400;
const MAX_READ_CHARS = 20000;
const MAX_EXCERPT = 320;
const MAX_MATCH = 40;

// 经验包只能“建议”。这些模式提示包内容可能与引擎安全策略冲突，
// 导入时给出警告，匹配时标记 advisory_only，但永不改变引擎行为。
const POLICY_PATTERNS = [
  '关闭事务', '关掉事务', '绕过事务', '跳过保存检查', '跳过检查', '跳过审查', '跳过 review',
  '忽略保存', '直接保存', '直接打开', '直接清空', '清空模型', '关闭证据', '跳过证据',
  'disable transaction', 'skip save check', 'skip review', 'bypass', 'ignore save', 'clear model',
];

const IMAGE_MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
const TEXT_EXT = new Set(['.md', '.txt', '.json', '.csv', '.yml', '.yaml', '.rb', '.py', '.js']);
const BLOCKED_EXT = new Set(['.exe', '.dll', '.bat', '.cmd', '.ps1', '.com', '.scr', '.msi', '.lnk', '.vbs', '.js.map']);

function refRoot(appDataDir) {
  return path.join(appDataDir || process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'SketchUpLiveMCP', 'ref-packs');
}
function layouts(appDataDir) {
  const root = refRoot(appDataDir);
  return {
    root,
    registry: path.join(root, 'registry.json'),
    packs: path.join(root, 'packs'),
    inbox: path.join(root, 'inbox'),
    drafts: path.join(root, 'drafts'),
    draftReviews: path.join(root, 'draft-reviews'),
    staged: path.join(root, 'staged'),
    usage: path.join(root, 'usage.jsonl'),
  };
}


const bundledBootstrapped = new Set();
function bundledRefRoot() {
  const configured = String(process.env.PIPCLAW_BUNDLED_REF_ROOT || '').trim();
  return configured ? path.resolve(configured) : '';
}

async function installBundledPacks(appDataDir) {
  const storeKey = refRoot(appDataDir);
  if (bundledBootstrapped.has(storeKey)) return [];
  const root = bundledRefRoot();
  if (!root || !fsSync.existsSync(root)) {
    bundledBootstrapped.add(storeKey);
    return [];
  }
  const entries = await fs.readdir(root, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (!entry.isDirectory() && !/\.zip$/i.test(entry.name)) continue;
    const candidate = path.join(root, entry.name);
    try {
      const result = await importPack(appDataDir, { path: candidate });
      results.push({ source: entry.name, ok: Boolean(result.ok), action: result.action || '', pack_id: result.pack && result.pack.id, version: result.pack && result.pack.version });
    } catch (error) {
      const message = String(error && error.message ? error.message : error);
      if (/already installed/i.test(message) && entry.isDirectory()) {
        const raw=await fs.readFile(path.join(candidate,REF_FILE),'utf8');
        const id=(raw.match(/^id:\s*(.+)$/m)||[])[1]?.trim();
        const version=(raw.match(/^version:\s*(.+)$/m)||[])[1]?.trim();
        const registry=JSON.parse(await fs.readFile(layouts(appDataDir).registry,'utf8'));
        const installed=registry.packs[id];
        results.push({source:entry.name,ok:true,preserved_existing:true,pack_id:id,installed_version:installed?.version,bundled_version:version,update_available:installed?.version!==version,update_request:{action:'import',path:candidate,overwrite:true},note:'Existing local pack preserved; explicit import overwrite required. Version difference is not an automatic upgrade approval.'});
      } else results.push({ source: entry.name, ok: false, preserved_existing: false, error: message });
    }
  }
  bundledBootstrapped.add(storeKey);
  return results;
}

function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
function nowIso() { return new Date().toISOString(); }
function isPlainObject(v) { return Boolean(v) && typeof v === 'object' && !Array.isArray(v); }

function slug(input, fallback) {
  const s = String(input || '').trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
  return s || fallback;
}
function sectionId(title) { return 'sec-' + sha256(title).slice(0, 10); }

function ensureInside(root, target) {
  const r = path.resolve(root);
  const t = path.resolve(target);
  if (t !== r && !t.startsWith(r + path.sep)) throw new Error('refusing path outside store: ' + target);
  return t;
}

/* ---------- 极简 frontmatter 解析（只支持本规范用到的 YAML 子集） ---------- */

function parseScalar(raw) {
  let v = String(raw).trim();
  if (v === '') return '';
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1);
  if (v.startsWith('[') && v.endsWith(']')) {
    return v.slice(1, -1).split(',').map((x) => x.trim().replace(/^["']|["']$/g, '')).filter((x) => x !== '');
  }
  if (v === 'true') return true;
  if (v === 'false') return false;
  return v;
}

function parseFrontmatter(text) {
  const normalized = String(text).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) return { meta: {}, body: normalized, frontmatter: false };
  const end = normalized.indexOf('\n---', 3);
  if (end < 0) return { meta: {}, body: normalized, frontmatter: false };
  const head = normalized.slice(4, end);
  const body = normalized.slice(end + 4).replace(/^\n+/, '');
  const meta = Object.create(null);
  let listKey = null;
  for (const line of head.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && listKey) { meta[listKey].push(parseScalar(item[1])); continue; }
    const kv = /^([A-Za-z0-9_\u4e00-\u9fff-]+)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1].trim();
    if(['__proto__','constructor','prototype'].includes(key))throw new Error('Reserved metadata key');
    const value = kv[2].replace(/\s+#.*$/, '');
    if (value.trim() === '') { meta[key] = []; listKey = key; continue; }
    meta[key] = parseScalar(value);
    listKey = null;
  }
  return { meta, body, frontmatter: true };
}

function asArray(v) {
  if (v === undefined || v === null || v === '') return [];
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  return String(v).split(/[,，|]/).map((x) => x.trim()).filter(Boolean);
}

/* ---------- 章节拆分 ---------- */

// 支持 `## [massing|archetypes] 标题`、`## 标题 [massing,archetypes]`、`## 标题`
function parseSections(body) {
  const lines = String(body).split('\n');
  const sections = [];
  let current = null;
  const push = () => {
    if (!current) return;
    const text = current.buffer.join('\n').replace(/\s+$/g, '');
    sections.push({ id: sectionId(current.title), title: current.title, stages: current.stages, text, characters: [...text].length });
    current = null;
  };
  for (const line of lines) {
    const h = /^##\s+(.+?)\s*$/.exec(line);
    if (h) {
      push();
      let title = h[1].trim();
      let stages = [];
      let m = /^\[([^\]]*)\]\s*(.*)$/.exec(title);
      if (m) { stages = asArray(m[1].replace(/[|,，]/g, ',')); title = m[2].trim(); }
      const tail = /^(.*?)\s*\[([^\]]*)\]\s*$/.exec(title);
      if (tail && tail[1]) { title = tail[1].trim(); stages = stages.concat(asArray(tail[2].replace(/[|,，]/g, ','))); }
      if (!title) continue;
      current = { title, stages: [...new Set(stages)], buffer: [] };
      continue;
    }
    if (current) current.buffer.push(line);
  }
  push();
  if(sections.length>MAX_SECTIONS)throw new Error('Too many sections');
  return sections;
}

function scanPolicy(text) {
  const lower = String(text).toLowerCase();
  const hits = [];
  for (const p of POLICY_PATTERNS) if (lower.includes(p.toLowerCase())) hits.push(p);
  return [...new Set(hits)];
}
/* ---------- 目录扫描与包解析 ---------- */

async function collectFiles(dir, base, acc) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    const rel = base ? base + '/' + e.name : e.name;
    if (e.isDirectory()) {
      if (e.name === '.git' || e.name === 'node_modules' || e.name === '__MACOSX') continue;
      await collectFiles(abs, rel, acc);
    } else if (e.isSymbolicLink()) { throw new Error('Symbolic links are not allowed: ' + rel);
    } else if (e.isFile()) {
      const st = await fs.stat(abs);
      acc.push({ rel, abs, bytes: st.size });
      if (st.size > (rel==='provider.exe'?PROVIDER_MAX:MAX_SINGLE_BYTES)) throw new Error('file too large (>2 MiB): ' + rel);
      if (acc.length > MAX_FILES) throw new Error('pack has too many files; maximum is ' + MAX_FILES);
      if (acc.reduce((n, f) => n + (f.rel==='provider.exe'?0:f.bytes), 0) > MAX_TOTAL_BYTES) throw new Error('pack exceeds the 8 MiB total limit');
    }
  }
  return acc;
}

function mimeOf(rel) {
  const ext = path.extname(rel).toLowerCase();
  if (IMAGE_MIME[ext]) return IMAGE_MIME[ext];
  if (ext === '.json') return 'application/json';
  if (TEXT_EXT.has(ext)) return 'text/plain';
  return 'application/octet-stream';
}
function isText(rel) { return TEXT_EXT.has(path.extname(rel).toLowerCase()); }

const PROVIDER_MAX = 32 * 1024 * 1024;
async function providerManifest(dir) {
  const record = JSON.parse(await fs.readFile(path.join(dir, 'provider.json'), 'utf8'));
  if(record.schema_version!==1 || record.executable!=='provider.exe' || !/^[a-f0-9]{64}$/.test(record.sha256||'') || !Array.isArray(record.resources)) throw new Error('Malformed provider manifest');
  const ids=new Set(); let total=0;
  for(const r of record.resources) {
    if(typeof r.id!=='string' || path.isAbsolute(r.id) || /[:\\]/.test(r.id) || r.id.split('/').some(x=>!x||x==='..'||x==='.') || ids.has(r.id) || (!isText(r.id)&&!IMAGE_MIME[path.extname(r.id).toLowerCase()])) throw new Error('Invalid provider resource');
    if(!Number.isSafeInteger(r.bytes)||r.bytes<0||r.bytes>MAX_SINGLE_BYTES) throw new Error('Invalid provider resource size');
    ids.add(r.id);total+=r.bytes;
  }
  if(!ids.has('REF.md')||ids.size>MAX_FILES||total>MAX_TOTAL_BYTES) throw new Error('Provider resource limits exceeded');
  const actual=crypto.createHash('sha256');
  for await(const chunk of fsSync.createReadStream(path.join(dir,'provider.exe'))) actual.update(chunk);
  if(actual.digest('hex')!==record.sha256) throw new Error('provider.exe does not match provider.json');
  return record;
}
async function providerResult(dir, requested, record) {
  const resource=record.resources.find(r=>r.id===requested);
  if(!resource) throw new Error('Unknown provider resource');
  // Execution is allowed only after explicit import trust. Hash identifies bytes, not publisher trust.
  const {stdout}=await runFile(path.join(dir,'provider.exe'),[requested],{windowsHide:true,timeout:20000,maxBuffer:3*1024*1024,encoding:'utf8'});
  const value=String(stdout).trim();
  if(!/^[A-Za-z0-9+/]*={0,2}$/.test(value))throw new Error('Invalid provider base64');
  const buf=Buffer.from(value,'base64');
  if(buf.length!==resource.bytes || buf.toString('base64')!==value)throw new Error('Provider output size/encoding mismatch');
  return buf;
}

async function parsePackDir(dir) {
  const errors = [];
  const warnings = [];
  const files = await collectFiles(dir, '', []);
  if (files.length > MAX_FILES) errors.push('pack has ' + files.length + ' files; maximum is ' + MAX_FILES);
  let total = 0;
  for (const f of files) {
    total += f.rel==='provider.exe'?0:f.bytes;
    if (f.bytes > (f.rel==='provider.exe'?PROVIDER_MAX:MAX_SINGLE_BYTES)) errors.push('file too large (>2 MiB): ' + f.rel);
    if (f.rel!=='provider.exe' && !TEXT_EXT.has(path.extname(f.rel).toLowerCase()) && !IMAGE_MIME[path.extname(f.rel).toLowerCase()]) errors.push('only text or image files are allowed in a pack: ' + f.rel);
  }
  if (total > MAX_TOTAL_BYTES) errors.push('pack totals ' + total + ' bytes; maximum is ' + MAX_TOTAL_BYTES);

  const provider=files.find(f=>f.rel==='provider.exe');
  let providerRecord=null;
  if(provider) { try { providerRecord=await providerManifest(dir); } catch(e) { errors.push(e.message); } }
  const refRel = files.find((f) => f.rel.toLowerCase() === REF_FILE.toLowerCase());
  if (!refRel) {
    errors.push('missing REF.md at pack root');
    return { ok: false, errors, warnings, files, meta: {}, sections: [], content_sha256: '' };
  }
  const raw = await fs.readFile(refRel.abs);
  const text = raw.toString('utf8');
  const { meta, body, frontmatter } = parseFrontmatter(text);
  if (!frontmatter) errors.push('REF.md must start with a --- frontmatter block');

  const id = String(meta.id || '').trim();
  if (!id) errors.push('frontmatter field "id" is required (ASCII letters, digits, dash, underscore)');
  else if (!/^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/.test(id)) errors.push('frontmatter "id" must be 2-64 chars of ASCII letters/digits/._- : ' + id);
  if (!String(meta.name || '').trim()) warnings.push('frontmatter "name" is recommended for display');

  const state=String(meta.state || 'unverified');
  if(!['unverified','verified','retired','draft'].includes(state)) errors.push('state must be unverified/verified/retired/draft');
  if(state==='verified' && (!meta.verified_by || !meta.evidence)) errors.push('verified requires verified_by and evidence');
  const sections = parseSections(body);
  if(new Set(sections.map(s=>s.id)).size!==sections.length) errors.push('Duplicate section titles');
  if (!sections.length) warnings.push('REF.md has no "## " sections; nothing will match by stage');
  for (const s of sections) {
    const hits = scanPolicy(s.text);
    if (hits.length) warnings.push('section "' + s.title + '" mentions engine-safety terms (' + hits.join('/') + '); it stays advisory and cannot change MCP policy');
  }

  const hash = crypto.createHash('sha256');
  for (const f of files.slice().sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))) {
    hash.update(f.rel); hash.update('\u0000');
    for await(const chunk of fsSync.createReadStream(f.abs)) hash.update(chunk); hash.update('\u0000');
  }
  const content_sha256 = hash.digest('hex');

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    files,
    meta,
    sections,
    body,
    content_sha256,
    bytes: total,
    provider: providerRecord,
  };
}

/* ---------- 注册表 ---------- */

async function readRegistry(appDataDir) {
  const L = layouts(appDataDir);
  await fs.mkdir(L.packs, { recursive: true });
  await fs.mkdir(L.inbox, { recursive: true });
  await fs.mkdir(L.drafts, { recursive: true });
  await fs.mkdir(L.draftReviews, { recursive: true });
  await fs.mkdir(L.staged, { recursive: true });
  try {
    const raw = JSON.parse(await fs.readFile(L.registry, 'utf8'));
    if(raw.packs) for(const [id,p] of Object.entries(raw.packs)) {if(!/^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/.test(id)||['constructor','prototype','__proto__'].includes(id)||!isPlainObject(p)||id!==p.id)throw new Error('Invalid registry entry');}
    if (!isPlainObject(raw) || !isPlainObject(raw.packs)) throw new Error('malformed');
    return { schema_version: raw.schema_version || SCHEMA_VERSION, updated_at: raw.updated_at || null, packs: raw.packs };
  } catch(e) {
    if(e.code==='ENOENT') return {schema_version:SCHEMA_VERSION,updated_at:null,packs:{}};
    throw new Error('Registry unreadable; preserving existing file. Restore backup or repair registry.json: '+e.message);
  }
}

async function activeRefUsers(appDataDir, packId) {
 const L=layouts(appDataDir);if(!fsSync.existsSync(L.usage))return [];
 const {ManagedProjects}=require('./managed-project');
 const manager=new ManagedProjects({appDataDir,skillRoot:path.resolve(__dirname,'../../../professional-sketchup-modeling')});
 const lines=(await fs.readFile(L.usage,'utf8')).split('\n').filter(Boolean),users=[];
 for(const line of lines){let record;try{record=JSON.parse(line);}catch{continue;}
  const used=Array.isArray(record.packs)&&record.packs.some((item)=>item&&item.id===packId);
  if(!used || !record.project_id)continue;
  try{const state=await manager.readStoredStateForCas(String(record.project_id));if(state&&state.status!=='finished')users.push({project_id:record.project_id,status:state.status||'unknown'});}
  catch(error){if(error.code==='ENOENT')continue;throw Object.assign(new Error('REF_DEPENDENCY_STATE_UNVERIFIED'),{code:'REF_DEPENDENCY_STATE_UNVERIFIED',project_id:record.project_id,cause:error.code||'state_error'});}
 }
 return users;
}

async function writeRegistry(appDataDir, reg) {
  const L = layouts(appDataDir);
  reg.schema_version = SCHEMA_VERSION;
  reg.updated_at = nowIso();
  const tmp = L.registry + '.' + crypto.randomUUID() + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(reg, null, 2), 'utf8');
  await fs.rename(tmp, L.registry);
}

/* ---------- 复制（导入） ---------- */

async function copyInto(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    if (e.name === '.git' || e.name === 'node_modules' || e.name === '__MACOSX') continue;
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) await copyInto(s, d);
    else if (e.isFile()) await fs.copyFile(s, d);
    else throw new Error('Unexpected link while copying');
  }
}

async function removeTree(dir) {
  await fs.rm(dir, { recursive: true, force: true });
}


async function materializeSource(sourcePath, tmpDir) {
  const st = await fs.lstat(sourcePath);
  if(st.isSymbolicLink()) throw new Error('Source link forbidden');
  if(st.isDirectory()) return {kind:'folder',dir:sourcePath,display:sourcePath};
  if(path.extname(sourcePath).toLowerCase()!=='.zip') throw new Error('source must be a folder or .zip');
  const py=process.env.PIPCLAW_PYTHON || (process.platform==='win32'?'python':'python3');
  try{
    const {stdout}=await runFile(py,[path.join(__dirname,'safe-unzip.py'),sourcePath,tmpDir],{windowsHide:true,timeout:60000,maxBuffer:262144,encoding:'utf8'});
    const out=JSON.parse(String(stdout).replace(/^\uFEFF/,'').trim().split('\n').pop());
    if(!out.ok) throw new Error(out.error);
  }catch(e){ throw new Error('zip import rejected: '+String(e.message||e).split('\n')[0]); }
  let dir=tmpDir;
  const kids=(await fs.readdir(dir,{withFileTypes:true})).filter(e=>e.name!=='__MACOSX');
  if(kids.length===1 && kids[0].isDirectory()) dir=path.join(dir,kids[0].name);
  return {kind:'zip',dir,display:sourcePath};
}
async function importPack(appDataDir,input) {
  if(!input.path) throw new Error('import requires path');
  const L=layouts(appDataDir); const reg=await readRegistry(appDataDir);
  const source=path.resolve(input.path);
  if(source===L.root || source.startsWith(L.packs+path.sep)) throw new Error('Cannot import store into itself');
  const tmpDir=path.join(L.root,'.import-'+crypto.randomUUID());
  let stage,backup,dest,installed=false,committed=false;
  try {
    const materialized=await materializeSource(source,tmpDir);
    let parsed;
    try { parsed=await parsePackDir(materialized.dir); }
    catch(e){ return {ok:false,stage:'validate',error:String(e.message||e),errors:[String(e.message||e)],warnings:[]}; }
    if(!parsed.ok) return {ok:false,error:parsed.errors.join('; '),errors:parsed.errors,warnings:parsed.warnings};
    if(parsed.provider && input.trusted_provider!==true) throw new Error('Compiled pack executes a local program. Explicit trusted_provider:true required; inbox never auto-trusts.');
    const id=String(input.id || parsed.meta.id);
    if(!/^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/.test(id)) throw new Error('invalid pack id');
    if(['constructor','prototype','__proto__'].includes(id))throw new Error('Reserved pack id');
    const scope=input.scope || parsed.meta.scope || 'shared';
    if(!['project','company','shared'].includes(scope)) throw new Error('invalid scope');
    const projectId=String(input.project_id || parsed.meta.project_id || '');
    if(scope==='project' && !projectId) throw new Error('project scope requires project_id');
    const existing=reg.packs[id];
    if(existing && existing.content_sha256===parsed.content_sha256) return {ok:true,action:'unchanged',pack:publicPack(existing),guidance_only:true,can_modify_engine_policy:false};
    if(existing && input.overwrite!==true) throw new Error('pack id already installed; overwrite:true required');
    if(existing && input.overwrite===true){
      const users=await activeRefUsers(appDataDir,id);
      if(users.length) throw Object.assign(new Error('REF_VERSION_IN_USE'),{code:'REF_VERSION_IN_USE',projects:users});
    }
    dest=ensureInside(L.packs,path.join(L.packs,id));
    stage=path.join(L.packs,'.stage-'+crypto.randomUUID());
    await copyInto(materialized.dir,stage);
    const staged=await parsePackDir(stage);
    if(!staged.ok || staged.content_sha256!==parsed.content_sha256) throw new Error('Source changed while importing');
    if(fsSync.existsSync(dest)) {backup=dest+'.backup-'+crypto.randomUUID();await fs.rename(dest,backup);}
    await fs.rename(stage,dest);stage=null;installed=true;
    const state=String(parsed.meta.state || 'unverified');
    reg.packs[id]={id,name:String(parsed.meta.name||id),version:String(parsed.meta.version||'0.0.0'),state,
      scope,project_id:projectId,enabled:!['draft','retired'].includes(state) && (typeof input.enable==='boolean'?input.enable:(existing?existing.enabled:true)),
      source:source,imported_at:nowIso(),content_sha256:parsed.content_sha256,topics:asArray(parsed.meta.topics),
      stages:asArray(parsed.meta.stages),section_count:parsed.sections.length,asset_count:parsed.files.filter(f=>!isText(f.rel)).length,
      provider_trusted:!!parsed.provider && input.trusted_provider===true,bytes:parsed.bytes,warnings:parsed.warnings};
    await writeRegistry(appDataDir,reg);committed=true;
    if(backup) {await removeTree(backup);backup=null;}
    return {ok:true,action:existing?'replaced':'installed',pack:publicPack(reg.packs[id]),guidance_only:true,can_modify_engine_policy:false};
  } catch(e) {
    if(!committed && dest && backup){await removeTree(dest);await fs.rename(backup,dest);backup=null;}
    else if(!committed && installed && dest) await removeTree(dest);
    throw e;
  } finally {if(stage) await removeTree(stage);await removeTree(tmpDir);}
}

function publicPack(p) {
  const { source, ...rest } = p;
  return rest;
}

/* ---------- 收件箱自动导入：把文件夹拖进去就算装好 ---------- */

async function scanInbox(appDataDir) {
  const L = layouts(appDataDir);
  await fs.mkdir(L.inbox, { recursive: true });
  await readRegistry(appDataDir);
  const entries = await fs.readdir(L.inbox, { withFileTypes: true });
  const discovered = [];
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    if (!e.isDirectory() && !/\.zip$/i.test(e.name)) continue;
    const candidate = path.join(L.inbox, e.name);
    try {
      const res = await importPack(appDataDir, { path: candidate });
      if (res.ok) { discovered.push({source:e.name,pack_id:res.pack.id,version:res.pack.version,result:res.action});
        const archive=path.join(L.root,'imported');await fs.mkdir(archive,{recursive:true});
        await fs.rename(candidate,path.join(archive,crypto.randomUUID()+'-'+e.name));
      }
      else discovered.push({ source: e.name, error: res.error || (res.errors || []).join('; ') });
    } catch (err) {
      discovered.push({ source: e.name, error: String(err.message || err) });
    }
  }
  return discovered;
}

/* ---------- 载入一个已安装包的解析结果 ---------- */

async function loadPack(appDataDir, id) {
  const L = layouts(appDataDir);
  if(!/^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/.test(id)) throw new Error('invalid pack id');
  const reg=await readRegistry(appDataDir); if(!reg.packs[id]) return {ok:false,error:'pack not installed'};
  const dir = ensureInside(L.packs, path.join(L.packs, id));
  if (!fsSync.existsSync(dir)) return { ok: false, error: 'pack not installed: ' + id };
  const parsed = await parsePackDir(dir);
  if (!parsed.ok) return { ok: false, error: 'installed pack failed validation', errors: parsed.errors };
  if(parsed.content_sha256!==reg.packs[id].content_sha256) throw new Error('Installed pack changed; validate and re-import source');
  return { ok: true, dir, parsed };
}

/* ---------- 按任务与阶段匹配 ---------- */

function normalize(list) { return [...new Set(asArray(list).map((x) => String(x).trim().toLowerCase()))]; }

async function matchPacks(appDataDir, input) {
  await installBundledPacks(appDataDir);
  const reg = await readRegistry(appDataDir);
  const wantTopics = normalize(input.topics);
  const wantStages = normalize(input.stages);
  const query = String(input.query || '').trim().toLowerCase();
  const limit = Math.min(Math.max(Number(input.limit) || 12, 1), MAX_MATCH);
  const includeDisabled = input.include_disabled === true;

  const ids = Object.keys(reg.packs).sort();
  const items = [];
  const conflicts = [];
  const used = [];
  const topicOwners = new Map();
  const titleOwners = new Map();
  const ruleOwners = new Map();

  for (const id of ids) {
    const meta = reg.packs[id];
    if (!meta.enabled && !includeDisabled) continue;
    if(meta.state==='retired' || meta.state==='draft') continue;
    if(meta.scope==='project' && meta.project_id && meta.project_id!==input.project_id) continue;
    if(input.pack_ids && !input.pack_ids.includes(id)) continue;
    let loaded;
    try { loaded=await loadPack(appDataDir,id); } catch(error) {conflicts.push({kind:'broken_pack',pack_id:id,detail:String(error.message),blocking:false});continue;}
    if (!loaded.ok) { conflicts.push({ kind: 'broken_pack', pack_id: id, detail: loaded.error }); continue; }
    let ruleContract={schema_version:1,rules:[]};
    const ruleFile=path.join(loaded.dir,'rules.json');
    if(fsSync.existsSync(ruleFile)) {
      try {
        ruleContract=JSON.parse(await fs.readFile(ruleFile,'utf8'));
        if(ruleContract.schema_version!==1 || !Array.isArray(ruleContract.rules) || ruleContract.rules.length>100)throw new Error('Invalid rules contract');
        const ids=new Set();
        for(const r of ruleContract.rules) {
          if(!r || typeof r.id!=='string' || !/^[a-z0-9][a-z0-9._-]{1,127}$/.test(r.id) || ids.has(r.id) || !Array.isArray(r.stages) || typeof r.method!=='string')throw new Error('Invalid or duplicate rule');
          ids.add(r.id);
        }
      }catch(error){conflicts.push({kind:'broken_rule_contract',pack_id:id,blocking:false,detail:String(error.message)});continue;}
    }
    for(const r of ruleContract.rules) {
      if(wantStages.length && r.stages.length && !r.stages.some(st=>wantStages.includes(st)))continue;
      const matchingTopics=normalize(meta.topics);
      if(wantTopics.length && !wantTopics.some(w=>matchingTopics.some(pt=>pt===w||pt.includes(w)||w.includes(pt))))continue;
      ruleOwners.set(r.id,(ruleOwners.get(r.id)||[]).concat({pack_id:id,method:r.method,scope:meta.scope,version:meta.version}));
    }
    const packTopics = normalize(meta.topics);
    const topicHits = wantTopics.length ? wantTopics.filter((t) => packTopics.some((pt) => pt === t || pt.includes(t) || t.includes(pt))) : [];
    for (const t of topicHits) topicOwners.set(t, (topicOwners.get(t) || []).concat(id));
    let contributed = 0;
    for (const s of loaded.parsed.sections) {
      const sStages = normalize(s.stages);
      const stageHits = wantStages.length ? wantStages.filter((st) => sStages.some((ss) => ss === st)) : [];
      const generic = sStages.length === 0;
      if (wantTopics.length && topicHits.length === 0) continue;
      if (wantStages.length && stageHits.length === 0 && !generic) continue;
      if (query) {
        const hay = (s.title + '\n' + s.text).toLowerCase();
        if (!hay.includes(query)) continue;
      }
      titleOwners.set(s.title, (titleOwners.get(s.title) || []).concat(id + '#' + s.id));
      const score = topicHits.length * 10 + stageHits.length * 3 + (generic ? 1 : 0) + ({project:200,company:100,shared:0}[meta.scope]||0);
      items.push({
        pack_id: id, pack_name: meta.name, pack_version: meta.version, scope: meta.scope, state:meta.state, enabled: meta.enabled,
        section_id: s.id, title: s.title, stages: sStages, topic_hits: topicHits, stage_hits: stageHits, generic,
        characters: s.characters, score,
        excerpt: [...s.text.replace(/\s+/g, ' ').trim()].slice(0, MAX_EXCERPT).join(''),
      });
      contributed++;
    }
    if (contributed) used.push({ pack_id: id, name: meta.name, version: meta.version, scope: meta.scope, content_sha256: meta.content_sha256, sections_matched: contributed });
  }

  for (const [topic, owners] of topicOwners) {
    const uniq = [...new Set(owners)];
    // Topic overlap is routing metadata, not semantic contradiction.
  }
  for (const [title, owners] of titleOwners) {
    const uniq = [...new Set(owners.map((o) => o.split('#')[0]))];
    if (uniq.length > 1) conflicts.push({ kind: 'possible_rule_overlap', title, packs: uniq, blocking:false, action_required: 'compare applicability; same title alone does not prove conflict; use explicit pack_ids for mutually exclusive methods' });
  }

  for (const [rule_id,owners] of ruleOwners) {
    if(new Set(owners.map(r=>r.method)).size>1)conflicts.push({kind:'explicit_rule_conflict',rule_id,owners,blocking:true,action_required:'Choose applicable method and pass pack_ids; scope ranking alone does not authorize overriding a different method.'});
  }
  items.sort((a, b) => b.score - a.score || (a.pack_id < b.pack_id ? -1 : 1));
  const total = items.length;
  const offset=input.offset||0;
  const selected = items.slice(offset, offset+limit);
  const visibleUsed=used.filter(p=>selected.some(i=>i.pack_id===p.pack_id));

  if(input.project_id) await recordUsage(appDataDir,{project_id:input.project_id,phase:wantStages.join(','),packs:visibleUsed, note:'Matched candidates; sections must be read before use'});
  return {
    ok: true,
    action: 'match',
    requested_topics: wantTopics,
    requested_stages: wantStages,
    installed_pack_count: ids.length,
    enabled_pack_count: ids.filter((x) => reg.packs[x].enabled).length,
    matched_section_count: total,
    items: selected,
    packs_used: visibleUsed,
    rule_selections:[...ruleOwners].map(([rule_id,owners])=>({rule_id,owners})),
    offset,next_offset:offset+limit<total?offset+limit:null,
    conflicts,
    no_pack_loaded: used.length === 0,
    empty_reason: used.length === 0 ? 'no enabled pack covers these topics/stages; build with the base workflow only, and say so in the delivery note' : null,
    guidance_only: true,
    can_modify_engine_policy: false,
    how_to_use: 'Read the matching section with action=read (pack_id + section_id), then follow it inside the normal managed pipeline. Pack guidance never replaces sketchup_project_* transactions, evidence, review or save checks.',
  };
}

/* ---------- 读取章节 / 素材 ---------- */

async function readFromPack(appDataDir, input) {
  await installBundledPacks(appDataDir);
  const id = String(input.pack_id || input.id || '').trim();
  if (!id) return { ok: false, error: 'read requires pack_id' };
  const loaded = await loadPack(appDataDir, id);
  if (!loaded.ok) return { ok: false, error: loaded.error, errors: loaded.errors };
  if(input.expected_fingerprint && input.expected_fingerprint!==loaded.parsed.content_sha256)throw new Error('REF_VERSION_LOCK_MISMATCH');

  if(loaded.parsed.provider) {
    const reg=await readRegistry(appDataDir);
    if(!reg.packs[id].provider_trusted) throw new Error('Provider is not trusted; re-import explicitly');
  }
  if(input.project_id) await recordUsage(appDataDir,{project_id:input.project_id,phase:input.phase||'',packs:[{id,version:loaded.parsed.meta.version,sha256:loaded.parsed.content_sha256}],note:'read requested: '+(input.asset||input.section_id||input.section||'')});
  if (input.asset) {
    const rel = String(input.asset).replace(/\\/g, '/');
    if (path.isAbsolute(rel) || rel.includes(':') || rel.split('/').includes('..') || !(loaded.parsed.provider?loaded.parsed.provider.resources.some(f=>f.id===rel):loaded.parsed.files.some(f=>f.rel===rel))) return { ok: false, error: 'asset must be a relative path inside the pack' };
    const abs = ensureInside(loaded.dir, path.join(loaded.dir, rel));
    if (!loaded.parsed.provider && !fsSync.existsSync(abs)) return { ok: false, error: 'asset not found: ' + rel };
    const buf = loaded.parsed.provider ? await providerResult(loaded.dir,rel,loaded.parsed.provider) : await fs.readFile(abs);
    const mime = mimeOf(rel);
    const base = { ok: true, action: 'read', pack_id: id, asset: rel, mime_type: mime, bytes: buf.length, sha256: sha256(buf), note: 'Pack asset. Reading it is not visual inspection of the model.' };
    if (mime.startsWith('image/')) return { ...base, encoding: 'base64', data: buf.toString('base64') };
    const chars=[...buf.toString('utf8')],offset=input.offset||0,limit=Math.min(input.limit||MAX_READ_CHARS,MAX_READ_CHARS);
    if(offset>chars.length)throw new Error('offset exceeds resource length');
    return {...base,text:chars.slice(offset,offset+limit).join(''),offset,total_characters:chars.length,next_offset:offset+limit<chars.length?offset+limit:null,offset_unit:'unicode_codepoints'};
  }

  const key = String(input.section_id || input.section || '').trim();
  if (!key) return { ok: false, error: 'read requires section_id (from action=match) or asset' };
  if(loaded.parsed.provider) {
    const raw=await providerResult(loaded.dir,'REF.md',loaded.parsed.provider);
    const full=parseFrontmatter(raw.toString('utf8'));
    if(String(full.meta.id)!==String(loaded.parsed.meta.id))throw new Error('Provider metadata mismatch');
    loaded.parsed.sections=parseSections(full.body);
  }
  const sec = loaded.parsed.sections.find((s) => s.id === key) || loaded.parsed.sections.find((s) => s.title === key);
  if (!sec) return { ok: false, error: 'unknown section_id: ' + key, available: loaded.parsed.sections.map((s) => ({ section_id: s.id, title: s.title })) };
  const runes = [...sec.text];
  const offset = Math.max(Number(input.offset) || 0, 0);
  const limit = Math.min(Math.max(Number(input.limit) || MAX_READ_CHARS, 1), MAX_READ_CHARS);
  if (offset > runes.length) return { ok: false, error: 'offset exceeds section length' };
  const end = Math.min(offset + limit, runes.length);
  return {
    ok: true, action: 'read',
    pack_id: id, pack_name: loaded.parsed.meta.name || id, pack_version: loaded.parsed.meta.version || '0.0.0',
    section_id: sec.id, title: sec.title, stages: sec.stages,
    text: runes.slice(offset, end).join(''),
    offset, total_characters: runes.length, next_offset: end < runes.length ? end : null, offset_unit: 'unicode_codepoints',
    assets: loaded.parsed.files.filter((f) => f.rel !== REF_FILE && !isText(f.rel)).map((f) => f.rel),
    guidance_only: true, can_modify_engine_policy: false,
  };
}

/* ---------- 从修复经验生成草稿（永不自动启用） ---------- */

async function draftFromFix(appDataDir, input) {
  const L = layouts(appDataDir);
  await fs.mkdir(L.drafts, { recursive: true });
  const title = String(input.title || '').trim();
  const symptom = String(input.symptom || '').trim();
  const fix = String(input.fix || '').trim();
  if (!title || !symptom || !fix) return { ok: false, error: 'draft requires title, symptom and fix' };
  const topics = asArray(input.topics);
  const stages = asArray(input.stages);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(L.drafts, stamp + '-' + slug(title, 'draft').slice(0,60)+'-'+crypto.randomUUID() + '.md');
  const body = [
    '---',
    'id: ' + (String(input.pack_id || '').trim() || 'draft-' + stamp),
    'name: ' + title.replace(/[\r\n]/g,' '),
    'version: 0.0.1-draft',
    'state: draft',
    'topics: [' + topics.join(', ') + ']',
    'stages: [' + stages.join(', ') + ']',
    'scope: project',
    'source_project: ' + String(input.project_id || ''),
    '---',
    '',
    '# ' + title,
    '',
    '> 这是自动生成的草稿，**未验证**，不会自动进入任何经验包，也不会自动生效。',
    '',
    '## [' + stages.join('|') + '] ' + title,
    '',
    '### 现象（symptom）',
    symptom,
    '',
    '### 原因（cause）',
    String(input.cause || '待查'),
    '',
    '### 处理（fix）',
    fix,
    '',
    '### 证据（evidence）',
    String(input.evidence || '待补'),
    '',
    '### 检查点（checks）',
    String(input.checks || '复查同一视角与同一构造；确认未影响其它共享构件。'),
    '',
    '### 已验证范围（verified）',
    '未验证。需要维护者在真实项目中复现并确认后才可升级为已验证。',
    '',
    '### 不适用情况（not_applicable）',
    String(input.not_applicable || '待补'),
    '',
  ].join('\n');
  await fs.writeFile(file, body, 'utf8');
  return {
    ok: true, action: 'draft', draft_path: file, state: 'unverified_draft', auto_enabled: false,
    next: 'Review it, then move it into the target pack folder as a section and re-import with overwrite:true.',
  };
}

/* ---------- 草稿审核与发布：两步确认，只生成待导入包 ---------- */

function cleanLine(value, field) {
  const text = String(value || '').replace(/[\r\n]+/g, ' ').trim();
  if (!text) throw new Error(field + ' is required');
  return text;
}
function yamlList(values) { return '[' + asArray(values).map((x) => x.replace(/[\r\n,\[\]]+/g, ' ').trim()).filter(Boolean).join(', ') + ']'; }
function draftFile(L, input) {
  const raw = cleanLine(input.draft_path, 'draft_path');
  const file = ensureInside(L.drafts, path.resolve(raw));
  if (path.extname(file).toLowerCase() !== '.md' || !fsSync.existsSync(file) || !fsSync.statSync(file).isFile()) throw new Error('draft_path must be an existing .md file inside the drafts directory');
  return file;
}
async function reviewDraft(appDataDir, input) {
  const L = layouts(appDataDir); await readRegistry(appDataDir);
  const file = draftFile(L, input);
  const raw = await fs.readFile(file, 'utf8');
  const parsed = parseFrontmatter(raw);
  if (!parsed.frontmatter || String(parsed.meta.state || '') !== 'draft') throw new Error('draft_path must contain state: draft frontmatter');
  const targetId = cleanLine(input.target_pack_id || input.pack_id, 'target_pack_id');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/.test(targetId) || ['constructor','prototype','__proto__'].includes(targetId)) throw new Error('invalid target_pack_id');
  const version = cleanLine(input.version, 'version');
  if (!/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(version)) throw new Error('version must be semver-like, for example 1.0.0');
  const verifiedBy = cleanLine(input.verified_by, 'verified_by');
  const evidence = cleanLine(input.evidence, 'evidence');
  const scope = String(input.scope || parsed.meta.scope || 'company');
  if (!['project','company','shared'].includes(scope)) throw new Error('invalid scope');
  const projectId = String(input.project_id || parsed.meta.source_project || '').trim();
  if (scope === 'project' && !projectId) throw new Error('project scope requires project_id');
  const topics = asArray(input.topics).length ? asArray(input.topics) : asArray(parsed.meta.topics);
  const stages = asArray(input.stages).length ? asArray(input.stages) : asArray(parsed.meta.stages);
  if (!topics.length) throw new Error('at least one topic is required');
  const proposal = {target_pack_id:targetId,name:cleanLine(parsed.meta.name || targetId,'name'),version,state:'verified',scope,project_id:projectId,topics,stages,verified_by:verifiedBy,evidence};
  const operationId='draft-'+crypto.randomUUID();
  const summary=`发布草稿 ${path.basename(file)} → ${targetId}@${version}；范围=${scope}${projectId?'；项目='+projectId:''}；验证人=${verifiedBy}；证据=${evidence}`;
  const record={schema_version:1,operation_id:operationId,created_at:nowIso(),draft_path:file,draft_sha256:sha256(Buffer.from(raw)),proposal,confirmation_summary:summary};
  await fs.writeFile(ensureInside(L.draftReviews,path.join(L.draftReviews,operationId+'.json')),JSON.stringify(record,null,2),'utf8');
  return {ok:true,action:'draft_review',operation_id:operationId,confirmation_summary:summary,proposal,changes_model:false,next:'核对 confirmation_summary；确认后调用 action=draft_publish，并原样传 operation_id 与 confirmation_summary。'};
}
async function publishDraft(appDataDir, input) {
  const L=layouts(appDataDir);await readRegistry(appDataDir);
  const operationId=String(input.operation_id||'').trim();
  if(!/^draft-[0-9a-f-]{36}$/i.test(operationId))throw new Error('invalid operation_id');
  const opFile=ensureInside(L.draftReviews,path.join(L.draftReviews,operationId+'.json'));
  const record=JSON.parse(await fs.readFile(opFile,'utf8'));
  if(String(input.confirmation_summary||'')!==record.confirmation_summary)throw new Error('confirmation_summary mismatch; run draft_review again and approve the exact summary');
  const raw=await fs.readFile(draftFile(L,{draft_path:record.draft_path}),'utf8');
  if(sha256(Buffer.from(raw))!==record.draft_sha256)throw new Error('draft changed after review; run draft_review again');
  const parsed=parseFrontmatter(raw),m=record.proposal;
  const dest=ensureInside(L.staged,path.join(L.staged,m.target_pack_id+'-'+m.version));
  if(fsSync.existsSync(dest)&&input.overwrite!==true)throw new Error('staged output exists; overwrite:true required');
  const tmp=ensureInside(L.staged,path.join(L.staged,'.stage-'+crypto.randomUUID()));
  const head=['---','id: '+m.target_pack_id,'name: '+m.name,'version: '+m.version,'state: verified','topics: '+yamlList(m.topics),'stages: '+yamlList(m.stages),'scope: '+m.scope];
  if(m.project_id)head.push('project_id: '+m.project_id);
  head.push('verified_by: '+m.verified_by,'evidence: '+m.evidence,'---','');
  await fs.mkdir(tmp,{recursive:true});
  await fs.writeFile(path.join(tmp,REF_FILE),head.join('\n')+parsed.body.replace(/^\s+/,''),'utf8');
  const checked=await parsePackDir(tmp);
  if(!checked.ok) {await removeTree(tmp);throw new Error('staged pack invalid: '+checked.errors.join('; '));}
  if(fsSync.existsSync(dest))await removeTree(dest);
  await fs.rename(tmp,dest);
  const result={ok:true,action:'draft_publish',staged_path:dest,pack_id:m.target_pack_id,version:m.version,content_sha256:checked.content_sha256,auto_installed:false,next:'调用 sketchup_ref(action=import,path=staged_path) 安装；如替换同 ID 旧版，明确传 overwrite=true。'};
  await fs.writeFile(opFile,JSON.stringify({...record,published_at:nowIso(),result},null,2),'utf8');
  return result;
}

/* ---------- 使用记录 ---------- */

async function recordUsage(appDataDir, input) {
  const L = layouts(appDataDir);
  const line = JSON.stringify({
    ts: nowIso(),
    project_id: String(input.project_id || ''),
    phase: String(input.phase || ''),
    packs: Array.isArray(input.packs) ? input.packs : [],
    note: String(input.note || '').slice(0, 500),
  });
  await fs.mkdir(L.root,{recursive:true});
  await fs.appendFile(L.usage, line + '\n', 'utf8');
  return { ok: true, action: 'record', appended: true, usage_file: L.usage };
}

async function listUsage(appDataDir, input) {
  const L = layouts(appDataDir);
  if (!fsSync.existsSync(L.usage)) return { ok: true, action: 'usage', records: [], total: 0 };
  const want = String(input.project_id || '').trim();
  const lines = (await fs.readFile(L.usage, 'utf8')).split('\n').filter(Boolean);
  const records = [];
  for (const l of lines) { try { const r = JSON.parse(l); if (!want || r.project_id === want) records.push(r); } catch { /* skip */ } }
  const limit = Math.min(Math.max(Number(input.limit) || 20, 1), 200);
  return { ok: true, action: 'usage', records: records.slice(-limit), total: records.length, usage_file: L.usage };
}

/* ---------- 列表 / 检视 / 启停 / 移除 / 校验 ---------- */

async function listPacks(appDataDir, input) {
  const L = layouts(appDataDir);
  const bundled = await installBundledPacks(appDataDir);
  const discovered = await scanInbox(appDataDir);
  const reg = await readRegistry(appDataDir);
  const packs = Object.keys(reg.packs).sort().map((id) => publicPack(reg.packs[id]));
  return {
    ok: true,
    action: 'list',
    store: L.root,
    inbox: L.inbox,
    drafts: L.drafts,
    staged: L.staged,
    packs,
    bundled_from_mcp: bundled,
    discovered_from_inbox: discovered,
    enabled_ids: packs.filter((p) => p.enabled).map((p) => p.id),
    hint: 'To add a pack: put its folder (or .zip) into the inbox directory above, then call action=list again — or use action=import with the path.',
    guidance_only: true,
    can_modify_engine_policy: false,
  };
}

async function inspectPack(appDataDir, input) {
  await installBundledPacks(appDataDir);
  const id = String(input.pack_id || input.id || '').trim();
  if (!id) return { ok: false, error: 'inspect requires pack_id' };
  const reg = await readRegistry(appDataDir);
  if (!reg.packs[id]) return { ok: false, error: 'pack not installed: ' + id, installed: Object.keys(reg.packs) };
  const loaded = await loadPack(appDataDir, id);
  if (!loaded.ok) return { ok: false, error: loaded.error, errors: loaded.errors };
  return {
    ok: true, action: 'inspect',
    pack: publicPack(reg.packs[id]),
    warnings: loaded.parsed.warnings,
    sections: loaded.parsed.sections.map((s) => ({ section_id: s.id, title: s.title, stages: s.stages, characters: s.characters })),
    assets: loaded.parsed.files.filter((x) => x.rel !== REF_FILE && !isText(x.rel)).map((x) => x.rel),
    guidance_only: true, can_modify_engine_policy: false,
  };
}

async function setEnabled(appDataDir, input, enabled) {
  const id = String(input.pack_id || input.id || '').trim();
  if (!id) return { ok: false, error: 'action requires pack_id' };
  const reg = await readRegistry(appDataDir);
  if (!reg.packs[id]) return { ok: false, error: 'pack not installed: ' + id };
  if(enabled && ['draft','retired'].includes(reg.packs[id].state)) throw new Error('Draft/retired pack cannot be enabled; maintainer must revise and re-import');
  reg.packs[id].enabled = enabled;
  await writeRegistry(appDataDir, reg);
  return { ok: true, action: enabled ? 'enable' : 'disable', pack: publicPack(reg.packs[id]), note: enabled ? 'matching will now include this pack' : 'matching skips this pack; existing models and saved SKP files are unaffected', can_modify_engine_policy: false };
}

async function removePack(appDataDir, input) {
  const id = String(input.pack_id || input.id || '').trim();
  if (!id) return { ok: false, error: 'remove requires pack_id' };
  const confirmed = input.confirm === true;
  const reg = await readRegistry(appDataDir);
  if (!reg.packs[id]) return { ok: false, error: 'pack not installed: ' + id };
  if (!confirmed) return { ok: false, error: 'remove deletes the installed copy; pass confirm:true (the original folder you imported from is never touched)', pack: publicPack(reg.packs[id]) };
  const L = layouts(appDataDir);
  await removeTree(ensureInside(L.packs, path.join(L.packs, id)));
  delete reg.packs[id];
  await writeRegistry(appDataDir, reg);
  return { ok: true, action: 'remove', removed: id, remaining: Object.keys(reg.packs).sort() };
}

async function validatePath(appDataDir, input) {
  const p = String(input.path || '').trim();
  if (!p) return { ok: false, error: 'validate requires path (pack folder or .zip)' };
  const resolved = path.resolve(p);
  if (!fsSync.existsSync(resolved)) return { ok: false, error: 'path does not exist: ' + resolved };
  const L = layouts(appDataDir);
  const tmpDir = path.join(L.root, '.tmp-validate-' + Date.now().toString(36));
  let materialized;
  try {
    materialized = await materializeSource(resolved, tmpDir);
  } catch (e) {
    await removeTree(tmpDir);
    return { ok: false, error: String(e.message || e) };
  }
  try {
    let parsed;
    try { parsed = await parsePackDir(materialized.dir); }
    catch (e) { return { ok: false, action: 'validate', error: String(e.message||e), errors: [String(e.message||e)], warnings: [] }; }
    return {
      ok: parsed.ok,
      error: parsed.ok ? undefined : parsed.errors.join('; '),
      action: 'validate',
      errors: parsed.errors,
      warnings: parsed.warnings,
      metadata: parsed.meta,
      section_count: parsed.sections.length,
      sections: parsed.sections.map((s) => ({ section_id: s.id, title: s.title, stages: s.stages, characters: s.characters })),
      file_count: parsed.files.length,
      bytes: parsed.bytes,
      content_sha256: parsed.content_sha256,
      can_modify_engine_policy: false,
    };
  } finally {
    if (materialized.kind === 'zip') await removeTree(tmpDir);
  }
}

/* ---------- 入口 ---------- */

async function dispatchRef(input, appDataDir) {
  const action = String(input && input.action || '').trim();
  try {
    switch (action) {
      case 'list': return await listPacks(appDataDir, input);
      case 'import': return await importPack(appDataDir, input || {});
      case 'inspect': return await inspectPack(appDataDir, input || {});
      case 'enable': return await setEnabled(appDataDir, input || {}, true);
      case 'disable': return await setEnabled(appDataDir, input || {}, false);
      case 'remove': return await removePack(appDataDir, input || {});
      case 'match': return await matchPacks(appDataDir, input || {});
      case 'read': return await readFromPack(appDataDir, input || {});
      case 'draft': return await draftFromFix(appDataDir, input || {});
      case 'draft_review': return await reviewDraft(appDataDir, input || {});
      case 'draft_publish': return await publishDraft(appDataDir, input || {});
      case 'validate': return await validatePath(appDataDir, input || {});
      case 'record': return await recordUsage(appDataDir, input || {});
      case 'usage': return await listUsage(appDataDir, input || {});
      default:
        return {
          ok: false,
          error: 'unsupported action: ' + (action || '(missing)'),
          actions: ['list', 'import', 'inspect', 'enable', 'disable', 'remove', 'match', 'read', 'draft', 'draft_review', 'draft_publish', 'validate', 'record', 'usage'],
        };
    }
  } catch (err) {
    return { ok: false, action, error: String(err && err.message ? err.message : err) };
  }
}

const queues=new Map();
async function refTool(input, appDataDir){
  const key=refRoot(appDataDir),prev=queues.get(key)||Promise.resolve();
  const task=prev.then(async()=>{
    if(!input||!isPlainObject(input))return {ok:false,error:'Object input required'};
    for(const k of ['limit','offset']) if(input[k]!==undefined && (!Number.isSafeInteger(input[k])||input[k]<(k==='limit'?1:0)))return {ok:false,error:k+' must be a valid integer'};
    await fs.mkdir(key,{recursive:true});
    const lock=path.join(key,'.lock');let handle;
    try {handle=await fs.open(lock,'wx');await handle.writeFile(JSON.stringify({pid:process.pid,at:nowIso()}));}
    catch(e){return {ok:false,error:e.code==='EEXIST'?'REF store busy; retry after current request. If process crashed, verify recorded PID is stopped before removing .lock.':e.message};}
    try{return await dispatchRef(input,appDataDir);}finally{await handle.close();await fs.unlink(lock);}

  });
  const end=task.catch(()=>{});queues.set(key,end);
  try{return await task;}finally{if(queues.get(key)===end)queues.delete(key);}
}
module.exports = { refTool, layouts, parsePackDir, parseFrontmatter, parseSections, scanPolicy };
