'use strict';
const path = require('node:path');
const runtimeRoot = path.join(__dirname, 'runtime-support', 'professional-sketchup-modeling');
process.env.PIPCLAW_SKILL_ROOT = process.env.PIPCLAW_SKILL_ROOT || runtimeRoot;
process.env.PIPCLAW_BUNDLED_REF_ROOT = process.env.PIPCLAW_BUNDLED_REF_ROOT || path.join(__dirname, 'bundled-ref-packs');
require('./mcp/sketchup-mcp/server.js');
