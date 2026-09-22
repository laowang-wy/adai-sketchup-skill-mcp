# Versioned, coarse architectural-system scopes. No state files are modified here.
# All geometry mutations still use execute_step's single SketchUp transaction.
module PipClawManagedProject
  def mutable_member?(entity, scope)
    return false unless entity.is_a?(Sketchup::Group)
    if scope.is_a?(Hash)
      entity.get_attribute(DICT, 'work_unit_id').to_s == scope.fetch('work_unit_id').to_s &&
        entity.get_attribute(DICT, 'project_id').to_s == scope.fetch('project_id').to_s
    else
      entity.get_attribute(DICT, 'phase').to_s == scope.to_s
    end
  end

  def work_unit_group(root, id)
    return nil unless root
    matches = root.entities.grep(Sketchup::Group).select { |g| g.valid? && g.get_attribute(DICT, 'work_unit_id').to_s == id.to_s }
    raise 'WORK_UNIT_AMBIGUOUS' if matches.length > 1
    matches.first
  end

  def unit_fingerprint(group)
    record = entity_record(group)
    raise 'UNIT_READBACK_INCOMPLETE' if record['incomplete'] || record.dig('geometry_summary', 'complete') == false
    record['registrations'] = %w[archetypes_json visible_detail_systems_json unique_details_json projection_subjects_json replication_systems_json variants_json].map { |key| [key, group.get_attribute(DICT, key, '[]')] }.to_h
    Digest::SHA256.hexdigest(canonical_json(record))
  end

  def unit_scope_record(group)
    {'work_unit_id'=>group.get_attribute(DICT, 'work_unit_id').to_s,
     'persistent_id'=>group.persistent_id, 'fingerprint'=>unit_fingerprint(group),
     'counts'=>count_recursive(group.entities), 'bounds_inches'=>bounds_signature(group)}
  end

  def locked_scope_fingerprint(root)
    return Digest::SHA256.hexdigest('[]') unless root
    records = []
    walk = lambda do |entity, ancestors|
      if entity.respond_to?(:locked?) && entity.locked?
        record = entity_record(entity)
        raise 'PROTECTION_READBACK_INCOMPLETE' if record['incomplete'] || record.dig('geometry_summary','complete') == false
        records << {'ancestors'=>ancestors, 'entity'=>record}
      else
        children = child_entities(entity)
        if children
          frame = {'pid'=>(entity.persistent_id rescue nil), 'transform'=>(entity.transformation.to_a rescue nil)}
          children.to_a.each { |child| walk.call(child, ancestors + [frame]) if child.valid? }
        end
      end
    end
    walk.call(root, [])
    Digest::SHA256.hexdigest(canonical_json(records))
  end

  def validate_operation_context(context, operation_id)
    raise ArgumentError, 'OPERATION_CONTEXT_OBJECT_REQUIRED' unless context.is_a?(Hash)
    return context if context.empty? # Recognized unversioned legacy request only.
    version = context['policy_version']
    raise ArgumentError, 'POLICY_VERSION_UNSUPPORTED' unless version.is_a?(Integer) && [1,2].include?(version)
    strategy = context['strategy']
    raise ArgumentError, 'OPERATION_STRATEGY_INVALID' unless %w[expert_work_unit guided_phase].include?(strategy)
    raise ArgumentError, 'OPERATION_INTENT_INVALID' unless %w[append update replace].include?(context['intent'])
    raise ArgumentError, 'OPERATION_ID_MISMATCH' unless context['operation_id'] == operation_id
    unit = context['work_unit_id']
    if strategy == 'expert_work_unit'
      raise ArgumentError, 'WORK_UNIT_ID_INVALID' unless unit.is_a?(String) && unit.match?(/\A[A-Za-z][A-Za-z0-9_-]{2,63}\z/)
    else
      raise ArgumentError, 'GUIDED_CONTEXT_INVALID' unless version == 1 && unit.nil? && context['intent'] == 'replace'
    end
    if version == 2
      raise ArgumentError, 'EXPERT_CONTEXT_REQUIRED' unless strategy == 'expert_work_unit'
      value = context['expected_fingerprint']
      raise ArgumentError, 'UNIT_FINGERPRINT_INVALID' unless value.nil? || (value.is_a?(String) && value.match?(/\A[a-f0-9]{64}\z/))
      pid = context['expected_pid']
      raise ArgumentError, 'UNIT_PID_INVALID' unless pid.nil? || (pid.is_a?(Integer) && pid > 0)
    end
    context
  end

  def registered_groups(root)
    root.entities.grep(Sketchup::Group).select(&:valid?)
  end

  # Readback validates actual prototype/instance references, not declared counts.
  def audited_detail_systems(group)
    phase_detail_systems(group).map do |item|
      pid = item['prototype'].to_s
      entity = pid.match?(/\A[0-9]+\z/) ? find_entity_in_collection(group.entities, pid.to_i) : nil
      if !entity && !pid.empty?
        entry = phase_registry(group, 'archetypes_json').find { |a| a['id'].to_s == pid }
        entity = find_entity_in_collection(group.entities, entry['persistent_id'].to_i) if entry
      end
      count = entity && entity.respond_to?(:definition) ? instance_paths_for(group, entity).length : (entity ? 1 : 0)
      item.merge('valid'=>!!(entity && entity.valid? && count > 0), 'actual_instances'=>count)
    end
  end
end
