# Tool-owned read-only geometry and camera diagnostics. Uses only a managed root.
module PipClawManagedProject
 # A different managed project may have hidden this root. A requested capture
 # shows its subject temporarily; child visibility remains the user's choice.
 def with_project_visibility(root)
  visibility=model.entities.select{|e|e.respond_to?(:hidden=) && e.respond_to?(:hidden?)}.map{|e|[e,e.hidden?]}
  visibility.each{|e,_|e.hidden=(e!=root)}
  yield visibility.count{|e,_|e!=root}
 ensure
  visibility.each{|e,hidden|e.hidden=hidden if e.valid?} if visibility
 end
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
 def capture_geometry_views(project_id,phase_name,directory,requested_json=nil,comparison_json=nil,comparison_display='current')
  root=root_for(project_id,false);raise 'MANAGED_PROJECT_REQUIRED' unless root && root.valid?
  group=phase_group(root,phase_name);raise 'MANAGED_PHASE_REQUIRED' unless group
  view=model.active_view;original_state=capture_camera_state;records=[]
  requested=requested_json.nil? ? nil : JSON.parse(requested_json)
  supported=%w[perspective front side plan underside]
  raise 'INVALID_GEOMETRY_VIEWS' if requested && (!requested.is_a?(Array) || (requested-supported).any? || requested.uniq.length!=requested.length)
  raise 'INVALID_EVIDENCE_DISPLAY' unless %w[current surfaces].include?(comparison_display)
  comparison=comparison_json.nil? ? nil : JSON.parse(comparison_json)
  if comparison
   raise 'INVALID_EVIDENCE_DISPLAY' if comparison.key?('display') && !%w[current surfaces].include?(comparison['display'])
   az= comparison['azimuth_deg'];el=comparison['elevation_deg']
   raise 'INVALID_COMPARISON_VIEW' unless az.is_a?(Numeric) && el.is_a?(Numeric) && az.finite? && el.finite? && az.abs<=360 && el.abs<89 && (!comparison.key?('perspective') || [true,false].include?(comparison['perspective']))
   a=az*Math::PI/180.0;e=el*Math::PI/180.0
   comparison_direction=[Math.cos(e)*Math.cos(a),Math.cos(e)*Math.sin(a),Math.sin(e)]
  end
  with_project_visibility(root) do |external_count|
  root_bounds=drawable_bounds(root.entities,root.transformation)
  raise 'NO_DRAWABLE_GEOMETRY' unless root_bounds.valid?
  targets=[['whole',root_bounds]]
  ids=requested ? [] : JSON.parse(group.get_attribute('ADAI_GEOMETRY','expected_ids','[]'))
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
   shots= label=='whole' ? [['perspective',[1,-1,0.7],true],['front',[0,-1,0],false],['side',[1,0,0],false],['plan',[0,0,1],false],['underside',[1,-1,-0.65],false]] : [['end',[1,-1,0.2],false],['underside',[0,-1,-0.7],false]]
   shots=shots.select{|kind,_,_|requested.include?(kind)} if requested
   shots << ['comparison',comparison_direction,comparison.fetch('perspective',true)] if comparison && label=='whole'
   shots.each do |kind,offset,perspective|
    up=kind=='plan' ? Y_AXIS : Z_AXIS
    restore_camera(ADAIViewportCapture.fitted_state(view,bounds,offset,up,perspective))
    file=File.join(directory,'geometry-'+label+'-'+kind+'.png')
    display=label=='whole' && %w[perspective comparison].include?(kind) ? (comparison && comparison['display'] || comparison_display) : 'current'
    ok=ADAIViewportCapture.with_display(model,display){write_evidence_image(view,file,1600,1200)}
    raise 'DIAGNOSTIC_CAPTURE_FAILED' unless ok && File.size(file)>0
    metadata=JSON.parse(camera_state);metadata['display']=display;metadata['bounds_mm']=[bounds.min,bounds.max].map{|p|p.to_a.map{|x|x.to_mm}};metadata['semantic_id']=id;metadata['extent_scope']='recursive Face vertices; excludes MCP ConstructionPoint anchor';metadata['image_pixels']=evidence_image_size(view,1600,1200);metadata['render_backend']=evidence_framebuffer? ? 'framebuffer' : 'image';metadata['clipping_check']='eight drawable-bound corners fitted to image aspect; inspect image';metadata['projection_verified']=view.camera.perspective? == perspective;metadata['external_entities_temporarily_hidden']=external_count
    records<<{'label'=>label+'_'+kind,'path'=>file,'camera'=>metadata}
   end
  end
  JSON.generate({'ok'=>true,'views'=>records,'omitted_closeups'=>[ids.length-8,0].max})
  end
 ensure
  restore_camera(original_state) if original_state && view
  view.refresh if view
 end
end

module PipClawManagedProject
 def geometry_diagnose(project_id,request_json=nil)
  root=root_for(project_id,false)
  return JSON.generate({'ok'=>true,'root_exists'=>false,'project_id'=>project_id,'scope'=>'managed root existence readback; valid after rollback'}) unless root
  load File.join(File.dirname(__FILE__),'geometry_guard.rb') # Read the installed kernel, never a stale step's module.
  phases=[]
  containers=root.entities.grep(Sketchup::Group).select { |group| group.get_attribute(DICT,'phase') }
  containers.each do |group|
   ids=JSON.parse(group.get_attribute('ADAI_GEOMETRY','expected_ids','[]'));next if ids.empty?
   phases<<{'phase'=>group.get_attribute(DICT,'phase'),'mapping'=>ADAIGeometryGuard.mapping(group.entities,ids)}
  end
  request=request_json ? JSON.parse(request_json) : {}
  objects=JSON.parse(discover_targets(project_id,JSON.generate({'query'=>'','offset'=>request.fetch('offset',0)})))
  JSON.generate({'ok'=>true,'project_id'=>project_id,'root_exists'=>true,'root_pid'=>root.persistent_id,'phases'=>phases,'phase_count'=>containers.length,'mapped_phase_count'=>phases.length,'source'=>'fresh SketchUp entities; no cached measurement reuse','counts_recursive'=>count_recursive(root.entities),'scope'=>'bounded object addresses plus tagged topology; absent topology tags do not mean absent geometry'}.merge(objects))
 end
end
