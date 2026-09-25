'use strict';

// Agent-facing construction guidance.  It selects by visible/declared
// capability and input conditions; package and preset names remain internal
// identities used only after a method has been selected.
const cards = require('./modeling-method-cards.json');
const copy = value => JSON.parse(JSON.stringify(value));

const roofAliases = [
  ['si_shan', /歇山|xieshan|xie[_ -]?shan/i],
  ['wu_dian', /庑殿|wudian|wu[_ -]?dian/i],
  ['juan_peng', /卷棚|juan[_ -]?peng/i],
  ['zan_jian', /攒尖|zan[_ -]?jian/i],
  ['helmet', /盔顶|盔|helmet/i],
  ['xie_ding', /悬山|简化四坡|xie[_ -]?ding|simple[_ -]?hip/i],
];

function textOf(profile, taskText = '') {
  return [...(profile?.topics || []), ...(profile?.features || []), String(taskText || '')].join(' ');
}

function negatedMatch(text, expression) {
  const value = String(text || '');
  const match = expression.exec(value);
  if (!match || match.index === undefined) return false;
  return /(不|非|无|没有|不是|排除|without|not|no)\s*$/i.test(value.slice(Math.max(0, match.index - 8), match.index));
}

function ancientRoofRoute(profile) {
  if (profile?.roof_route === 'custom') return false;
  if (profile?.roof_route === 'ancient_roof') return true;
  if (profile?.method_family && !['ancient_roof', 'chinese_ancient_roof', 'chinese_tower', 'yellow_crane_tower', 'yellow_crane'].includes(profile.method_family)) return false;
  return /(古建|楼阁|塔|庙|殿|黄鹤楼|yellow[ _-]?crane|tower|pagoda|temple|chinese[_ -]?ancient|歇山|庑殿|悬山|卷棚|攒尖|盔顶)/i.test(textOf(profile));
}

function ancientRoofPresetId(profile) {
  const text = textOf(profile);
  const hit = roofAliases.find(([, expression]) => expression.test(text));
  return hit ? hit[0] : null;
}

function inferProfile(profile, taskText = '', normalize) {
  const text = String(taskText || '');
  const topics = [...(profile?.topics || [])];
  const features = [...(profile?.features || [])];
  const ancient = /(古建|楼阁|塔|庙|殿|黄鹤楼|yellow[ _-]?crane|tower|pagoda|temple|歇山|庑殿|悬山|卷棚|攒尖|盔顶)/i.test(text);
  for (const [id, expression] of roofAliases) {
    if (expression.test(text) && !negatedMatch(text, expression) && !features.some(item => expression.test(String(item)))) features.push(id);
  }
  if (ancient && !topics.some(item => /古建|楼阁|塔|庙|殿|tower|pagoda|temple/i.test(String(item)))) topics.push('古建');
  const value = { ...profile, topics, features, roof_route: profile?.roof_route === 'custom' ? 'custom' : ancient || ancientRoofRoute({ ...profile, topics, features }) ? 'ancient_roof' : profile?.roof_route };
  return typeof normalize === 'function' ? normalize(value) : value;
}

function negativeFor(text, methodId) {
  const value = String(text || '');
  if (methodId === 'si_shan' && /(无|没有|不是|不含|without|no|not)\s*(独立|清晰|明确)?\s*(山面|gable)/i.test(value)) return true;
  if (methodId === 'wu_dian' && !/(无|没有|不含|without|no)\s*(独立|明确)?\s*(山面|gable)/i.test(value) && /(有|具有|包含|with)\s*(独立|明确)?\s*(山面|gable)/i.test(value)) return true;
  if (['si_shan', 'wu_dian', 'xie_ding'].includes(methodId) && /(无|没有|不见|without|no)\s*(正脊|ridge)/i.test(value)) return true;
  if (methodId === 'juan_peng' && /(有|具有|明确)\s*(正脊|ridge)/i.test(value)) return true;
  return false;
}

const basis = {
  si_shan: '有长正脊、端部独立山面并向下接四坡裙；可分别调山面跨度与下裙举高。',
  wu_dian: '四面坡连续汇向正脊，端部没有独立山面；适合连续主坡和统一檐口。',
  juan_peng: '屋面以连续圆缓曲坡或卷棚断面为主，通常不靠单一正脊分隔前后坡。',
  zan_jian: '多坡从中心脊顶或中心节点向周边放射；适合中心收束、平面多边形的屋盖。',
  helmet: '屋面向中心冠部连续收拢并形成穹曲外轮廓；适合无明确长正脊的冠顶关系。',
  xie_ding: '用简化的四坡或悬山外轮廓快速表达主屋壳；适合来源无法支持更复杂分区时的可编辑基础。',
};
const humanLabels = { si_shan: '歇山屋壳', wu_dian: '庑殿屋壳', juan_peng: '卷棚屋壳', zan_jian: '攒尖屋壳', helmet: '盔顶屋壳', xie_ding: '简化四坡/悬山屋壳' };

function localMethod(methodId) {
  const method = cards.construction_methods?.[methodId];
  if (!method) return null;
  return {
    method_id: methodId,
    label: humanLabels[methodId] || method.label || methodId,
    selection_basis: method.selection_basis || basis[methodId] || method.recognize || '根据来源可见形体选择该构造方法。',
    ...copy(method),
  };
}

function mergeMethod(methodId, catalog) {
  const local = localMethod(methodId) || { method_id: methodId, label: humanLabels[methodId] || methodId, selection_basis: basis[methodId] || '根据来源可见形体选择该构造方法。' };
  const remote = catalog?.candidates?.find(item => item.method_id === methodId);
  if (!remote) return local;
  return {
    ...local,
    ...copy(remote),
    method_id: methodId,
    // Some older package manifests contain legacy-encoded labels.  The
    // stable local display name is clearer; package identity remains in
    // method_id/experience_pack.
    label: local.label || humanLabels[methodId] || remote.label || methodId,
    selection_basis: remote.selection_basis || local.selection_basis || basis[methodId],
    method: local.method || remote.method,
    actions: local.actions || remote.actions,
    key_parameters: local.key_parameters || remote.key_parameters,
    common_errors: local.common_errors || remote.common_errors,
    inspect: local.inspect || remote.inspect,
    if_failed: local.if_failed || remote.if_failed,
  };
}

function capabilityScores(text, methodIds) {
  const value = String(text || '');
  const scores = Object.fromEntries(methodIds.map(id => [id, 0]));
  const add = (ids, amount) => ids.forEach(id => { if (scores[id] !== undefined) scores[id] += amount; });
  for (const [id, expression] of roofAliases) if (expression.test(value) && !negatedMatch(value, expression)) add([id], 6);
  if (/(长正脊|正脊|long\s*ridge|ridge)/i.test(value)) add(['si_shan', 'wu_dian', 'zan_jian', 'xie_ding'], 1);
  if (/(独立|清晰|明确)\s*(山面|gable)|gable\s*(end|face)/i.test(value)) add(['si_shan'], 5);
  if (/(四坡裙|下部四坡|lower\s*hip|hip\s*skirt)/i.test(value)) add(['si_shan'], 3);
  if (/(连续|统一|无独立)\s*(坡面|山面)|四面坡连续|连续四坡|端部没有独立山面|continuous\s*(hip|slope)|no\s*(independent\s*)?gable/i.test(value)) add(['wu_dian'], 5);
  if (/(中心|中央)\s*(脊顶|收束|节点)|放射|多边形平面|central\s*(finial|crown)|radial|polygonal/i.test(value)) add(['zan_jian'], 5);
  if (/(卷棚|圆缓|桶|barrel|continuous\s*curv|no\s*ridge)/i.test(value)) add(['juan_peng'], 5);
  if (/(穹|冠顶|盔|helmet|dome|crown)/i.test(value)) add(['helmet'], 5);
  if (/(简化|普通四坡|悬山|simple\s*hip|basic\s*roof)/i.test(value)) add(['xie_ding'], 4);
  return scores;
}

function selectedMethodId(profile, taskText, methodIds) {
  const text = textOf(profile, taskText);
  const scores = capabilityScores(text, methodIds);
  for (const id of methodIds) if (negativeFor(text, id)) scores[id] = -100;
  const ranked = methodIds.map(id => ({ id, score: scores[id] })).filter(item => item.score >= 4).sort((a, b) => b.score - a.score);
  if (!ranked.length || (ranked.length > 1 && ranked[0].score === ranked[1].score)) return null;
  return ranked[0].id;
}

function executableRoute(methodId, catalog) {
  const pack = catalog?.experience_pack;
  const tool = pack ? 'sketchup_toolkit' : 'sketchup_ancient_tool';
  const identity = pack ? { toolkit_id: pack.id, expected_fingerprint: pack.fingerprint } : { family: 'roof', preset_id: methodId };
  const invoke = pack ? (operation, args) => ({ tool, arguments: { action: 'invoke', ...identity, operation, arguments: args, project_id: '<current project>' } }) : null;
  return {
    tool,
    method_id: methodId,
    calls: pack ? [
      invoke('preset', { family: 'roof', preset_id: methodId }),
      invoke('compile', { family: 'roof', parameters: '<only adjust fields returned by preset>', output_directory: '<new absolute output directory>' }),
      { tool: 'sketchup_project_step', arguments: { ruby_file: '<result.manifest.ruby_file>', project_id: '<current project>' } },
    ] : [
      { tool, arguments: { action: 'preset', family: 'roof', preset_id: methodId } },
      { tool, arguments: { action: 'compile', family: 'recipe', parameters: '<returned preset>', output_directory: '<new absolute output directory>' } },
      { tool: 'sketchup_project_step', arguments: { ruby_file: '<returned manifest.ruby_file>' } },
    ],
    validation: 'preset/compile 的真实输入检查保留在工具内；不要凭名称猜参数。',
  };
}

function constructionBriefFor(profile, taskText = '', mode = '', phase = 'massing', catalog = null) {
  const effective = inferProfile(profile || {}, taskText);
  const text = textOf(effective, taskText);
  const ancient = ancientRoofRoute(effective);
  const methods = cards.construction_methods || {};
  if (!ancient) {
    const method = methods.image_primary_form;
    return method ? { method_id: 'image_primary_form', ...copy(method), selection_state: 'candidate_selection_required', source: 'bundled_construction_method', agent_action: '先从来源图提取完整主形、轮廓、负空间和比例，再选择能表达它的构造方法；不要先搭柱网或盒体。' } : null;
  }
  const localIds = ['si_shan', 'wu_dian', 'zan_jian', 'juan_peng', 'helmet', 'xie_ding'];
  const catalogIds = Array.isArray(catalog?.candidates) ? catalog.candidates.map(item => item.method_id).filter(Boolean) : [];
  const ids = [...new Set([...catalogIds, ...localIds])];
  const selected = selectedMethodId(effective, taskText, ids);
  const candidates = ids.map(id => mergeMethod(id, catalog)).filter(Boolean);
  if (selected) {
    const method = candidates.find(item => item.method_id === selected) || mergeMethod(selected, catalog);
    return {
      method_id: selected,
      selection_state: 'applicable_method',
      source: catalog ? 'bundled_method_catalog_and_source_features' : 'bundled_construction_method',
      experience_pack: catalog?.experience_pack || { id: 'adai-ancient-experience', version: '0.4.5' },
      selection_basis: method.selection_basis || basis[selected],
      recognize: method.recognize,
      construct: method.construct,
      method: method.method || { tool: 'sketchup_ancient_tool', preset_id: selected },
      actions: method.actions || [`按来源比例取得 ${selected} 预设，再执行 preset → compile → ruby_file → sketchup_project_step。`],
      key_parameters: method.key_parameters,
      common_errors: method.common_errors,
      inspect: method.inspect,
      if_failed: method.if_failed,
      candidate_methods: candidates.filter(item => item.method_id !== selected).slice(0, 3).map(item => ({ method_id: item.method_id, label: item.label, selection_basis: item.selection_basis })),
      generator: executableRoute(selected, catalog),
      agent_action: '先依据这条可区分说明核对来源，再直接执行适用方法；只有真实形态与说明不符时才改选候选。',
    };
  }
  return {
    method_id: 'ancient_primary_form', selection_state: 'candidate_selection_required', source: catalog ? 'bundled_method_catalog_and_source_features' : 'bundled_construction_method',
    experience_pack: catalog?.experience_pack || { id: 'adai-ancient-experience', version: '0.4.5' },
    recognize: '当前资料尚不足以唯一选定屋面；建筑名称不作为屋面判定。',
    construct: '先建立主体、定义性屋面、退台和主要负空间的完整主形，再按选定方法生成代表性屋壳。',
    candidate_methods: candidates.map(item => ({ method_id: item.method_id, label: item.label, selection_basis: item.selection_basis || basis[item.method_id], recognize: item.recognize, construct: item.construct, key_parameters: item.key_parameters })),
    distinguishing_feature: '需要辨别：端部是独立山面还是连续坡面，是否存在长正脊、中心收束或连续圆曲坡。',
    actions: ['逐张查看用户提供的来源图，只记录可见屋脊、山面、侧坡、檐线、翼角和开敞关系。', '根据上述区别选择一个或保留两个候选；不要按包名或建筑名称猜。', '选定后执行该候选的 preset → compile → ruby_file → sketchup_project_step；预设不能表达来源关键形体时使用受管自定义 Ruby。'],
    agent_action: '方法知识已经按能力展示；不需要先 list/match/read 全库，也不需要补写方法卡。',
  };
}

function ancientMethodRoute(profile) {
  const id = ancientRoofPresetId(profile);
  if (id) return { recommended: 'sketchup_ancient_tool', preset_id: id, sequence: [`preset(family=roof,preset_id=${id})`, 'compile(family=recipe,parameters=returned_preset)', 'sketchup_project_step(ruby_file=returned_manifest.ruby_file)'], fallback: '方法不能表达来源形体时，使用受管自定义 Ruby，保留来源比例和屋面关系。' };
  return { recommended: 'source_first_method_selection', candidates: ['si_shan', 'wu_dian', 'zan_jian', 'juan_peng', 'helmet', 'xie_ding'], sequence: ['inspect source features', 'choose by selection_basis', 'preset → compile → ruby_file → sketchup_project_step'], fallback: '没有候选能表达来源时，使用受管自定义构造；不以盒体或柱网代替主形。' };
}

module.exports = { ancientRoofRoute, ancientRoofPresetId, inferProfile, constructionBriefFor, ancientMethodRoute };
