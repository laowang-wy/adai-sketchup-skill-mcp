# Runnable managed engineering example; source dimensions must be adapted.
# Run at source_alignment, review, then archetypes, review, then replication.
# Production count is 4: one reviewed prototype plus 3 additional instances.
module PipClawManagedBuild
  def self.box(entities,x,y,z,w,d,h)
    group=entities.add_group
    face=group.entities.add_face([x.mm,y.mm,z.mm],[(x+w).mm,y.mm,z.mm],[(x+w).mm,(y+d).mm,z.mm],[x.mm,(y+d).mm,z.mm])
    face.reverse! if face.normal.z<0
    face.pushpull(h.mm)
    group
  end
  def self.build(entities,context)
    phase=context['phase_group'];root=context['project_root']
    case context['phase']
    when 'source_alignment'
      box(entities,0,-300,-200,10000,800,200)
    when 'archetypes'
      frame=entities.add_group
      box(frame.entities,0,0,0,120,180,2000)
      box(frame.entities,1080,0,0,120,180,2000)
      box(frame.entities,0,0,2000,1200,180,180)
      prototype=frame.to_component
      prototype.definition.name='Engineering complete frame'
      PipClawManagedProject.register_archetype(phase,prototype,{'id'=>'frame','family'=>'frame','source_cue'=>'Engineering example: two uprights and a lintel'})
      PipClawManagedProject.register_visible_detail(phase,{'id'=>'uprights','kind'=>'posts','source_cue'=>'Two real vertical solids','instances'=>2})
      PipClawManagedProject.register_visible_detail(phase,{'id'=>'lintel','kind'=>'beam','source_cue'=>'One real horizontal solid','instances'=>1})
    when 'replication'
      raise 'Review the archetype before replication' unless PipClawManagedProject.find_archetype(root,'frame')
      [2500,5000,8700].each_with_index do |x,index|
        expected=Geom::Transformation.translation([x.mm,0,0])
        expected=expected*Geom::Transformation.scaling(-1,1,1) if index==2
        PipClawManagedProject.instantiate_archetype(phase,entities,root,'frame',expected,{'system_id'=>'frame-row','source_cue'=>'Engineering repeated row including mirrored end','expected_transform'=>expected.to_a})
      end
    else
      raise 'This example supports source_alignment, archetypes and replication'
    end
    context['model'].active_view.zoom(root)
    {'scope'=>'Engineering example, not source fidelity acceptance','prototype_count'=>1,'additional_instances'=>context['phase']=='replication' ? 3 : 0}
  end
end
