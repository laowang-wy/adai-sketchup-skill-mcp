'use strict';
// Small typed facade over the same managed Ruby transaction. No raw bridge writes.
const { Buffer } = require('node:buffer');
const keys = {
  box: ['op','id','size_mm','origin_mm','component'],
  wall: ['op','id','width_mm','height_mm','thickness_mm','origin_mm','openings'],
  set_wall_openings: ['op','target','openings'],
  window_frame: ['op','id','wall','opening','frame_mm','depth_mm','recess_mm'],
  instance: ['op','id','prototype','origin_mm'],
  translate: ['op','target','delta_mm'],
  material: ['op','target','rgb','alpha'],
  mesh: ['op','id','vertices_mm','triangles']
};
const text = v => typeof v === 'string' && /^[A-Za-z][A-Za-z0-9_/-]{0,159}$/.test(v) && !v.includes('..');
function reject(index, field, reason) { throw Object.assign(new Error(`operations[${index}].${field}: ${reason}`), { code: 'OPERATION_INPUT_INVALID' }); }
function vector(v, n = 3) { return Array.isArray(v) && v.length === n && v.every(x => typeof x === 'number' && Number.isFinite(x)); }
function validateOperations(input) {
  if (!Array.isArray(input) || !input.length || input.length > 128) reject(0, 'batch', 'expected 1–128 supported operations');
  if (JSON.stringify(input).length > 8 * 1024 * 1024) reject(0, 'batch', 'input exceeds 8 MiB');
  const ids = new Set();
  return input.map((op, i) => {
    if (!op || typeof op !== 'object' || Array.isArray(op) || !Object.hasOwn(keys, op.op)) reject(i, 'op', 'unsupported operation');
    for (const key of Object.keys(op)) if (!keys[op.op].includes(key)) reject(i, key, 'unknown field');
    for (const key of ['id','target','prototype','wall','opening']) if (op[key] !== undefined && !text(op[key])) reject(i,key,'expected a stable object label');
    const updating = ['set_wall_openings','translate','material'].includes(op.op);
    if (!text(updating ? op.target : op.id)) reject(i, updating ? 'target' : 'id', 'required');
    if (!updating) { if (ids.has(op.id)) reject(i,'id','duplicate creation in batch'); ids.add(op.id); }
    for (const key of ['origin_mm','delta_mm','size_mm']) if (op[key] !== undefined && !vector(op[key])) reject(i,key,'expected three finite numbers in mm');
    for (const key of ['width_mm','height_mm','thickness_mm','frame_mm','depth_mm']) if (op[key] !== undefined && (typeof op[key] !== 'number' || !Number.isFinite(op[key]) || op[key] <= 0)) reject(i,key,'expected a positive finite length in mm');
    if (op.recess_mm !== undefined && (typeof op.recess_mm !== 'number' || !Number.isFinite(op.recess_mm) || op.recess_mm < 0)) reject(i,'recess_mm','expected a nonnegative finite length');
    if (op.component !== undefined && typeof op.component !== 'boolean') reject(i,'component','expected boolean');
    if (op.op === 'box' && (!vector(op.size_mm) || op.size_mm.some(x=>x<=0))) reject(i,'size_mm','required positive dimensions');
    if (op.op === 'wall' && ['width_mm','height_mm','thickness_mm'].some(k => op[k] === undefined)) reject(i,'dimensions','width, height and thickness required');
    if (['wall','set_wall_openings'].includes(op.op)) {
      if (op.op === 'set_wall_openings' && op.openings === undefined) reject(i,'openings','required');
      if (op.openings !== undefined) {
        if (!Array.isArray(op.openings) || op.openings.length > 64) reject(i,'openings','expected at most 64 rectangular openings');
        const openings = new Set();
        for (const o of op.openings) {
          if (!o || !text(o.id) || openings.has(o.id) || Object.keys(o).some(k=>!['id','x_mm','z_mm','width_mm','height_mm'].includes(k))) reject(i,'openings','bad or duplicate opening');
          openings.add(o.id);
          if (['x_mm','z_mm','width_mm','height_mm'].some(k=>typeof o[k] !== 'number' || !Number.isFinite(o[k])) || o.x_mm < 0 || o.z_mm < 0 || o.width_mm <= 0 || o.height_mm <= 0) reject(i,'openings','invalid finite rectangle');
        }
      }
    }
    if (op.op === 'window_frame' && (!text(op.wall) || !text(op.opening))) reject(i,'wall/opening','required existing wall and opening');
    if (op.op === 'instance' && !text(op.prototype)) reject(i,'prototype','required');
    if (op.op === 'translate' && !vector(op.delta_mm)) reject(i,'delta_mm','required');
    if (op.op === 'material' && (!vector(op.rgb) || op.rgb.some(x=>!Number.isInteger(x)||x<0||x>255) || (op.alpha !== undefined && (typeof op.alpha!=='number'||!Number.isFinite(op.alpha)||op.alpha<0||op.alpha>1)))) reject(i,'rgb/alpha','RGB integers 0–255 and alpha 0–1 required');
    if (op.op === 'mesh') {
      if (!Array.isArray(op.vertices_mm) || op.vertices_mm.length < 4 || op.vertices_mm.length > 100000 || op.vertices_mm.some(v=>!vector(v))) reject(i,'vertices_mm','expected 4–100000 finite vertices');
      if (!Array.isArray(op.triangles) || op.triangles.length < 4 || op.triangles.length > 200000 || op.triangles.some(t=>!vector(t)||new Set(t).size!==3||t.some(x=>!Number.isInteger(x)||x<0||x>=op.vertices_mm.length))) reject(i,'triangles','expected valid zero-based triangle indices');
    }
    return JSON.parse(JSON.stringify(op));
  });
}
function compileOperations(input, helperPath) {
  const ops = validateOperations(input);
  const payload = Buffer.from(JSON.stringify(ops)).toString('base64');
  const helper = Buffer.from(helperPath.replaceAll('\\', '/'), 'utf8').toString('base64');
  // Paths and JSON bytes are encoded, never interpolated as executable Ruby.
  return `require 'json'\nrequire 'base64'\nload Base64.strict_decode64('${helper}').force_encoding('UTF-8')\nmodule PipClawManagedBuild\n  def self.build(entities, context)\n    ADAIManagedOperations.build(entities, context, JSON.parse(Base64.strict_decode64('${payload}')))\n  end\nend\n`;
}
module.exports = { validateOperations, compileOperations, operationNames: Object.keys(keys) };
