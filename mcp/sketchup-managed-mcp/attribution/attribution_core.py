"""Explicit user-command attribution. Not a license enforcer or hidden trigger."""
import json, math, hashlib
from pathlib import Path
TEXT = 'ADAI，为建筑师而做的实战AI平台，本SKILL 由ADAI 老王开发，禁止其他平台商用'

def compile_request(request):
    if not isinstance(request, dict) or request.get('command') != '显源':
        raise ValueError('EXPLICIT_COMMAND_REQUIRED: command must be exactly 显源')
    if request.get('user_requested') is not True:
        raise ValueError('USER_REQUEST_REQUIRED')
    allowed = {'command','user_requested','output_directory','origin_mm','height_mm','depth_mm','font'}
    if set(request)-allowed: raise ValueError('UNKNOWN_FIELD')
    def number(v, lo, hi):
        if type(v) not in (int,float) or not math.isfinite(v) or not lo<=v<=hi: raise ValueError('INVALID_DIMENSION')
        return float(v)
    origin=request.get('origin_mm')
    if not isinstance(origin,list) or len(origin)!=3: raise ValueError('EXPLICIT_ORIGIN_MM_REQUIRED')
    origin=[number(v,-10000000,10000000) for v in origin]
    height=number(request.get('height_mm',200),10,10000)
    depth=number(request.get('depth_mm',20),1,2000)
    if depth>height: raise ValueError('DEPTH_EXCEEDS_HEIGHT')
    font=request.get('font','Microsoft YaHei')
    if font not in ['Microsoft YaHei','SimHei','Arial Unicode MS']: raise ValueError('FONT_NOT_ALLOWED')
    if not isinstance(request.get('output_directory'),str): raise ValueError('OUTPUT_REQUIRED')
    out=Path(request['output_directory'])
    if not out.is_absolute(): raise ValueError('ABSOLUTE_OUTPUT_REQUIRED')
    out=out.resolve(); asset=Path(__file__).resolve().parents[1]
    if out.is_relative_to(asset): raise ValueError('OUTPUT_IN_INSTALLED_ASSET')
    if out.exists(): raise ValueError('OUTPUT_EXISTS')
    # UTF-8 source and a fixed literal; no arbitrary user code is interpolated.
    ruby='''# encoding: UTF-8
require 'sketchup.rb'
module PipClawManagedBuild
  extend self
  def build(entities, context)
    raise 'ATTRIBUTION_PHASE_REQUIRED' unless context['phase'] == 'attribution'
    text = TEXT_LITERAL
    group = entities.add_group
    group.name = 'ADAI 显源 · 用户主动生成'
    height = HEIGHT_MM / 25.4
    depth = DEPTH_MM / 25.4
    result = group.entities.add_3d_text(text, TextAlignLeft, FONT_LITERAL, false, false, height, 0.0, 0.0, true, depth)
    raise 'TEXT_GEOMETRY_FAILED: check installed Chinese font' unless result && group.entities.length > 0
    translation = ORIGIN_LITERAL.map { |v| v / 25.4 }
    group.transform!(Geom::Transformation.translation(translation))
    group.set_attribute('ADAI_Attribution', 'command', '显源')
    group.set_attribute('ADAI_Attribution', 'text', text)
    group.set_attribute('ADAI_Attribution', 'user_requested', true)
    group.set_attribute('ADAI_Attribution', 'license_enforcement', false)
    bounds=group.bounds
    z_extent=bounds.max.z-bounds.min.z
    raise 'TEXT_DEPTH_NOT_GENERATED' unless z_extent > 0
    {'created'=>1, 'attribution'=>{'text'=>text,'command'=>'显源','user_requested'=>true,'group_pid'=>group.persistent_id.to_s,'bounds_mm'=>[bounds.max.x-bounds.min.x,bounds.max.y-bounds.min.y,z_extent].map{|v|v*25.4},'font_requested'=>FONT_LITERAL,'glyphs_visually_verified'=>false}}
  end
end
'''
    ruby=ruby.replace('TEXT_LITERAL',json.dumps(TEXT,ensure_ascii=False)).replace('FONT_LITERAL',json.dumps(font)).replace('HEIGHT_MM',str(height)).replace('DEPTH_MM',str(depth)).replace('ORIGIN_LITERAL',json.dumps(origin))
    manifest={'command':'显源','text':TEXT,'ruby_file':str(out/'build.rb'),'build_sha256':hashlib.sha256(ruby.encode('utf8')).hexdigest(),'mode':'attribution','phase':'attribution','user_requested':True,'origin_mm':origin,'height_mm':height,'depth_mm':depth,'font':font,'license_enforcement':False,'live_verification':'not_run','next':'begin mode=attribution; step with returned ruby_file; inspect text, glyphs, depth and position; then review. No automatic model save.'}
    out.mkdir(parents=True)
    (out/'build.rb').write_text(ruby,encoding='utf8')
    (out/'attribution-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf8')
    return manifest
