'use strict';

// Optional confirmed targets, stored once with the task. This is deliberately
// not a general building constraint graph or an image-derived scale estimator.
function invalid(message) {
  throw Object.assign(new Error(message), { code: 'SOURCE_DIMENSIONS_INVALID' });
}
function normalizeTargets(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 32) invalid('dimension_targets must contain at most 32 explicit targets.');
  const seen = new Set();
  return value.map(t => {
    if (!t || typeof t !== 'object' || Array.isArray(t) || Object.keys(t).some(k => !['object','axis','expected_mm','tolerance_mm','source'].includes(k))) invalid('Invalid dimension target fields.');
    if (typeof t.object !== 'string' || !t.object.trim() || t.object.length > 160 || !['x','y','z'].includes(t.axis)) invalid('Target requires a unique semantic object label and a local x/y/z axis.');
    if (!Number.isFinite(t.expected_mm) || t.expected_mm <= 0 || !Number.isFinite(t.tolerance_mm) || t.tolerance_mm < 0) invalid('Expected dimension and explicit tolerance must be finite millimetres.');
    if (typeof t.source !== 'string' || !t.source.trim() || t.source.length > 1000) invalid('Bind the confirmed user/source dimension once; do not invent missing dimensions.');
    const key = t.object.trim() + ':' + t.axis;
    if (seen.has(key)) invalid('Duplicate object/axis target.');
    seen.add(key);
    return { object:t.object.trim(), axis:t.axis, expected_mm:t.expected_mm, tolerance_mm:t.tolerance_mm, source:t.source.trim() };
  });
}
function evaluateMeasurements(targets, readback) {
  const rows = Array.isArray(readback?.results) ? readback.results : [];
  return targets.map(t => {
    const found = rows.filter(r => r.object === t.object && r.axis === t.axis);
    const r = found.length === 1 ? found[0] : null;
    if (!r || r.state !== 'measured' || !Number.isFinite(r.measured_mm)) return { ...t, state:'unverified', reason:r?.reason || 'Unique actual object/axis measurement unavailable.' };
    const difference = r.measured_mm - t.expected_mm;
    return { ...t, measured_mm:r.measured_mm, difference_mm:difference, state:Math.abs(difference) <= t.tolerance_mm + 1e-6 ? 'pass' : 'fail', frame:'object_local_axes_with_world_scale', occurrence:r.occurrence };
  });
}
function assertTargets(results, final = false) {
  const bad = results.filter(r => r.state === 'fail' || final && r.state !== 'pass');
  if (bad.length) {
    const error = new Error(bad.map(r => `${r.object}.${r.axis}: expected ${r.expected_mm} ± ${r.tolerance_mm} mm, actual ${r.measured_mm ?? 'unverified'} mm`).join('; '));
    error.code = final ? 'DELIVERY_DIMENSIONS_UNVERIFIED' : 'SOURCE_DIMENSION_MISMATCH';
    error.findings = bad;
    throw error;
  }
}
module.exports = { normalizeTargets, evaluateMeasurements, assertTargets };
