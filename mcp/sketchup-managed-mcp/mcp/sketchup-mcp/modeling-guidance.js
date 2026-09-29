"use strict";
const cards=require('./modeling-method-cards.json');
const copy=value=>JSON.parse(JSON.stringify(value));
// Text routing supplies candidates, never a claim of image recognition. Bare
// 'tower' and the building name alone do not specify a roof algorithm.
const roofNames=[['si_shan',/歇山|\b(?:si_shan|xieshan|xie[_ -]shan)\b/i],['wu_dian',/庑殿|\b(?:wudian|wu[_ -]dian)\b/i],['juan_peng',/卷棚|\bjuan[_ -]peng\b/i],['zan_jian',/攒尖|\bzan[_ -]jian\b/i],['helmet',/盔顶|\bhelmet\b/i],['xie_ding',/简化四坡|\bxie_ding\b/i]];

function positiveMatches(text,expression){
 const value=String(text||'');
 const re=new RegExp(expression.source,expression.flags.replace('g','')+'g');
 return Array.from(value.matchAll(re)).filter(match=>{
  const before=value.slice(0,match.index).split(/[，,。;；\n]/).pop();
  const after=value.slice(match.index+match[0].length).split(/[，,。;；\n]/)[0];
  // Carry negation across a coordinated list, but stop at an affirmative turn.
  const clause=before.split(/但是|但|而|改用|改为|换成|(?<!不)采用|(?<!不)使用|\bbut\b|\binstead\b/i).pop();
  const negativeList=/(?:不要|不用|不采用|不使用|不选|排除|避免|不是|并非|没有|\bnot|\bno|\bwithout|\bneither)\s*[^，,。;；\n]*(?:和|与|及|或|、|\band\b|\bor\b|\bnor\b)\s*$/i.test(clause);
  return !negativeList && !/(?:不是|并非|不采用|不使用|不选|不用|不要|排除|没有|无|不|非|\bnot|\bno|\bwithout|\bneither|rather than)\s*(?:独立|明确|清晰)?\s*$/i.test(before)
   && !/(?:可能|疑似|不确定|也许|\bmaybe|\bpossible)\s*$/i.test(before)
   && !/^\s*(?:未定|不确定|看不清|未知|可能|不详|unknown|uncertain)/i.test(after);
 });
}
function textOf(profile,taskText=''){return [...(profile?.topics||[]),...(profile?.features||[]),taskText].join('；');}
function roofSuggestion(profile,taskText=''){
 const text=textOf(profile,taskText);
 const named=roofNames.filter(([,re])=>positiveMatches(text,re).length).map(([id])=>id);
 return named.length===1?named[0]:null;
}
function ancientRoofRoute(profile){
 if(profile?.roof_route==='custom')return false;
 if(profile?.roof_route==='ancient_roof')return true;
 if(['ancient_roof','chinese_ancient_roof','chinese_tower','yellow_crane_tower','yellow_crane'].includes(profile?.method_family))return true;
 const words=textOf(profile);
 return positiveMatches(words,/古建|楼阁|黄鹤楼|佛塔|古塔|木塔|寺庙|悬山|yellow[ _-]?crane|pagoda|chinese[_ -]?ancient/i).length>0
  || roofNames.some(([,re])=>positiveMatches(words,re).length>0);
}
function inferProfile(profile,taskText='',normalize){
 const value={...(profile||{}),topics:[...(profile?.topics||[])],features:[...(profile?.features||[])]};
 if(ancientRoofRoute({topics:[String(taskText)]})&&!ancientRoofRoute(value))value.topics.push('古建');
 return typeof normalize==='function'?normalize(value):value;
}
function selectRoof(profile,taskText,ids){
 const text=textOf(profile,taskText);
 const explicit=roofNames.filter(([,re])=>positiveMatches(text,re).length).map(([id])=>id).filter(id=>ids.includes(id));
 if(explicit.length)return explicit.length===1?explicit[0]:null;
 const has=re=>positiveMatches(text,re).length>0;
 // These are textual source cues supplied by the agent, not visual recognition.
 if(has(/独立山面|独立山墙|distinct gable/i)&&has(/四坡裙|下部四坡|hip skirt/i))return ids.includes('si_shan')?'si_shan':null;
 if(has(/连续四坡|四面坡连续|continuous hip/i)&&/没有\s*独立山面|无\s*独立山面|no\s+(independent\s+)?gable/i.test(text))return ids.includes('wu_dian')?'wu_dian':null;
 return null;
}
function methodFor(mode,phase,taskText='',context=null){
 if(phase==='delivery')return 'delivery';
 if(mode==='refinement')return 'local_correction';
 if(['massing','source_alignment'].includes(phase) && mode==='cad')return 'cad_primary_form';
 if(phase==='work_unit'){
  const current=context===null?taskText:context.text||'';
  if(context?.intent==='update'||context?.repair||/修改|修复|纠正|\b(?:move|modify|repair|update)\b/i.test(current))return 'local_correction';
  if(/曲面|曲线|复杂轮廓|放样|curv|loft|sweep/i.test(current))return 'curved_contour';
  if(/复制|阵列|批量|replicat|array/i.test(current))return 'replication';
  if(/原型|样板|代表构件|prototype/i.test(current))return 'representative_component';
  if(/栏杆|入口|门窗|材质|表皮|细部|railing|entrance|facade|material|detail/i.test(current))return 'variants_and_skin';
  // CAD source units and coordinates remain relevant to later construction.
  if(mode==='cad')return 'cad_primary_form';
  return 'system_construction';
 }
 return cards.phases[phase]||'image_primary_form';
}
function needsRoofMethods(profile,taskText,phase,context=null){
 if(!['massing','roof_profile','work_unit'].includes(phase))return false;
 if(phase==='work_unit'){
  const current=context===null?taskText:context.text||'';
  return positiveMatches(current,/屋面|屋盖|屋顶|檐|山面|roof|eave/i).length>0 || roofNames.some(([,re])=>positiveMatches(current,re).length);
 }
 return ancientRoofRoute(inferProfile(profile,taskText))||positiveMatches(taskText,/曲檐|曲坡屋盖|curved roof|curved eave/i).length>0;
}
function constructionBriefFor(profile,taskText='',mode='',phase='massing',catalog=null,context=null){
 const id=methodFor(mode,phase,taskText,context);
 const result={method_id:id,...copy(cards.construction_methods[id])};
 const currentText=phase==='work_unit'&&context!==null?context.text||'':taskText;
 const isPrimary=['massing','roof_profile','work_unit'].includes(phase);
 if(isPrimary && /曲面|曲线|复杂轮廓|放样|curv|loft|sweep/i.test(currentText) && id!=='curved_contour')
  result.related_method=copy(cards.construction_methods.curved_contour);
 if(!needsRoofMethods(profile,taskText,phase,context))return result;
 const currentNames=roofNames.some(([,re])=>re.test(currentText));
 // A current roof choice supersedes the original task's method name.
 const selectionText=phase==='work_unit'&&currentNames?currentText:taskText;
 const effective=phase==='work_unit'&&currentNames?{}:inferProfile(profile,taskText);
 result.roof_scope='屋面方法只生成所选屋壳，不生成整栋。主体、其他定义性屋盖、标高、退台和开敞空间仍由当前建模动作组织。受管 Ruby 是正常选项，无须先让预设失败。';
 result.custom_roof={helper_file:'references/examples/ruby/polygon-eave-shell.rb',entry:'ADAIPolygonEaveShell.build(entities,name,parameters,material=nil)',
  parameters:'outer_xy_mm, inner_xy_mm: 对应的同向凸环；base_z_mm,rise_mm,thickness_mm,corner_lift_mm,span_segments,slope_segments',
  applies:'多边形同拓扑檐环到内环的曲坡壳，可按真实标高组成完整主形；不是歇山山面/任意双曲面的通用生成器。'};
 if(!catalog){result.method_notice='当前屋面包未提供可读取的方法目录；用上述自定义构造，或显式查询已安装工具包。没有据此判定屋面类型。';return result;}
 result.experience_pack=catalog.experience_pack;
 const selected=selectRoof(effective,selectionText,catalog.candidates.map(c=>c.method_id));
 result.selection_state=selected?'applicable_method':'candidate_selection_required';
 result.suggested_method=selected;
 result.suggestion_basis=selected?'来自任务或已提供来源描述的适用线索；按所列差别与实际图像核对。':'来源特征尚不明确；保留候选，不按建筑名称选屋面。';
 result.candidate_methods=catalog.candidates.map(c=>({method_id:c.method_id,label:c.label,selection_basis:c.selection_basis||c.recognize||'当前包未提供适用摘要；查看方法说明。'}));
 if(selected){
  const method=catalog.candidates.find(c=>c.method_id===selected);
  result.matched_method={method_id:selected,label:method.label,recognize:method.recognize,construct:method.construct,
   key_parameters:(method.key_parameters||[]).filter(p=>method.parameter_names.includes(p)),
   common_errors:method.common_errors,inspect:method.inspect,if_failed:method.if_failed};
 }
 if(catalog.actions.includes('preset')&&catalog.actions.includes('compile')&&catalog.candidates.length){
  const argumentsBase={toolkit_id:catalog.experience_pack.id};
  result.generator={tool:'sketchup_toolkit',...argumentsBase,units:catalog.units,dimensions:catalog.dimensions,
   calls:[{tool:'sketchup_toolkit',arguments:{action:'invoke',...argumentsBase,expected_fingerprint:catalog.experience_pack.fingerprint,operation:'preset',arguments:{family:'roof',preset_id:result.suggested_method||'<所选 method_id>'}},add:'project_id 使用当前项目'},
    {tool:'sketchup_toolkit',arguments:{action:'invoke',...argumentsBase,expected_fingerprint:catalog.experience_pack.fingerprint,operation:'compile',arguments:{family:'roof',parameters:'<按来源调整 result.parameters>',output_directory:'<新的绝对输出目录>'}},add:'project_id 使用当前项目'},
    {tool:'sketchup_project_step',arguments:{ruby_file:'<result.manifest.ruby_file>'},add:'project_id 使用当前项目；仅在本次范围就是该屋壳时直接提交'}],
   parameters:'只改 preset 返回的真实字段。width/depth 是檐外包，rise 是局部举高，单位 mm；eave_height/setback 不是生成器字段。标高、退台由装配变换表达。compile 已包含 validate。',
   outputs:'result.manifest.ruby_file 为可直接提交的屋壳脚本；同目录 mesh-data.json 可由受管 Ruby 组织完整主形，不必重复编译。',
   assembly:'mesh-data.json 是 roof 数组：vertices(mm), triangles, offset。当前主形需要多个屋盖/主体时，在同一 build 中按真实变换组合屋壳和主体，再统一 step；details 与墙体不会由 shell 网格自动组装。',
   repair:'屋壳脚本是 create-only；已有受管单元可显式 replace，update 必须用支持目标修改的方法，不能产生第二份重叠屋壳。'};
 }
 return result;
}
module.exports={ancientRoofRoute,roofSuggestion,ancientRoofPresetId:roofSuggestion,inferProfile,constructionBriefFor,methodFor,selectRoof,needsRoofMethods};
