# Study helpers distilled from the original ancient-building regression
# examples.  They create geometry only in the entities supplied by the
# managed build; they never open, save, clear or transact on a model.
# Adapt the dimensions and materials from the current source before use.
module ADAIAncientConstructionPatterns
  extend self

  def mm(value)
    value.to_f / 25.4
  end

  def point(x, y, z)
    Geom::Point3d.new(mm(x), mm(y), mm(z))
  end

  # A closed prism from a measured 2D profile.  Useful for dougong noses,
  # eave ends and other stepped members whose side silhouette matters.
  def profile_prism(entities, name, profile_xz, y0_mm, y1_mm, material = nil)
    a = profile_xz.map { |x, z| point(x, y0_mm, z) }
    b = profile_xz.map { |x, z| point(x, y1_mm, z) }
    group = entities.add_group
    group.name = name
    inner = group.entities
    [inner.add_face(a), inner.add_face(b.reverse)].each do |face|
      next unless face
      face.material = material if material
      face.back_material = material if material
    end
    profile_xz.each_index do |index|
      next_index = (index + 1) % profile_xz.length
      face = inner.add_face(a[index], a[next_index], b[next_index], b[index])
      face.material = material if face && material
      face.back_material = material if face && material
    end
    group
  end

  # Sweep one measured section between two stations.  The caller can provide
  # different station heights to preserve a real ridge/eave slope instead of
  # raising four plan-ring corners after the fact.
  def section_sweep(entities, name, section_xz, x_mm, y0_mm, y1_mm, z0_mm, z1_mm, material = nil)
    a = section_xz.map { |x, z| point(x_mm + x, y0_mm, z0_mm + z) }
    b = section_xz.map { |x, z| point(x_mm + x, y1_mm, z1_mm + z) }
    group = entities.add_group
    group.name = name
    inner = group.entities
    [inner.add_face(a), inner.add_face(b.reverse)].each do |face|
      next unless face
      face.material = material if material
      face.back_material = material if material
    end
    section_xz.each_index do |index|
      next_index = (index + 1) % section_xz.length
      face = inner.add_face(a[index], a[next_index], b[next_index], b[index])
      face.material = material if face && material
      face.back_material = material if face && material
    end
    group
  end

  # A three-station support chain keeps the bearing points visible and
  # inspectable before it is repeated.  The caller chooses the actual source
  # datum and member section; this helper does not infer historical dimensions.
  def support_chain(entities, name, stations, width_mm, depth_mm, height_mm, material = nil)
    root = entities.add_group
    root.name = name
    stations.each_with_index do |station, index|
      x, y, z = station
      profile_prism(root.entities, "#{name}_station_#{index}",
                    [[-width_mm / 2.0, 0], [width_mm / 2.0, 0],
                     [width_mm / 2.0, height_mm], [-width_mm / 2.0, height_mm]],
                    y - depth_mm / 2.0, y + depth_mm / 2.0, material).transform!(
                      Geom::Transformation.translation(Geom::Vector3d.new(mm(x), 0, mm(z))))
    end
    root
  end

  # Use three or more actual read-back stations for a lifted curved corner.
  # This preserves the measured corner path as geometry rather than metadata.
  def curved_corner(entities, name, stations, section_xz, material = nil)
    root = entities.add_group
    root.name = name
    stations.each_cons(2).with_index do |pair, index|
      first = pair[0]
      second = pair[1]
      section_sweep(root.entities, "#{name}_segment_#{index}", section_xz,
                    first[0], first[1], second[1], first[2], second[2], material)
    end
    root
  end
end
