'use strict';

function fail(code, message = code) {
  throw Object.assign(new Error(message), { code });
}

function requiredSystems(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20) fail('REQUIRED_DETAIL_SYSTEMS_INVALID');
  const seen = new Set();
  return value.map(id => {
    if (typeof id !== 'string' || !id.trim() || id.length > 160) fail('REQUIRED_DETAIL_SYSTEMS_INVALID');
    id = id.trim();
    if (seen.has(id)) fail('REQUIRED_DETAIL_SYSTEMS_DUPLICATE');
    seen.add(id);
    return id;
  });
}

// Shape, uniqueness, real objects and task coverage are distinct checks. Never
// discard malformed entries then count the remainder as sufficient evidence.
function validateDetails(systems, required = [], { allowEmpty = false, requireActual = false } = {}) {
  required = requiredSystems(required);
  if (!Array.isArray(systems) || (!systems.length && (!allowEmpty || required.length))) {
    fail('VISIBLE_DETAIL_SYSTEMS_REQUIRED');
  }
  const seen = new Set();
  for (const item of systems) {
    if (!item || typeof item !== 'object' || Array.isArray(item) ||
        typeof item.id !== 'string' || !item.id.trim()) {
      fail('VISIBLE_DETAIL_MAPPING_INVALID');
    }
    const id = item.id.trim();
    if (seen.has(id)) fail('DUPLICATE_VISIBLE_DETAIL_ID');
    seen.add(id);
    if (requireActual && (item.valid !== true || !Number.isInteger(item.actual_instances) || item.actual_instances < 1)) {
      fail('VISIBLE_DETAIL_ENTITY_MISSING', `Detail ${id} has no verified live prototype/instances.`);
    }
  }
  const missing = required.filter(id => !seen.has(id));
  if (missing.length) fail('VISIBLE_DETAIL_SYSTEMS_MISSING', `Missing task-required systems: ${missing.join(', ')}`);
  return systems;
}

module.exports = { requiredSystems, validateDetails };
