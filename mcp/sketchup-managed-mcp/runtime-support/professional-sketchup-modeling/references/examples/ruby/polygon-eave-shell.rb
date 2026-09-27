# Polygon eave-to-inner-ring shell, in millimetres. Adapted from the bundled
# Yellow Crane revision-d roofpoint/roof_sector method (rise*t*t and localized
# edge lift); no building dimensions, scene globals, tiles or lifecycle code.
# Scope: corresponding nested convex CCW rings, vertical thickness, open centre.
# Not an arbitrary loft, a ridge/gable roof or a surveyed historical profile.
# Loading this file creates nothing. Geometry is written only by build.
module ADAIPolygonEaveShell
  extend self

  def number(value, name)
    raise ArgumentError, "FINITE_NUMBER_REQUIRED: #{name}" unless value.is_a?(Numeric) && value.finite?
    value.to_f
  end

  def cross(a, b, c)
    (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
  end

  def ring(value, name)
    unless value.is_a?(Array) && (3..64).include?(value.length) && value.all? { |p| p.is_a?(Array) && p.length == 2 }
      raise ArgumentError, "XY_RING_REQUIRED: #{name}"
    end
    points=value.map { |p| p.map { |v| number(v,name) } }
    # Every other vertex must be strictly inside each CCW edge. This excludes
    # self-crossing/star rings as well as collinear/duplicate vertices.
    points.each_index do |i|
      j=(i+1)%points.length
      points.each_index do |k|
        next if k==i || k==j
        raise ArgumentError, "CONVEX_CCW_RING_REQUIRED: #{name}" unless cross(points[i],points[j],points[k])>1e-6
      end
    end
    points
  end

  def mesh(parameters)
    raise ArgumentError, 'PARAMETERS_REQUIRED' unless parameters.is_a?(Hash)
    allowed=%w[outer_xy_mm inner_xy_mm base_z_mm rise_mm thickness_mm corner_lift_mm span_segments slope_segments]
    raise ArgumentError, 'UNKNOWN_ROOF_PARAMETER' unless (parameters.keys-allowed).empty?
    outer=ring(parameters.fetch('outer_xy_mm'),'outer_xy_mm')
    inner=ring(parameters.fetch('inner_xy_mm'),'inner_xy_mm')
    raise ArgumentError, 'RING_CORRESPONDENCE_REQUIRED' unless outer.length==inner.length
    outer.each_index do |i|
      inner.each { |p| raise ArgumentError, 'INNER_RING_NOT_INSIDE' unless cross(outer[i],outer[(i+1)%outer.length],p)>1e-6 }
    end
    base=number(parameters.fetch('base_z_mm',0),'base_z_mm')
    rise=number(parameters.fetch('rise_mm'),'rise_mm')
    thickness=number(parameters.fetch('thickness_mm'),'thickness_mm')
    lift=number(parameters.fetch('corner_lift_mm',0),'corner_lift_mm')
    raise ArgumentError, 'POSITIVE_ROOF_DIMENSIONS_REQUIRED' unless rise>0 && thickness>0 && lift>=0
    spans=parameters.fetch('span_segments',12)
    slopes=parameters.fetch('slope_segments',8)
    unless [spans,slopes].all? { |n| n.is_a?(Integer) && (2..64).include?(n) } && outer.length*spans*slopes<=16000
      raise ArgumentError, 'ROOF_SAMPLING_BUDGET'
    end
    count=outer.length*spans
    vertices=[]
    (0..slopes).each do |level|
      t=level.to_f/slopes
      outer.each_index do |side|
        nxt=(side+1)%outer.length
        spans.times do |sample|
          s=sample.to_f/spans
          xy=2.times.map do |axis|
            o=outer[side][axis]*(1-s)+outer[nxt][axis]*s
            i=inner[side][axis]*(1-s)+inner[nxt][axis]*s
            o*(1-t)+i*t
          end
          vertices << [xy[0],xy[1],base+rise*t*t+lift*(2*s-1).abs**10*(1-t)**2]
        end
      end
    end
    offset=vertices.length
    vertices+=vertices.map { |x,y,z| [x,y,z-thickness] }
    faces=[]
    slopes.times do |level|
      count.times do |j|
        a=level*count+j;b=level*count+(j+1)%count
        c=b+count;d=a+count
        [[a,b,c],[a,c,d]].each do |tri|
          # Positive projected cells are a height graph, avoiding twisted or
          # crossing correspondences before any SketchUp object is created.
          raise ArgumentError, 'TWISTED_RING_CORRESPONDENCE' unless cross(*tri.map { |i| vertices[i] })>1e-6
          faces << tri << tri.reverse.map { |i| i+offset }
        end
      end
    end
    # Reverse the top boundary for the thickness walls, including the inner rim.
    count.times do |j|
      [[j,(j+1)%count], [slopes*count+(j+1)%count,slopes*count+j]].each do |a,b|
        faces << [b,a,a+offset] << [b,a+offset,b+offset]
      end
    end
    {'vertices_mm'=>vertices,'triangles'=>faces}
  end

  def build(entities, name, parameters, material=nil)
    data=mesh(parameters)
    raise 'MANAGED_GEOMETRY_KERNEL_REQUIRED' unless defined?(ADAIGeometryGuard)
    group=entities.add_group
    group.name=name
    report=ADAIGeometryGuard.add_mesh(group.entities,data['vertices_mm'],data['triangles'],name,true)
    group.material=material if material
    group.set_attribute('ADAI_POLYGON_EAVE','parameters',JSON.generate(parameters))
    ADAIGeometryGuard.tag(group,name,report)
    group
  end
end
