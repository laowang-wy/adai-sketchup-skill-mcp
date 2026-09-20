module AncientRoofKitV4
 extend self
 def point(p); Geom::Point3d.new(*p.map { |v| v.mm }); end
 def add_mesh(entities,vertices,faces,id='roof')
  ADAIGeometryGuard.add_mesh(entities,vertices,faces,id)
 end
 def audit(group,expected)
  report=ADAIGeometryGuard.audit(group.entities,group.name,true,expected && expected['triangles']);ADAIGeometryGuard.tag(group,group.name,report);report
 end
 def ridge(parent,spec,id)
  g=parent.add_group;g.name=id
  report=add_mesh(g.entities,spec.fetch('vertices'),spec.fetch('faces'),id);ADAIGeometryGuard.tag(g,id,report)
  g
 end
 def build(entities,context,data)
  started=Process.clock_gettime(Process::CLOCK_MONOTONIC)
  root=entities.add_group;root.name='ARK4_Roof_Family_Bench';reports=[];semantic_ids=[];dependencies=[]
  roof_material=context['model'].materials['ARK4 Roof Clay'] || context['model'].materials.add('ARK4 Roof Clay');roof_material.color=Sketchup::Color.new(90,110,116)
  data.each_with_index do |item,index|
   group=root.entities.add_group;group.name=item['preset']['roof_type'];shell=group.entities.add_group;shell.name="roof/#{index}/#{item['preset']['roof_type']}/shell";semantic_ids<<shell.name
   write_report=add_mesh(shell.entities,item['vertices'],item['triangles'],shell.name);report=audit(shell,item['expected']).merge(write_report);ADAIGeometryGuard.tag(shell,shell.name,report);shell.material=roof_material
   d=item['details'];ridges=group.entities.add_group;ridges.name='Ridges';ridges.material=roof_material;d.fetch('ridge_meshes').each_with_index { |spec,ri| id="roof/#{index}/ridge/#{ri}";ridge(ridges.entities,spec,id);semantic_ids<<id;dependencies<<{'producer'=>shell.name,'consumer'=>id} }
   extra_reports=[]
   (d['extras'] || []).each do |spec|
    g=group.entities.add_group;g.name=spec['name'];add_mesh(g.entities,spec['vertices'],spec['faces'])
    extra_reports<<audit(g,spec['expected']).merge('name'=>spec['name'])
    if spec['material']=='wood'
     wood=context['model'].materials['ARK Gable Timber'] || context['model'].materials.add('ARK Gable Timber');wood.color=Sketchup::Color.new(125,78,45);g.material=wood
    else;g.material=roof_material;end
   end
   report['closure_parts']=extra_reports
   report['cut_tile_instances']=d['instances'].count { |i| i['clipped'] }
   definitions={}
   d['prototypes'].each do |name,prototype|
    g=group.entities.add_group;g.name='Tile_'+name;add_mesh(g.entities,prototype['vertices'],prototype['faces'])
    raise 'TILE_NOT_MANIFOLD' unless g.manifold?
    g.entities.grep(Sketchup::Edge).each { |edge| if edge.faces.length==2 && edge.faces[0].normal.angle_between(edge.faces[1].normal)<65.degrees;edge.soft=true;edge.smooth=true;end }
    g.material=roof_material
    inst=g.to_component;definitions[name]=inst.definition;definitions[name].name="ARK4_#{context['project_id']}_#{index}_#{name}";inst.erase!
   end
   tiles=group.entities.add_group;tiles.name=(d['scope']=='tiled' ? 'Tile_Surface_Array' : 'Tile_Overlap_Sample');tiles.material=roof_material
   d['instances'].each do |inst|
    tr=Geom::Transformation.axes(point(inst['origin']),Geom::Vector3d.new(*inst['x']),Geom::Vector3d.new(*inst['y']),Geom::Vector3d.new(*inst['z']))
    tiles.entities.add_instance(definitions.fetch(inst['prototype']),tr)
   end
   report['tile_instances']=tiles.entities.grep(Sketchup::ComponentInstance).length
   report['ridge_paths']=d['ridge_paths'].length
   group.set_attribute('ARK4','preset_json',JSON.generate(item['preset']));group.set_attribute('ARK4','live_report',JSON.generate(report))
   group.transform!(Geom::Transformation.translation(point(item['offset']).to_a))
   reports<<report.merge('roof_type'=>item['preset']['roof_type'])
  end
  root.set_attribute('ARK4','reports',JSON.generate(reports))
  PipClawManagedProject.register_projection_subject(context['phase_group'],root,{'id'=>'roof','role'=>'focal_building'})
  center=root.bounds.center;extent=[root.bounds.width,root.bounds.height,root.bounds.depth].max
  context['model'].active_view.camera.set(center+Geom::Vector3d.new(extent*0.95,-extent*1.3,extent*0.95),center,Z_AXIS)
  context['phase_group'].set_attribute('ADAI_GEOMETRY','expected_ids',JSON.generate(semantic_ids))
  mapping=ADAIGeometryGuard.mapping(entities,semantic_ids)
  {'created'=>data.length,'reports'=>reports,'geometry_readback'=>{'schema_version'=>1,'kernel_version'=>ADAIGeometryGuard::VERSION,'parameter_sha256'=>Digest::SHA256.hexdigest(JSON.generate(data.map{|item|item['preset']})),'generator_sha256'=>data.first.fetch('generator_sha256'),'source_evidence'=>'explicit v4 diagnostic presets; inferred generic shapes','host'=>data.map{|item|item['host']},'mapping'=>mapping,'contacts'=>[],'dependencies'=>dependencies,'write_readback_seconds'=>Process.clock_gettime(Process::CLOCK_MONOTONIC)-started,'scope'=>'shell and ridge topology; tiles checked on creation, contact not certified'}}
 end
end

