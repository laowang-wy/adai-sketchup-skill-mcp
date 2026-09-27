# Runnable hosted-opening example; replace these sample dimensions from sources.
# One shared parameter set drives the wall opening, frame and host placements.
# Guided uses its saved phase; expert can reuse these methods in its work unit.
module PipClawManagedBuild
  def self.parameters
    {bay: 3000, count: 4, wall_height: 3200, wall_depth: 240,
     sill: 800, opening_width: 1400, opening_height: 1800,
     frame_section: 80, frame_depth: 120, floor_z: 200}
  end
  def self.box(entities,x,y,z,w,d,h)
    raise 'Sample dimensions must be positive' unless [w,d,h].all?{|n|n>0}
    g=entities.add_group
    face=g.entities.add_face([x.mm,y.mm,z.mm],[(x+w).mm,y.mm,z.mm],[(x+w).mm,(y+d).mm,z.mm],[x.mm,(y+d).mm,z.mm])
    face.pushpull(face.normal.z < 0 ? -h.mm : h.mm)
    g
  end
  def self.layout(p)
    left=(p[:bay]-p[:opening_width])/2.0
    top=p[:sill]+p[:opening_height]
    raise 'Opening must fit host and frame section' unless left>0 && top<p[:wall_height] && p[:frame_section]*2<[p[:opening_width],p[:opening_height]].min && p[:frame_depth]<=p[:wall_depth]
    {left:left,top:top,frame_y:(p[:wall_depth]-p[:frame_depth])/2.0}
  end
  def self.host(entities,p)
    a=layout(p); g=entities.add_group;g.name='Host with real opening'
    # Four wall zones leave a through opening; the frame never hides a solid wall.
    box(g.entities,0,0,0,a[:left],p[:wall_depth],p[:wall_height])
    box(g.entities,a[:left]+p[:opening_width],0,0,a[:left],p[:wall_depth],p[:wall_height])
    box(g.entities,a[:left],0,0,p[:opening_width],p[:wall_depth],p[:sill])
    box(g.entities,a[:left],0,a[:top],p[:opening_width],p[:wall_depth],p[:wall_height]-a[:top])
    g
  end
  def self.frame(entities,p)
    g=entities.add_group;g.name='Complete opening frame';s=p[:frame_section];w=p[:opening_width];h=p[:opening_height];d=p[:frame_depth]
    box(g.entities,0,0,0,s,d,h);box(g.entities,w-s,0,0,s,d,h)
    box(g.entities,s,0,0,w-2*s,d,s);box(g.entities,s,0,h-s,w-2*s,d,s)
    g.to_component
  end
  def self.host_transform(p,index)
    Geom::Transformation.translation([(p[:bay]*index).mm,0,p[:floor_z].mm])
  end
  def self.frame_transform(p,index)
    a=layout(p)
    host_transform(p,index)*Geom::Transformation.translation([a[:left].mm,a[:frame_y].mm,p[:sill].mm])
  end
  def self.build(entities,context)
    p=parameters;layout(p);phase=context['phase_group'];root=context['project_root']
    case context['phase']
    when 'massing','source_alignment'
      box(entities,0,-300,0,p[:bay]*p[:count],p[:wall_depth]+600,p[:floor_z])
      p[:count].times{|i|g=host(entities,p);g.transformation=host_transform(p,i)}
    when 'archetypes'
      prototype=frame(entities,p)
      prototype.definition.name='Hosted opening frame'
      prototype.transformation=frame_transform(p,0)
      PipClawManagedProject.register_archetype(phase,prototype,{'id'=>'frame','family'=>'opening_frame','source_cue'=>'Complete frame at the first real wall opening'})
    when 'replication'
      (1...p[:count]).each do |i|
        tr=frame_transform(p,i)
        PipClawManagedProject.instantiate_archetype(phase,entities,root,'frame',tr,{'system_id'=>'frame-row','source_cue'=>'Same opening and host parameters','expected_transform'=>tr.to_a})
      end
    else
      raise 'Sample covers primary form, hosted representative and repetition; use task-specific construction for other phases'
    end
    {'scope'=>'Hosted construction example, not a building template','parameters_mm'=>p.reject{|k,_|k==:count},'frame_total'=>p[:count]}
  end
end
