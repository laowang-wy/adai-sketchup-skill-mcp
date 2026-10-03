# One capture implementation, shipped beside both the bridge and Skill helpers.
# Captures are read-only: restore the persisted camera even when export fails.
module ADAIViewportCapture
  extend self
  def framebuffer?
    configured = ENV['SKETCHUP_EVIDENCE_RENDER_BACKEND'].to_s
    return configured == 'framebuffer' unless configured.empty?
    Sketchup.version.to_i <= 19
  end
  def image_size(view, width, height)
    framebuffer? ? [view.vpwidth.to_i, view.vpheight.to_i] : [width, height]
  end
  def write(view, path, width, height)
    if framebuffer?
      raise 'EVIDENCE_VIEWPORT_TOO_SMALL' if view.vpwidth < 640 || view.vpheight < 480
      view.refresh
      return false unless view.write_image(:filename=>path, :source=>:framebuffer, :compression=>0.9)
      view.refresh
      view.write_image(:filename=>path, :source=>:framebuffer, :compression=>0.9)
    else
      view.write_image(path, width, height, true, 0.9)
    end
  end
  # Surface comparison removes display edges only. Face geometry, materials and
  # smoothing are untouched; structural shots use the user's current settings.
  def with_display(model, style)
    return yield if style == 'current'
    raise 'INVALID_EVIDENCE_DISPLAY' unless style == 'surfaces'
    options=model.rendering_options
    changes={'EdgeDisplayMode'=>0,'DrawSilhouettes'=>false,'DrawHidden'=>false}
    saved={}
    begin
      changes.each do |key,value|
        next unless options.keys.include?(key)
        saved[key]=options[key]; options[key]=value
      end
      yield
    ensure
      saved.each{|key,value|options[key]=value}
      model.active_view.refresh
    end
  end
  def snapshot(view)
    c = view.camera
    {'eye'=>c.eye.to_a, 'target'=>c.target.to_a, 'up'=>c.up.to_a,
      'perspective'=>c.perspective?, 'fov'=>(c.perspective? ? c.fov : nil),
      'height'=>(c.perspective? ? nil : c.height), 'aspect_ratio'=>c.aspect_ratio,
      'fov_is_height'=>(c.fov_is_height? rescue nil),
      'two_point'=>(c.respond_to?(:is_2d?) ? c.is_2d? : false),
      'viewport_pixels'=>[view.vpwidth, view.vpheight]}
  end
  def restore(view, state)
    raise 'TWO_POINT_CAMERA_RESTORE_UNSUPPORTED: retain the original Camera object instead of reconstructing it' if state['two_point'] == true
    camera = view.camera
    camera.set(Geom::Point3d.new(*state['eye']), Geom::Point3d.new(*state['target']), Geom::Vector3d.new(*state['up']))
    camera.perspective = !!state['perspective']
    camera.aspect_ratio = state['aspect_ratio'].to_f if state.key?('aspect_ratio') && camera.respond_to?(:aspect_ratio=)
    camera.fov = state['fov'].to_f if state['perspective'] && state['fov']
    camera.height = state['height'].to_f if !state['perspective'] && state['height'] && camera.respond_to?(:height=)
    view.invalidate
    view.refresh
  end
  # Fit the eight drawable-bound corners in camera space, using the real image
  # aspect and the camera's FOV convention. This does not evaluate architecture.
  def fitted_state(view, bounds, offset, up, perspective, width=1600, height=1200)
    raise 'NO_DRAWABLE_GEOMETRY' unless bounds.valid?
    pixels = image_size(view, width, height)
    aspect = pixels[0].to_f / [pixels[1], 1].max
    direction = Geom::Vector3d.new(*offset); direction.length = 1.0
    camera = Sketchup::Camera.new(bounds.center + direction, bounds.center, up, perspective)
    camera.aspect_ratio = aspect
    camera.fov = 40.0 if perspective
    z = direction.to_a
    u = up.to_a
    x = [u[1]*z[2]-u[2]*z[1], u[2]*z[0]-u[0]*z[2], u[0]*z[1]-u[1]*z[0]]
    length = Math.sqrt(x.inject(0.0){|n,v|n+v*v})
    raise 'CAMERA_UP_PARALLEL_TO_DIRECTION' if length < 1.0e-9
    x = x.map{|v|v/length}
    y = [z[1]*x[2]-z[2]*x[1], z[2]*x[0]-z[0]*x[2], z[0]*x[1]-z[1]*x[0]]
    points = 8.times.map do |i|
      p = (bounds.corner(i)-bounds.center).to_a
      [x,y,z].map{|axis|3.times.inject(0.0){|n,k|n+p[k]*axis[k]}}
    end
    margin = 1.12
    if perspective
      tangent = Math.tan(camera.fov*Math::PI/360.0)
      ty = camera.fov_is_height? ? tangent : tangent/aspect
      tx = ty*aspect
      distance = points.map{|a,b,c|c+margin*[a.abs/tx,b.abs/ty].max}.max
    else
      camera.height = [points.map{|p|p[1].abs*2}.max, points.map{|p|p[0].abs*2/aspect}.max, 0.01].max*margin
      distance = bounds.diagonal*2
    end
    direction.length = [distance, bounds.diagonal*0.01, 1.0].max
    camera.set(bounds.center+direction, bounds.center, up)
    {'eye'=>camera.eye.to_a, 'target'=>camera.target.to_a, 'up'=>camera.up.to_a,
      'perspective'=>perspective, 'aspect_ratio'=>aspect,
      'fov'=>(perspective ? camera.fov : nil), 'height'=>(perspective ? nil : camera.height)}
  end

  # Preserve a usable chosen delivery view. Only a clipped/off-screen/tiny
  # whole-model view needs an automatic overview; two-point views stay native.
  def overview_needed?(view, bounds)
    return false if snapshot(view)['two_point']
    camera = view.camera; forward = camera.target-camera.eye
    corners = 8.times.map{|i|bounds.corner(i)}
    if camera.perspective?
      return true if corners.any?{|p|v=p-camera.eye; v.x*forward.x+v.y*forward.y+v.z*forward.z <= 0}
    end
    pixels = corners.map{|p|view.screen_coords(p)}
    xs=pixels.map{|p|p.x/view.vpwidth.to_f}; ys=pixels.map{|p|p.y/view.vpheight.to_f}
    xs.min < 0.01 || xs.max > 0.99 || ys.min < 0.01 || ys.max > 0.99 ||
      [xs.max-xs.min,ys.max-ys.min].max < 0.35
  end

  def with_saved_camera(view)
    state = snapshot(view)
    # Fail before navigation when this camera cannot be restored faithfully.
    raise 'TWO_POINT_CAMERA_RESTORE_UNSUPPORTED' if state['two_point']
    begin
      yield
    ensure
      restore(view, state)
    end
  end
end
