module AncientEave
 extend self
 def build(entities,context,data)
  report=AncientBearing.build(entities,context,data['bearing'])
  assembly=entities.grep(Sketchup::Group).find { |g| g.name=='Measured_Column_Bracket_Beam_Diagnostic' }
  assembly.name='Column_Bracket_Beam_Rafters_Sheathing_Roof'
  origin=data['bearing']['bracket']['preset']['origin_mm']
  geometry={'beam'=>AncientBearing.triangles(assembly.entities.grep(Sketchup::Group).find { |g| g.name=='Diagnostic_EaveBeam' }.entities)}
  solid_reports=[]
  data['parts'].each do |spec|
   g=assembly.entities.add_group;g.name=spec['name'];AncientRoofKitV4.add_mesh(g.entities,spec['vertices'],spec['faces'])
   solid_reports<<AncientRoofKitV4.audit(g,spec['expected']).merge('name'=>spec['name'])
   material_name=spec['material']=='wood' ? 'ARK Bearing Timber' : 'ARK Eave Substrate'
   mat=context['model'].materials[material_name] || context['model'].materials.add(material_name)
   mat.color=Sketchup::Color.new(98,112,118) if spec['material']!='wood';g.material=mat
   g.transform!(Geom::Transformation.translation(AncientRoofKitV4.point(origin).to_a))
   geometry[spec['name']]=AncientBearing.triangles(g.entities,g.transformation)
  end
  data['tiles'].each do |spec|
   g=assembly.entities.add_group;g.name=spec['name'];AncientRoofKitV4.add_mesh(g.entities,spec['mesh']['vertices'],spec['mesh']['faces']);raise 'EAVE_TILE_NOT_SOLID' unless g.manifold?
   g.entities.grep(Sketchup::Edge).each { |edge| if edge.faces.length==2 && edge.faces[0].normal.angle_between(edge.faces[1].normal)<65.degrees;edge.soft=true;edge.smooth=true;end }
   g.material=context['model'].materials['ARK Eave Substrate'];p=spec['placement'];pt=p['origin'].zip(origin).map { |a,b| a+b }
   g.transform!(Geom::Transformation.axes(AncientRoofKitV4.point(pt),Geom::Vector3d.new(*p['x']),Geom::Vector3d.new(*p['y']),Geom::Vector3d.new(*p['z'])))
   inst=g.to_component;inst.definition.name=spec['name']
  end
  contacts=data['contacts'].map do |c|
   gaps=c['points_local_mm'].map do |pt|
    q=pt.zip(origin).map { |a,b| a+b }
    a,b=c['pair'].map { |name| AncientBearing.height_at(geometry.fetch(name),q[0],q[1],q[2],c['tolerance_mm']) }
    raise 'EAVE_CONTACT_GAP' if (a-b).abs>c['tolerance_mm'];(a-b).abs
   end
   {'id'=>c['id'],'samples'=>gaps.length,'max_abs_gap_mm'=>gaps.max}
  end
  report['eave_contacts']=contacts;report['eave_solids']=solid_reports;report['tile_instances']=data['tiles'].length;report['scope']=data['scope']
  assembly.set_attribute('ARKS','full_eave_report',JSON.generate(report));report
 end
end
