module AncientBearing
 extend self
 def box(entities,spec,origin)
  g=entities.add_group;g.name=spec['name']
  lo=spec['min_mm'].zip(origin).map { |a,b| (a+b).mm };hi=spec['max_mm'].zip(origin).map { |a,b| (a+b).mm }
  face=g.entities.add_face([lo[0],lo[1],lo[2]],[hi[0],lo[1],lo[2]],[hi[0],hi[1],lo[2]],[lo[0],hi[1],lo[2]])
  raise 'EMPTY_SUPPORT_FACE' unless face
  face.reverse! if face.normal.z<0
  face.pushpull(hi[2]-lo[2]);raise 'SUPPORT_NOT_SOLID' unless g.manifold?
  report=ADAIGeometryGuard.audit(g.entities,spec['name'],true);ADAIGeometryGuard.tag(g,spec['name'],report)
  g
 end
 def triangles(entities,tr=Geom::Transformation.new,result=[])
  entities.grep(Sketchup::Face).each do |face|
   mesh=face.mesh
   mesh.polygons.each do |ids|
    pts=ids.map { |id| mesh.point_at(id.abs).transform(tr).to_a.map { |v| v.to_mm } }
    (1...pts.length-1).each { |i| result<<[pts[0],pts[i],pts[i+1]] }
   end
  end
  entities.each do |item|
   if item.is_a?(Sketchup::ComponentInstance)
    triangles(item.definition.entities,tr*item.transformation,result)
   elsif item.is_a?(Sketchup::Group)
    triangles(item.entities,tr*item.transformation,result)
   end
  end
  result
 end
 def height_at(tris,x,y,target,tolerance)
  heights=[]
  tris.each do |a,b,c|
   den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);next if den.abs<1e-8
   u=((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(y-c[1]))/den
   v=((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(y-c[1]))/den;w=1-u-v
   next unless [u,v,w].min>=-1e-7
   z=u*a[2]+v*b[2]+w*c[2];heights<<z if (z-target).abs<=tolerance
  end
  raise 'NO_LIVE_CONTACT_SURFACE' if heights.empty?
  heights.min_by { |z| (z-target).abs }
 end
 def build(entities,context,data)
  assembly=entities.add_group;assembly.name='Measured_Column_Bracket_Beam_Diagnostic'
  origin=data['bracket']['preset']['origin_mm']
  result=AncientSourceTemplates.build(assembly.entities,context,data['bracket'])
  bracket=assembly.entities.grep(Sketchup::Group).find { |g| g.name.start_with?('SourceTemplate_') }
  column=box(assembly.entities,data['column'],origin);beam=box(assembly.entities,data['beam'],origin)
  wood=context['model'].materials['ARK Bearing Timber'] || context['model'].materials.add('ARK Bearing Timber');wood.color=Sketchup::Color.new(154,111,70)
  column.material=wood;beam.material=wood
  geometry={'bracket'=>triangles(bracket.entities,bracket.transformation),'column'=>triangles(column.entities,column.transformation),'beam'=>triangles(beam.entities,beam.transformation)}
  contacts=data['contacts'].map do |c|
   pair=c['id']=='column_to_bracket' ? ['column','bracket'] : ['bracket','beam']
   gaps=c['points_local_mm'].map do |pt|
    q=pt.zip(origin).map { |a,b| a+b }
    z0=height_at(geometry[pair[0]],q[0],q[1],q[2],c['tolerance_mm'])
    z1=height_at(geometry[pair[1]],q[0],q[1],q[2],c['tolerance_mm'])
    gap=z1-z0;raise "CONTACT_GAP #{gap}" if gap.abs>c['tolerance_mm'];gap
   end
   {'id'=>c['id'],'samples'=>gaps.length,'max_abs_gap_mm'=>gaps.map(&:abs).max,'overlap_area_mm2'=>c['overlap_area_mm2'],'scope'=>'sampled contact on named pads, not full collision or structural analysis'}
  end
  assembly.set_attribute('ARKS','contact_report',JSON.generate(contacts))
  assembly.set_attribute('ARKS','source_seat_report',JSON.generate(data['report']))
  bounds=AncientSourceTemplates.mesh_bounds(assembly.entities);center=bounds.center;extent=[bounds.width,bounds.height,bounds.depth].max
  context['model'].active_view.camera.set(center+Geom::Vector3d.new(extent,-extent*1.4,extent),center,Z_AXIS)
  {'created'=>3,'bracket'=>result,'contacts'=>contacts}
 end
end
