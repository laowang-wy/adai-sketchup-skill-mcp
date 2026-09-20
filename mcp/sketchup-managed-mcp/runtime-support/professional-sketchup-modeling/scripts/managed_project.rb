# managed_project.rb
# Tool-owned SketchUp project isolation and transactional phase execution.
require 'sketchup.rb'
require 'json'
require_relative 'geometry_guard'
require 'digest'

module PipClawManagedProject
  extend self
  DICT = 'pipclaw_managed_project'.freeze
  ROOT_PREFIX = 'Managed_Project_'.freeze

  def model
    Sketchup.active_model
  end

  # Explicit machine-local workaround; never rewrite the glass material alpha.
  def apply_runtime_render_profile
    config_path = File.join(ENV['APPDATA'].to_s, 'SketchUpLiveMCP', 'runtime-render-profile.json')
    return unless File.file?(config_path)
    profile = JSON.parse(File.read(config_path))
    if profile['disable_material_transparency'] == true
      model.rendering_options['MaterialTransparency'] = false
    end
  end

  def model_identity
    # Identity is a read-only query; rendering options are changed only by an explicit build.
    current = model
    JSON.generate({
      'ok'=>true,
      'object_id'=>current.object_id,
      'path'=>current.path.to_s,
      'title'=>current.title.to_s
    })
  end

  def root_for(project_id, create = false)
    found = model.entities.grep(Sketchup::Group).find do |group|
      group.valid? && group.get_attribute(DICT, 'project_id') == project_id.to_s
    end
    return found if found || !create
    group = model.entities.add_group
    group.name = ROOT_PREFIX + project_id.to_s
    group.set_attribute(DICT, 'project_id', project_id.to_s)
    group.set_attribute(DICT, 'managed_root', true)
    group
  end

  def begin_project(project_id)
    raise ArgumentError, 'project_id is required' if project_id.to_s.strip.empty?
    # Do not create an empty SketchUp group here: SketchUp deletes empty groups at
    # operation commit. The managed root is created atomically with the first phase.
    existing = root_for(project_id, false)
    JSON.generate({'ok'=>true, 'project_id'=>project_id.to_s, 'root_pid'=>(existing ? (existing.persistent_id rescue nil) : nil), 'root_name'=>(existing ? existing.name : nil)})
  end

  def bounds_signature(entity)
    b = entity.bounds
    [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z].map { |v| v.to_f.round(7) }
  rescue StandardError
    []
  end

  def child_entities(entity)
    return entity.entities if entity.respond_to?(:entities)
    return entity.definition.entities if entity.respond_to?(:definition) && entity.definition
    nil
  rescue StandardError
    nil
  end

  def canonical_json(value)
    case value
    when Hash
      keys = value.keys.map(&:to_s).uniq.sort
      '{' + keys.map { |key| original_key = value.key?(key) ? key : key.to_sym; JSON.generate(key) + ':' + canonical_json(value[original_key]) }.join(',') + '}'
    when Array
      '[' + value.map { |item| canonical_json(item) }.join(',') + ']'
    else
      JSON.generate(value)
    end
  end

  def point_signature(point)
    [point.x, point.y, point.z].map { |value| value.to_f.round(7) }
  rescue StandardError
    []
  end

  def material_signature(material)
    return nil unless material
    texture = material.respond_to?(:texture) && material.texture
    texture_path = texture ? (texture.filename.to_s rescue '') : ''
    {
      'name'=>material.display_name.to_s,
      'color'=>(material.color.to_a.map { |value| value.to_f.round(7) } rescue []),
      'alpha'=>(material.alpha.to_f.round(7) rescue nil),
      'texture'=> texture ? {
        'filename'=>texture_path,
        'sha256'=>(File.file?(texture_path) ? Digest::SHA256.file(texture_path).hexdigest : nil),
        'width'=>(texture.width.to_i rescue nil),
        'height'=>(texture.height.to_i rescue nil)
      } : nil
    }
  rescue StandardError
    {'name'=>material.to_s}
  end

  def entity_order_key(entity)
    [(entity.typename.to_s rescue ''), (entity.persistent_id rescue entity.entityID rescue 0).to_i, (entity.name.to_s rescue '')]
  end

  def geometry_leaf_signature(entity)
    if entity.is_a?(Sketchup::Face)
      uv = []
      if entity.respond_to?(:get_UVHelper)
        begin
          helper = entity.get_UVHelper(true, true)
          uv = entity.loops.to_a.flat_map { |loop| loop.vertices.to_a.map { |vertex| helper.get_front_UVQ(vertex.position).to_a.map { |value| value.to_f.round(7) } } }
        rescue StandardError
          uv = []
        end
      end
      {
        'type'=>'face',
        'hidden'=>entity.hidden?,
        'layer'=>entity.layer.name.to_s,
        'layer_visible'=>entity.layer.visible?,
        'loops'=>entity.loops.to_a.map { |loop| loop.vertices.to_a.map { |vertex| point_signature(vertex.position) } },
        'normal'=>(entity.normal.to_a.map { |value| value.to_f.round(7) } rescue []),
        'material'=>material_signature(entity.material),
        'back_material'=>material_signature(entity.back_material),
        'uvq'=>uv
      }
    elsif entity.is_a?(Sketchup::Edge)
      {
        'type'=>'edge',
        'hidden'=>entity.hidden?,
        'layer'=>entity.layer.name.to_s,
        'layer_visible'=>entity.layer.visible?,
        'start'=>point_signature(entity.start.position),
        'end'=>point_signature(entity.end.position),
        'curve'=>(entity.curve ? entity.curve.class.name.to_s : nil)
      }
    else
      {
        'type'=>(entity.typename.to_s rescue ''),
        'pid'=>(entity.persistent_id rescue entity.entityID rescue nil),
        # Group/ComponentInstance state is part of the audited model even when
        # it does not change the outer bounds or face/edge counts.
        'transform'=>(entity.transformation.to_a.map { |value| value.to_f.round(7) } rescue nil),
        'hidden'=>(entity.hidden? rescue nil),
        'locked'=>(entity.respond_to?(:locked?) ? entity.locked? : false),
        'material'=>material_signature(entity.respond_to?(:material) ? entity.material : nil),
        'back_material'=>material_signature(entity.respond_to?(:back_material) ? entity.back_material : nil),
        'layer'=>(entity.layer.name.to_s rescue nil),
        'layer_visible'=>(entity.layer.visible? rescue nil),
        'definition_guid'=>(entity.definition.guid.to_s rescue nil)
      }
    end
  rescue StandardError
    {'type'=>(entity.typename.to_s rescue ''), 'unreadable'=>true}
  end

  def geometry_node_signature(entity, depth = 0, max_depth = 8, path = [], ignore_visibility_pids = nil, cache = nil)
    key = entity.object_id
    children = child_entities(entity)
    leaf_cache = cache && (cache[:geometry_leaf] ||= {})
    node = if leaf_cache && leaf_cache.key?(key)
      leaf_cache[key].dup
    else
      value = geometry_leaf_signature(entity)
      leaf_cache[key] = value if leaf_cache
      value.dup
    end
    node['incomplete'] = true if node['unreadable'] == true
    node['pid'] = (entity.persistent_id rescue entity.entityID rescue nil)
    if ignore_visibility_pids && ignore_visibility_pids.include?(node['pid'].to_s)
      node['hidden'] = '__managed_visibility__'
    end
    return node unless children
    if path.include?(key)
      node['incomplete'] = true
      node['cycle'] = true
      node['max_depth'] = depth
      return node
    end
    valid = children.to_a.select { |child| child.valid? rescue false }.sort_by { |child| entity_order_key(child) }
    node['children'] = []
    node['children'] = valid.map { |child| geometry_node_signature(child, depth + 1, max_depth, path + [key], ignore_visibility_pids, cache) }
    node['incomplete'] = node['incomplete'] == true || node['children'].any? { |child| child['incomplete'] == true }
    node['max_depth'] = max_depth if node['incomplete']
    node
  rescue StandardError
    {'type'=>(entity.typename.to_s rescue ''), 'incomplete'=>true, 'max_depth'=>depth}
  end

  def geometry_summary(entity, ignore_visibility_pids = nil, cache = nil)
    summary_cache = cache && (cache[:geometry_summary] ||= {})
    ignored_key = Array(ignore_visibility_pids).map(&:to_s).sort.join("\0")
    summary_key = [entity.object_id, ignored_key]
    return summary_cache[summary_key] if summary_cache && summary_cache.key?(summary_key)
    node = geometry_node_signature(entity, 0, 8, [], ignore_visibility_pids, cache)
    counts = Hash.new(0)
    walk = lambda do |item|
      counts['entities'] += 1
      counts['faces'] += 1 if item['type'] == 'face'
      counts['edges'] += 1 if item['type'] == 'edge'
      counts['groups'] += 1 if %w[Group ComponentInstance].include?(item['type'])
      Array(item['children']).each { |child| walk.call(child) }
    end
    walk.call(node)
    result = counts.merge('digest'=>Digest::SHA256.hexdigest(canonical_json(node)), 'complete'=>node['incomplete'] != true)
    summary_cache[summary_key] = result if summary_cache
    result
  rescue StandardError
    {'complete'=>false, 'digest'=>nil}
  end

  def appearance_summary(entity)
    material = entity.respond_to?(:material) ? entity.material : nil
    {
      'material'=>material_signature(material),
      'back_material'=>material_signature(entity.respond_to?(:back_material) ? entity.back_material : nil),
      'layer'=>(entity.layer.name.to_s rescue nil),
      'layer_visible'=>(entity.layer.visible? rescue nil),
      'hidden'=>(entity.hidden? rescue nil),
      'definition_guid'=>(entity.definition.guid.to_s rescue nil)
    }
  end

  def entity_record(entity, depth = 0, ignore_visibility_pids = nil, excluded_phase = nil, path = [], cache = nil)
    key = entity.object_id
    children = child_entities(entity)
    valid_children = children ? children.to_a.select { |child| child.valid? rescue false }.sort_by { |child| entity_order_key(child) } : []
    record = {
      'pid'=>(entity.persistent_id rescue entity.entityID rescue nil),
      'type'=>entity.typename.to_s,
      'name'=>(entity.respond_to?(:name) ? entity.name.to_s : ''),
      'layer'=>(entity.respond_to?(:layer) && entity.layer ? entity.layer.name.to_s : ''),
      'material'=>(entity.respond_to?(:material) && entity.material ? entity.material.display_name.to_s : ''),
      'bounds'=>bounds_signature(entity),
      'appearance_summary'=>appearance_summary(entity),
      'geometry_summary'=>geometry_summary(entity, ignore_visibility_pids, cache),
      'incomplete'=>false
    }
    if ignore_visibility_pids && ignore_visibility_pids.include?(record['pid'].to_s)
      record['appearance_summary']['hidden'] = '__managed_visibility__'
    end
    # Face-camera entourage changes its displayed world bounds when the camera
    # moves. Fingerprint definition geometry + placement, not its rendered AABB.
    if entity.is_a?(Sketchup::ComponentInstance) && entity.definition.behavior.always_face_camera?
      record['bounds'] = bounds_signature(entity.definition)
      record['always_face_camera'] = true
    end
    if entity.respond_to?(:transformation)
      if record['always_face_camera']
        t = entity.transformation
        record['transform'] = {'origin'=>t.origin.to_a.map { |v| v.to_f.round(7) }, 'axis_lengths'=>[t.xaxis.length, t.yaxis.length, t.zaxis.length].map { |v| v.to_f.round(7) }, 'zaxis'=>t.zaxis.to_a.map { |v| v.to_f.round(7) }}
      else
        record['transform'] = entity.transformation.to_a.map { |v| v.to_f.round(7) }
      end
    end
    if children
      if path.include?(key)
        record['incomplete'] = true
        record['cycle'] = true
        record['max_depth'] = depth
      else
        filtered_children = valid_children.reject do |child|
          excluded_phase && child.is_a?(Sketchup::Group) && child.get_attribute(DICT, 'phase').to_s == excluded_phase.to_s
        end
        record['children'] = filtered_children.map { |child| entity_record(child, depth + 1, ignore_visibility_pids, excluded_phase, path + [key], cache) }
        record['incomplete'] = record['children'].any? { |child| child['incomplete'] == true }
        record['max_depth'] = 8 if record['incomplete']
      end
    end
    record
  end

  def collect_definition_guids(entity, result = {}, seen = {})
    return result if seen[entity.object_id]
    seen[entity.object_id] = true
    if entity.is_a?(Sketchup::ComponentInstance)
      guid = entity.definition.guid.to_s rescue ''
      result[guid] = entity.definition if !guid.empty?
    end
    children = child_entities(entity)
    children.to_a.each { |child| collect_definition_guids(child, result, seen) } if children
    result
  rescue StandardError
    result
  end

  def external_fingerprint(project_id, mutable_phase = nil, ignore_visibility_pids = nil, include_protected_root = true, cache = nil)
    top_level = model.entities.to_a.select { |entity| entity.valid? rescue false }
    root = root_for(project_id, false)
    external_entities = top_level.reject { |entity| root && entity.object_id == root.object_id }
    protected_entities = if root
      root.entities.to_a.select { |entity| entity.valid? rescue false }.reject do |entity|
        entity.is_a?(Sketchup::Group) && entity.get_attribute(DICT, 'phase').to_s == mutable_phase.to_s
      end
    else
      []
    end
    ignored_visibility = Array(ignore_visibility_pids).map(&:to_s)
    protected_root = if root
      root_record = entity_record(root, 0, ignored_visibility, mutable_phase, [], cache)
      # The root transform and protected children are part of the boundary. The
      # mutable phase is excluded above, so its aggregate bounds/geometry cannot
      # create a false positive for a legal rebuild.
      root_record['bounds'] = []
      root_record['geometry_summary'] = {'complete'=>true, 'excluded_phase'=>mutable_phase.to_s}
      root_record
    end
    records = (external_entities + protected_entities + (include_protected_root && protected_root ? [protected_root] : [])).map { |entity| entity.is_a?(Hash) ? entity : entity_record(entity, 0, ignored_visibility, mutable_phase, [], cache) }
    external_defs = external_entities.each_with_object({}) { |entity, out| collect_definition_guids(entity, out) }
    managed_defs = root ? collect_definition_guids(root) : {}
    # Hash every external definition even when the managed phase only starts
    # referencing it in this step. A legal new reference must not look like a
    # mutation; changing that definition's geometry still changes this digest.
    definitions = external_defs.keys.sort.map do |guid|
      definition = external_defs[guid] || managed_defs[guid]
      {'guid'=>guid, 'name'=>(definition.name.to_s rescue ''), 'geometry_summary'=>geometry_summary(definition, nil, cache)}
    end
    payload = {
      'entities'=>records.sort_by { |record| [record['type'].to_s, record['pid'].to_i, canonical_json(record)] },
      'shared_definitions'=>definitions
    }
    if records.any? { |record| record['incomplete'] == true || record.dig('geometry_summary', 'complete') == false } || definitions.any? { |record| record.dig('geometry_summary', 'complete') == false }
      raise 'PROTECTION_READBACK_INCOMPLETE: unreadable protected geometry cannot be treated as unchanged'
    end
    Digest::SHA256.hexdigest(canonical_json(payload))
  end

  def phase_group(root, phase_name)
    root.entities.grep(Sketchup::Group).find do |group|
      group.valid? && group.get_attribute(DICT, 'phase') == phase_name.to_s
    end
  end

  def count_recursive(entities, counts = Hash.new(0), depth = 0)
    counts['max_depth'] = [counts['max_depth'], depth].max
    entities.each do |entity|
      next unless entity.valid? rescue false
      counts['entities'] += 1
      counts['faces'] += 1 if entity.is_a?(Sketchup::Face)
      counts['edges'] += 1 if entity.is_a?(Sketchup::Edge)
      counts['groups'] += 1 if entity.is_a?(Sketchup::Group)
      counts['component_instances'] += 1 if entity.is_a?(Sketchup::ComponentInstance)
      children = child_entities(entity)
      count_recursive(children, counts, depth + 1) if children
    end
    counts
  end

  # Read actual definition use and world-space AABB volumes. AABB is not solid volume.
  # Each leaf belongs to its nearest component family: nested geometry is not double-counted.
  def complexity_metrics(phase)
    families = {}
    total = 0
    root_volume = phase.bounds.width.to_f * phase.bounds.height.to_f * phase.bounds.depth.to_f
    walk = lambda do |entities, transform, owner, stack|
      entities.each do |entity|
        next unless entity.valid?
        children = child_entities(entity)
        if children
          definition = entity.respond_to?(:definition) ? entity.definition : nil
          key = definition ? definition.guid.to_s : nil
          next if key && stack.include?(key)
          world = transform * entity.transformation
          family = owner
          if entity.is_a?(Sketchup::ComponentInstance) && key
            family = key
            item = families[key] ||= {'definition_guid'=>key,'instances'=>0,'entities'=>0,'max_bbox_volume_ratio'=>0.0}
            item['instances'] += 1
            box = Geom::BoundingBox.new
            8.times { |i| box.add(definition.bounds.corner(i).transform(world)) }
            volume = box.width.to_f * box.height.to_f * box.depth.to_f
            ratio = root_volume > 0 ? volume / root_volume : 1.0
            item['max_bbox_volume_ratio'] = [item['max_bbox_volume_ratio'], ratio].max
          end
          walk.call(children, world, family, key ? stack + [key] : stack)
        else
          total += 1
          families[owner]['entities'] += 1 if owner && families[owner]
        end
      end
    end
    walk.call(phase.entities, Geom::Transformation.new, nil, [])
    families.each_value { |f| f['entity_share'] = total > 0 ? f['entities'].to_f / total : 0.0 }
    {'source'=>'su_entity_readback','bbox_volume_inches3'=>root_volume,
     'normalization'=>'world_AABB_volume_not_solid_volume','leaf_entities'=>total,'families'=>families.values}
  end

  # Records source-visible reusable systems on the managed archetype phase.
  # This is deliberately separate from names/counts so final audit can verify
  # the systems belong to the accepted component contract.
  def register_visible_detail(phase_group, metadata)
    raise ArgumentError, 'phase_group must be a valid SketchUp group' unless phase_group && phase_group.valid?
    data = metadata.is_a?(String) ? JSON.parse(metadata) : metadata
    raise ArgumentError, 'detail metadata must be a Hash' unless data.is_a?(Hash)
    required = %w[id kind source_cue instances]
    missing = required.select { |key| data[key].nil? || data[key].to_s.strip.empty? }
    raise ArgumentError, "detail metadata missing #{missing.join(', ')}" unless missing.empty?
    raise ArgumentError, 'detail instances must be >= 1' unless data['instances'].to_i >= 1
    systems = begin
      JSON.parse(phase_group.get_attribute(DICT, 'visible_detail_systems_json', '[]').to_s)
    rescue StandardError
      []
    end
    normalized = {
      'id'=>data['id'].to_s,
      'kind'=>data['kind'].to_s,
      'source_cue'=>data['source_cue'].to_s,
      'instances'=>data['instances'].to_i,
      'prototype'=>(data['prototype'] || '').to_s,
      'host'=>(data['host'] || '').to_s
    }
    systems.reject! { |item| item.is_a?(Hash) && item['id'].to_s == normalized['id'] }
    systems << normalized
    phase_group.set_attribute(DICT, 'visible_detail_systems_json', JSON.generate(systems))
    normalized
  end

  def phase_detail_systems(phase_group)
    JSON.parse(phase_group.get_attribute(DICT, 'visible_detail_systems_json', '[]').to_s)
  rescue StandardError
    []
  end

  # Records one-off source-visible detail that must not be propagated as part of
  # a reusable archetype (entry, canopy, crown, corner closure, interface, etc.).
  # The actual entity is sealed into the registry so audit can prove the detail
  # exists instead of trusting descriptive metadata.
  def register_unique_detail(phase_group, detail_entity, metadata)
    valid_entity = detail_entity && detail_entity.valid? && (detail_entity.is_a?(Sketchup::Group) || detail_entity.is_a?(Sketchup::ComponentInstance))
    raise ArgumentError, 'unique detail must be a valid Group or ComponentInstance' unless phase_group && phase_group.valid? && valid_entity
    data = metadata.is_a?(String) ? JSON.parse(metadata) : metadata
    raise ArgumentError, 'unique detail metadata must be a Hash' unless data.is_a?(Hash)
    id = data['id'].to_s.strip
    kind = data['kind'].to_s.strip
    cue = data['source_cue'].to_s.strip
    raise ArgumentError, 'unique detail needs id, kind and source_cue' if id.empty? || kind.empty? || cue.empty?
    items = phase_registry(phase_group, 'unique_details_json')
    item = {
      'id'=>id,
      'kind'=>kind,
      'source_cue'=>cue,
      'host'=>(data['host'] || '').to_s,
      'persistent_id'=>(detail_entity.persistent_id rescue nil),
      'name'=>(detail_entity.name rescue '').to_s
    }
    items.reject! { |existing| existing.is_a?(Hash) && existing['id'].to_s == id }
    items << item
    write_phase_registry(phase_group, 'unique_details_json', items)
    item
  end

  # A massing subject is an actual SketchUp group tied to one image-space role.
  # The audit later projects its real bounds through the active camera; a script
  # cannot satisfy the image contract by merely returning descriptive text.
  def register_projection_subject(phase_group, subject_group, metadata)
    raise ArgumentError, 'phase_group and subject_group must be valid groups' unless phase_group && phase_group.valid? && subject_group && subject_group.valid?
    data = metadata.is_a?(String) ? JSON.parse(metadata) : metadata
    raise ArgumentError, 'projection metadata must be a Hash' unless data.is_a?(Hash)
    id = data['id'].to_s.strip
    role = data['role'].to_s.strip
    raise ArgumentError, 'projection subject needs id and role' if id.empty? || role.empty?
    subjects = begin
      JSON.parse(phase_group.get_attribute(DICT, 'projection_subjects_json', '[]').to_s)
    rescue StandardError
      []
    end
    item = { 'id'=>id, 'role'=>role, 'persistent_id'=>(subject_group.persistent_id rescue nil), 'name'=>subject_group.name.to_s }
    subjects.reject! { |existing| existing.is_a?(Hash) && existing['id'].to_s == id }
    subjects << item
    phase_group.set_attribute(DICT, 'projection_subjects_json', JSON.generate(subjects))
    item
  end

  def phase_projection_subjects(phase_group)
    JSON.parse(phase_group.get_attribute(DICT, 'projection_subjects_json', '[]').to_s)
  rescue StandardError
    []
  end

  def phase_registry(phase_group, key)
    JSON.parse(phase_group.get_attribute(DICT, key, '[]').to_s)
  rescue StandardError
    []
  end

  def write_phase_registry(phase_group, key, items)
    phase_group.set_attribute(DICT, key, JSON.generate(items))
    items
  end

  def register_archetype(phase_group, prototype, metadata)
    raise ArgumentError, 'archetype prototype must be a valid Sketchup::ComponentInstance, not a Group' unless phase_group && phase_group.valid? && prototype && prototype.valid? && prototype.is_a?(Sketchup::ComponentInstance)
    data = metadata.is_a?(String) ? JSON.parse(metadata) : metadata
    raise ArgumentError, 'archetype metadata must be a Hash' unless data.is_a?(Hash)
    id = data['id'].to_s.strip
    family = data['family'].to_s.strip
    cue = data['source_cue'].to_s.strip
    raise ArgumentError, 'archetype needs id, family and source_cue' if id.empty? || family.empty? || cue.empty?
    items = phase_registry(phase_group, 'archetypes_json')
    item = {'id'=>id, 'family'=>family, 'source_cue'=>cue, 'persistent_id'=>(prototype.persistent_id rescue nil), 'definition_name'=>prototype.definition.name.to_s, 'definition_guid'=>(prototype.definition.guid rescue '')}
    items.reject! { |existing| existing.is_a?(Hash) && existing['id'].to_s == id }
    items << item
    write_phase_registry(phase_group, 'archetypes_json', items)
    item
  end

  # Resolve an accepted managed object by its semantic ID without trusting a
  # descriptive path. The correction adapter uses this only to bind a declared
  # target; it never treats a missing target as an implicit permission to edit.
  def find_entity_by_semantic_id(project_root, semantic_id)
    wanted = semantic_id.to_s
    found = nil
    walk = lambda do |entities|
      entities.each do |entity|
        next unless entity.valid? rescue false
        if entity.respond_to?(:get_attribute) && entity.get_attribute('ADAI_GEOMETRY', 'semantic_id').to_s == wanted
          found = entity
          return
        end
        if entity.is_a?(Sketchup::Group)
          walk.call(entity.entities)
        elsif entity.is_a?(Sketchup::ComponentInstance)
          walk.call(entity.definition.entities)
        end
        return if found
      end
    end
    walk.call(project_root.entities)
    found
  rescue StandardError
    nil
  end

  def register_primary_correction(phase_group, target_entity, correction_entity, metadata)
    valid = lambda { |entity| entity && entity.valid? && (entity.is_a?(Sketchup::Group) || entity.is_a?(Sketchup::ComponentInstance)) }
    raise ArgumentError, 'correction target and result must be valid managed entities' unless phase_group && phase_group.valid? && valid.call(target_entity) && valid.call(correction_entity)
    data = metadata.is_a?(String) ? JSON.parse(metadata) : metadata
    raise ArgumentError, 'correction metadata must be a Hash' unless data.is_a?(Hash)
    id = data['id'].to_s.strip
    target_id = data['target_semantic_id'].to_s.strip
    reason = data['reason'].to_s.strip
    raise ArgumentError, 'correction needs id, target_semantic_id and reason' if id.empty? || target_id.empty? || reason.empty?
    items = phase_registry(phase_group, 'correction_bindings_json')
    item = {
      'id'=>id,
      'target_semantic_id'=>target_id,
      'target_persistent_id'=>(target_entity.persistent_id rescue nil),
      'correction_persistent_id'=>(correction_entity.persistent_id rescue nil),
      'reason'=>reason
    }
    items.reject! { |existing| existing.is_a?(Hash) && existing['id'].to_s == id }
    items << item
    write_phase_registry(phase_group, 'correction_bindings_json', items)
    item
  end

  def find_archetype(project_root, archetype_id)
    phase = phase_group(project_root, 'archetypes')
    return nil unless phase && phase.valid?
    item = phase_registry(phase, 'archetypes_json').find { |entry| entry['id'].to_s == archetype_id.to_s }
    return nil unless item
    entity = model.find_entity_by_persistent_id(item['persistent_id'].to_i) rescue nil
    entity if entity && entity.valid? && entity.respond_to?(:definition)
  end

  def instantiate_archetype(phase_group, entities, project_root, archetype_id, transform, metadata = {})
    prototype = find_archetype(project_root, archetype_id)
    raise ArgumentError, "Registered archetype not found: #{archetype_id}" unless prototype
    instance = entities.add_instance(prototype.definition, transform || Geom::Transformation.new)
    data = metadata.is_a?(String) ? JSON.parse(metadata) : metadata
    system_id = (data['system_id'] || archetype_id).to_s
    items = phase_registry(phase_group, 'replication_systems_json')
    item = items.find { |entry| entry['id'].to_s == system_id }
    unless item
      item = {'id'=>system_id, 'archetype_id'=>archetype_id.to_s, 'source_cue'=>data['source_cue'].to_s, 'definition_guid'=>(prototype.definition.guid rescue ''), 'definition_name'=>prototype.definition.name.to_s, 'instance_pids'=>[]}
      items << item
    end
    instance.set_attribute(DICT, 'replication_system_id', system_id)
    instance.set_attribute(DICT, 'replication_archetype_id', archetype_id.to_s)
    item['instance_pids'] ||= []
    pid = (instance.persistent_id rescue nil)
    item['instance_pids'] << pid
    item['expected_placements'] ||= []
    expected = data['expected_transform'] || (instance.transformation.to_a rescue [])
    paths = instance_paths_for(project_root, instance)
    raise ArgumentError, 'INSTANCE_PATH_AMBIGUOUS: registration requires one managed instance path' unless paths.length == 1
    item['expected_placements'] << {'persistent_id'=>pid, 'transform'=>Array(expected).map { |value| value.to_f.round(7) }, 'path_pids'=>paths.first['path_pids'], 'world_transform'=>paths.first['world_transform']}
    write_phase_registry(phase_group, 'replication_systems_json', items)
    instance
  end

  def recursive_entities(entities, output = [])
    entities.each do |entity|
      output << entity
      if entity.is_a?(Sketchup::Group)
        recursive_entities(entity.entities, output)
      elsif entity.is_a?(Sketchup::ComponentInstance)
        recursive_entities(entity.definition.entities, output)
      end
    end
    output
  rescue StandardError
    output
  end

  def register_variant(phase_group, entity, metadata)
    raise ArgumentError, 'variant entity must be valid' unless entity && entity.valid?
    data = metadata.is_a?(String) ? JSON.parse(metadata) : metadata
    id = data['id'].to_s.strip
    kind = data['kind'].to_s.strip
    cue = data['source_cue'].to_s.strip
    raise ArgumentError, 'variant needs id, kind and source_cue' if id.empty? || kind.empty? || cue.empty?
    items = phase_registry(phase_group, 'variants_json')
    item = {'id'=>id, 'kind'=>kind, 'source_cue'=>cue, 'persistent_id'=>(entity.persistent_id rescue nil)}
    items.reject! { |existing| existing.is_a?(Hash) && existing['id'].to_s == id }
    items << item
    write_phase_registry(phase_group, 'variants_json', items)
    item
  end

  def find_entity_in_collection(entities, persistent_id)
    entities.to_a.each do |candidate|
      next unless candidate.valid? rescue false
      candidate_id = (candidate.persistent_id rescue candidate.entityID rescue nil).to_i
      return candidate if candidate_id == persistent_id.to_i
      if candidate.is_a?(Sketchup::Group)
        found = find_entity_in_collection(candidate.entities, persistent_id)
        return found if found
      end
    end
    nil
  rescue StandardError
    nil
  end

  def instance_paths_for(root, target)
    found = []
    target_pid = (target.persistent_id rescue target.entityID rescue nil)
    walk = lambda do |entities, parent, ids, definitions|
      entities.to_a.each do |entity|
        next unless entity.valid?
        pid = (entity.persistent_id rescue entity.entityID rescue nil)
        transform = parent * (entity.respond_to?(:transformation) ? entity.transformation : Geom::Transformation.new)
        path_ids = ids + [pid]
        if pid == target_pid
          found << {'path_pids'=>path_ids, 'world_transform'=>transform.to_a.map { |value| value.to_f.round(7) }}
        end
        if entity.is_a?(Sketchup::Group)
          walk.call(entity.entities, transform, path_ids, definitions)
        elsif entity.is_a?(Sketchup::ComponentInstance)
          key = entity.definition.object_id
          raise 'INSTANCE_PATH_CYCLE' if definitions.include?(key)
          walk.call(entity.definition.entities, transform, path_ids, definitions + [key])
        end
      end
    end
    walk.call(root.entities, root.transformation, [(root.persistent_id rescue root.entityID rescue nil)], [])
    found
  end

  def structure_audit(root)
    archetype_phase = phase_group(root, 'archetypes')
    replication_phase = phase_group(root, 'replication')
    variant_phase = phase_group(root, 'variants')
    archetypes = archetype_phase ? phase_registry(archetype_phase, 'archetypes_json') : []
    archetypes = archetypes.map do |item|
      entity = model.find_entity_by_persistent_id(item['persistent_id'].to_i) rescue nil
      item.merge('valid'=>!!(entity && entity.valid?), 'counts'=>(entity && entity.valid? ? count_recursive(child_entities(entity)) : {}), 'bounds_inches'=>(entity && entity.valid? ? bounds_signature(entity) : []))
    end
    replications = replication_phase ? phase_registry(replication_phase, 'replication_systems_json') : []
    replications = replications.map do |item|
      registered = (item['instance_pids'] || []).compact.map(&:to_i)
      unique_pids = registered.uniq
      duplicates = registered.group_by { |pid| pid }.select { |_pid, values| values.length > 1 }.keys
      found = unique_pids.map { |pid| find_entity_in_collection(replication_phase ? replication_phase.entities : [], pid) }
      invalid_pids = unique_pids.select.with_index { |_pid, index| !found[index] || !found[index].is_a?(Sketchup::ComponentInstance) }
      definition_mismatch = []
      expected_guid = item['definition_guid'].to_s
      found.each_with_index do |entity, index|
        next unless entity && entity.is_a?(Sketchup::ComponentInstance)
        actual_guid = (entity.definition.guid rescue '').to_s
        definition_mismatch << unique_pids[index] if expected_guid != '' && actual_guid != expected_guid
      end
      actual = unique_pids.length - invalid_pids.length - definition_mismatch.length
      placements = found.each_with_index.map do |entity, index|
        next unless entity && entity.is_a?(Sketchup::ComponentInstance)
        {
          'persistent_id'=>unique_pids[index],
          'transform'=>(entity.transformation.to_a.map { |value| value.to_f.round(7) } rescue []),
          'bounds_inches'=>bounds_signature(entity)
        }
      end.compact
      expected_records = Array(item['expected_placements'])
      expected_by_pid = expected_records.each_with_object({}) { |entry, memo| memo[entry['persistent_id'].to_i] = Array(entry['transform']).map { |value| value.to_f.round(7) } }
      path_mismatches = found.each_with_index.map do |entity, index|
        next unless entity && entity.is_a?(Sketchup::ComponentInstance)
        expected = expected_records.find { |entry| entry['persistent_id'].to_i == unique_pids[index] }
        paths = instance_paths_for(root, entity)
        valid_path = expected && paths.length == 1 && expected['path_pids'] == paths.first['path_pids'] && expected['world_transform'] == paths.first['world_transform']
        valid_path ? nil : unique_pids[index]
      end.compact
      placement_mismatches = placements.map do |placement|
        expected_transform = expected_by_pid[placement['persistent_id'].to_i]
        next if expected_transform.nil? || expected_transform == placement['transform']
        placement['persistent_id']
      end.compact
      item.merge(
        'expected_instances'=>unique_pids.length,
        'actual_instances'=>actual,
        'invalid_instance_pids'=>invalid_pids,
        'duplicate_instance_pids'=>duplicates,
        'definition_mismatch_pids'=>definition_mismatch,
        'instance_placements'=>placements,
        'placement_mismatch_pids'=>placement_mismatches,
        'path_mismatch_pids'=>path_mismatches,
        'placement_contract_missing'=>expected_by_pid.empty? || expected_by_pid.keys.sort != unique_pids.sort,
        'valid'=>actual == unique_pids.length && actual > 0 && duplicates.empty? && placement_mismatches.empty? && path_mismatches.empty? && !expected_by_pid.empty? && expected_by_pid.keys.sort == unique_pids.sort
      )
    end
    variants = variant_phase ? phase_registry(variant_phase, 'variants_json') : []
    variants = variants.map do |item|
      entity = model.find_entity_by_persistent_id(item['persistent_id'].to_i) rescue nil
      item.merge('valid'=>!!(entity && entity.valid?), 'bounds_inches'=>(entity && entity.valid? ? bounds_signature(entity) : []))
    end
    {'archetypes'=>archetypes, 'replication_systems'=>replications, 'variants'=>variants}
  end

  def world_transform_for(target, entities = model.entities, parent = Geom::Transformation.new, seen = {})
    entities.to_a.each do |candidate|
      next unless candidate.valid? rescue false
      next if seen[candidate.object_id]
      seen[candidate.object_id] = true
      local = candidate.respond_to?(:transformation) ? candidate.transformation : Geom::Transformation.new
      world = parent * local
      if (candidate.persistent_id rescue candidate.entityID rescue nil).to_i == (target.persistent_id rescue target.entityID rescue nil).to_i
        return world
      end
      children = child_entities(candidate)
      found = world_transform_for(target, children, world, seen) if children
      return found if found
    end
    nil
  rescue StandardError
    nil
  end

  def local_bounds_for(entity)
    return entity.definition.bounds if entity.is_a?(Sketchup::ComponentInstance)
    return entity.local_bounds if entity.respond_to?(:local_bounds)
    entity.bounds
  rescue StandardError
    entity.bounds
  end

  def screen_bbox_normalized(entity)
    view = model.active_view
    width = view.vpwidth.to_f
    height = view.vpheight.to_f
    raise 'SketchUp viewport unavailable for projection audit' if width <= 1 || height <= 1
    transform = world_transform_for(entity) || Geom::Transformation.new
    bounds = local_bounds_for(entity)
    points = (0..7).map { |index| view.screen_coords(bounds.corner(index).transform(transform)) }
    xs = points.map(&:x); ys = points.map(&:y)
    [xs.min / width, ys.min / height, xs.max / width, ys.max / height].map { |value| value.round(6) }
  rescue StandardError
    []
  end

  # E13-A narrow patch adapter. It deliberately edits one tagged Group or
  # ComponentInstance by a finite translation and never edits a shared
  # ComponentDefinition. The MCP verifies the returned fingerprint again
  # immediately before applying or rolling back.
  def patch_target(project_id, semantic_id, scope)
    raise ArgumentError, 'patch scope must be instance' unless scope.to_s == 'instance'
    root = root_for(project_id, false)
    raise ArgumentError, "Managed project not found: #{project_id}" unless root && root.valid?
    target = find_entity_by_semantic_id(root, semantic_id)
    raise ArgumentError, "PATCH_TARGET_NOT_FOUND: #{semantic_id}" unless target && target.valid?
    unless target.is_a?(Sketchup::Group) || target.is_a?(Sketchup::ComponentInstance)
      raise ArgumentError, 'PATCH_UNSUPPORTED_OBJECT: semantic target must be a Group or ComponentInstance'
    end
    # A child found through a shared ComponentDefinition has no unique
    # instance path. Refuse it before preview/apply rather than moving every
    # parent instance while claiming an instance-scoped edit.
    shared = shared_definition_ancestor_for(root, target)
    if shared
      raise ArgumentError, 'PATCH_AMBIGUOUS_SHARED_ANCESTOR: target is inside a shared ComponentDefinition; use a unique top-level instance or an explicit supported copy operation'
    end
    target
  end

  def definition_instance_count(definition, entities = model.entities, seen = {})
    return 0 unless definition
    total = 0
    entities.to_a.each do |entity|
      next unless entity.valid? rescue false
      key = entity.object_id
      next if seen[key]
      seen[key] = true
      if entity.is_a?(Sketchup::ComponentInstance)
        total += 1 if (entity.definition.guid.to_s rescue '') == (definition.guid.to_s rescue '')
        total += definition_instance_count(definition, entity.definition.entities, seen)
      elsif entity.is_a?(Sketchup::Group)
        total += definition_instance_count(definition, entity.entities, seen)
      end
    end
    total
  rescue StandardError
    0
  end

  def shared_definition_ancestor_for(root, target)
    found = nil
    walk = lambda do |entities|
      entities.to_a.each do |entity|
        next unless entity.valid? rescue false
        return true if entity.object_id == target.object_id
        if entity.is_a?(Sketchup::Group)
          return true if walk.call(entity.entities)
        elsif entity.is_a?(Sketchup::ComponentInstance)
          if walk.call(entity.definition.entities)
            count = definition_instance_count(entity.definition)
            found = entity.definition if count > 1
            return true
          end
        end
      end
      false
    end
    walk.call(root.entities)
    found
  rescue StandardError
    nil
  end

  def patch_translation(change)
    data = change.is_a?(String) ? JSON.parse(change) : change
    values = data.is_a?(Hash) ? data['translation_mm'] : nil
    raise ArgumentError, 'PATCH_UNSUPPORTED_CHANGE: translation_mm=[x,y,z] is required' unless values.is_a?(Array) && values.length == 3 && values.all? { |value| value.is_a?(Numeric) && value.finite? }
    values.map { |value| value.to_f * 0.03937007874015748 }
  end

  def patch_fingerprint(target)
    Digest::SHA256.hexdigest(canonical_json(entity_record(target)))
  end

  def patch_preview(project_id, semantic_id, scope, change)
    target = patch_target(project_id, semantic_id, scope)
    patch_translation(change)
    instances = []
    if target.is_a?(Sketchup::ComponentInstance)
      guid = target.definition.guid.to_s rescue ''
      model.entities.each { |entity| instances << (entity.persistent_id rescue entity.entityID rescue nil) if entity.is_a?(Sketchup::ComponentInstance) && (entity.definition.guid.to_s rescue '') == guid }
    end
    JSON.generate({
      'ok'=>true,
      'project_id'=>project_id.to_s,
      'semantic_id'=>semantic_id.to_s,
      'scope'=>scope.to_s,
      'persistent_id'=>(target.persistent_id rescue target.entityID rescue nil),
      'entity_type'=>target.typename.to_s,
      'definition_guid'=>(target.definition.guid.to_s rescue nil),
      'definition_instance_pids'=>instances,
      'original_transform'=>target.transformation.to_a.map(&:to_f),
      'target_fingerprint'=>patch_fingerprint(target)
    })
  end

  def patch_apply(project_id, semantic_id, scope, change)
    started = false
    committed = false
    commit_attempted = false
    begin
      target = patch_target(project_id, semantic_id, scope)
      delta = patch_translation(change)
      raise 'target cannot be transformed' unless target.respond_to?(:transform!)
      start_result = model.start_operation("Patch managed #{project_id} #{semantic_id}", true)
      raise 'start_operation returned false' if start_result == false
      started = true
      original = target.transformation.to_a.map(&:to_f)
      target.transform!(Geom::Transformation.translation(Geom::Vector3d.new(*delta)))
      after = target.transformation.to_a.map(&:to_f)
      after_fingerprint = patch_fingerprint(target)
      commit_attempted = true
      commit_result = model.commit_operation
      raise 'commit_operation returned false' if commit_result == false
      committed = true
      JSON.generate({'ok'=>true, 'project_id'=>project_id.to_s, 'semantic_id'=>semantic_id.to_s, 'scope'=>scope.to_s, 'original_transform'=>original, 'target_before'=>original, 'target_after'=>after, 'after_target_fingerprint'=>after_fingerprint})
    rescue Exception => error
      propagate = error.is_a?(Interrupt) || error.is_a?(SystemExit) || error.is_a?(NoMemoryError)
      if !propagate && error.message.to_s.start_with?('PATCH_AMBIGUOUS_SHARED_ANCESTOR')
        return JSON.generate({'ok'=>false, 'error'=>error.message, 'unsupported'=>true, 'write_attempted'=>false})
      end
      rollback_error = nil
      rollback_unconfirmed = false
      if started && !committed && !commit_attempted
        begin
          abort_result = model.abort_operation
          rollback_unconfirmed = abort_result == false
        rescue Exception => abort_error
          rollback_error = exception_payload(abort_error)
          rollback_unconfirmed = true
        end
      end
      raise error if propagate
      if commit_attempted || rollback_unconfirmed
        return JSON.generate({'ok'=>false, 'error'=>"#{error.class}: #{error.message}", 'commit_unconfirmed'=>commit_attempted && !committed, 'rollback_unconfirmed'=>rollback_unconfirmed, 'rollback_error'=>rollback_error})
      end
      raise error
    end
  end

  def patch_rollback(project_id, semantic_id, scope, original_transform)
    started = false
    committed = false
    commit_attempted = false
    begin
      target = patch_target(project_id, semantic_id, scope)
      values = original_transform.is_a?(String) ? JSON.parse(original_transform) : original_transform
      raise ArgumentError, 'PATCH_ORIGINAL_TRANSFORM_INVALID' unless values.is_a?(Array) && values.length == 16 && values.all? { |value| value.is_a?(Numeric) && value.finite? }
      start_result = model.start_operation("Rollback managed patch #{project_id} #{semantic_id}", true)
      raise 'start_operation returned false' if start_result == false
      started = true
      target.transformation = Geom::Transformation.new(values.map(&:to_f))
      after = target.transformation.to_a.map(&:to_f)
      commit_attempted = true
      commit_result = model.commit_operation
      raise 'commit_operation returned false' if commit_result == false
      committed = true
      JSON.generate({'ok'=>true, 'project_id'=>project_id.to_s, 'semantic_id'=>semantic_id.to_s, 'scope'=>scope.to_s, 'target_after'=>after})
    rescue Exception => error
      propagate = error.is_a?(Interrupt) || error.is_a?(SystemExit) || error.is_a?(NoMemoryError)
      rollback_error = nil
      rollback_unconfirmed = false
      if started && !committed && !commit_attempted
        begin
          abort_result = model.abort_operation
          rollback_unconfirmed = abort_result == false
        rescue Exception => abort_error
          rollback_error = exception_payload(abort_error)
          rollback_unconfirmed = true
        end
      end
      raise error if propagate
      if commit_attempted || rollback_unconfirmed
        return JSON.generate({'ok'=>false, 'error'=>"#{error.class}: #{error.message}", 'commit_unconfirmed'=>commit_attempted && !committed, 'rollback_unconfirmed'=>rollback_unconfirmed, 'rollback_error'=>rollback_error})
      end
      raise error
    end
  end

  def projection_subject_audit(root)
    massing = phase_group(root, 'massing')
    return [] unless massing && massing.valid?
    phase_projection_subjects(massing).map do |item|
      entity = model.find_entity_by_persistent_id(item['persistent_id'].to_i) rescue nil
      item.merge('bounds_inches'=>(entity ? bounds_signature(entity) : []), 'screen_bbox_normalized'=>(entity ? screen_bbox_normalized(entity) : []), 'valid'=>!!(entity && entity.valid?))
    end
  end

  def preflight_build_script(script_path)
    source = File.binread(script_path.to_s)
    if defined?(RubyVM::InstructionSequence) && RubyVM::InstructionSequence.respond_to?(:compile)
      RubyVM::InstructionSequence.compile(source, script_path.to_s, script_path.to_s, 1)
    end
    true
  end

  def exception_payload(error)
    {
      'class'=>error.class.name.to_s,
      'message'=>error.message.to_s,
      'line'=>(error.backtrace && error.backtrace.first)
    }
  end

  def operation_receipt_path(project_id, operation_id)
    raise ArgumentError, 'Invalid receipt project ID' unless project_id.to_s.match?(/\A[A-Za-z][A-Za-z0-9_-]{2,63}\z/)
    raise ArgumentError, 'Invalid operation ID' unless operation_id.to_s.match?(/\A[0-9a-f-]{36}\z/)
    File.join(ENV.fetch('APPDATA'), 'SketchUpLiveMCP', 'operation-receipts', project_id.to_s, operation_id.to_s + '.json')
  end

  def operation_receipt(project_id, operation_id)
    target = operation_receipt_path(project_id, operation_id)
    return JSON.generate({'ok'=>true, 'found'=>false, 'operation_id'=>operation_id}) unless File.file?(target)
    receipt = JSON.parse(File.binread(target))
    root = root_for(project_id, false)
    marker = root && root.get_attribute(DICT, 'operation_commit_' + operation_id.to_s)
    marker ||= model.get_attribute(DICT, 'operation_commit_' + operation_id.to_s)
    current_rollback = receipt.dig('result','rollback_confirmed') ? external_fingerprint(project_id, '__no_mutable_phase__') : nil
    JSON.generate({'ok'=>true, 'found'=>true, 'receipt'=>receipt, 'current_model_binding'=>JSON.parse(model_identity), 'commit_marker'=>marker, 'current_rollback_fingerprint'=>current_rollback})
  end

  def auxiliary_with_receipt(request_json)
    request = JSON.parse(request_json)
    method = request.fetch('kind')
    raise 'Unsupported auxiliary action' unless %w[save_copy remove_phase remove_phases].include?(method)
    args = request.fetch('arguments')
    project_id = request.fetch('project_id')
    raise 'Auxiliary input mismatch' unless args.first == project_id && Digest::SHA256.hexdigest(canonical_json(args)) == request.fetch('input_sha256')
    raise 'Auxiliary document mismatch' unless request['model_binding'] == JSON.parse(model_identity)
    target = operation_receipt_path(project_id,request.fetch('operation_id'))
    if File.file?(target)
      prior = JSON.parse(File.binread(target))
      raise 'OPERATION_ID_CONFLICT' unless prior['request'] == request
      return JSON.generate(prior['result']) if prior['status'] == 'completed'
      raise 'RESULT_UNKNOWN: auxiliary operation already dispatched'
    end
    FileUtils.mkdir_p(File.dirname(target))
    File.open(target,File::WRONLY | File::CREAT | File::EXCL,0600) { |f| f.write(JSON.generate({'request'=>request,'status'=>'started'})); f.flush; f.fsync }
    if method == 'save_copy'
      if File.exist?(args[1])
        result = {'ok'=>false,'error'=>'OUTPUT_EXISTS','write_attempted'=>false,'transaction_started'=>false}
      else
        before = project_audit_data(project_id)
        result = JSON.parse(save_copy(*args))
        if result['ok']
          result['saved_file'] = {'path'=>args[1],'bytes'=>File.size(args[1]),'sha256'=>Digest::SHA256.file(args[1]).hexdigest}
          result['pre_save_audit'] = before
          result['post_save_audit'] = project_audit_data(project_id)
          root_for(project_id,false).set_attribute(DICT,'operation_commit_' + request['operation_id'],Digest::SHA256.hexdigest(canonical_json(request)))
        end
      end
    else
      names = method == 'remove_phase' ? [args[1]] : JSON.parse(args[1])
      result = JSON.parse(remove_phases(project_id,names,request))
      result['post_action_audit'] = JSON.parse(deletion_readback(project_id)) if result['ok']
      if method == 'remove_phase' && result['ok']
        result['phase'] = args[1]
        result['removed'] = result['removed'].length
      end
    end
    temporary = target + '.tmp'
    File.open(temporary,'wb') { |f| f.write(JSON.generate({'request'=>request,'status'=>'completed','result'=>result})); f.flush; f.fsync }
    File.rename(temporary,target)
    JSON.generate(result)
  end

  def execute_step_with_receipt(project_id, phase_name, step_index, script_path, projection_brief_json = nil, operation_id = nil)
    raise ArgumentError, 'operation_id is required' if operation_id.to_s.empty?
    target = operation_receipt_path(project_id, operation_id)
    binding = JSON.parse(model_identity)
    request = {'operation_id'=>operation_id, 'project_id'=>project_id, 'phase'=>phase_name, 'step_index'=>step_index, 'script_sha256'=>Digest::SHA256.file(script_path).hexdigest, 'model_binding'=>binding}
    if File.file?(target)
      prior = JSON.parse(File.binread(target))
      raise 'OPERATION_ID_CONFLICT' unless prior['request'] == request
      return JSON.generate(prior['result']) if prior['status'] == 'completed'
      raise 'RESULT_UNKNOWN: operation already started; query its receipt, never replay'
    end
    FileUtils.mkdir_p(File.dirname(target))
    File.open(target, File::WRONLY | File::CREAT | File::EXCL, 0600) do |file|
      file.write(JSON.generate({'request'=>request, 'status'=>'started'})); file.flush; file.fsync
    end
    result = execute_step(project_id, phase_name, step_index, script_path, projection_brief_json, request)
    receipt = {'request'=>request, 'status'=>'completed', 'result'=>JSON.parse(result)}
    temporary = target + '.tmp'
    File.open(temporary, 'wb') { |file| file.write(JSON.generate(receipt)); file.flush; file.fsync }
    File.rename(temporary, target)
    result
  end

  def execute_step(project_id, phase_name, step_index, script_path, projection_brief_json = nil, operation_request = nil)
    raise ArgumentError, 'project_id is required' if project_id.to_s.strip.empty?
    raise ArgumentError, 'phase_name is required' if phase_name.to_s.strip.empty?
    raise "Ruby build file not found: #{script_path}" unless File.file?(script_path.to_s)
    begin
      preflight_build_script(script_path)
    rescue Exception => error
      raise if error.is_a?(Interrupt) || error.is_a?(SystemExit)
      return JSON.generate({'ok'=>false, 'error'=>"#{error.class}: #{error.message}", 'exception'=>exception_payload(error), 'preflight'=>true, 'transaction_started'=>false, 'rollback_unconfirmed'=>false})
    end
    apply_runtime_render_profile
    existing_root = root_for(project_id, false)
    include_protected_root = !existing_root.nil?
    managed_visibility_pids = model.entities.grep(Sketchup::Group).select { |entity| entity.get_attribute(DICT, 'managed_root', false) }.map { |entity| (entity.persistent_id rescue entity.entityID).to_s }
    before_records = model.entities.to_a.select { |e| e.valid? }.reject { |e| e.is_a?(Sketchup::Group) && e.get_attribute(DICT, 'project_id') == project_id.to_s }.map { |e| entity_record(e) }
    before = external_fingerprint(project_id, phase_name, managed_visibility_pids, include_protected_root)
    rollback_baseline = external_fingerprint(project_id, '__no_mutable_phase__')
    started = false
    committed = false
    commit_attempted = false
    begin
      start_result = model.start_operation("Managed #{project_id} #{phase_name}", true)
      raise 'start_operation returned false' if start_result == false
      started = true
      root = root_for(project_id, true)
      # Separate revisions share a document: hide other tool-owned project roots.
      # Preserve their geometry and source files; only display visibility changes.
      model.entities.grep(Sketchup::Group).each do |other|
        next unless other.get_attribute(DICT, 'managed_root', false)
        other.hidden = other != root
      end
      root.hidden = false
      old = phase_group(root, phase_name)
      old.erase! if old && old.valid?
      phase = root.entities.add_group
      phase.name = format('%02d_%s', step_index.to_i + 1, phase_name)
      phase.set_attribute(DICT, 'project_id', project_id.to_s)
      phase.set_attribute(DICT, 'phase', phase_name.to_s)
      phase.set_attribute(DICT, 'step_index', step_index.to_i)
      phase.set_attribute(DICT, 'created_at', Time.now.utc.strftime('%Y-%m-%dT%H:%M:%SZ'))
      # SketchUp can erase a truly empty Group. Keep a hidden tool-owned anchor
      # so phase registries remain attached even when build geometry is hosted by
      # component definitions or registered child objects elsewhere in the root.
      anchor = phase.entities.add_cpoint(ORIGIN)
      anchor.hidden = true if anchor.respond_to?(:hidden=)
      anchor.set_attribute(DICT, 'phase_anchor', true)

      Object.send(:remove_const, :PipClawManagedBuild) if Object.const_defined?(:PipClawManagedBuild)
      load script_path.to_s
      unless Object.const_defined?(:PipClawManagedBuild) && PipClawManagedBuild.respond_to?(:build)
        raise 'Managed build file must define PipClawManagedBuild.build(entities, context)'
      end
      projection_brief = begin
        projection_brief_json.to_s.empty? ? {} : JSON.parse(projection_brief_json.to_s)
      rescue StandardError
        {}
      end
      context = {
        'project_id'=>project_id.to_s,
        'phase'=>phase_name.to_s,
        'step_index'=>step_index.to_i,
        'phase_group'=>phase,
        'project_root'=>root,
        'model'=>model,
        # SketchUp's internal lengths are inches. Supplying both conversions here
        # prevents build files from inventing/reversing a metres conversion.
        'working_units'=>'mm',
        'meters_to_inches'=>39.37007874015748,
        'mm_to_inches'=>0.03937007874015748,
        'projection_brief'=>projection_brief
      }
      result = PipClawManagedBuild.build(phase.entities, context)
      managed_roots = model.entities.grep(Sketchup::Group).select { |entity| entity.get_attribute(DICT, 'managed_root', false) }
      visibility_violation = managed_roots.any? do |entity|
        next false if entity.object_id == root.object_id
        (entity.hidden? rescue false) != true
      end
      raise 'Managed isolation violation: tool-owned project roots must remain hidden during an isolated step' if visibility_violation
      after = external_fingerprint(project_id, phase_name, managed_visibility_pids, include_protected_root)
      unless before == after
        after_records = model.entities.to_a.select { |e| e.valid? }.reject { |e| e.is_a?(Sketchup::Group) && e.get_attribute(DICT, 'project_id') == project_id.to_s }.map { |e| entity_record(e) }
        debug_path = File.join(ENV['APPDATA'].to_s, 'SketchUpLiveMCP', 'last-isolation-diff.json')
        File.write(debug_path, JSON.generate({'project_id'=>project_id, 'before'=>before_records, 'after'=>after_records}))
        raise 'Managed isolation violation: geometry outside the project root changed; see last-isolation-diff.json'
      end
      counts = count_recursive(phase.entities)
      bounds = bounds_signature(phase)
      metrics = complexity_metrics(phase)
      if operation_request
        root.set_attribute(DICT, 'operation_commit_' + operation_request.fetch('operation_id'), Digest::SHA256.hexdigest(canonical_json(operation_request)))
      end
      commit_attempted = true
      commit_result = model.commit_operation
      raise 'commit_operation returned false' if commit_result == false
      committed = true
      JSON.generate({
        'complexity_metrics'=>metrics,
        'ok'=>true, 'project_id'=>project_id.to_s, 'phase'=>phase_name.to_s,
        'step_index'=>step_index.to_i, 'phase_pid'=>(phase.persistent_id rescue nil),
        'counts'=>counts, 'bounds_inches'=>bounds, 'build_result'=>result
      })
    rescue Exception => error
      propagate = error.is_a?(Interrupt) || error.is_a?(SystemExit) || error.is_a?(NoMemoryError)
      rollback_error = nil
      rollback_unconfirmed = false
      commit_unconfirmed = started && commit_attempted && !committed
      if started && !committed && !commit_attempted
        begin
          abort_result = model.abort_operation
          if abort_result == false
            rollback_unconfirmed = true
            rollback_error = {'class'=>'Sketchup::AbortOperationFailed', 'message'=>'abort_operation returned false', 'line'=>nil}
          end
        rescue Exception => abort_error
          rollback_error = exception_payload(abort_error)
          rollback_unconfirmed = true
        end
      end
      raise error if propagate
      JSON.generate({
        'ok'=>false,
        'error'=>"#{error.class}: #{error.message}",
        'exception'=>exception_payload(error),
        'transaction_started'=>started,
        'commit_unconfirmed'=>commit_unconfirmed,
        'rollback_unconfirmed'=>rollback_unconfirmed,
        'rollback_confirmed'=>started && !commit_attempted && !rollback_unconfirmed && rollback_baseline == external_fingerprint(project_id, '__no_mutable_phase__'),
        'rollback_fingerprint'=>rollback_baseline,
        'rollback_error'=>rollback_error
      })
    end
  end

  def remove_phase(project_id, phase_name)
    started = false
    committed = false
    commit_attempted = false
    begin
      start_result = model.start_operation("Revise managed #{project_id} #{phase_name}", true)
      raise 'start_operation returned false' if start_result == false
      started = true
      root = root_for(project_id, false)
      removed = 0
      if root
        target = phase_group(root, phase_name)
        if target && target.valid?
          target.erase!
          removed = 1
        end
      end
      commit_attempted = true
      commit_result = model.commit_operation
      raise 'commit_operation returned false' if commit_result == false
      committed = true
      JSON.generate({'ok'=>true, 'project_id'=>project_id.to_s, 'phase'=>phase_name.to_s, 'removed'=>removed})
    rescue Exception => error
      propagate = error.is_a?(Interrupt) || error.is_a?(SystemExit)
      rollback_error = nil
      rollback_unconfirmed = false
      if started && !committed && !commit_attempted
        begin
          abort_result = model.abort_operation
          rollback_unconfirmed = abort_result == false
        rescue Exception => abort_error
          rollback_error = exception_payload(abort_error)
          rollback_unconfirmed = true
        end
      end
      error.instance_variable_set(:@pipclaw_rollback_error, rollback_error) if rollback_error
      raise error if propagate
      if commit_attempted || rollback_unconfirmed
        return JSON.generate({'ok'=>false, 'error'=>"#{error.class}: #{error.message}", 'exception'=>exception_payload(error), 'commit_unconfirmed'=>commit_attempted && !committed, 'rollback_unconfirmed'=>rollback_unconfirmed, 'rollback_error'=>rollback_error})
      end
      raise error
    end
  end


  # Atomically removes a caller-supplied downstream phase set. The caller sends
  # names in reverse dependency order so a failed operation never leaves a
  # partially revised managed root.
  def remove_phases(project_id, phase_names_json, operation_request = nil)
    names = phase_names_json.is_a?(String) ? JSON.parse(phase_names_json) : phase_names_json
    raise ArgumentError, 'phase_names must be a non-empty Array' unless names.is_a?(Array) && !names.empty?
    normalized = names.map { |name| name.to_s.strip }
    raise ArgumentError, 'phase_names contains an empty or duplicate phase' if normalized.any?(&:empty?) || normalized.uniq.length != normalized.length
    rollback_baseline = external_fingerprint(project_id, '__no_mutable_phase__')
    started = false
    committed = false
    commit_attempted = false
    begin
      start_result = model.start_operation("Revise managed #{project_id} from #{normalized.last}", true)
      raise 'start_operation returned false' if start_result == false
      started = true
      root = root_for(project_id, false)
      raise "Managed project not found: #{project_id}" unless root
      removed = []
      normalized.each do |phase_name|
        target = phase_group(root, phase_name)
        next unless target && target.valid?
        target.erase!
        removed << phase_name
      end
      if operation_request
        # Removing the last phase can make SketchUp erase its empty root. Bind
        # the deletion receipt to the document transaction, not that lost root.
        model.set_attribute(DICT,'operation_commit_' + operation_request.fetch('operation_id'),Digest::SHA256.hexdigest(canonical_json(operation_request)))
      end
      commit_attempted = true
      commit_result = model.commit_operation
      raise 'commit_operation returned false' if commit_result == false
      committed = true
      JSON.generate({'ok'=>true, 'project_id'=>project_id.to_s, 'requested'=>normalized, 'removed'=>removed})
    rescue Exception => error
      propagate = error.is_a?(Interrupt) || error.is_a?(SystemExit)
      rollback_error = nil
      rollback_unconfirmed = false
      if started && !committed && !commit_attempted
        begin
          abort_result = model.abort_operation
          rollback_unconfirmed = abort_result == false
        rescue Exception => abort_error
          rollback_error = exception_payload(abort_error)
          rollback_unconfirmed = true
        end
      end
      error.instance_variable_set(:@pipclaw_rollback_error, rollback_error) if rollback_error
      raise error if propagate
      confirmed = started && !commit_attempted && !rollback_unconfirmed && rollback_baseline == external_fingerprint(project_id, '__no_mutable_phase__')
      JSON.generate({'ok'=>false, 'error'=>"#{error.class}: #{error.message}", 'exception'=>exception_payload(error), 'transaction_started'=>started, 'commit_unconfirmed'=>commit_attempted && !committed, 'rollback_unconfirmed'=>rollback_unconfirmed, 'rollback_confirmed'=>confirmed, 'rollback_fingerprint'=>rollback_baseline, 'rollback_error'=>rollback_error})
    end
  end



  def deletion_readback(project_id)
    data = root_for(project_id,false) ? project_audit_data(project_id) : {'project_id'=>project_id,'root_absent'=>true,'document_fingerprint'=>external_fingerprint(project_id,'__no_mutable_phase__')}
    JSON.generate(data.merge('ok'=>true))
  end

  def camera_state
    c = model.active_view.camera
    JSON.generate({
      'ok'=>true,
      'eye'=>c.eye.to_a,
      'target'=>c.target.to_a,
      'up'=>c.up.to_a,
      'perspective'=>c.perspective?,
      'fov'=>(c.fov rescue nil),
      'height'=>(c.height rescue nil)
    })
  end

  def restore_camera(state_json)
    state = state_json.is_a?(String) ? JSON.parse(state_json) : state_json
    eye = Geom::Point3d.new(*state['eye'])
    target = Geom::Point3d.new(*state['target'])
    up = Geom::Vector3d.new(*state['up'])
    camera = Sketchup::Camera.new(eye, target, up, !!state['perspective'])
    camera.fov = state['fov'].to_f if state['perspective'] && state['fov']
    camera.height = state['height'].to_f if !state['perspective'] && state['height'] && camera.respond_to?(:height=)
    model.active_view.camera = camera
    model.active_view.refresh
    JSON.generate({'ok'=>true})
  end

  def safe_ratio(a, b)
    aa = a.to_f
    bb = b.to_f
    return 0.0 if bb.abs <= 0.000001
    (aa / bb).round(6)
  end

  # SketchUp BoundingBox width/height/depth are X/Y/Z; architectural height is Z.
  def root_form_summary(entity)
    b = entity.bounds
    plan = [b.width.to_f, b.height.to_f].sort
    short = plan[0].to_f
    long = plan[1].to_f
    height = b.depth.to_f
    {
      'width_inches'=>b.width.to_f.round(6),
      'depth_inches'=>b.height.to_f.round(6),
      'height_inches'=>height.round(6),
      'plan_short'=>short.round(6),
      'plan_long'=>long.round(6),
      'plan_aspect'=>safe_ratio(long, short),
      'height_to_width'=>safe_ratio(height, long),
      'height_to_thickness'=>safe_ratio(height, short)
    }
  rescue StandardError
    {}
  end

  def subject_kind(entity)
    values = [
      (entity.get_attribute(DICT, 'subject_kind') rescue nil),
      (entity.get_attribute(DICT, 'role') rescue nil),
      (entity.get_attribute(DICT, 'semantic_kind') rescue nil)
    ].map { |value| value.to_s.strip.downcase }.reject(&:empty?)
    values.first
  end

  def dominant_body_candidate?(entity)
    return false unless entity.is_a?(Sketchup::Group) || entity.is_a?(Sketchup::ComponentInstance)
    return false unless entity.valid?
    kind = subject_kind(entity)
    return false if kind == 'phase' || kind == 'phase_container' || kind == 'prototype' || kind == 'helper' || kind == 'context' || kind == 'site'
    return true if %w[building body main_body wing].include?(kind)
    # A managed phase container is never a physical body. Untagged direct
    # children remain a compatibility fallback for older projects.
    return false if (entity.get_attribute(DICT, 'phase') rescue nil)
    true
  end

  # Resolve physical subjects through a managed phase container. A phase group
  # is bookkeeping, never a building; its direct registered body children are
  # the candidates. Roofs, entrances, context and helpers remain excluded by
  # semantic kind. Untagged direct children are retained only as the legacy
  # compatibility fallback, so an ambiguous nested structure is not silently
  # inflated by every leaf detail.
  def dominant_body_entities(entities, nested_phase = false, result = [])
    entities.to_a.each do |entity|
      next unless entity.valid? rescue false
      next unless entity.is_a?(Sketchup::Group) || entity.is_a?(Sketchup::ComponentInstance)
      if entity.get_attribute(DICT, 'phase')
        children = child_entities(entity)
        dominant_body_entities(children, true, result) if children
        next
      end
      kind = subject_kind(entity)
      next if %w[phase phase_container prototype helper context site roof roof_shell entrance entry facade_detail].include?(kind)
      if %w[building body main_body wing].include?(kind) || !nested_phase
        result << entity if dominant_body_candidate?(entity)
      elsif nested_phase
        # A phase child without a semantic kind is a supported legacy body
        # candidate, but we do not recurse into it and count its details.
        result << entity if dominant_body_candidate?(entity)
      end
    end
    result
  rescue StandardError
    result
  end

  def dominant_bodies_summary(root)
    candidates = dominant_body_entities(root.entities)
    seen = {}
    masses = candidates.select do |entity|
      pid = (entity.persistent_id rescue entity.entityID rescue nil).to_i
      key = pid > 0 ? pid : entity.object_id
      next false if seen[key]
      seen[key] = true
      begin
        entity.layer.visible?
      rescue StandardError
        true
      end
    end
    bodies = masses.map do |group|
      b = group.bounds
      width = b.width.to_f
      depth = b.height.to_f
      height = b.depth.to_f
      plan = [width, depth].sort
      short = plan[0].to_f
      long = plan[1].to_f
      footprint = width * depth
      {
        'name'=>group.name.to_s,
        'persistent_id'=>(group.persistent_id rescue nil),
        'subject_kind'=>subject_kind(group),
        'width_inches'=>width.round(6),
        'depth_inches'=>depth.round(6),
        'height_inches'=>height.round(6),
        'plan_long'=>long.round(6),
        'plan_short'=>short.round(6),
        'plan_aspect'=>safe_ratio(long, short),
        'height_to_width'=>safe_ratio(height, long),
        'height_to_thickness'=>safe_ratio(height, short),
        'footprint'=>footprint.round(6),
        'bounds_inches'=>bounds_signature(group)
      }
    end
    bodies.sort_by! { |item| -item['footprint'].to_f }
    total = bodies.sum { |item| item['footprint'].to_f }
    bodies.each do |item|
      item['footprint_share'] = safe_ratio(item['footprint'].to_f, total)
    end
    main = bodies.select { |item| item['footprint_share'].to_f >= 0.08 }.first(8)
    {
      'main_body_count'=>main.length,
      'dominant_body_footprint_ratio'=>(main.first ? main.first['footprint_share'].to_f.round(6) : 0.0),
      'bodies'=>main,
      'candidate_count'=>masses.length,
      'excluded_container_count'=>root.entities.to_a.count { |entity| (entity.get_attribute(DICT, 'phase') rescue nil) },
      'count_confidence'=>(bodies.any? { |item| !item['subject_kind'].to_s.empty? } ? 'semantic_or_mixed' : 'legacy_top_level_fallback')
    }
  rescue StandardError
    { 'main_body_count'=>0, 'dominant_body_footprint_ratio'=>0.0, 'bodies'=>[], 'candidate_count'=>0, 'count_confidence'=>'unavailable' }
  end

  def scale_diagnostics(entity)
    b = entity.bounds
    spans = [b.width.to_f, b.height.to_f, b.depth.to_f]
    largest = spans.max || 0.0
    warning = if largest > 0 && largest < 1.0
      'Managed subject is smaller than one inch across. Check metres/mm-to-inches conversion before accepting.'
    elsif largest > 1_000_000.0
      'Managed subject exceeds one million inches across. Check working-unit conversion before accepting.'
    else
      ''
    end
    {
      'span_inches'=>spans.map { |v| v.round(6) },
      'span_mm'=>spans.map { |v| (v * 25.4).round(3) },
      'largest_span_inches'=>largest.round(6),
      'warning'=>warning
    }
  rescue StandardError
    {}
  end

  # The mutable phase may change, but locked objects inside it may not. Hashes
  # bind recapture to the same protected scene used by transactional writes.
  def recapture_protection(project_id, cache = nil)
    root = root_for(project_id, false)
    visibility = model.entities.grep(Sketchup::Group).select { |e| e.get_attribute(DICT, 'managed_root', false) }.map { |e| e.persistent_id.to_s }
    locked = []
    walk = lambda do |entity|
      if entity.respond_to?(:locked?) && entity.locked?
        record = entity_record(entity, 0, nil, nil, [], cache)
        record['locked_paths'] = entity == root ? [{'world_transform'=>root.transformation.to_a}] : instance_paths_for(root,entity)
        raise 'PROTECTION_READBACK_INCOMPLETE' if record['incomplete'] || record.dig('geometry_summary', 'complete') == false
        locked << record
      else
        Array(child_entities(entity)).each { |child| walk.call(child) }
      end
    end
    walk.call(root)
    root.entities.grep(Sketchup::Group).each_with_object({}) do |group, result|
      phase = group.get_attribute(DICT, 'phase').to_s
      next if phase.empty?
      result[phase] = {'boundary'=>external_fingerprint(project_id, phase, visibility, true, cache), 'locked'=>Digest::SHA256.hexdigest(canonical_json(locked))}
    end
  end

  def project_audit_data(project_id, reuse_geometry = true)
    # The cache is deliberately scoped to this audit call. Tests may disable it
    # to compare the exact same correctness path without creating cross-request state.
    audit_cache = reuse_geometry ? {} : nil
    root = root_for(project_id, false)
    raise "Managed project not found: #{project_id}" unless root
    phases = root.entities.grep(Sketchup::Group).select { |group| group.valid? }.map do |group|
      {
        'name'=>group.name.to_s,
        'phase'=>group.get_attribute(DICT, 'phase').to_s,
        'step_index'=>group.get_attribute(DICT, 'step_index'),
        'persistent_id'=>(group.persistent_id rescue nil),
        'bounds_inches'=>bounds_signature(group),
        'counts'=>count_recursive(group.entities),
        'visible_detail_systems'=>phase_detail_systems(group),
        'unique_details'=>phase_registry(group, 'unique_details_json')
      }
    end
    detail_systems = phases.flat_map { |phase| phase['visible_detail_systems'] || [] }
    unique_details = phases.flat_map { |phase| phase['unique_details'] || [] }.map do |item|
      entity = model.find_entity_by_persistent_id(item['persistent_id'].to_i) rescue nil
      item.merge(
        'valid'=>!!(entity && entity.valid?),
        'counts'=>(entity && entity.valid? ? count_recursive(child_entities(entity)) : {}),
        'bounds_inches'=>(entity && entity.valid? ? bounds_signature(entity) : [])
      )
    end
    {
      'schema_version'=>1,
      'project_id'=>project_id.to_s,
      'model'=>JSON.parse(model_identity),
      'recapture_protection'=>recapture_protection(project_id, audit_cache),
      'root'=>{
        'name'=>root.name.to_s,
        'persistent_id'=>(root.persistent_id rescue nil),
        'bounds_inches'=>bounds_signature(root),
        'counts'=>count_recursive(root.entities),
        'geometry_summary'=>geometry_summary(root, nil, audit_cache)
      },
      'phases'=>phases,
      'visible_detail_systems'=>detail_systems,
      'unique_details'=>unique_details,
      'projection_subjects'=>projection_subject_audit(root),
      'structure'=>structure_audit(root),
      'camera'=>JSON.parse(camera_state),
      'root_form_summary'=>root_form_summary(root),
      'massing_summary'=>dominant_bodies_summary(root),
      'scale_diagnostics'=>scale_diagnostics(root),
      'created_at'=>Time.now.utc.strftime('%Y-%m-%dT%H:%M:%SZ')
    }
  end

  def export_project_audit(project_id, output_path)
    data = project_audit_data(project_id)
    File.open(output_path.to_s, 'wb') { |file| file.write(JSON.pretty_generate(data)) }
    JSON.generate({'ok'=>true, 'path'=>output_path.to_s, 'project_id'=>project_id.to_s, 'counts'=>data['root']['counts']})
  end

  def save_copy(project_id, output_path)
    root = root_for(project_id, false)
    raise "Managed project not found: #{project_id}" unless root
    FileUtils.mkdir_p(File.dirname(output_path.to_s))
    binding_before = JSON.parse(model_identity)
    ok = false
    strategy = 'save_copy'
    begin
      ok = model.save_copy(output_path.to_s)
    rescue ArgumentError => e
      raise e unless e.message.to_s =~ /Model must be saved before copying/i
      strategy = 'temporary_save_as_then_copy'
      temp_dir = File.join(ENV['APPDATA'].to_s, 'SketchUpLiveMCP', 'temp-models')
      FileUtils.mkdir_p(temp_dir)
      temp_model = File.join(temp_dir, "managed-#{project_id}-#{Time.now.utc.strftime('%Y%m%d%H%M%S')}.skp")
      ok = model.save(temp_model)
      raise 'Temporary save before copy failed' unless ok && File.file?(temp_model)
      FileUtils.cp(temp_model, output_path.to_s)
      ok = File.file?(output_path.to_s)
    end
    size = File.file?(output_path.to_s) ? File.size(output_path.to_s) : 0
    binding_after = JSON.parse(model_identity)
    JSON.generate({'ok'=>!!ok && size > 0, 'path'=>output_path.to_s, 'bytes'=>size, 'active_model_path'=>model.path.to_s, 'strategy'=>strategy, 'model_binding_before'=>binding_before, 'model_binding_after'=>binding_after, 'path_migrated'=>binding_before['path'].to_s.empty? && !binding_after['path'].to_s.empty?})
  end

  # Exports three source-camera-aligned facade close-ups. Overall screenshots
  # cannot reveal whether a claimed "detail" is a real balcony/window/edge kit.
  def capture_detail_views(project_id, output_directory)
    root = root_for(project_id, false)
    raise "Managed project not found: #{project_id}" unless root
    FileUtils.mkdir_p(output_directory.to_s)
    view = model.active_view
    original_state = camera_state
    original = view.camera
    direction = original.target - original.eye
    # Facade close-ups need a horizontal viewing direction. A top/plan source
    # camera is parallel to world-up and cannot construct a valid facade camera.
    direction = Geom::Vector3d.new(direction.x, direction.y, 0) if direction
    direction = Geom::Vector3d.new(0, 1, 0) if !direction || direction.length <= 0.0001
    direction.length = 1.0
    bounds = root.bounds
    center = bounds.center
    horizontal = [bounds.width.to_f, bounds.height.to_f].max
    distance = [horizontal * 2.2, bounds.depth.to_f * 0.24, 120.0].max
    up = Geom::Vector3d.new(0, 0, 1)
    levels = [['lower', 0.23], ['middle', 0.52], ['upper', 0.81]]
    paths = levels.map do |label, fraction|
      target = Geom::Point3d.new(center.x, center.y, bounds.min.z + bounds.depth * fraction)
      eye = Geom::Point3d.new(
        target.x - direction.x.to_f * distance,
        target.y - direction.y.to_f * distance,
        target.z - direction.z.to_f * distance
      )
      camera = Sketchup::Camera.new(eye, target, up, true)
      camera.fov = 34.0 if camera.respond_to?(:fov=)
      view.camera = camera
      path = File.join(output_directory.to_s, "detail-#{label}.png")
      raise "Could not write detail view #{label}" unless view.write_image(path, 1600, 1200, true, 0.9)
      path
    end
    JSON.generate({'ok'=>true, 'paths'=>paths, 'labels'=>levels.map { |item| item[0] }})
  ensure
    if defined?(view) && defined?(original) && view && original
      restore_camera(original_state)
      view.refresh
    end
  end

  # Use the full world-space drawable extent, including height, for both exporters.
  def prototype_camera_state(entity, rise)
    transform = world_transform_for(entity)
    raise 'Prototype has no live world path' unless transform
    bounds = drawable_bounds(entity.definition.entities, transform)
    raise 'Prototype has no drawable extent' unless bounds.valid?
    target = bounds.center
    direction = Geom::Vector3d.new(-0.58, -1.35, rise)
    direction.length = [bounds.diagonal / 2.0, 1.0].max * 4.0
    {'eye'=>(target + direction).to_a, 'target'=>target.to_a, 'up'=>[0,0,1], 'perspective'=>true, 'fov'=>43.0}
  end

  # Capture real registered prototypes at a useful review scale, then restore camera.
  def capture_archetype_views(project_id, output_directory)
    root = root_for(project_id, false)
    raise "Managed project not found: #{project_id}" unless root
    phase = phase_group(root, 'archetypes')
    raise 'Missing archetype phase' unless phase
    FileUtils.mkdir_p(output_directory.to_s)
    view = model.active_view
    original_state = camera_state
    original = view.camera
    paths = []; labels = []
    phase_registry(phase, 'archetypes_json').each_with_index do |item, index|
      entity = model.find_entity_by_persistent_id(item['persistent_id'].to_i)
      raise 'Missing registered prototype geometry' unless entity && entity.valid?
      [['above', 0.48], ['underside', -0.20]].each do |label, rise|
        restore_camera(JSON.generate(prototype_camera_state(entity, rise)))
        path = File.join(output_directory.to_s, "prototype-#{index+1}-#{label}.png")
        raise 'Prototype image export failed' unless view.write_image(path, 1600, 1200, true, 0.9)
        paths << path; labels << "prototype_#{index+1}_#{label}"
      end
    end
    raise 'No prototypes exported' if paths.empty?
    JSON.generate({'ok'=>true, 'paths'=>paths, 'labels'=>labels})
  ensure
    if defined?(view) && defined?(original) && view && original
      restore_camera(original_state)
      view.refresh
    end
  end

  def capture_reference(project_id, output_path)
    root = root_for(project_id, false)
    raise "Managed project not found: #{project_id}" unless root
    directory = File.dirname(output_path.to_s)
    Dir.mkdir(directory) unless Dir.exist?(directory)
    view = model.active_view
    ok = view.write_image(output_path.to_s, 1600, 1200, true, 0.9)
    JSON.generate({'ok'=>!!ok, 'path'=>output_path.to_s, 'width'=>view.vpwidth, 'height'=>view.vpheight})
  end
  # Camera preparation only. OS viewport capture occurs AFTER this request returns.
  def viewport_plan(project_id, phase_name)
    @viewport_selection = model.selection.to_a
    model.selection.clear
    root = root_for(project_id, false)
    raise 'Missing managed root' unless root
    b = root.bounds
    c = b.center.to_a
    span = [b.width, b.height, b.depth, 120.0].max.to_f
    shots = [{'label'=>'reference', 'camera'=>JSON.parse(camera_state)}]
    [['perspective',[-1.4,-2.0,1.0],[0,0,1]],['plan',[0,0,2],[0,1,0]],['front',[0,-2,0],[0,0,1]],['side',[2,0,0],[0,0,1]],['underside',[-1,-1,-2],[0,0,1]]].each do |label,offset,up|
      shots << {'label'=>label,'camera'=>{'eye'=>3.times.map{|i| c[i]+offset[i]*span},'target'=>c,'up'=>up,'perspective'=>false,'height'=>span*1.35}}
    end
    if phase_name == 'archetypes'
      pg = phase_group(root, 'archetypes')
      phase_registry(pg, 'archetypes_json').each_with_index do |item,index|
        entity = model.find_entity_by_persistent_id(item['persistent_id'].to_i)
        raise 'Missing prototype' unless entity && entity.valid?
        [['above',0.48],['underside',-0.20]].each do |label,rise|
          shots << {'label'=>"prototype_#{index+1}_#{label}",'camera'=>prototype_camera_state(entity,rise)}
        end
      end
    end
    if phase_name == 'facade_detail'
      base=JSON.parse(camera_state); dir=Geom::Vector3d.new(*3.times.map{|i|base['target'][i]-base['eye'][i]});dir.length=1
      distance=[b.width,b.height].max*2.2
      [['lower',0.23],['middle',0.52],['upper',0.81]].each do |label,f|
        t=[b.center.x,b.center.y,b.min.z+b.depth*f]
        shots << {'label'=>"detail_#{label}",'camera'=>{'eye'=>3.times.map{|i|t[i]-dir.to_a[i]*distance},'target'=>t,'up'=>[0,0,1],'perspective'=>true,'fov'=>34.0}}
      end
    end
    shots.each do |shot|
      ['eye','target','up'].each {|key| shot['camera'][key]=shot['camera'][key].map(&:to_f)}
      shot['camera']['height']=shot['camera']['height'].to_f if shot['camera']['height']
    end
    JSON.generate({'ok'=>true,'shots'=>shots,'process_id'=>Process.pid,'render_options'=>model.rendering_options.keys.map{|k|[k,model.rendering_options[k]]}.to_h})
  end

  def restore_viewport_selection
    model.selection.clear
    model.selection.add((@viewport_selection || []).select(&:valid?))
    @viewport_selection = nil
    JSON.generate({'ok'=>true})
  end

end

load File.join(File.dirname(__FILE__), 'geometry_views.rb')
