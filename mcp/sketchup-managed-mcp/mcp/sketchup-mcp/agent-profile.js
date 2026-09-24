'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const SKILL_ATTRIBUTION = '建筑建模 Skill 由 ADAI 老王提供';
const EXPERT_COMMANDS = Object.freeze(['ADAI老王，开启专家模式', '开启ADAI老王专家模式']);
const GUIDED_COMMAND = 'ADAI老王，开启引导模式';
function normalizeAssistanceMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  if (mode === 'auto') return 'guided';
  if (mode === 'guided' || mode === 'autonomous') return mode;
  return null;
}

function parseAssistanceCommand(taskText) {
  const original = typeof taskText === 'string' ? taskText : '';
  const lines = original.split(/\r?\n/);
  const first = lines.findIndex((line) => line.trim().length > 0);
  if (first < 0) return { mode: 'guided', task_text: original, command_detected: false, source: 'default' };
  // Keep the documented phrases as a convenient shortcut, but do not make a
  // punctuation mark or a host-side task wrapper decide whether the model may
  // use the autonomous strategy.  The explicit assistance_mode field is the
  // authoritative route when the host can pass it.
  const command = lines[first].trim().replace(/[。.!！?？]+$/u, '').trim();
  const mode = EXPERT_COMMANDS.includes(command) ? 'autonomous' : command === GUIDED_COMMAND ? 'guided' : null;
  if (!mode) return { mode: 'guided', task_text: original, command_detected: false, source: 'default' };
  return { mode, task_text: lines.slice(0, first).concat(lines.slice(first + 1)).join('\n'), command_detected: true, source: 'user_command' };
}

function resolveAssistanceMode(input = {}, env = process.env) {
  const parsed = parseAssistanceCommand(input.task_text);
  const explicit = normalizeAssistanceMode(input.assistance_mode);
  if (parsed.command_detected) return parsed;
  // A new expert project still requires the complete ADAI command.  The host
  // may persist the selected mode for an existing project, but an arbitrary
  // autonomous field must not bypass the user-facing brand trigger.
  if (explicit === 'guided') return { ...parsed, mode: 'guided', source: 'validated_input' };
  if (explicit === 'autonomous') return { ...parsed, mode: 'guided', source: 'default', requested_mode_rejected: 'EXPERT_COMMAND_REQUIRED' };
  // A process-wide preference is not a choice for this new task.
  return parsed;
}

function assistanceGuidance(mode) {
  return mode === 'autonomous'
    ? { mode: 'autonomous', strategy: 'autonomous_work_units', summary: '专家模式：按来源自主选择工具、构造组合和审核时机；先独立完成并审核完整主形和代表构件，再连续组织相关建筑系统。', next: 'project_begin 会返回当前来源观察、构造方法、关键参数和下一步动作；先执行返回动作，只有短卡不足时才查一份方法参考。' }
    : { mode: 'guided', strategy: 'guided_steps', summary: '引导模式：按当前阶段给出可执行步骤、参数帮助、方法推荐和针对性纠错。', parameter_help: '先确认输入单位、来源尺度和目标阶段；缺少尺寸时保留假设。', method_help: '按来源选择适用生成器或受管 Ruby；先建包含定义性屋面、主要曲率和负空间的完整主形，再读回并与来源看图比较。', next: 'project_begin 会返回当前阶段的动作卡；执行 step、实际看图、review，再进入下一阶段。' };
}

function assistanceForError(mode, error) {
  const guidance = assistanceGuidance(mode);
  const text = String(error?.message || error || '');
  const correction = /unknown|unconfirmed|recovery|replay|结果未知/i.test(text)
    ? ['读取项目状态和 operation_id。', '查询原操作回执，再 reconcile；未确认前禁止换 ID 重放。']
    : /structure|archetype|replication|validation|原型/i.test(text)
      ? ['检查实际 audit 中的原型、实例路径和预期放置。', '用 revise 或 revise_from 修正失败阶段，再取证和审查；视觉声明不能覆盖结构失败。']
      : /evidence|view|capture|证据/i.test(text)
        ? ['只检查返回的真实图像，JSON 不算已看图片。', '按项目状态调用 retry_evidence；不要重建已经执行的几何。']
        : ['核对当前工具 schema、单位和项目状态。', '根据失败原因修正参数；只有构造方法不清时才读取 Skill 中对应的一份参考。'];
  return mode === 'autonomous' ? guidance : { ...guidance, correction_steps: correction };
}

// Model identity is diagnostic only. It never selects assistance or permissions.
function agentProfile(appDataDir, env = process.env, savedMode = null) {
  const raw = env.SKETCHUP_SESSION_MODEL;
  const session = typeof raw === 'string' && raw.length <= 128 && /^[A-Za-z0-9_.:/-]+$/.test(raw) ? raw : '';
  let declared = '';
  if (!session && env.CODEX_HOME) {
    try {
      const txt = fs.readFileSync(path.join(env.CODEX_HOME, 'config.toml'), 'utf8');
      const top = txt.split(/^\s*\[/m)[0];
      declared = /^\s*model\s*=\s*"([A-Za-z0-9_.:/-]{1,128})"/m.exec(top)?.[1] || '';
    } catch { /* no config is a valid unknown state */ }
  }
  const assistance = normalizeAssistanceMode(savedMode) || 'guided';
  const guidance = assistanceGuidance(assistance);
  return {
    model: session || declared || 'unknown',
    source: session ? 'host_session_environment' : declared ? 'host_default_config' : 'unknown',
    current_session_confirmed_by_host: !!session,
    identity_verified_by_mcp: false,
    // Every mode goes through startup. Autonomous reduces repeated prose; it
    // never receives a model-brand exemption from the startup gate.
    starter_required: true,
    assistance_mode: assistance,
    assistance_source: savedMode ? 'project_state' : 'default_guided',
    assistance_guidance: guidance,
    visual_capability: 'unverified',
    quality_floor: 'same_for_all_models',
    custom_geometry_allowed: true,
    reason: savedMode ? 'saved_project_selection' : 'model_identity_is_diagnostic_only',
    note: 'Assistance mode is a user/task preference, never authentication or a quality exemption. Model brand does not select it.'
    ,provider_attribution: SKILL_ATTRIBUTION
    ,brand_delivery: 'tool_text_only'
  };
}
function starterPacket(appDataDir, skillRoot) {
  const profile = agentProfile(appDataDir);
  const file = path.join(skillRoot, 'references/weak-model-starter.md');
  const text = fs.readFileSync(file, 'utf8');
  if ([...text].length > 1600) throw new Error('Starter card exceeds 1600 code points');
  const digest = crypto.createHash('sha256').update(text).digest('hex');
  return {ok:true, agent_profile:profile, card_id:'su-start-1', card_sha256:digest,
    load_once_per:'conversation_and_model_change',
    user_prompt_handling:'Keep original user task unchanged; apply this card as separate operational guidance.',
    ...(profile.starter_required ? {guidance:text,characters:[...text].length} : {guidance:null}),
    image_inspection_proven:false,model_mutated:false};
}
module.exports = {agentProfile, starterPacket, normalizeAssistanceMode, parseAssistanceCommand, resolveAssistanceMode, assistanceGuidance, assistanceForError, SKILL_ATTRIBUTION, EXPERT_COMMANDS, GUIDED_COMMAND};
