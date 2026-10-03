"use strict";
const cards=require('./modeling-method-cards.json');
const copy=value=>JSON.parse(JSON.stringify(value));
// Text routing supplies candidates, never a claim of image recognition. Bare
// 'tower' and the building name alone do not specify a roof algorithm.
const roofNames=[['si_shan',/歇山|\b(?:si_shan|xieshan|xie[_ -]shan)\b/i],['wu_dian',/庑殿|\b(?:wudian|wu[_ -]dian)\b/i],['juan_peng',/卷棚|\bjuan[_ -]peng\b/i],['zan_jian',/攒尖|\bzan[_ -]jian\b/i],['helmet',/盔顶|\bhelmet\b/i],['xie_ding',/简化四坡|\bxie_ding\b/i]];
// Ordinary source descriptions should reach the same optional construction help.
// This is method discovery, not a geometric interpretation or preset selection.
const curvedCues=/曲面|曲线|弧形|流线[型形]|曲壳|曲坡|弯曲|复杂轮廓|放样|curv|loft|sweep/i;

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
  if(positiveMatches(current,curvedCues).length)return 'curved_contour';
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
 result.ruby_construction={entry:"g = context['geometry']",units:'所有输入用毫米数值；helper 内转换一次。直接调用 SketchUp API 时用 .mm，因为原生数值是英寸。',
  profile:"g.profile(entities, name, outline_mm, depth_mm, plane='xz', offset_mm=0, material=nil)：等截面沿直线挤出；xy 向 +Z，xz 向 +Y，yz 向 +X。offset 是起始平面而非中心，结束=offset+depth；轮廓随深度变化时用截面/网格。",
  profile_with_holes:"g.profile_with_holes(entities,name,outer_mm,holes_mm,depth_mm,plane='xy',offset_mm=0,material=nil)：外环和内孔沿直线挤出；holes_mm 为二维点环数组，无孔 []、单孔 [hole]。孔在外环内且互不接触；贴边缺口直接放入外轮廓。各构件采用自身轮廓，边框则生成内外环间的带体。",
  box:'g.box(entities, name, origin_mm, size_mm, material=nil)：矩形构件；自动隔离组、处理面方向与正向挤出。返回组，可放入组件定义。',
  loft_sections:"g.loft_sections(entities,name,sections_mm,axis='x',material=nil)：沿直轴连接不同闭合截面并封两端。每站 {'offset_mm'=>轴向位置,'profile_mm'=>二维轮廓}；x截面为YZ，y为XZ，z为XY。位置递增、对应点同序同向；可变宽高/侧移，无孔、非旋转截面，逐段直连而非自动拟合光滑曲线。",
  shell_grid:"g.shell_grid(entities,name,top_grid_mm,thickness_mm,material=nil)：二维XYZ毫米网格生成封闭曲面薄壳，厚度沿-Z。每行同点数≥2；端点XY/Z表达收分和起伏，首末整行/列可重复同一XYZ点收成端点；适用XY上单值、无孔高度面。",
  closed_band:"g.closed_band(entities,name,outer_bottom_mm,outer_top_mm,inner_bottom_mm,inner_top_mm,material=nil)：四条对应XYZ毫米点环生成竖向围合带，中央留空；上下沿可起伏。环点数、绕向一致，内环XY在外环内，各顶点高于对应底点；不自动偏移。",
  sample_profile:cards.construction_methods.curved_contour.method.sample_profile,
  transform:'g.translation_mm([x,y,z])；g.point_mm([x,y,z])。任意曲面仍可用现有网格/放样或自定义 Ruby。',
  material:"material=nil 使用默认显示；需颜色时传 Sketchup::Color.new(r,g,b)。命名材质在 build 内创建：mat=Sketchup.active_model.materials.add('本项目材质名'); mat.color=Sketchup::Color.new(r,g,b)，再将 mat 传给构造方法。仅传自定义名称不会创建材质。",
  reference:'references/managed-ruby-api.md'};
 // Reuse the source features already supplied to begin. Current expert work
 // still uses its own context so a later material/edit task gets no stale roof help.
 const currentText=phase==='work_unit'&&context!==null?context.text||'':textOf(profile,taskText);
 const isPrimary=['massing','roof_profile','work_unit'].includes(phase);
 if(isPrimary && positiveMatches(currentText,curvedCues).length && id!=='curved_contour')
  result.related_method=copy(cards.construction_methods.curved_contour);
 // A plain photo request carries no visual classification. Keep the small core
 // construction palette discoverable; richer matched cards carry their own inputs.
 const showCoreSurfaces=isPrimary&&!['local_correction','variants_and_skin'].includes(id);
 if(!showCoreSurfaces || result.method?.shell_grid || result.related_method?.method?.shell_grid)delete result.ruby_construction.shell_grid;
 if(!showCoreSurfaces || result.method?.closed_band || result.related_method?.method?.closed_band)delete result.ruby_construction.closed_band;
 if(!showCoreSurfaces || result.method?.sample_profile || result.related_method?.method?.sample_profile)delete result.ruby_construction.sample_profile;
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
// Target discovery provides addresses, not recovered design parameters. Reuse
// the callable construction signatures rather than create another method list.
function localEditHelp(objects){
 if(!Array.isArray(objects)||!objects.some(o=>o.target&&!o.locked&&o.direct_instance_edit!==false))return null;
 const api=constructionBriefFor({},'', 'refinement','refinement').ruby_construction;
 return {
  choose:'位置或朝向不对：平移/旋转原对象。边界、退台或开口不对：改相应轮廓；截面沿进深变化：给出不同截面再连接。保留正确部分，修改导致偏差的几何参数；名称和包围盒不是原设计参数。',
  call:{tool:'sketchup_project_step',operation_intent:'update',targets:'所选 objects[].target',ruby_file:'构造修改脚本的绝对路径'},
  build:"在 build 内用 context['edit_targets'] 取得原对象；组用 target.entities，组件用 target.definition.entities。只修改所选范围中的相关内容；需要重建目标内部时保留外层对象及其变换，用 g=context['geometry'] 在内部构造替代几何。",
  coordinates:'helper 输入为目标局部毫米坐标；已有 bounds_inches 和变换平移量为原生英寸。世界点先经 world_transform 的逆变换转入目标局部，再换算为毫米；不重复施加外层变换。',
  methods:{profile:api.profile,profile_with_holes:api.profile_with_holes,loft_sections:api.loft_sections},
  more:'曲面/围合带或任意形体继续用已有 shell_grid、closed_band 或受管 Ruby；精确输入见 references/managed-ruby-api.md。这不是限定可用方法。'
 };
}
module.exports={localEditHelp,ancientRoofRoute,roofSuggestion,ancientRoofPresetId:roofSuggestion,inferProfile,constructionBriefFor,methodFor,selectRoof,needsRoofMethods};
