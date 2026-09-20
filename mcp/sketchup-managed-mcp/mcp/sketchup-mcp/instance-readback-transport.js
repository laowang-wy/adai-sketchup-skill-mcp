'use strict';
const crypto = require('node:crypto');
const MAX_BYTES = 32 * 1024 * 1024;
function decodeInstanceReadback(response, marker, input) {
  const fail = reason => { throw new Error('Instance readback transport: ' + reason + '; no complete readback accepted. Narrow scope_path/max_instances if needed.'); };
  if (!response || response.ok !== true) fail('bridge failed');
  if (typeof response.stdout !== 'string') fail('missing stdout payload');
  if (Buffer.byteLength(response.stdout, 'utf8') > Math.ceil(MAX_BYTES / 3) * 4 + 4096) fail('payload exceeds 32 MiB limit');
  const lines = response.stdout.split(/\r?\n/).filter(line => line.startsWith(marker + ':'));
  if (lines.length !== 1) fail('missing or duplicate payload frame');
  const parts = lines[0].slice(marker.length + 1).split(':');
  if (parts.length !== 3 || !/^[0-9]+$/.test(parts[0]) || !/^[a-f0-9]{64}$/.test(parts[1])) fail('invalid frame header');
  const size = Number(parts[0]), encoded = parts[2];
  if (!Number.isSafeInteger(size) || size > MAX_BYTES || size < 2) fail('invalid payload length');
  const bytes = Buffer.from(encoded,'base64');
  if (bytes.toString('base64') !== encoded) fail('invalid base64 payload');
  if (bytes.length !== size || crypto.createHash('sha256').update(bytes).digest('hex') !== parts[1]) fail('payload length/hash mismatch');
  if (!Buffer.from(bytes.toString('utf8'),'utf8').equals(bytes)) fail('invalid UTF-8 payload');
  let data;
  try { data = JSON.parse(bytes.toString('utf8')); } catch { fail('invalid JSON'); }
  if (!data || data.schema_version !== 1 || data.scope !== 'active_document_occurrences' ||
      !Array.isArray(data.instances) || data.instances.length > (input.max_instances || 1000) ||
      typeof data.truncated !== 'boolean' || !Array.isArray(data.truncation_reasons) ||
      data.units !== 'm' || data.coordinate_frame !== 'world:model-origin' ||
      data.geometry_readback !== 'instance_transforms_only') fail('unexpected readback schema');
  const norm = p => typeof p === 'string' ? p.replaceAll('\\','/').toLowerCase() : '';
  if (!data.source || !data.source_after || norm(data.source.path) !== norm(input.expected_path) ||
      data.source.path !== data.source_after.path || !data.source.guid ||
      data.source.guid !== data.source_after.guid || data.source.modified !== data.source_after.modified ||
      JSON.stringify(data.scope_path) !== JSON.stringify(input.scope_path || [])) fail('source/scope identity mismatch');
  if ((!data.truncated && data.truncation_reasons.length) || (data.truncated && !data.truncation_reasons.length)) fail('inconsistent traversal truncation');
  return {ok:true,...data,transport:{version:1,complete:true,bytes:bytes.length,sha256:parts[1],
    scope:'transport_integrity_only_not_signed_geometry_or_visual_acceptance'}};
}
module.exports = {decodeInstanceReadback,MAX_BYTES};
