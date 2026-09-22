# Narrow actual-geometry measurements shared by guided and expert tasks.
# World AABB is deliberately not used as an object's width/depth/height.
module PipClawManagedProject
  def dimension_axis_lengths(transform)
    axes = [transform.xaxis, transform.yaxis, transform.zaxis].map(&:to_a)
    lengths = axes.map { |a| Math.sqrt(a.inject(0.0) { |s,x| s+x*x }) }
    raise 'DIMENSION_SINGULAR_TRANSFORM' if lengths.any? { |v| !v.finite? || v < 1e-10 }
    [[0,1],[0,2],[1,2]].each do |i,j|
      dot = axes[i].zip(axes[j]).inject(0.0) { |s,xy| s+xy[0]*xy[1] }
      raise 'DIMENSION_SHEAR_UNSUPPORTED' if dot.abs / (lengths[i]*lengths[j]) > 1e-6
    end
    lengths
  end

  def measure_source_dimensions(project_id, targets_json)
    targets = JSON.parse(targets_json)
    raise 'DIMENSION_TARGETS_INVALID' unless targets.is_a?(Array) && targets.length <= 32
    labels = targets.map { |t| t.fetch('object') }
    matches = Hash.new { |h,k| h[k]=[] }
    root = root_for(project_id,false)
    visits = 0
    walk = lambda do |entity, transform, pids, stack|
      next unless entity.valid?
      visits += 1
      raise 'DIMENSION_TRAVERSAL_LIMIT' if visits > 100_000 || stack.length > 128
      child = child_entities(entity)
      next unless child
      key = entity.respond_to?(:definition) ? entity.definition.object_id : entity.object_id
      raise 'DIMENSION_CYCLIC_DEFINITION' if stack.include?(key)
      world = transform * entity.transformation
      path = pids + [entity.persistent_id.to_s]
      names = [entity.get_attribute('ADAI_SCOPED_OBJECT','id'), entity.get_attribute('ADAI_GEOMETRY','semantic_id'), entity.name].compact.uniq
      (names & labels).each { |name| matches[name] << [entity,world,path] }
      child.to_a.each { |e| walk.call(e,world,path,stack+[key]) }
    end
    walk.call(root,Geom::Transformation.new,[],[]) if root
    results = targets.map do |target|
      begin
        found = matches[target.fetch('object')]
        raise(found.empty? ? 'DIMENSION_OBJECT_MISSING' : 'DIMENSION_OBJECT_AMBIGUOUS') unless found.length == 1
        entity, transform, path = found.first
        bounds = entity.respond_to?(:definition) ? entity.definition.bounds : entity.local_bounds
        raise 'DIMENSION_EMPTY_BOUNDS' unless bounds.valid?
        axis = %w[x y z].index(target.fetch('axis'))
        raise 'DIMENSION_AXIS_INVALID' unless axis
        extents = [bounds.max.x-bounds.min.x,bounds.max.y-bounds.min.y,bounds.max.z-bounds.min.z]
        value = extents[axis].to_f * dimension_axis_lengths(transform)[axis] * 25.4
        {'object'=>target['object'],'axis'=>target['axis'],'state'=>'measured','measured_mm'=>value,'occurrence'=>path}
      rescue StandardError => error
        {'object'=>target['object'],'axis'=>target['axis'],'state'=>'unverified','reason'=>error.message}
      end
    end
    JSON.generate({'ok'=>true,'project_id'=>project_id,'source'=>'actual local definition bounds and full occurrence transform','results'=>results})
  end

  # Typed boxes/walls have known axis extents. Preflight before creating faces;
  # later actual readback remains mandatory and can catch a wrong implementation.
  def preflight_primitive_dimensions(context, operations)
    targets = context['dimension_targets'] || []
    return if targets.empty?
    transform = context['project_root'].transformation * context['phase_group'].transformation
    scales = dimension_axis_lengths(transform)
    operations.each do |op|
      lengths = op['op']=='box' ? op['size_mm'] : op['op']=='wall' ? [op['width_mm'],op['thickness_mm'],op['height_mm']] : nil
      next unless lengths
      targets.select { |t| t['object']==op['id'] }.each do |t|
        axis = %w[x y z].index(t['axis'])
        value = lengths[axis]*scales[axis]
        if (value-t['expected_mm']).abs > t['tolerance_mm']+1e-6
          raise "SOURCE_DIMENSION_PREFLIGHT: #{op['id']}.#{t['axis']} expected #{t['expected_mm']} +/- #{t['tolerance_mm']} mm, planned #{value} mm"
        end
      end
    end
  end
end
