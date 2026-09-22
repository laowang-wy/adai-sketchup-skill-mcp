# Typed building primitives. Loaded inside the same protected MCP transaction.
# Input lengths are millimetres. No save/open/UI/lifecycle calls are made here.
module ADAIManagedOperations
  extend self
  DICT = 'ADAI_SCOPED_OBJECT'.freeze

  def mm(x); x.to_f / 25.4; end
  def point(values); Geom::Point3d.new(*values.map { |x| mm(x) }); end
  def object(entities, id)
    found = []
    walk = lambda do |items, stack|
      items.each do |e|
        next unless e.valid?
        found << e if e.get_attribute(DICT, 'id') == id
        child = PipClawManagedProject.child_entities(e)
        if child
          key=e.respond_to?(:definition) ? e.definition.object_id : e.object_id
          raise 'CYCLIC_COMPONENT_DEFINITION' if stack.include?(key)
          walk.call(child,stack+[key])
        end
      end
    end
    walk.call(entities, [])
    raise "OBJECT_AMBIGUOUS: #{id}" if found.length > 1
    found.first
  end
  def existing(entities, id)
    e = object(entities, id)
    raise "OBJECT_NOT_FOUND: #{id}" unless e
    raise "OBJECT_LOCKED: #{id}" if e.respond_to?(:locked?) && e.locked?
    e
  end
  def new_group(entities, id)
    raise "OBJECT_EXISTS: #{id}" if object(entities,id)
    g = entities.add_group
    g.name = id
    g.set_attribute(DICT, 'id', id)
    g
  end
  def face(entities, coordinates)
    f = entities.add_face(coordinates.map { |p| point(p) })
    raise 'DEGENERATE_FACE' unless f && f.valid?
    f
  end
  def box_mesh(entities, origin, size)
    x,y,z = origin; w,d,h = size
    v = [[x,y,z],[x+w,y,z],[x+w,y+d,z],[x,y+d,z],[x,y,z+h],[x+w,y,z+h],[x+w,y+d,z+h],[x,y+d,z+h]]
    [[3,2,1,0],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7],[4,5,6,7]].each { |f| face(entities, f.map { |i| v[i] }) }
    ADAIGeometryGuard.audit(entities, 'typed_box', true)
  end
  def wall_body(wall, data)
    w,h,t = data.values_at('width_mm','height_mm','thickness_mm')
    holes = data.fetch('openings',[])
    holes.each do |o|
      raise 'OPENING_OUTSIDE_WALL' unless o['x_mm'] > 0 && o['x_mm']+o['width_mm'] < w && o['z_mm'] >= 0 && o['z_mm']+o['height_mm'] < h
    end
    holes.combination(2).each do |a,b|
      overlap_x = [a['x_mm']+a['width_mm'],b['x_mm']+b['width_mm']].min - [a['x_mm'],b['x_mm']].max
      overlap_z = [a['z_mm']+a['height_mm'],b['z_mm']+b['height_mm']].min - [a['z_mm'],b['z_mm']].max
      raise 'OPENINGS_OVERLAP_OR_TOUCH' if overlap_x >= 0 && overlap_z >= 0
    end
    body = wall.entities.grep(Sketchup::Group).find { |g| g.get_attribute(DICT,'role') == 'wall_body' }
    body ||= wall.entities.add_group
    body.set_attribute(DICT,'role','wall_body')
    # Only the wall body is rebuilt. Frame siblings remain independently editable.
    body.entities.erase_entities(body.entities.to_a)
    xs = ([0,w] + holes.flat_map { |o| [o['x_mm'],o['x_mm']+o['width_mm']] }).uniq.sort
    zs = ([0,h] + holes.flat_map { |o| [o['z_mm'],o['z_mm']+o['height_mm']] }).uniq.sort
    occupied = {}
    (xs.length-1).times do |i|
      (zs.length-1).times do |j|
        cx=(xs[i]+xs[i+1])/2.0;cz=(zs[j]+zs[j+1])/2.0
        occupied[[i,j]] = !holes.any? { |o| cx>o['x_mm'] && cx<o['x_mm']+o['width_mm'] && cz>o['z_mm'] && cz<o['z_mm']+o['height_mm'] }
      end
    end
    occupied.each do |(i,j),solid|
      next unless solid
      x0,x1=xs[i],xs[i+1];z0,z1=zs[j],zs[j+1]
      face(body.entities,[[x0,0,z0],[x1,0,z0],[x1,0,z1],[x0,0,z1]])
      face(body.entities,[[x0,t,z1],[x1,t,z1],[x1,t,z0],[x0,t,z0]])
      face(body.entities,[[x0,0,z0],[x0,0,z1],[x0,t,z1],[x0,t,z0]]) unless occupied[[i-1,j]]
      face(body.entities,[[x1,0,z1],[x1,0,z0],[x1,t,z0],[x1,t,z1]]) unless occupied[[i+1,j]]
      face(body.entities,[[x1,0,z0],[x0,0,z0],[x0,t,z0],[x1,t,z0]]) unless occupied[[i,j-1]]
      face(body.entities,[[x0,0,z1],[x1,0,z1],[x1,t,z1],[x0,t,z1]]) unless occupied[[i,j+1]]
    end
    ADAIGeometryGuard.audit(body.entities, 'typed_wall', true)
    wall.entities.grep(Sketchup::Group).each do |frame|
      next unless frame.valid?
      spec=frame.get_attribute(DICT,'frame_spec')
      next unless spec
      spec=JSON.parse(spec)
      opening=holes.find{|o|o['id']==spec['opening']}
      if opening
        frame_body(frame,data,opening,spec)
      else
        frame.erase! # Removing a parametric opening also removes its owned frame.
      end
    end
    wall.set_attribute(DICT,'wall',JSON.generate(data))
    body
  end

  def frame_body(frame, wall_data, opening, spec)
    f=spec.fetch('frame_mm',60.0);d=spec.fetch('depth_mm',60.0);r=spec.fetch('recess_mm',0.0)
    w,h=opening.values_at('width_mm','height_mm')
    raise 'FRAME_SIZE_INVALID' unless 2*f < w && 2*f < h && r+d <= wall_data['thickness_mm']
    frame.entities.erase_entities(frame.entities.to_a)
    [[0,0,f,h],[w-f,0,f,h],[f,0,w-2*f,f],[f,h-f,w-2*f,f]].each do |x,z,bw,bh|
      member=frame.entities.add_group
      box_mesh(member.entities,[opening['x_mm']+x,r,opening['z_mm']+z],[bw,d,bh])
    end
    frame.set_attribute(DICT,'host_opening',spec['opening'])
    frame.set_attribute(DICT,'frame_spec',JSON.generate(spec))
    frame
  end
  def build(entities, context, operations)
    raise 'TYPED_OPERATIONS_EXPERT_ONLY' unless context['execution_policy_version'] == 2
    PipClawManagedProject.preflight_primitive_dimensions(context,operations)
    result=[]
    operations.each do |op|
      id=op['id'] || op['target']
      case op.fetch('op')
      when 'box'
        e=new_group(entities,id);box_mesh(e.entities,[0,0,0],op.fetch('size_mm'))
        e.transformation=Geom::Transformation.translation(point(op.fetch('origin_mm',[0,0,0])))
        if op['component']
          e=e.to_component;e.set_attribute(DICT,'id',id)
        end
      when 'wall'
        e=new_group(entities,id);wall_body(e,op)
        e.transformation=Geom::Transformation.translation(point(op.fetch('origin_mm',[0,0,0])))
      when 'set_wall_openings'
        e=existing(entities,id)
        old=e.get_attribute(DICT,'wall')
        raise 'TARGET_NOT_PARAMETRIC_WALL' unless old
        wall_body(e,JSON.parse(old).merge('openings'=>op.fetch('openings')))
      when 'window_frame'
        wall=existing(entities,op.fetch('wall'))
        raise 'OBJECT_EXISTS' if object(entities,id)
        data=JSON.parse(wall.get_attribute(DICT,'wall','{}'))
        opening=(data['openings'] || []).find { |o| o['id']==op['opening'] }
        raise 'OPENING_NOT_FOUND' unless opening
        e=new_group(wall.entities,id)
        frame_body(e,data,opening,op)
      when 'instance'
        proto=existing(entities,op.fetch('prototype'))
        raise 'PROTOTYPE_COMPONENT_REQUIRED' unless proto.is_a?(Sketchup::ComponentInstance)
        raise 'OBJECT_EXISTS' if object(entities,id)
        e=entities.add_instance(proto.definition,Geom::Transformation.translation(point(op.fetch('origin_mm',[0,0,0]))))
        e.name=id;e.set_attribute(DICT,'id',id)
      when 'translate'
        e=existing(entities,id)
        paths=PipClawManagedProject.instance_paths_for(context['phase_group'],e)
        raise 'SHARED_PARENT_EDIT_AMBIGUOUS' unless paths.length==1
        e.transform!(Geom::Transformation.translation(point(op.fetch('delta_mm'))))
      when 'material'
        e=existing(entities,id)
        color=op.fetch('rgb');alpha=op.fetch('alpha',1.0)
        name='SystemMaterial_'+context['work_unit_id']+'_'+Digest::SHA256.hexdigest(JSON.generate([color,alpha]))[0,12]
        mat=context['model'].materials[name]
        unless mat
          mat=context['model'].materials.add(name);mat.color=Sketchup::Color.new(*color);mat.alpha=alpha
        end
        e.material=mat
      when 'mesh'
        e=new_group(entities,id)
        ADAIGeometryGuard.add_mesh(e.entities,op.fetch('vertices_mm'),op.fetch('triangles'),id,true)
      else
        raise 'OPERATION_UNSUPPORTED'
      end
      result << {'id'=>id,'persistent_id'=>e.persistent_id,'bounds_inches'=>PipClawManagedProject.bounds_signature(e)}
    end
    {'objects'=>result,'units'=>'mm','source'=>'actual SketchUp entities'}
  end
end
