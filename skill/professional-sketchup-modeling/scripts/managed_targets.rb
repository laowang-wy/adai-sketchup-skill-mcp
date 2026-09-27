# Object addressing shared by diagnostics and managed local updates.
# Paths contain persistent IDs from the managed root, including the container.
module PipClawManagedProject
  def target_rows(project_id)
    root = root_for(project_id, false)
    raise 'TARGET_PROJECT_MISSING' unless root
    rows = []
    visit = lambda do |entity, chain, parent_transform, definitions|
      return unless entity.valid?
      children = child_entities(entity)
      return unless children
      path = chain + [entity]
      transform = parent_transform * entity.transformation
      rows << {'entity'=>entity, 'chain'=>path, 'parent_transform'=>parent_transform,
               'transform'=>transform, 'container'=>path[1]} if path.length >= 3
      key = entity.respond_to?(:definition) ? entity.definition.object_id : entity.object_id
      raise 'CYCLIC_COMPONENT_DEFINITION' if definitions.include?(key)
      children.each { |child| visit.call(child, path, transform, definitions + [key]) }
    end
    visit.call(root, [], Geom::Transformation.new, [])
    rows
  end

  def target_address(row)
    'path:' + row['chain'].map { |e| e.persistent_id.to_s }.join('/')
  end

  def resolve_target(rows, selector)
    raise ArgumentError, 'TARGET_SELECTOR_INVALID' unless selector.is_a?(String) && !selector.empty?
    matches = rows.select do |r|
      e = r['entity']
      if selector.start_with?('path:')
        target_address(r) == selector
      elsif selector.match?(/\Apid:[1-9][0-9]*\z/)
        e.persistent_id.to_s == selector[4..-1]
      else
        e.get_attribute('ADAI_SCOPED_OBJECT','id').to_s == selector ||
          e.get_attribute('ADAI_GEOMETRY','semantic_id').to_s == selector
      end
    end
    raise "TARGET_NOT_FOUND: #{selector}" if matches.empty?
    raise "TARGET_AMBIGUOUS: #{selector}; use a returned instance path" unless matches.length == 1
    matches.first
  end

  def target_description(row)
    e = row['entity']; container = row['container']
    shared = e.respond_to?(:definition) ? e.definition.instances.count { |i| i.valid? } : 1
    shared_parents=row['chain'][0...-1].each_with_index.select { |x,i| x.respond_to?(:definition) && x.definition.instances.count(&:valid?)>1 }.map { |x,i| {'target'=>'path:'+row['chain'][0..i].map { |n| n.persistent_id.to_s }.join('/'),'definition_instances'=>x.definition.instances.count(&:valid?)} }
    {'shared_ancestors'=>shared_parents,'direct_instance_edit'=>shared_parents.empty?, 'target'=>target_address(row), 'persistent_id'=>e.persistent_id, 'name'=>e.name.to_s,
     'id'=>e.get_attribute('ADAI_SCOPED_OBJECT','id'),
     'semantic_id'=>e.get_attribute('ADAI_GEOMETRY','semantic_id'),
     'container_pid'=>container.persistent_id, 'phase'=>container.get_attribute(DICT,'phase'),
     'work_unit_id'=>container.get_attribute(DICT,'work_unit_id'),
     'parent_transform'=>row['parent_transform'].to_a, 'world_transform'=>row['transform'].to_a,
     'bounds_inches'=>bounds_signature(e), 'definition_instances'=>shared,
     'locked'=>row['chain'].any? { |x| x.respond_to?(:locked?) && x.locked? },
     'methods'=>['translate','rotate','material','managed Ruby'] + (e.get_attribute('ADAI_SCOPED_OBJECT','wall') ? ['set_wall_openings','window_frame'] : [])}
  end

  def discover_targets(project_id, request_json)
    request = JSON.parse(request_json); rows = target_rows(project_id)
    selected = if request['targets']
      request['targets'].map { |s| resolve_target(rows,s) }
    else
      query = request.fetch('query','').downcase
      labels = {}
      rows.each do |r|
        e=r['entity']
        (labels[e.definition.object_id] ||= []) << e.name.to_s unless !e.respond_to?(:definition) || e.name.to_s.empty?
      end
      rows.select do |r|
        e=r['entity']; names=[e.name,e.get_attribute('ADAI_SCOPED_OBJECT','id'),e.get_attribute('ADAI_GEOMETRY','semantic_id')]
        names += [e.definition.name,*(labels[e.definition.object_id] || [])] if e.respond_to?(:definition)
        names.compact.join(' ').downcase.include?(query)
      end
    end
    offset = [request.fetch('offset',0).to_i,0].max
    JSON.generate({'ok'=>true,'objects'=>selected.drop(offset).take(20).map { |r| target_description(r) },
      'total'=>selected.length, 'next_offset'=>offset+20 < selected.length ? offset+20 : nil})
  end

  def prepare_local_update(project_id, request_json)
    request = JSON.parse(request_json); rows = target_rows(project_id)
    selectors = request.fetch('targets')
    raise 'LOCAL_TARGETS_REQUIRED' unless selectors.is_a?(Array) && !selectors.empty? && selectors.length <= 128
    selected = selectors.map { |s| resolve_target(rows,s) }
    scope = request.fetch('edit_scope','instance')
    raise 'EDIT_SCOPE_INVALID' unless %w[instance definition].include?(scope)
    # Definition edits cover every occurrence, not just one visible instance.
    if scope == 'definition'
      selected = selected.flat_map do |r|
        e=r['entity']; raise 'COMPONENT_DEFINITION_REQUIRED' unless e.is_a?(Sketchup::ComponentInstance)
        peers=rows.select { |other| other['entity'].is_a?(Sketchup::ComponentInstance) && other['entity'].definition == e.definition }
        known=peers.map { |other| other['entity'] }.uniq
        raise 'DEFINITION_OUTSIDE_PROJECT' unless e.definition.instances.select(&:valid?).all? { |instance| known.include?(instance) }
        peers
      end
    end
    selected = selected.uniq { |r| target_address(r) }
    containers = selected.map { |r| r['container'] }.uniq
    raise 'LOCAL_UPDATE_MULTIPLE_CONTAINERS: submit each container through the same step API' unless containers.length == 1
    selected.each do |r|
      raise 'TARGET_LOCKED' if r['chain'].any? { |e| e.respond_to?(:locked?) && e.locked? }
      # An internal PID shared by multiple occurrences cannot authorize all of them.
      # Copy-on-write of nested parent definitions is not inferred from a name.
      shared_parent=target_description(r)['shared_ancestors'].first
      raise "SHARED_ANCESTOR_REQUIRES_OUTER_TARGET: #{shared_parent['target']}; use instance-scoped Ruby on this outer target for internal editing" if shared_parent
    end
    container = containers.first
    {'ok'=>true, 'targets'=>selected.map { |r| target_address(r) }, 'edit_scope'=>scope,
     'container_pid'=>container.persistent_id,'phase'=>container.get_attribute(DICT,'phase'),
     'work_unit_id'=>container.get_attribute(DICT,'work_unit_id'),
     'fingerprint'=>unit_fingerprint(container), 'selectors'=>selectors,
     'objects'=>selected.map { |r| target_description(r) }}
  end

  def prepare_local_update_json(project_id, request_json)
    JSON.generate(prepare_local_update(project_id,request_json))
  end

  # Unselected siblings are protected even inside the edited stage. Ancestor
  # aggregate bounds legitimately change, so compare their own attributes and
  # transforms while retaining complete records for the untouched branches.
  def local_boundary_fingerprint(container, selected, cache = {})
    ids = selected.map { |r| r['entity'].object_id }
    ancestors = selected.flat_map { |r| r['chain'][0...-1].map(&:object_id) }.uniq
    cache[:exact_geometry] = true
    walk = lambda do |e|
      return {'editable_pid'=>e.persistent_id} if ids.include?(e.object_id)
      unless ancestors.include?(e.object_id)
        return fast_boundary_record(e,nil,nil,cache)
      end
      {'pid'=>e.persistent_id,'name'=>e.name.to_s,'appearance'=>appearance_summary(e),
       'transform'=>e.transformation.to_a,
       'children'=>child_entities(e).select(&:valid?).sort_by { |x| x.persistent_id }.map { |x| walk.call(x) }}
    end
    canonical_sha256(walk.call(container), cache[:canonical_chunks] ||= {})
  end

  # SketchUp can retain a group's old bounds after direct face/edge edits.
  # Refresh only the selected branches and their ancestors, bottom-up, before
  # protection/readback. This does not change geometry or split definitions.
  def refresh_local_bounds(selected)
    seen = {}
    visit = lambda do |entity|
      return if seen[entity.object_id]
      seen[entity.object_id] = true
      children = child_entities(entity)
      return unless children
      children.each { |child| visit.call(child) if child.valid? && child_entities(child) }
      definition = entity.respond_to?(:definition) ? entity.definition : nil
      definition.invalidate_bounds if definition && definition.respond_to?(:invalidate_bounds)
    end
    selected.each { |row| visit.call(row['entity']) }
    selected.each do |row|
      row['chain'][0...-1].reverse_each do |ancestor|
        definition = ancestor.respond_to?(:definition) ? ancestor.definition : nil
        definition.invalidate_bounds if definition && definition.respond_to?(:invalidate_bounds)
      end
    end
  end

end
