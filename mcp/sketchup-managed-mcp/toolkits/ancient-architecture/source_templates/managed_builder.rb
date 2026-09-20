module AncientSourceTemplates
 extend self
 def transformation(values,factor=1.0)
  a=values.dup
  [12,13,14].each { |i| a[i]=(a[i]*factor).mm }
  Geom::Transformation.new(a)
 end
 def mesh_bounds(ents,tr=Geom::Transformation.new,bounds=Geom::BoundingBox.new)
  ents.grep(Sketchup::Face).each { |face| face.vertices.each { |v| bounds.add(v.position.transform(tr)) } }
  ents.each do |item|
   if item.is_a?(Sketchup::ComponentInstance)
    mesh_bounds(item.definition.entities,tr*item.transformation,bounds)
   elsif item.is_a?(Sketchup::Group)
    mesh_bounds(item.entities,tr*item.transformation,bounds)
   end
  end
  bounds
 end
 def build(entities,context,data)
  root=entities.add_group;root.name='SourceTemplate_'+data['preset']['template']
  definitions={};reports=[];factor=1000.0
  maker=nil
  maker=lambda do |key|
   return definitions[key] if definitions.key?(key)
   d=data['definitions'].fetch(key)
   temp=root.entities.add_group
   source_mesh_report=ADAIGeometryGuard.add_source_mesh(temp.entities,d['vertices_mm'],d['triangles'],'source/'+key,factor)
   # Only hide new triangulation diagonals inside the same original source face.
   boundary={};verts=d['vertices_mm']
   d['face_ranges'].each do |start,count|
    incidence=Hash.new(0)
    d['triangles'][start,count].each { |tri| 3.times { |i| incidence[[tri[i],tri[(i+1)%3]].sort]+=1 } }
    incidence.each { |pair,n| boundary[pair]=true if n==1 }
   end
   lookup={};verts.each_with_index { |v,i| lookup[v.map { |x| x.round(4) }]=i }
   temp.entities.grep(Sketchup::Edge).each do |e|
    pair=e.vertices.map { |v| lookup[v.position.to_a.map { |x| (x.to_mm/factor).round(4) }] }
    if pair.all? { |v| !v.nil? } && !boundary[pair.sort] && e.faces.length==2
     e.hidden=true;e.soft=true;e.smooth=true
    end
   end
   live=temp.entities.grep(Sketchup::Face).length
   raise "SOURCE_TRIANGLE_LOSS #{key}: #{live}/#{d['triangles'].length}" unless live==d['triangles'].length
   topology_report= d['triangles'].empty? ? {'state'=>'empty_definition_container'} : ADAIGeometryGuard.audit(temp.entities,'source/'+key,false,d['triangles'].length,factor)
   inst=temp.to_component;definition=inst.definition
   definition.name="ARKS_#{context['project_id']}_#{data['preset']['template']}_#{key}_#{d['name']}"
   definitions[key]=definition
   d['children'].each do |child|
    sub=definition.entities.add_instance(maker.call(child['definition']),transformation(child['transform_mm'],factor))
    sub.name=child['name'];sub.hidden=child['hidden']
   end
   inst.erase!
   reports<<{'id'=>key,'source_faces'=>d['source_faces'],'live_triangles'=>live,'children'=>d['children'].length,'topology'=>topology_report}
   definition
  end
  definition=maker.call(data['root']);p=data['preset'];s=data['scale']
  source=transformation(data['root_transform_mm'],factor)
  rotation=Geom::Transformation.rotation(ORIGIN,Z_AXIS,p['rotation_deg'].degrees)
  instances=[];placement_reports=[]
  p['count'].times do |i|
   shift=Geom::Transformation.translation([i*p['spacing_mm'].mm,0,0])
   origin=Geom::Transformation.translation(p['origin_mm'].map { |v| v.mm })
   instance=root.entities.add_instance(definition,origin*rotation*shift*Geom::Transformation.scaling(s/factor)*source)
   instance.name="#{p['template']}_#{i+1}"
   instances<<instance
   measured=mesh_bounds(instance.definition.entities,instance.transformation)
   actual_points=[measured.min,measured.max].map { |q| q.to_a.map { |v| v.to_mm } }
   expected=data['placement_contract']['instances_bounds_mm'][i]
   max_error=actual_points.flatten.zip(expected.flatten).map { |a,b| (a-b).abs }.max
   raise "INSTANCE_PLACEMENT_MISMATCH #{i}: #{max_error}" if max_error>0.2
   placement_reports<<{'index'=>i,'bounds_mm'=>actual_points,'max_error_mm'=>max_error,'definition_id'=>instance.definition.entityID}

  end
  root.set_attribute('ARKS','preset',JSON.generate(p));root.set_attribute('ARKS','source_sha256',data['source_sha256'])
  # Nested rotated instance AABBs are conservative. Measure actual live vertices.
  bounds=mesh_bounds(root.entities,root.transformation)
  raise 'NOT_SHARED_DEFINITION' unless instances.all? { |inst| inst.definition==definition }
  actual=[bounds.width,bounds.height,bounds.depth].map { |v| v.to_mm }
  bbox=[root.bounds.width,root.bounds.height,root.bounds.depth].map { |v| v.to_mm }
  if p['count']==1 && p['rotation_deg']==0
   raise "SOURCE_BOUNDS_MISMATCH #{actual.inspect} vs #{data['expected_extent_mm'].inspect}" unless actual.zip(data['expected_extent_mm']).all? { |a,b| (a-b).abs<0.2 }
  end
  root.set_attribute('ARKS','live_definition_report',JSON.generate(reports))
  root.set_attribute('ARKS','placement_report',JSON.generate(placement_reports))
  PipClawManagedProject.register_projection_subject(context['phase_group'],root,{'id'=>'roof','role'=>'focal_building'})
  center=bounds.center;extent=[bounds.width,bounds.height,bounds.depth].max
  context['model'].active_view.camera.set(center+Geom::Vector3d.new(extent,-extent*1.4,extent),center,Z_AXIS)
  {'created'=>p['count'],'placement_reports'=>placement_reports,'shared_definition_verified'=>true,'definition_count'=>definitions.length,'unique_triangles'=>reports.inject(0) { |s,r| s+r['live_triangles'] },'actual_extent_mm'=>actual,'conservative_bbox_mm'=>bbox,'source_sha256'=>data['source_sha256']}
 end
end
