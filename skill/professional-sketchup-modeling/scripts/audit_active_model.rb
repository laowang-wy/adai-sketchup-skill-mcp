require 'json'
require 'digest'
require 'fileutils'

module PipClawModelAudit
  extend self

  MAX_NAME_SAMPLES = 120
  MAX_DEFINITIONS = 150

  def mm(value)
    value.respond_to?(:to_mm) ? value.to_mm.to_f : value.to_f * 25.4
  end

  def bounds_mm(bounds)
    return nil unless bounds && bounds.valid?
    {
      'min' => [mm(bounds.min.x), mm(bounds.min.y), mm(bounds.min.z)].map { |v| v.round(2) },
      'max' => [mm(bounds.max.x), mm(bounds.max.y), mm(bounds.max.z)].map { |v| v.round(2) },
      # SketchUp BoundingBox width/height/depth map to X/Y/Z.
      'size' => [mm(bounds.width), mm(bounds.height), mm(bounds.depth)].map { |v| v.round(2) }
    }
  end

  def same_path?(expected, actual)
    return false if expected.to_s.empty? || actual.to_s.empty?
    File.identical?(expected, actual)
  rescue
    File.expand_path(expected).casecmp(File.expand_path(actual)).zero?
  end

  def new_stats
    {
      'entities' => 0, 'groups' => 0, 'component_instances' => 0,
      'faces' => 0, 'edges' => 0, 'images' => 0, 'texts' => 0,
      'dimensions' => 0, 'construction' => 0, 'unnamed_containers' => 0,
      'tiny_containers_under_150mm' => 0, 'small_containers_under_500mm' => 0,
      'max_depth' => 0, 'names' => [], 'layer_usage' => Hash.new(0),
      'definition_usage' => Hash.new(0)
    }
  end

  def walk(entities, stats, depth, visited_definitions)
    stats['max_depth'] = [stats['max_depth'], depth].max
    entities.each do |entity|
      stats['entities'] += 1
      layer_name = entity.respond_to?(:layer) && entity.layer ? entity.layer.name.to_s : 'Layer0'
      stats['layer_usage'][layer_name] += 1
      case entity
      when Sketchup::Face
        stats['faces'] += 1
      when Sketchup::Edge
        stats['edges'] += 1
      when Sketchup::Group
        stats['groups'] += 1
        record_container(entity, stats)
        walk(entity.entities, stats, depth + 1, visited_definitions)
      when Sketchup::ComponentInstance
        stats['component_instances'] += 1
        record_container(entity, stats)
        definition = entity.definition
        key = definition.guid.to_s.empty? ? definition.object_id.to_s : definition.guid.to_s
        stats['definition_usage'][definition.name.to_s] += 1
        unless visited_definitions[key]
          visited_definitions[key] = true
          walk(definition.entities, stats, depth + 1, visited_definitions)
        end
      when Sketchup::Image
        stats['images'] += 1
      when Sketchup::Text
        stats['texts'] += 1
      when Sketchup::Dimension
        stats['dimensions'] += 1
      when Sketchup::ConstructionLine, Sketchup::ConstructionPoint
        stats['construction'] += 1
      end
    end
  end

  def record_container(entity, stats)
    name = entity.respond_to?(:name) ? entity.name.to_s.strip : ''
    stats['unnamed_containers'] += 1 if name.empty?
    stats['names'] << name unless name.empty? || stats['names'].length >= MAX_NAME_SAMPLES
    size = bounds_mm(entity.bounds)['size'] rescue nil
    if size
      max_dim = size.max
      stats['tiny_containers_under_150mm'] += 1 if max_dim <= 150.0
      stats['small_containers_under_500mm'] += 1 if max_dim <= 500.0
    end
  end

  def audit
    model = Sketchup.active_model
    stats = new_stats
    walk(model.entities, stats, 0, {})
    containers = stats['groups'] + stats['component_instances']
    definitions = model.definitions.reject { |d| d.image? }
    definition_rows = definitions.map do |definition|
      {
        'name' => definition.name.to_s,
        'instances' => definition.instances.length,
        'entities' => definition.entities.length,
        'bounds_mm' => bounds_mm(definition.bounds)
      }
    end.sort_by { |row| [-row['instances'], -row['entities']] }.first(MAX_DEFINITIONS)
    materials = model.materials.map do |material|
      texture = material.texture
      {
        'name' => material.name.to_s,
        'alpha' => material.alpha.to_f.round(3),
        'textured' => !texture.nil?,
        'texture_file' => texture ? File.basename(texture.filename.to_s) : nil,
        'texture_size' => texture ? [texture.width, texture.height].map { |v| mm(v).round(2) } : nil
      }
    end
    textured_count = materials.count { |row| row['textured'] }
    repeated = definition_rows.count { |row| row['instances'] > 1 }
    high_reuse = definition_rows.count { |row| row['instances'] >= 5 }
    {
      'schema_version' => 1,
      'source' => {
        'path' => model.path.to_s,
        'title' => model.title.to_s,
        'sketchup_version' => Sketchup.version.to_s,
        'ruby_version' => RUBY_VERSION
      },
      'model_bounds_mm' => bounds_mm(model.bounds),
      'counts' => stats.reject { |key, _| ['names', 'layer_usage', 'definition_usage'].include?(key) },
      'quality_signals' => {
        'model_scale' => model.bounds.valid? && bounds_mm(model.bounds)['size'].max > 100_000.0 ? 'site_or_campus' : 'building_or_room',
        'top_level_entity_count' => model.entities.length,
        'definition_count' => definitions.length,
        'named_definition_ratio' => definitions.empty? ? 1.0 : (definitions.count { |d| !d.name.to_s.strip.empty? }.to_f / definitions.length).round(4),
        'scenes_count' => model.pages.length,
        'container_naming_ratio' => containers.zero? ? 1.0 : ((containers - stats['unnamed_containers']).to_f / containers).round(4),
        'component_instance_ratio' => containers.zero? ? 0.0 : (stats['component_instances'].to_f / containers).round(4),
        'repeated_definition_count' => repeated,
        'high_reuse_definition_count' => high_reuse,
        'textured_material_ratio' => materials.empty? ? 0.0 : (textured_count.to_f / materials.length).round(4),
        'tiny_container_ratio' => containers.zero? ? 0.0 : (stats['tiny_containers_under_150mm'].to_f / containers).round(4),
        'small_container_ratio' => containers.zero? ? 0.0 : (stats['small_containers_under_500mm'].to_f / containers).round(4),
        'container_naming_note' => 'Instance names are not a reliable quality signal; evaluate definition names and hierarchy separately'
      },
      'layers' => model.layers.map { |layer| {'name' => layer.name.to_s, 'visible' => layer.visible?, 'entity_refs' => stats['layer_usage'][layer.name.to_s]} },
      'materials' => materials,
      'scenes' => model.pages.map do |page|
        {
          'name' => page.name.to_s,
          'use_camera' => page.respond_to?(:use_camera?) ? page.use_camera? : nil,
          'use_hidden' => page.respond_to?(:use_hidden?) ? page.use_hidden? : nil,
          'use_layers' => page.respond_to?(:use_layers?) ? page.use_layers? : nil,
          'use_hidden_layers' => page.respond_to?(:use_hidden_layers?) ? page.use_hidden_layers? : nil
        }
      end,
      'definitions' => definition_rows,
      'name_samples' => stats['names']
    }
  end

  def profile_signals(result, feature_profile)
    profile = feature_profile.to_s
    return nil if profile.empty?
    corpus = []
    corpus.concat(Array(result['layers']).map { |row| row['name'].to_s })
    corpus.concat(Array(result['materials']).map { |row| row['name'].to_s })
    corpus.concat(Array(result['name_samples']).map(&:to_s))
    corpus.concat(Array(result['definitions']).map { |row| row['name'].to_s })
    text = corpus.join('|')
    counts = result['counts'] || {}
    quality = result['quality_signals'] || {}
    if profile.include?('ancient')
      terms = {
        'platform_or_base' => /台基|柱顶石|石材|砖|granite|stone/i,
        'roof_system' => /瓦|屋面|檩|举架|椽|脊|roof|tile/i,
        'frame_system' => /柱|梁|构造柱|木|timber|beam|column/i,
        'courtyard_or_wall' => /院|山墙|墙|合院|gate|wall/i,
        'threshold_or_bracket' => /门|窗|斗拱|檐|亭|door|window|bracket|eave/i,
        'repeated_components' => quality['high_reuse_definition_count'].to_i >= 5
      }
    elsif profile.include?('curved')
      terms = {
        'glass_or_infill' => /玻璃|glaz|glass|窗/i,
        'frame_or_metal' => /幕墙|metal|aluminum|铝|框|mullion|transom/i,
        'floor_or_wall_system' => /楼板|梁|墙|floor|slab|wall/i,
        'repeated_components' => quality['high_reuse_definition_count'].to_i >= 5,
        'developed_hierarchy' => counts['max_depth'].to_i >= 4
      }
    else
      return {'profile' => profile, 'note' => 'No specialized signal profile; use the general audit.'}
    end
    hits = {}
    missing = []
    terms.each do |key, matcher|
      hit = matcher == true ? true : !!(text =~ matcher)
      hits[key] = hit
      missing << key unless hit
    end
    {
      'profile' => profile,
      'signals' => hits,
      'missing_signals' => missing,
      'note' => 'Signals are evidence prompts, not proof of geometric contact. Confirm one close bay/section in SketchUp.'
    }
  end
  def export(output_path, preview_path = nil, expected_path = nil, feature_profile = nil)
    model = Sketchup.active_model
    actual_path = File.expand_path(model.path.to_s)
    unless expected_path.to_s.empty?
      expected = File.expand_path(expected_path.to_s)
      return {'ok' => false, 'error' => "Active model mismatch: expected #{expected}, got #{actual_path}"} unless same_path?(expected, actual_path)
    end

    result = audit
    result['feature_profile'] = feature_profile.to_s unless feature_profile.to_s.empty?
    result['profile_signals'] = profile_signals(result, feature_profile)
    File.open(output_path, 'wb') { |file| file.write(JSON.pretty_generate(result)) }
    unless preview_path.to_s.empty?
      FileUtils.mkdir_p(File.dirname(preview_path))
      view = model.active_view
      view.zoom_extents
      view.write_image({
        filename: preview_path, width: 1600, height: 1000, antialias: true,
        compression: 0.9, transparent: false
      })
    end
    {
      'ok' => true, 'output_path' => output_path, 'preview_path' => preview_path,
      'model_path' => model.path.to_s, 'summary' => result['quality_signals'],
      'counts' => result['counts']
    }
  rescue => error
    {'ok' => false, 'error' => "#{error.class}: #{error.message}", 'backtrace' => error.backtrace}
  end
end
