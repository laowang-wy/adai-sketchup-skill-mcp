require 'json'
# smoke_wall.rb -- trace-driven smoke test for the sketchup-mcp bridge.
# Derived from the proven ai_wall snippet (references/ruby-snippets.md).
# Builds one 4000mm wall centered on the X axis with a 900x2100 door opening,
# then prints a SMOKE_READBACK line for comparison with the trace manifest.
# Run as a managed `sketchup_project_step` build file.
# Expected readback: min_mm [0,-120,0], max_mm [4000,120,2800], manifold true.

def ai_layer(m, name)
  m.layers[name] || m.layers.add(name)
end

# p1/p2: wall centerline endpoints [x, y] (mm); h: height; t: thickness
# openings: [{at:, w:, sill:, h:}]  at = opening center distance from p1 (mm)
def ai_wall(m, ents, p1, p2, h, t, name, openings = [])
  dx = p2[0] - p1[0]
  dy = p2[1] - p1[1]
  len = Math.sqrt(dx * dx + dy * dy)
  raise ArgumentError, "zero-length wall: #{name}" if len < 1

  ground = []   # floor-reaching openings [x1, x2, height]
  float  = []   # suspended openings   [x1, x2, z1, z2]
  openings.each do |o|
    x1 = o[:at] - o[:w] / 2.0
    x2 = o[:at] + o[:w] / 2.0
    raise ArgumentError, "opening beyond wall length: #{name}" if x1 < 0 || x2 > len
    if (o[:sill] || 0) <= 0
      ground << [x1, x2, o[:h]]
    else
      float << [x1, x2, o[:sill], o[:sill] + o[:h]]
    end
  end
  ground.sort_by!(&:first)

  pts = [[0, 0]]
  ground.each { |x1, x2, oh| pts << [x1, 0] << [x1, oh] << [x2, oh] << [x2, 0] }
  pts << [len, 0] << [len, h] << [0, h]

  g = ents.add_group
  ge = g.entities
  ge.add_face(pts.map { |x, z| Geom::Point3d.new(x.mm, 0, z.mm) })

  float.each do |x1, x2, z1, z2|
    ge.add_face([
      Geom::Point3d.new(x1.mm, 0, z1.mm), Geom::Point3d.new(x2.mm, 0, z1.mm),
      Geom::Point3d.new(x2.mm, 0, z2.mm), Geom::Point3d.new(x1.mm, 0, z2.mm)])
  end
  faces = ge.grep(Sketchup::Face).sort_by { |f| -f.area }
  faces[1..-1].each { |f| f.erase! if f.valid? } if faces.length > 1

  shell = ge.grep(Sketchup::Face).first
  raise "outline face failed: #{name}" unless shell
  shell.pushpull(t.mm)

  ang = Math.atan2(dy, dx)
  g.transform!(
    Geom::Transformation.translation(Geom::Vector3d.new(p1[0].mm, p1[1].mm, 0)) *
    Geom::Transformation.rotation(ORIGIN, Z_AXIS, ang) *
    Geom::Transformation.translation(Geom::Vector3d.new(0, -t.mm / 2.0, 0)))
  g.name = name
  raise "wall not manifold (overlapping openings?): #{name}" unless g.manifold?
  g
end

module PipClawManagedBuild
  extend self

  def build(entities, context)
    m = context['model']
    w = ai_wall(m, entities, [0, 0], [4000, 0], 2800, 240,
                'smoke_south_wall',
                [{ at: 2000, w: 900, sill: 0, h: 2100 }])
    w.layer = ai_layer(m, 'AI_Smoke')
    w.set_attribute('ai_meta', 'source_layer', 'A-WALL')
    w.set_attribute('ai_meta', 'confidence', 'explicit')
    bb = w.bounds
    readback = {
      'name'=>w.name, 'manifold'=>w.manifold?,
      'min_mm'=>[bb.min.x.to_mm, bb.min.y.to_mm, bb.min.z.to_mm].map { |v| v.round(1) },
      'max_mm'=>[bb.max.x.to_mm, bb.max.y.to_mm, bb.max.z.to_mm].map { |v| v.round(1) }
    }
    puts 'SMOKE_READBACK ' + JSON.generate(readback) if defined?(JSON)
    readback
  end
end

