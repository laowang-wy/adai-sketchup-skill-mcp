# Shared small construction operations. All numeric inputs are millimetres.
# Called inside the managed transaction; no document or transaction ownership.
module ADAIConstructionGeometry
  extend self

  def numbers(value, count, label)
    raise ArgumentError, "#{label}: expected #{count} finite numbers" unless value.is_a?(Array) && value.length == count
    value.map do |v|
      raise ArgumentError, "#{label}: expected finite numeric millimetres" unless v.is_a?(Numeric) && v.to_f.finite?
      v.to_f
    end
  end

  def point_mm(xyz)
    Geom::Point3d.new(*numbers(xyz, 3, 'point_mm').map { |v| v / 25.4 })
  end

  def translation_mm(xyz)
    Geom::Transformation.translation(numbers(xyz, 3, 'translation_mm').map { |v| v / 25.4 })
  end

  # C1 shape-preserving cubic Hermite interpolation through supplied stations.
  # Mathematical method: Fritsch-Butland weighted harmonic interior slopes,
  # one-sided limited endpoints (PCHIP). No SciPy/runtime dependency.
  # Returns [position,value] in input mm coordinates; creates no SU entities.
  def sample_profile(stations_mm, samples_per_span = 6)
    raise ArgumentError, 'sample_profile needs at least two [position,value] stations' unless stations_mm.is_a?(Array) && stations_mm.length >= 2
    raise ArgumentError, 'samples_per_span must be a positive integer' unless samples_per_span.is_a?(Integer) && samples_per_span > 0
    points=stations_mm.map{|p|numbers(p,2,'profile station')}
    intervals=points.each_cons(2).map{|a,b|b[0]-a[0]}
    raise ArgumentError, 'profile positions must strictly increase; split a returning contour into separate branches' unless intervals.all?{|h|h>0 && h.finite?}
    slopes=points.each_cons(2).zip(intervals).map{|(a,b),h|(b[1]-a[1])/h}
    raise ArgumentError, 'profile slopes must be finite' unless slopes.all?(&:finite?)
    tangents=Array.new(points.length,0.0)
    if points.length==2
      tangents[0]=tangents[1]=slopes[0]
    else
      (1...points.length-1).each do |i|
        left,right=slopes[i-1],slopes[i]
        next if left==0 || right==0 || (left>0)!=(right>0)
        h0,h1=intervals[i-1],intervals[i]
        # Normalize the weights to avoid unnecessary large-coordinate products.
        share=h1/(h0+h1); w1=(1+share)/3.0; w2=1-w1
        tangents[i]=1.0/(w1/left+w2/right)
      end
      endpoint=lambda do |h0,h1,d0,d1|
        m=d0+(d0-d1)*(h0/(h0+h1))
        if d0==0 || (m>0)!=(d0>0)
          0.0
        elsif (d0>0)!=(d1>0) && m.abs>3*d0.abs
          3*d0
        else
          m
        end
      end
      tangents[0]=endpoint.call(intervals[0],intervals[1],slopes[0],slopes[1])
      tangents[-1]=endpoint.call(intervals[-1],intervals[-2],slopes[-1],slopes[-2])
    end
    result=[]
    intervals.each_with_index do |h,i|
      x0,y0=points[i];y1=points[i+1][1]
      samples_per_span.times do |j|
        if j==0
          result<<points[i].dup
          next
        end
        t=j.to_f/samples_per_span; t2=t*t; t3=t2*t
        y=(2*t3-3*t2+1)*y0+(t3-2*t2+t)*h*tangents[i]+(-2*t3+3*t2)*y1+(t3-t2)*h*tangents[i+1]
        raise ArgumentError, 'profile interpolation exceeds finite numeric range' unless y.finite?
        result<<[x0+t*h,y]
      end
    end
    result<<points.last.dup
    result
  end

  # A simple closed planar outline, no holes. xy extrudes +Z, xz +Y, yz +X.
  # Curved profiles may be sampled into the outline; varying sections use mesh/loft.
  def profile(entities, name, outline_mm, depth_mm, plane = 'xz', offset_mm = 0, material = nil)
    axes = {'xy' => [[0, 1], 2], 'xz' => [[0, 2], 1], 'yz' => [[1, 2], 0]}
    raise ArgumentError, 'profile plane must be xy, xz or yz' unless axes.key?(plane)
    depth, offset = numbers([depth_mm, offset_mm], 2, 'profile depth/offset')
    raise ArgumentError, 'profile depth must be positive' unless depth > 0
    raise ArgumentError, 'profile needs a closed outline of at least 3 points' unless outline_mm.is_a?(Array)
    ring = outline_mm.map { |p| numbers(p, 2, 'outline point') }
    ring.pop if ring.length > 1 && ring.first == ring.last
    area = ring.each_with_index.inject(0.0) { |s, (p, i)| q = ring[(i + 1) % ring.length]; s + p[0] * q[1] - q[0] * p[1] }
    raise ArgumentError, 'profile outline is empty, repeated or has zero signed area' if ring.length < 3 || ring.uniq.length != ring.length || area.abs < 1.0e-8
    pair, direction = axes[plane]
    points = ring.map do |p|
      xyz = [0.0, 0.0, 0.0]; xyz[pair[0]] = p[0]; xyz[pair[1]] = p[1]; xyz[direction] = offset
      point_mm(xyz)
    end
    group = entities.add_group
    begin
      group.name = name.to_s
      face = group.entities.add_face(points)
      raise ArgumentError, 'profile outline cannot form a SketchUp face; check crossings and tiny edges' unless face && face.valid?
      distance = depth / 25.4
      face.pushpull(face.normal.to_a[direction] < 0 ? -distance : distance)
      group.material = material if material
      group
    rescue Exception
      group.erase! if group && group.valid?
      raise
    end
  end

  # Isolated positive-size solid, useful for a rectangular part, not a building template.
  def box(entities, name, origin_mm, size_mm, material = nil)
    x, y, z = numbers(origin_mm, 3, 'box origin')
    w, d, h = numbers(size_mm, 3, 'box size')
    raise ArgumentError, 'box sizes must be positive' unless [w, d, h].all? { |v| v > 0 }
    profile(entities, name, [[x, y], [x + w, y], [x + w, y + d], [x, y + d]], h, 'xy', z, material)
  end

  # Straight extrusion with through-holes, e.g. a courtyard slab or perforated panel.
  # The caller supplies architectural boundaries; these checks only validate loops.
  def profile_ring_area(ring)
    ring.each_with_index.sum { |p,i| q=ring[(i+1)%ring.length]; p[0]*q[1]-q[0]*p[1] } / 2.0
  end
  def profile_segments_touch?(a,b,c,d)
    cross=lambda { |p,q,r| (q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]) }
    eps=1.0e-7
    ab_c=cross.call(a,b,c);ab_d=cross.call(a,b,d);cd_a=cross.call(c,d,a);cd_b=cross.call(c,d,b)
    return true if ab_c*ab_d < 0 && cd_a*cd_b < 0
    [[a,b,c,ab_c],[a,b,d,ab_d],[c,d,a,cd_a],[c,d,b,cd_b]].any? do |p,q,r,v|
      v.abs<=eps && 2.times.all? { |i| r[i]>= [p[i],q[i]].min-eps && r[i]<= [p[i],q[i]].max+eps }
    end
  end
  def profile_point_inside?(point, ring)
    inside=false
    ring.each_with_index do |a,i|
      b=ring[(i+1)%ring.length]
      if (a[1]>point[1]) != (b[1]>point[1])
        x=a[0]+(point[1]-a[1])*(b[0]-a[0])/(b[1]-a[1])
        inside=!inside if point[0]<x
      end
    end
    inside
  end
  def profile_rings(outer_mm, holes_mm)
    raise ArgumentError,'profile holes must be an array of interior loops' unless holes_mm.is_a?(Array)
    rings=([outer_mm]+holes_mm).map do |input|
      raise ArgumentError,'profile loop must be an array of 2D millimetre points' unless input.is_a?(Array)
      ring=input.map { |v| numbers(v,2,'profile loop point') }
      ring.pop if ring.length>1 && ring.first==ring.last
      raise ArgumentError,'profile loop needs distinct points and nonzero area' if ring.length<3 || ring.uniq.length!=ring.length || profile_ring_area(ring).abs<1.0e-8
      ring.each_index do |i|
        (i+1...ring.length).each do |j|
          next if j==i+1 || (i==0 && j==ring.length-1)
          raise ArgumentError,'profile loop crosses or touches itself' if profile_segments_touch?(ring[i],ring[(i+1)%ring.length],ring[j],ring[(j+1)%ring.length])
        end
      end
      ring
    end
    rings.each_with_index do |a,i|
      (i+1...rings.length).each do |j|
        b=rings[j]
        a.each_with_index do |p,k|
          b.each_with_index do |q,l|
            raise ArgumentError,'profile loops cross or touch; boundary openings belong in the outer contour' if profile_segments_touch?(p,a[(k+1)%a.length],q,b[(l+1)%b.length])
          end
        end
        raise ArgumentError,'profile holes overlap or nest' if i>0 && (profile_point_inside?(a.first,b) || profile_point_inside?(b.first,a))
      end
      raise ArgumentError,'profile hole lies outside the outer contour' if i>0 && !profile_point_inside?(a.first,rings.first)
    end
    rings
  end
  def profile_with_holes(entities,name,outer_mm,holes_mm,depth_mm,plane='xy',offset_mm=0,material=nil)
    rings=profile_rings(outer_mm,holes_mm)
    axes={'xy'=>[[0,1],2],'xz'=>[[0,2],1],'yz'=>[[1,2],0]}
    raise ArgumentError,'profile plane must be xy, xz or yz' unless axes.key?(plane)
    depth,offset=numbers([depth_mm,offset_mm],2,'profile depth/offset')
    raise ArgumentError,'profile depth must be positive' unless depth>0
    pair,direction=axes[plane]
    points=rings.map { |ring| ring.map { |p| v=[0.0,0.0,0.0];v[pair[0]]=p[0];v[pair[1]]=p[1];v[direction]=offset;point_mm(v) } }
    group=entities.add_group
    begin
      group.name=name.to_s
      raise ArgumentError,'outer contour could not form a face' unless group.entities.add_face(points.first)
      points.drop(1).each do |loop_points|
        hole=group.entities.add_face(loop_points)
        raise ArgumentError,'interior contour could not form a face' unless hole && hole.valid?
        hole.erase!
      end
      faces=group.entities.grep(Sketchup::Face)
      expected=(profile_ring_area(rings.first).abs-rings.drop(1).sum { |r| profile_ring_area(r).abs })/(25.4**2)
      face=faces.first
      unless faces.length==1 && face.loops.length==rings.length && (face.area-expected).abs<=[expected*1.0e-7,1.0e-7].max
        raise ArgumentError,'profile holes were not retained; inspect contour size and SketchUp edge tolerance'
      end
      face.pushpull(face.normal.to_a[direction]<0 ? -depth/25.4 : depth/25.4)
      raise ArgumentError,'profile extrusion did not close around its holes' unless group.manifold?
      group.material=material if material
      group
    rescue Exception
      group.erase! if group && group.valid?
      raise
    end
  end
  # Closed, corresponding planar sections along one increasing project/local axis.
  # Width, height and lateral position may vary. Connections are ruled triangles,
  # not an inferred roof type, smooth spline, thickness offset or hole generator.
  def loft_sections(entities, name, sections_mm, axis = 'x', material = nil)
    axes = {'x' => [[1, 2], 0, 1], 'y' => [[0, 2], 1, -1], 'z' => [[0, 1], 2, 1]}
    raise ArgumentError, 'loft axis must be x, y or z' unless axes.key?(axis)
    unless sections_mm.is_a?(Array) && sections_mm.length >= 2
      raise ArgumentError, 'loft needs at least two closed sections'
    end
    sections = sections_mm.map do |section|
      unless section.is_a?(Hash) && section.key?('offset_mm') && section.key?('profile_mm')
        raise ArgumentError, 'loft section needs offset_mm and profile_mm'
      end
      [numbers([section['offset_mm']], 1, 'loft offset')[0], profile_rings(section['profile_mm'], []).first]
    end
    count = sections.first[1].length
    first_area = profile_ring_area(sections.first[1])
    unless sections.all? { |_, ring| ring.length == count && profile_ring_area(ring) * first_area > 0 }
      raise ArgumentError, 'loft sections need equal point counts, corresponding start points and consistent winding'
    end
    unless sections.each_cons(2).all? { |a,b| b[0] > a[0] }
      raise ArgumentError, 'loft offsets must increase; order sections along the chosen axis'
    end
    pair, direction, parity = axes[axis]
    reverse = first_area * parity < 0
    points = sections.map do |offset, ring|
      (reverse ? ring.reverse : ring).map do |p|
        xyz = [0.0, 0.0, 0.0]
        xyz[pair[0]] = p[0]; xyz[pair[1]] = p[1]; xyz[direction] = offset
        point_mm(xyz)
      end
    end
    group = entities.add_group
    begin
      group.name = name.to_s
      [[points.first, -1], [points.last, 1]].each do |ring, sign|
        face = group.entities.add_face(ring)
        raise ArgumentError, 'loft end cap failed; inspect tiny edges and contour validity' unless face && face.valid?
        face.reverse! if face.normal.to_a[direction] * sign < 0
      end
      points.each_cons(2) do |a,b|
        count.times do |i|
          j = (i + 1) % count
          [[a[i], a[j], b[j]], [a[i], b[j], b[i]]].each do |p,q,r|
            face = group.entities.add_face(p,q,r)
            raise ArgumentError, 'loft connection failed; inspect corresponding points and tiny edges' unless face && face.valid?
            face.reverse! if face.normal.dot((q-p).cross(r-p)) < 0
          end
        end
      end
      raise ArgumentError, 'loft did not form a closed solid; inspect section correspondence' unless group.manifold?
      group.material = material if material
      group
    rescue Exception
      group.erase! if group && group.valid?
      raise
    end
  end

  # Row/column grid of XYZ mm points; its XY boundary need not be rectangular.
  # Thickness is a vertical Z offset, not a normal offset. Holes/folded surfaces
  # use explicit mesh construction instead. A complete boundary row/column may
  # converge to one point; its repeated vertices become a triangle fan.
  def shell_grid(entities, name, top_grid_mm, thickness_mm, material = nil)
    thickness = numbers([thickness_mm], 1, 'shell thickness')[0]
    raise ArgumentError, 'shell thickness must be positive' unless thickness > 0
    raise ArgumentError, 'shell needs at least two corresponding rows' unless top_grid_mm.is_a?(Array) && top_grid_mm.length >= 2
    columns = top_grid_mm.first.is_a?(Array) ? top_grid_mm.first.length : 0
    raise ArgumentError, 'shell rows need matching point counts >= 2' unless columns >= 2 && top_grid_mm.all? { |row| row.is_a?(Array) && row.length == columns }
    grid = top_grid_mm.map { |row| row.map { |v| numbers(v, 3, 'shell point') } }
    rows = grid.length
    raw_vertices = grid.flatten(1)
    boundary_edges = [(0...columns).to_a, ((rows-1)*columns...rows*columns).to_a,
                      (0...rows).map { |i| i*columns }, (0...rows).map { |i| i*columns+columns-1 }]
    poles = boundary_edges.select { |edge| edge.map { |i| raw_vertices[i] }.uniq.length == 1 }
                          .map { |edge| edge.each_with_object({}) { |i, set| set[i] = true } }
    occurrences = Hash.new { |hash, point| hash[point] = [] }
    raw_vertices.each_with_index { |point, i| occurrences[point] << i }
    occurrences.each_value do |indices|
      next if indices.length == 1
      unless poles.any? { |edge| indices.all? { |i| edge.key?(i) } }
        raise ArgumentError, 'shell repeated points must form a complete converging boundary row or column; keep internal grid cells distinct'
      end
    end
    vertices = []
    by_point = {}
    indices = raw_vertices.map do |point|
      unless by_point.key?(point)
        by_point[point] = vertices.length
        vertices << point
      end
      by_point[point]
    end
    count = vertices.length
    triangles = []
    orientation = nil
    (0...rows-1).each do |i|
      (0...columns-1).each do |j|
        a = i*columns+j; b = (i+1)*columns+j; c = b+1; d = a+1
        [[a,b,c],[a,c,d]].each do |raw_tri|
          tri = raw_tri.map { |index| indices[index] }
          next if tri.uniq.length < 3 # Only a validated boundary pole can do this.
          p,q,r = tri.map { |index| vertices[index] }
          signed = (q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0])
          raise ArgumentError, 'shell grid folds or collapses in XY; use explicit mesh for vertical/overlapping surfaces' if signed.abs < 1.0e-8 || (orientation && signed*orientation < 0)
          orientation ||= signed < 0 ? -1 : 1
          triangles << (signed > 0 ? tri : tri.reverse)
        end
      end
    end
    raise ArgumentError, 'shell grid has no nonzero XY surface area' if triangles.empty?
    # Counter-clockwise outer loop consistent with top triangles.
    rim = (0...rows).map { |i| i*columns } + (1...columns).map { |j| (rows-1)*columns+j } + (0...rows-1).to_a.reverse.map { |i| i*columns+columns-1 } + (1...columns-1).to_a.reverse
    rim = rim.map { |index| indices[index] }.each_with_object([]) { |index, out| out << index unless out.last == index }
    rim.pop if rim.first == rim.last
    rim.reverse! if orientation < 0
    faces = triangles + triangles.map { |tri| tri.reverse.map { |v| v+count } }
    rim.each_with_index do |a,i|
      b = rim[(i+1)%rim.length]
      faces << [a,a+count,b+count] << [a,b+count,b]
    end
    points = (vertices + vertices.map { |x,y,z| [x,y,z-thickness] }).map { |v| point_mm(v) }
    group = entities.add_group
    begin
      group.name = name.to_s
      faces.each do |indices|
        p,q,r = indices.map { |i| points[i] }
        face = group.entities.add_face(p,q,r)
        raise ArgumentError, 'shell triangle failed; inspect repeated points or tiny edges' unless face && face.valid?
        expected = (q-p).cross(r-p)
        face.reverse! if face.normal.dot(expected) < 0
      end
      group.material = material if material
      group
    rescue Exception
      group.erase! if group && group.valid?
      raise
    end
  end

  # Four corresponding, closed XY boundary loops with variable Z. The cavity
  # remains open; wall thickness comes from the explicit inner/outer loops.
  def closed_band(entities, name, outer_bottom_mm, outer_top_mm, inner_bottom_mm, inner_top_mm, material = nil)
    loops = [outer_bottom_mm, outer_top_mm, inner_bottom_mm, inner_top_mm].map do |input|
      raise ArgumentError, 'closed_band needs four closed point loops' unless input.is_a?(Array)
      ring = input.map { |point| numbers(point, 3, 'closed_band point') }
      ring.pop if ring.length > 1 && ring.first == ring.last
      raise ArgumentError, 'closed_band needs distinct perimeter points' if ring.length < 3 || ring.uniq.length != ring.length
      ring
    end
    n = loops[0].length
    raise ArgumentError, 'closed_band loops need matching point counts and corresponding starts' unless loops.all? { |ring| ring.length == n }
    plan = loops.map { |ring| ring.map { |x,y,_| [x,y] } }
    areas = plan.map { |ring| profile_ring_area(ring) }
    raise ArgumentError, 'closed_band loops need the same perimeter direction in XY' if areas.any? { |area| area.abs < 1.0e-8 || area * areas[0] < 0 }
    # Existing simple-ring checks reject crossings and touching inner/outer
    # boundaries. This method handles upright bands, not arbitrary tube bends.
    profile_rings(plan[0], [plan[2]])
    profile_rings(plan[1], [plan[3]])
    [0,2].each do |bottom|
      n.times do |i|
        raise ArgumentError, 'closed_band top must lie above its corresponding bottom' unless loops[bottom+1][i][2] > loops[bottom][i][2] + 1.0e-8
      end
    end
    # Order wraps around the strip section: outer bottom/top, inner top/bottom.
    vertices = [loops[0], loops[1], loops[3], loops[2]].flatten(1)
    faces = []
    4.times do |k|
      n.times do |i|
        a=k*n+i; b=k*n+(i+1)%n; c=((k+1)%4)*n+(i+1)%n; d=((k+1)%4)*n+i
        faces << [a,b,c] << [a,c,d]
      end
    end
    points = vertices.map { |v| point_mm(v) }
    signed = 0.0
    faces.each do |indices|
      p,q,r=indices.map { |i| vertices[i] }
      a=q.zip(p).map { |x,y| x-y }; b=r.zip(p).map { |x,y| x-y }
      cross=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]
      raise ArgumentError, 'closed_band contains a collapsed face; inspect correspondence' if cross.sum { |v| v*v } < 1.0e-12
      signed += p[0]*(q[1]*r[2]-q[2]*r[1])+p[1]*(q[2]*r[0]-q[0]*r[2])+p[2]*(q[0]*r[1]-q[1]*r[0])
    end
    raise ArgumentError, 'closed_band has zero signed volume' if signed.abs < 1.0e-8
    faces.map!(&:reverse) if signed < 0
    group=entities.add_group
    begin
      group.name=name.to_s
      faces.each do |indices|
        p,q,r=indices.map { |i| points[i] }
        face=group.entities.add_face(p,q,r)
        raise ArgumentError, 'closed_band face failed; inspect boundary spacing and correspondence' unless face && face.valid?
        face.reverse! if face.normal.dot((q-p).cross(r-p)) < 0
      end
      raise ArgumentError, 'closed_band did not close; inspect boundary correspondence' unless group.manifold?
      group.material=material if material
      group
    rescue Exception
      group.erase! if group && group.valid?
      raise
    end
  end

end
