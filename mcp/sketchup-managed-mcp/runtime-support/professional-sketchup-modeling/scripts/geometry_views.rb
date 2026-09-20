# Tool-owned read-only geometry and camera diagnostics. Uses only a managed root.
module PipClawManagedProject
 def drawable_bounds(entities,transform=Geom::Transformation.new,bounds=Geom::BoundingBox.new)
  entities.each do |e|
   next if e.respond_to?(:hidden?) && e.hidden?
   if e.is_a?(Sketchup::Face)
    e.vertices.each{|v|bounds.add(v.position.transform(transform))}
   elsif e.is_a?(Sketchup::Group)
    drawable_bounds(e.entities,transform*e.transformation,bounds)
   elsif e.is_a?(Sketchup::ComponentInstance)
    drawable_bounds(e.definition.entities,transform*e.transformation,bounds)
   end
  end
  bounds
 end
 def capture_geometry_views(project_id,phase_name,directory)
  root=root_for(project_id,false);raise 'MANAGED_PROJECT_REQUIRED' unless root && root.valid?
  group=phase_group(root,phase_name);raise 'MANAGED_PHASE_REQUIRED' unless group
  original=camera_state;view=model.active_view;records=[];visibility=[]
  # Evidence isolates this managed root. Restore all external visibility in ensure.
  model.entities.each{|e|if e!=root && e.respond_to?(:hidden=);visibility<<[e,e.hidden?];e.hidden=true;end}
  root_bounds=drawable_bounds(root.entities,root.transformation)
  raise 'NO_DRAWABLE_GEOMETRY' unless root_bounds.valid?
  targets=[['whole',root_bounds]]
  ids=JSON.parse(group.get_attribute('ADAI_GEOMETRY','expected_ids','[]'))
  raise 'DIAGNOSTIC_ID_LIMIT' if ids.length>100
  matches=Hash.new{|h,k|h[k]=[]};walk=nil
  walk=lambda{|ents,tr|ents.each{|e|if e.is_a?(Sketchup::Group)||e.is_a?(Sketchup::ComponentInstance)
   id=e.get_attribute('ADAI_GEOMETRY','semantic_id');et=tr*e.transformation;ee=e.is_a?(Sketchup::Group) ? e.entities : e.definition.entities
   matches[id]<<drawable_bounds(ee,et) if id && ids.include?(id);walk.call(ee,et)
  end}}
  walk.call(group.entities,root.transformation*group.transformation)
  ids.each{|id|raise 'SEMANTIC_ID_MATCH_COUNT' unless matches[id].length==1}
  # At most 8 semantic closeups per evidence; whole views always cover the complete root.
  ids.take(8).each_with_index{|id,i|targets<<['part_'+i.to_s,matches[id][0],id]}
  targets.each do |label,bounds,id|
   next unless bounds.valid?
   center=bounds.center;radius=[bounds.diagonal/2,1.0].max
   shots= label=='whole' ? [['perspective',[1,-1,0.7],true],['front',[0,-1,0],false],['side',[1,0,0],false],['plan',[0,0,1],false],['underside',[1,-1,-0.65],false]] : [['end',[1,-1,0.2],false],['underside',[0,-1,-0.7],false]]
   shots.each do |kind,offset,perspective|
    dir=Geom::Vector3d.new(*offset);dir.length=radius*4;up=kind=='plan' ? Y_AXIS : Z_AXIS
    camera=Sketchup::Camera.new(center+dir,center,up,perspective)
    if perspective;camera.fov=40.0
    else;camera.height=radius*2.6;end
    view.camera=camera;view.refresh
    file=File.join(directory,'geometry-'+label+'-'+kind+'.png');ok=view.write_image(file,1600,1200,true,0.9);raise 'DIAGNOSTIC_CAPTURE_FAILED' unless ok && File.size(file)>0
    metadata=JSON.parse(camera_state);metadata['bounds_mm']=[bounds.min,bounds.max].map{|p|p.to_a.map{|x|x.to_mm}};metadata['semantic_id']=id;metadata['extent_scope']='recursive Face vertices; excludes MCP ConstructionPoint anchor';metadata['image_pixels']=[1600,1200];metadata['clipping_check']='conservative enclosing-sphere camera fit; inspect image';metadata['projection_verified']=view.camera.perspective? == perspective;metadata['external_entities_temporarily_hidden']=visibility.length
    records<<{'label'=>label+'_'+kind,'path'=>file,'camera'=>metadata}
   end
  end
  JSON.generate({'ok'=>true,'views'=>records,'omitted_closeups'=>[ids.length-8,0].max})
 ensure
  visibility.each{|e,hidden|e.hidden=hidden if e.valid?} if visibility
  restore_camera(original) if original
  view.refresh if view
 end
end

module PipClawManagedProject
 def geometry_diagnose(project_id)
  root=root_for(project_id,false)
  return JSON.generate({'ok'=>true,'root_exists'=>false,'project_id'=>project_id,'scope'=>'managed root existence readback; valid after rollback'}) unless root
  load File.join(File.dirname(__FILE__),'geometry_guard.rb') # Read the installed kernel, never a stale step's module.
  phases=[]
  root.entities.grep(Sketchup::Group).each do |group|
   ids=JSON.parse(group.get_attribute('ADAI_GEOMETRY','expected_ids','[]'));next if ids.empty?
   phases<<{'phase'=>group.get_attribute(DICT,'phase'),'mapping'=>ADAIGeometryGuard.mapping(group.entities,ids)}
  end
  JSON.generate({'ok'=>true,'project_id'=>project_id,'root_exists'=>true,'root_pid'=>root.persistent_id,'phases'=>phases,'source'=>'fresh SketchUp entities; no cached measurement reuse','counts_recursive'=>count_recursive(root.entities),'scope'=>'tagged geometry topology and ID mapping; contact remeasurement requires controlled samples in a step'})
 end
end
