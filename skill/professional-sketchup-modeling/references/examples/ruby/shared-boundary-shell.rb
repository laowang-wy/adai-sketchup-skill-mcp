# Reuse an actual shell edge for its attached fascia. No building dimensions,
# image interpretation, transaction, document operation or automatic offset.
module ADAISharedBoundaryShell
  extend self

  def perimeter(grid, geometry)
    raise ArgumentError, 'provide at least two corresponding grid rows' unless grid.is_a?(Array) && grid.length >= 2
    n = grid.first.is_a?(Array) ? grid.first.length : 0
    raise ArgumentError, 'grid rows need equal point counts >= 2' unless n >= 2 && grid.all? { |row| row.is_a?(Array) && row.length == n }
    points = grid.map { |row| row.map { |p| geometry.numbers(p, 3, 'shared shell point') } }
    # Walk each boundary once. Keep the actual endpoints, including varying XY.
    rim = points.map(&:first) + points.last.drop(1) +
      points[0...-1].reverse.map(&:last) + points.first[1...-1].reverse
    rim = rim.each_with_object([]) { |point, out| out << point unless out.last == point }
    rim.pop if rim.first == rim.last
    rim
  end

  # inner_xy_mm has one point for each perimeter point, in the same order.
  # The fascia's outer top meets the shell's underside exactly. Its inner top
  # uses the same station heights; this is not a fitted structural connection.
  def build(entities, geometry, top_grid_mm, inner_xy_mm, shell_thickness_mm,
            fascia_drop_mm, roof_material = nil, fascia_material = nil)
    rim = perimeter(top_grid_mm, geometry)
    thickness, drop = geometry.numbers([shell_thickness_mm, fascia_drop_mm], 2, 'shell thickness and fascia drop')
    raise ArgumentError, 'shell thickness and fascia drop must be positive' unless thickness > 0 && drop > 0
    raise ArgumentError, 'inner boundary needs one XY point per perimeter point' unless inner_xy_mm.is_a?(Array) && inner_xy_mm.length == rim.length
    inner_xy = inner_xy_mm.map { |p| geometry.numbers(p, 2, 'inner boundary point') }
    geometry.profile_rings(rim.map { |x,y,_| [x,y] }, [inner_xy])
    outer_top = rim.map { |x,y,z| [x,y,z-thickness] }
    outer_bottom = outer_top.map { |x,y,z| [x,y,z-drop] }
    inner_top = inner_xy.each_with_index.map { |(x,y),i| [x,y,outer_top[i][2]] }
    inner_bottom = inner_top.map { |x,y,z| [x,y,z-drop] }
    assembly = entities.add_group
    begin
      assembly.name = 'Shell with edge-mounted fascia'
      roof = geometry.shell_grid(assembly.entities, 'Shell', top_grid_mm, thickness, roof_material)
      fascia = geometry.closed_band(assembly.entities, 'Fascia', outer_bottom, outer_top, inner_bottom, inner_top, fascia_material)
      {assembly:assembly, roof:roof, fascia:fascia, outer_contact_mm:outer_top}
    rescue Exception
      assembly.erase! if assembly && assembly.valid?
      raise
    end
  end
end
