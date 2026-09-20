# ADAI SketchUp 0.5.24

Build: `0.5.24-s1-s6-cpal-skill-card-ruby-tower-stale-instance-20260920`

This release contains two independent runtime packages: `professional-sketchup-modeling` (Skill) and `sketchup-managed-mcp` (MCP). Install them separately in PipClaw or Codex; the MCP locates its bundled runtime support from its own package directory.

- License: CPAL-1.0 (see `LICENSE`)
- MCP entry: `launch.cjs`
- Runtime baseline: Windows, Node.js 18+, Python 3.10+, SketchUp 2018/2019
- REF packs are optional and are loaded through `sketchup_ref`; see the repository experience-pack guide.

The distributable contains runtime sources and user documentation only. Development tests, evidence reports, temporary logs and model files are kept outside this package.
