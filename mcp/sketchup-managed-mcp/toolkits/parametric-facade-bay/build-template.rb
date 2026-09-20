# ADAI_COMPILED_PHASE: __PHASE__
# method_family: parametric_facade_bay
module PipClawManagedBuild
  extend self
  PARAMS = __PARAMS__
  def box(entities, id, x, z, width, height)
    p = PARAMS
    group = entities.add_group
    group.name = id
    points = [[x,0,z],[x+width,0,z],[x+width,0,z+height],[x,0,z+height]].map { |v| Geom::Point3d.new(*v.map { |n| n.mm }) }
    face = group.entities.add_face(points)
    raise 'FACADE_FACE_REJECTED' unless face
    face.reverse! if face.normal.y < 0
    face.pushpull(p.fetch('depth_mm').mm)
    report = ADAIGeometryGuard.audit(group.entities, id, true)
    ADAIGeometryGuard.tag(group, id, report)
    group
  end
  def part_specs
    p = PARAMS
    specs = []
    p.fetch('bay_count').times do |index|
      x = index * p.fetch('bay_width_mm')
      pier = p.fetch('pier_width_mm')
      opening = p.fetch('opening_width_mm')
      specs << ["bay_#{index}_left",x,0,pier,p.fetch('height_mm')]
      specs << ["bay_#{index}_right",x+pier+opening,0,pier,p.fetch('height_mm')]
      specs << ["bay_#{index}_sill",x+pier,0,opening,p.fetch('sill_mm')] if p.fetch('sill_mm') > 0
      specs << ["bay_#{index}_head",x+pier,p.fetch('sill_mm')+600,opening,p.fetch('lintel_mm')]
    end
    specs
  end
  def build(entities, context)
    started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
    p = PARAMS
    specs = part_specs
    if context.fetch('phase') == 'massing'
      root = entities.add_group
      root.name = 'ParametricFacadeBay'
      specs.each { |id,x,z,w,h| box(root.entities,id,x,z,w,h) }
      PipClawManagedProject.register_projection_subject(context.fetch('phase_group'), root, {'id'=>'facade','role'=>'focal_building'})
      source = entities
    elsif context.fetch('phase') == 'finish'
      # Read the accepted massing afresh; no extra solids or cosmetic filler.
      accepted = PipClawManagedProject.phase_group(context.fetch('project_root'), 'massing')
      raise 'FACADE_MASSING_MISSING' unless accepted
      source = accepted.entities
    else
      raise 'FACADE_PHASE_UNSUPPORTED'
    end
    mapping = ADAIGeometryGuard.mapping(source, specs.map { |s| s[0] })
    specs.each do |id,x,z,w,h|
      measured = mapping.fetch(id).fetch('bounds_mm')
      expected = [[x,0,z],[x+w,p.fetch('depth_mm'),z+h]]
      error = measured.flatten.zip(expected.flatten).map { |a,b| (a-b).abs }.max
      raise "FACADE_DIMENSION_MISMATCH:#{id}:#{error}" if error > 0.1
    end
    {'created_bays'=>p.fetch('bay_count'),'geometry_readback'=>{
      'schema_version'=>1,'kernel_version'=>ADAIGeometryGuard::VERSION,
      'parameter_sha256'=>'__PARAMETER_HASH__','generator_sha256'=>'__GENERATOR_HASH__',
      'source_evidence'=>'explicit dimension brief; horizontal opening ratio, 600 mm aperture height',
      'mapping'=>mapping,'contacts'=>[],'dependencies'=>[],
      'write_readback_seconds'=>Process.clock_gettime(Process::CLOCK_MONOTONIC)-started,
      'scope'=>'actual closed part meshes and bounds; no structural or full collision certification'
    }}
  end
end
