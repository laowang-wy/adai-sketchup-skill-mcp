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
