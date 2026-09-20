# Production and diagnostic adapters share ADAIGeometryGuard; no MCP state mutation.
module ADAIGeometryAdapter
 extend self
 require_relative 'managed_contract' unless defined?(ADAIManagedContract)
 ALLOWED_PHASES=ADAIManagedContract::GEOMETRY_PHASES
 def component_instance(entities,context,part,spec)
  model=context.fetch('model');name='ADAI_'+spec.fetch('id').gsub(/[^A-Za-z0-9_]/,'_')
  definition=model.definitions.add(name)
  report=ADAIGeometryGuard.add_mesh(definition.entities,part.fetch('vertices'),part.fetch('triangles'),part.fetch('semantic_id'),true)
  instance=entities.add_instance(definition,Geom::Transformation.new);instance.name=part.fetch('semantic_id')
  report['compile_geometry_sha256']=part['geometry_sha256'];report['compile_checks']=part['compile_checks'];report['part_role']=part['role']
  ADAIGeometryGuard.tag(instance,part.fetch('semantic_id'),report)
  [instance,report]
 end
 def build(entities,context,data)
  start=Process.clock_gettime(Process::CLOCK_MONOTONIC)
  raise 'GEOMETRY_PHASE_MISMATCH' unless ALLOWED_PHASES.include?(context['phase']) && context['phase']==data['phase']
  raise 'GEOMETRY_PROJECT_MISMATCH' unless context['project_id']==data['project_id']
  ids=data['parts'].map{|p|p.fetch('semantic_id')};raise 'DUPLICATE_SEMANTIC_ID' unless ids.uniq.length==ids.length
  archetype_specs=(data['archetypes'] || []).each_with_object({}){|spec,h|h[spec.fetch('semantic_id')]=spec}
  groups={};reports=[];registrations={'projection_subjects'=>[],'archetypes'=>[],'visible_detail_systems'=>[],'correction_bindings'=>[]}
  data['parts'].each do |part|
   id=part.fetch('semantic_id')
   g,report=if context['phase']=='archetypes'
    spec=archetype_specs.fetch(id){raise 'ARCHETYPE_PART_MAPPING_MISSING:'+id}
    component_instance(entities,context,part,spec)
   else
    group=entities.add_group;group.name=id
    [group,ADAIGeometryGuard.add_mesh(group.entities,part.fetch('vertices'),part.fetch('triangles'),id,true)]
   end
   report['compile_geometry_sha256']=part['geometry_sha256'];report['compile_checks']=part['compile_checks'];report['part_role']=part['role']
   ADAIGeometryGuard.tag(g,id,report);groups[id]=g;reports<<report
   if context['phase']=='facade_detail'
    PipClawManagedProject.register_unique_detail(context['phase_group'],g,{'id'=>id,'kind'=>part.fetch('role'),'source_cue'=>data.fetch('source_evidence'),'host'=>part['host_id'] || 'explicit placement'})
   end
   if context['phase']=='archetypes'
    spec=archetype_specs.fetch(id);registrations['archetypes'] << PipClawManagedProject.register_archetype(context['phase_group'],g,spec)
   end
  end
  if context['phase']=='massing'
   data.fetch('projection_subjects').each do |item|
    subject=groups.fetch(item.fetch('semantic_id')){raise 'PROJECTION_SUBJECT_PART_MISSING:'+item.fetch('semantic_id')}
    registrations['projection_subjects'] << PipClawManagedProject.register_projection_subject(context['phase_group'],subject,item)
   end
  elsif context['phase']=='archetypes'
   data.fetch('visible_detail_systems').each do |item|
    spec=data.fetch('archetypes').find{|entry|entry.fetch('id')==item.fetch('archetype_id')}
    raise 'ARCHETYPE_ID_NOT_FOUND:'+item.fetch('archetype_id') unless spec
    meta=item.merge('prototype'=>groups.fetch(spec.fetch('semantic_id')).persistent_id.to_s,'host'=>'formal geometry adapter')
    registrations['visible_detail_systems'] << PipClawManagedProject.register_visible_detail(context['phase_group'],meta)
   end
  elsif context['phase']=='primary_corrections'
   data.fetch('correction_targets').each do |item|
    target=PipClawManagedProject.find_entity_by_semantic_id(context.fetch('project_root'),item.fetch('target_semantic_id'))
    raise 'CORRECTION_TARGET_NOT_FOUND:'+item.fetch('target_semantic_id') unless target
    correction=groups.fetch(item.fetch('correction_semantic_id'))
    registrations['correction_bindings'] << PipClawManagedProject.register_primary_correction(context['phase_group'],target,correction,item)
   end
  end
  readback=ADAIGeometryGuard.mapping(entities,ids)
  contacts=(data['contacts'] || []).map do |contact|
   # Samples are addressed by barycentric coordinates into actual readback meshes.
   # Producer index mapping is recovered by actual vertex coordinates, never old persistent IDs.
   points=contact.fetch('points_mm');direction=contact.fetch('direction');norm=Math.sqrt(ADAIGeometryGuard.dot(direction,direction));raise 'CONTACT_DIRECTION_INVALID' if norm<1e-9;direction=direction.map{|v|v/norm}
   side_ids=contact.fetch('pair');meshes=side_ids.map{|id|entity=groups.fetch(id);ADAIGeometryGuard.read_mesh(entity.is_a?(Sketchup::ComponentInstance) ? entity.definition.entities : entity.entities)}
   gaps=points.map do |point|
    heights=meshes.map do |vertices,triangles|
     hits=[]
     triangles.each do |f|
      a,b,c=f.map{|i|vertices[i]};n=ADAIGeometryGuard.cross(ADAIGeometryGuard.sub(b,a),ADAIGeometryGuard.sub(c,a));den=ADAIGeometryGuard.dot(n,direction);next if den.abs<1e-9
      distance=ADAIGeometryGuard.dot(n,ADAIGeometryGuard.sub(a,point))/den;q=point.zip(direction).map{|v,d|v+distance*d}
      u=ADAIGeometryGuard.sub(b,a);v=ADAIGeometryGuard.sub(c,a);w=ADAIGeometryGuard.sub(q,a);uu=ADAIGeometryGuard.dot(u,u);uv=ADAIGeometryGuard.dot(u,v);vv=ADAIGeometryGuard.dot(v,v);wu=ADAIGeometryGuard.dot(w,u);wv=ADAIGeometryGuard.dot(w,v);det=uu*vv-uv*uv;next if det.abs<1e-12
      s=(wu*vv-wv*uv)/det;t=(wv*uu-wu*uv)/det
      hits<<distance if s>=-1e-7 && t>=-1e-7 && s+t<=1+1e-7
     end
     raise 'CONTACT_NO_LIVE_SURFACE' if hits.empty?
     hits.min_by(&:abs)
    end
    gap=heights[1]-heights[0];error=(gap-contact.fetch('expected_gap_mm')).abs
    ADAIGeometryGuard.fail!('CONTACT_GAP',contact['id'],{'gap_mm'=>gap,'error_mm'=>error}) if error>contact.fetch('tolerance_mm')
    gap
   end
   {'id'=>contact['id'],'pair'=>side_ids,'samples'=>gaps.length,'gaps_mm'=>gaps,'expected_gap_mm'=>contact['expected_gap_mm'],'tolerance_mm'=>contact['tolerance_mm'],'source'=>'actual SU triangle ray intersections','scope'=>'declared samples only; no full surface collision proof'}
  end
  context['phase_group'].set_attribute('ADAI_GEOMETRY','expected_ids',JSON.generate(ids))
  context['phase_group'].set_attribute('ADAI_GEOMETRY','provenance',JSON.generate(data.reject{|k,_|['parts'].include?(k)}))
  {'created'=>groups.length,'roof_control_contract'=>data['roof_control_contract'],'registrations'=>registrations,
   'geometry_readback'=>{'schema_version'=>1,'kernel_version'=>ADAIGeometryGuard::VERSION,'parameter_sha256'=>data['parameter_sha256'],'generator_sha256'=>data['generator_sha256'],'source_evidence'=>data['source_evidence'],'host'=>data['host'],'mapping'=>readback,'contacts'=>contacts,'dependencies'=>data['dependencies'],'write_readback_seconds'=>Process.clock_gettime(Process::CLOCK_MONOTONIC)-start}}
 end
end
