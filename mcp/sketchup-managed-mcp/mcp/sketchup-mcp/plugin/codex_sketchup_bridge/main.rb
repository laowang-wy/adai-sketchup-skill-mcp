require 'sketchup.rb'
require 'socket'
require 'json'
require 'stringio'
require 'timeout'
require 'time'
require 'fileutils'
require 'securerandom'
require 'fiddle'

module CodexSketchUpBridge
  HOST = (ENV['SKETCHUP_BRIDGE_HOST'] || '127.0.0.1').to_s
  PORT = Integer((ENV['SKETCHUP_BRIDGE_PORT'] || '9876')) rescue 9876
  DEFAULT_TIMEOUT_MS = 30_000
  APP_DATA_DIR = ENV['APPDATA'] || File.join(ENV['USERPROFILE'], 'AppData', 'Roaming')
  WORKSPACE_DIR = File.join(APP_DATA_DIR, 'SketchUpLiveMCP').tr('\\', '/')
  TOKEN_PATH = ENV['SKETCHUP_BRIDGE_TOKEN_FILE'] || File.join(WORKSPACE_DIR, 'bridge.token')
  TOKEN = begin
    value = ENV['SKETCHUP_BRIDGE_TOKEN'].to_s.strip
    if value.empty?
      FileUtils.mkdir_p(File.dirname(TOKEN_PATH))
      begin
        File.open(TOKEN_PATH, File::WRONLY | File::CREAT | File::EXCL, 0600) { |f| f.write(SecureRandom.hex(32)) }
      rescue Errno::EEXIST
        # Each machine owns its token; never ship or overwrite one.
      end
      value = File.read(TOKEN_PATH).strip
    end
    raise 'Empty bridge token' if value.empty?
    value
  end
  LOG_PATH = File.join(WORKSPACE_DIR, 'bridge.log')
  BRIDGE_DIR = (ENV['SKETCHUP_BRIDGE_DIR'] || File.join(WORKSPACE_DIR, 'bridge')).tr('\\', '/')
  SESSION_ID = SecureRandom.hex(16)
  INSTANCE_DIR = File.join(BRIDGE_DIR, 'processes', Process.pid.to_s, SESSION_ID)
  REQUESTS_DIR = File.join(INSTANCE_DIR, 'requests')
  RESPONSES_DIR = File.join(INSTANCE_DIR, 'responses')
  REGISTRY_PATH = File.join(BRIDGE_DIR, 'instances', "#{Process.pid}.json")
  MAX_REQUEST_AGE_MS = Integer((ENV['SKETCHUP_BRIDGE_REQUEST_MAX_AGE_MS'] || '120000')) rescue 120000

  class << self
    def log(message)
      File.open(LOG_PATH, 'a') { |f| f.puts("#{Time.now} #{message}") }
    rescue
      nil
    end

    def executable_path
      buffer = "\0" * 65536
      function = Fiddle::Function.new(Fiddle.dlopen('kernel32.dll')['GetModuleFileNameW'],
        [Fiddle::TYPE_VOIDP, Fiddle::TYPE_VOIDP, Fiddle::TYPE_LONG], Fiddle::TYPE_LONG)
      count = function.call(0, buffer, 32768)
      raise 'Cannot identify SketchUp executable' if count == 0 || count >= 32768
      buffer.byteslice(0, count * 2).force_encoding('UTF-16LE').encode('UTF-8')
    end

    def publish_instance
      FileUtils.mkdir_p(File.dirname(REGISTRY_PATH))
      record = {protocol: 'sketchup-file-bridge/v3', process_id: Process.pid,
        session_id: SESSION_ID, executable: executable_path, sketchup_version: Sketchup.version}
      temporary = "#{REGISTRY_PATH}.#{SESSION_ID}.tmp"
      File.write(temporary, JSON.generate(record))
      File.rename(temporary, REGISTRY_PATH)
    end

    def start
      return status if running?

      @jobs ||= Queue.new
      FileUtils.mkdir_p(REQUESTS_DIR)
      FileUtils.mkdir_p(RESPONSES_DIR)
      log("starting file bridge at #{BRIDGE_DIR}; TCP compatibility endpoint=#{HOST}:#{PORT}")
      begin
        @server = TCPServer.new(HOST, PORT)
        @server_thread = Thread.new { accept_loop }
        @server_thread.abort_on_exception = false
      rescue Errno::EADDRINUSE => error
        @server = nil
        @server_thread = nil
        log("TCP compatibility endpoint unavailable; continuing with file bridge: #{error.class}: #{error.message}")
      end
      publish_instance
      @timer_id = UI.start_timer(0.05, true) do
        drain_jobs
        poll_file_requests
      end
      endpoint = @server ? " and http://#{HOST}:#{PORT}" : " (TCP compatibility endpoint unavailable)"
      puts "[CodexSketchUpBridge] file bridge ready at #{BRIDGE_DIR}#{endpoint}"
      log("file bridge ready at #{BRIDGE_DIR}#{endpoint}")
      status
    rescue => e
      puts "[CodexSketchUpBridge] failed to start file bridge: #{e.class}: #{e.message}"
      log("failed to start file bridge #{e.class}: #{e.message}\n#{e.backtrace&.join("\n")}")
      { ok: false, error: "#{e.class}: #{e.message}" }
    end

    def stop
      UI.stop_timer(@timer_id) if @timer_id
      @timer_id = nil
      @server.close if @server && !@server.closed?
      @server = nil
      @server_thread.kill if @server_thread && @server_thread.alive?
      @server_thread = nil
      if File.file?(REGISTRY_PATH)
        record = JSON.parse(File.read(REGISTRY_PATH))
        File.delete(REGISTRY_PATH) if record['session_id'] == SESSION_ID
      end
      { ok: true, running: false }
    rescue => e
      { ok: false, error: "#{e.class}: #{e.message}" }
    end

    def running?
      !@timer_id.nil?
    end

    def status
      model = Sketchup.active_model
      {
        ok: true,
        running: running?,
        tcp_running: !!(@server && !@server.closed? && @server_thread && @server_thread.alive?),
        bridge_mode: @server ? 'tcp+file' : 'file',
        bridge_dir: BRIDGE_DIR,
        tcp_host: HOST,
        tcp_port: PORT,
        process_id: Process.pid,
        session_id: SESSION_ID,
        executable: executable_path,
        protocol: 'sketchup-file-bridge/v3',
        sketchup_version: Sketchup.version,
        ruby_version: RUBY_VERSION,
        model_path: model.path,
        title: model.title
      }
    end

    def accept_loop
      loop do
        client = @server.accept
        Thread.new(client) { |socket| handle_client(socket) }
      rescue IOError, Errno::EBADF
        break
      rescue => e
        puts "[CodexSketchUpBridge] accept error: #{e.class}: #{e.message}"
      end
    end

    def poll_file_requests
      Dir.glob(File.join(REQUESTS_DIR, '*.json')).sort.each do |request_path|
        payload = JSON.parse(File.read(request_path))
        id = payload['id'].to_s
        created_at = begin
          Time.parse(payload['created_at'].to_s)
        rescue
          File.mtime(request_path)
        end
        timeout_ms = payload['timeout_ms'].to_i
        allowed_age_ms = [MAX_REQUEST_AGE_MS, timeout_ms + 30_000].max
        age_ms = ((Time.now - created_at) * 1000).to_i
        if age_ms > allowed_age_ms
          quarantine_dir = File.join(BRIDGE_DIR, "expired-requests-#{Time.now.strftime('%Y%m%d')}")
          FileUtils.mkdir_p(quarantine_dir)
          target = File.join(quarantine_dir, "#{File.basename(request_path, '.json')}.stale.json")
          File.rename(request_path, target) rescue nil
          log("quarantined stale request #{id}; age_ms=#{age_ms}; allowed_age_ms=#{allowed_age_ms}")
          next
        end
        claimed_path = request_path + '.processing'
        begin
          File.rename(request_path, claimed_path)
        rescue Errno::ENOENT
          next
        end
        response_path = File.join(RESPONSES_DIR, "#{id}.json")

        result =
          if secure_compare(payload['token'].to_s, TOKEN)
            expires_at = begin
              Time.parse(payload['expires_at'].to_s)
            rescue
              nil
            end
            if expires_at && Time.now > expires_at + 2
              log("dropped expired request #{id}; expires_at=#{payload['expires_at']}")
              { ok: false, error: 'Expired request dropped before execution' }
            else
              dispatch(payload)
            end
          else
            { ok: false, error: 'Unauthorized' }
          end

        envelope = {
          id: id,
          created_at: payload['created_at'],
          protocol: payload['protocol'] || 'sketchup-file-bridge/v1',
          result: result
        }
        temp_path = "#{response_path}.tmp"
        File.write(temp_path, JSON.generate(envelope))
        File.rename(temp_path, response_path)
        File.delete(claimed_path) if File.file?(claimed_path)
      rescue => e
        fallback_id = begin
          payload && payload['id'].to_s
        rescue
          File.basename(request_path, '.json')
        end
        response_path = File.join(RESPONSES_DIR, "#{fallback_id}.json")
        File.write(response_path, JSON.generate({
          ok: false,
          error: "#{e.class}: #{e.message}",
          backtrace: e.backtrace
        }))
        File.delete(request_path) rescue nil
        File.delete(claimed_path) if claimed_path && File.file?(claimed_path)
      end
    end

    def handle_client(socket)
      request = read_http_request(socket)
      unless request
        write_http(socket, 400, { ok: false, error: 'Bad request' })
        return
      end

      if request[:method] == 'GET' && request[:path] == '/health'
        write_http(socket, 200, status)
        return
      end

      unless request[:method] == 'POST' && request[:path] == '/command'
        write_http(socket, 404, { ok: false, error: 'Not found' })
        return
      end

      unless secure_compare(request[:headers]['x-codex-sketchup-token'], TOKEN)
        write_http(socket, 401, { ok: false, error: 'Unauthorized' })
        return
      end

      payload = JSON.parse(request[:body].to_s)
      timeout_ms = positive_number(payload['timeout_ms'], DEFAULT_TIMEOUT_MS)
      result = run_on_main_thread(payload, timeout_ms)
      status_code = result[:ok] ? 200 : 500
      write_http(socket, status_code, result)
    rescue JSON::ParserError => e
      write_http(socket, 400, { ok: false, error: "Invalid JSON: #{e.message}" })
    rescue => e
      write_http(socket, 500, { ok: false, error: "#{e.class}: #{e.message}", backtrace: e.backtrace })
    ensure
      socket.close rescue nil
    end

    def read_http_request(socket)
      raw = ''.b
      until raw.include?("\r\n\r\n")
        raw << socket.readpartial(4096)
      end

      head, body = raw.split("\r\n\r\n", 2)
      lines = head.split("\r\n")
      method, path, = lines.shift.to_s.split(' ')
      headers = {}
      lines.each do |line|
        key, value = line.split(':', 2)
        headers[key.downcase] = value.to_s.strip if key
      end

      content_length = headers.fetch('content-length', '0').to_i
      while body.bytesize < content_length
        body << socket.readpartial(content_length - body.bytesize)
      end

      {
        method: method,
        path: path,
        headers: headers,
        body: body.byteslice(0, content_length)
      }
    rescue EOFError
      nil
    end

    def write_http(socket, status_code, payload)
      body = JSON.generate(payload)
      reason = {
        200 => 'OK',
        400 => 'Bad Request',
        401 => 'Unauthorized',
        404 => 'Not Found',
        500 => 'Internal Server Error'
      }[status_code] || 'OK'

      socket.write "HTTP/1.1 #{status_code} #{reason}\r\n"
      socket.write "Content-Type: application/json; charset=utf-8\r\n"
      socket.write "Content-Length: #{body.bytesize}\r\n"
      socket.write "Connection: close\r\n"
      socket.write "\r\n"
      socket.write body
    end

    def secure_compare(left, right)
      return false unless left && right
      return false unless left.bytesize == right.bytesize

      diff = 0
      left.bytes.zip(right.bytes) { |a, b| diff |= a ^ b }
      diff.zero?
    end

    def run_on_main_thread(payload, timeout_ms)
      response_queue = Queue.new
      @jobs << [payload, response_queue]
      Timeout.timeout(timeout_ms / 1000.0) { response_queue.pop }
    rescue Timeout::Error
      { ok: false, error: "Timed out after #{timeout_ms}ms waiting for SketchUp main thread" }
    end

    def drain_jobs
      processed = 0
      while @jobs && !@jobs.empty? && processed < 20
        payload, response_queue = @jobs.pop(true)
        response_queue << dispatch(payload)
        processed += 1
      end
    rescue ThreadError
      nil
    rescue => e
      response_queue << { ok: false, error: "#{e.class}: #{e.message}", backtrace: e.backtrace } if response_queue
    end

    def dispatch(payload)
      if payload['target_process_id'].to_i != Process.pid || payload['target_session_id'] != SESSION_ID
        return {ok: false, error: 'INSTANCE_MISMATCH: select this process and session before executing'}
      end
      command = payload['command'].to_s
      args = payload['args'] || {}

      case command
      when 'ping'
        status
      when 'run_ruby'
        run_ruby(args['code'].to_s, args['file'])
      when 'create_box'
        create_box(args)
      when 'get_model_summary'
        get_model_summary
      when 'clear_model'
        clear_model
      when 'save_model'
        save_model(args)
      when 'open_model'
        open_model(args)
      when 'loft_sections'
        loft_sections(args)
      when 'sweep_profile_path'
        sweep_profile_path(args)
      when 'surface_grid'
        surface_grid(args)
      when 'shell_grid'
        shell_grid(args)
      when 'transform_entities'
        transform_entities(args)
      when 'create_beam_oriented'
        create_beam_oriented(args)
      when 'create_column_grid'
        create_column_grid(args)
      when 'array_on_path'
        array_on_path(args)
      when 'create_curved_eave'
        create_curved_eave(args)
      when 'create_tile_course'
        create_tile_course(args)
      when 'export_validation_views'
        export_validation_views(args)
      when 'create_bracket_unit'
        create_bracket_unit(args)
      when 'create_roof_frame'
        create_roof_frame(args)
      when 'create_ridge_system'
        create_ridge_system(args)
      when 'radial_instance_array'
        radial_instance_array(args)
      when 'radial_shell_array'
        radial_shell_array(args)
      else
        { ok: false, error: "Unknown command: #{command}" }
      end
    rescue => e
      { ok: false, error: "#{e.class}: #{e.message}", backtrace: e.backtrace }
    end

    def run_ruby(code, file = nil)
      return { ok: false, error: 'Ruby code is empty' } if code.strip.empty?

      old_stdout = $stdout
      old_stderr = $stderr
      stdout = StringIO.new
      stderr = StringIO.new
      $stdout = stdout
      $stderr = stderr

      result = eval(code, TOPLEVEL_BINDING, file || 'sketchup_mcp_bridge_eval', 1)

      {
        ok: true,
        result_class: result.class.name,
        result_inspect: safe_inspect(result),
        stdout: stdout.string,
        stderr: stderr.string
      }
    rescue Exception => e
      {
        ok: false,
        error: "#{e.class}: #{e.message}",
        backtrace: e.backtrace,
        stdout: stdout ? stdout.string : '',
        stderr: stderr ? stderr.string : ''
      }
    ensure
      $stdout = old_stdout
      $stderr = old_stderr
    end

    def create_box(args)
      width = positive_number(args['width_mm'], nil)
      depth = positive_number(args['depth_mm'], nil)
      height = positive_number(args['height_mm'], nil)
      return { ok: false, error: 'width_mm, depth_mm, and height_mm must be positive numbers' } unless width && depth && height

      origin = args['origin_mm'].is_a?(Array) ? args['origin_mm'] : [0, 0, 0]
      x = number(origin[0], 0).mm
      y = number(origin[1], 0).mm
      z = number(origin[2], 0).mm

      model = Sketchup.active_model
      model.start_operation('SketchUp MCP Create Box', true)
      group = model.active_entities.add_group
      group.name = args['name'].to_s unless args['name'].to_s.empty?

      points = [
        Geom::Point3d.new(x, y, z),
        Geom::Point3d.new(x + width.mm, y, z),
        Geom::Point3d.new(x + width.mm, y + depth.mm, z),
        Geom::Point3d.new(x, y + depth.mm, z)
      ]
      face = group.entities.add_face(points)
      face.reverse! if face.normal.z < 0
      face.pushpull(height.mm)

      if args['material'] && !args['material'].to_s.empty?
        material = model.materials[args['material'].to_s] || model.materials.add(args['material'].to_s)
        group.material = material
      end

      model.commit_operation
      {
        ok: true,
        entity_id: group.entityID,
        persistent_id: group.persistent_id,
        name: group.name,
        dimensions_mm: [width, depth, height]
      }
    rescue => e
      model.abort_operation if model
      { ok: false, error: "#{e.class}: #{e.message}", backtrace: e.backtrace }
    end

    def point_mm(value)
      arr = value.is_a?(Array) ? value : [0, 0, 0]
      Geom::Point3d.new(number(arr[0], 0).mm, number(arr[1], 0).mm, number(arr[2], 0).mm)
    end

    def offset_point(point, vector, distance_mm)
      v = vector.clone
      v.length = number(distance_mm, 0).mm
      point.offset(v)
    end

    def material_for(model, name)
      return nil if name.to_s.empty?
      model.materials[name.to_s] || model.materials.add(name.to_s)
    end

    def add_mesh_group(model, name, vertices, faces, material_name = '')
      group = model.active_entities.add_group
      group.name = name.to_s unless name.to_s.empty?
      entities = group.entities
      added_faces = 0
      faces.each do |face_indices|
        begin
          pts = face_indices.map { |i| vertices[i] }
          if pts.length >= 3
            a = pts[1] - pts[0]
            b = pts[2] - pts[0]
            if a.cross(b).length > 0.001
              entities.add_face(pts)
              added_faces += 1
            end
          end
        rescue
          next
        end
      end
      material = material_for(model, material_name)
      group.material = material if material
      group
    end

    def loft_sections(args)
      sections = args['sections']
      return { ok: false, error: 'sections must contain at least two point arrays' } unless sections.is_a?(Array) && sections.length >= 2
      counts = sections.map { |section| section.is_a?(Array) ? section.length : 0 }
      return { ok: false, error: 'all sections must have the same point count (minimum 3)' } if counts.any? { |n| n < 3 || n != counts[0] }
      vertices = sections.flatten.map { |p| point_mm(p) }
      n = counts[0]
      faces = []
      (0...(sections.length - 1)).each do |j|
        n.times do |i|
          a = j * n + i
          b = j * n + ((i + 1) % n)
          c = (j + 1) * n + ((i + 1) % n)
          d = (j + 1) * n + i
          faces << [a, b, c] << [a, c, d]
        end
      end
      if args['cap']
        faces << (0...n).to_a.reverse
        last = (sections.length - 1) * n
        faces << (0...n).map { |i| last + i }
      end
      model = Sketchup.active_model
      model.start_operation('SketchUp MCP Loft Sections', true)
      group = add_mesh_group(model, args['name'] || 'LoftSections', vertices, faces, args['material'])
      result = { ok: true, entity_id: group.entityID, persistent_id: group.persistent_id, name: group.name.to_s, section_count: sections.length, points_per_section: n, face_count: faces.length }
      model.commit_operation
      result
    rescue => e
      model.abort_operation if model
      { ok: false, error: "#{e.class}: #{e.message}", backtrace: e.backtrace }
    end

    def sweep_profile_path(args)
      profile = args['profile']
      path = args['path']
      return { ok: false, error: 'profile and path are required' } unless profile.is_a?(Array) && profile.length >= 3 && path.is_a?(Array) && path.length >= 2
      p0 = point_mm(path[0]); p1 = point_mm(path[1]); tangent = p1 - p0
      up = Geom::Vector3d.new(0, 0, 1)
      side = tangent.cross(up)
      side = Geom::Vector3d.new(1, 0, 0) if side.length < 0.001
      side.normalize!; normal = side.cross(tangent); normal.normalize!
      vertices = []
      path.each_with_index do |raw, j|
        center = point_mm(raw)
        if j > 0
          tangent = center - point_mm(path[j - 1])
          tangent.normalize!
          side = tangent.cross(up)
          side = Geom::Vector3d.new(1, 0, 0) if side.length < 0.001
          side.normalize!
          normal = side.cross(tangent); normal.normalize!
        end
        profile.each do |raw_profile|
          q = raw_profile.is_a?(Array) ? raw_profile : [0, 0]
          vertices << offset_point(offset_point(center, side, number(q[0], 0)), normal, number(q[1], 0))
        end
      end
      n = profile.length; faces = []
      (0...(path.length - 1)).each do |j|
        n.times do |i|
          a = j*n+i; b = j*n+((i+1)%n); c = (j+1)*n+((i+1)%n); d = (j+1)*n+i
          faces << [a,b,c] << [a,c,d]
        end
      end
      faces << (0...n).to_a.reverse << ((0...n).map { |i| (path.length-1)*n+i }) if args['cap']
      model = Sketchup.active_model
      model.start_operation('SketchUp MCP Sweep Profile Path', true)
      group = add_mesh_group(model, args['name'] || 'SweepProfilePath', vertices, faces, args['material'])
      model.commit_operation
      { ok: true, entity_id: group.entityID, persistent_id: group.persistent_id, name: group.name, path_count: path.length, profile_count: n, face_count: faces.length }
    rescue => e
      model.abort_operation if model
      { ok: false, error: "#{e.class}: #{e.message}", backtrace: e.backtrace }
    end

    def surface_grid(args)
      grid = args['grid']; return { ok: false, error: 'grid must be a non-empty rectangular point grid' } unless grid.is_a?(Array) && grid.length >= 2
      cols = grid[0].is_a?(Array) ? grid[0].length : 0
      return { ok: false, error: 'grid must have at least 2 rows and 2 columns' } if cols < 2 || grid.any? { |row| !row.is_a?(Array) || row.length != cols }
      vertices = grid.flatten.map { |p| point_mm(p) }; rows = grid.length; faces = []
      (0...(rows-1)).each do |r|
        (0...(cols-1)).each do |c|
          a=r*cols+c; b=a+1; d=(r+1)*cols+c; e=d+1
          faces << [a,b,e] << [a,e,d]
        end
      end
      model = Sketchup.active_model; model.start_operation('SketchUp MCP Surface Grid', true)
      group = add_mesh_group(model, args['name'] || 'SurfaceGrid', vertices, faces, args['material'])
      result = { ok: true, entity_id: group.entityID, persistent_id: group.persistent_id, name: group.name.to_s, rows: rows, columns: cols, face_count: faces.length }
      model.commit_operation
      result
    rescue => e
      model.abort_operation if model; { ok: false, error: "#{e.class}: #{e.message}", backtrace: e.backtrace }
    end

    def shell_grid(args)
      grid = args['grid']
      thickness = positive_number(args['thickness_mm'], nil)
      return { ok: false, error: 'grid must be rectangular and thickness_mm must be positive' } unless grid.is_a?(Array) && grid.length >= 2 && thickness
      cols = grid[0].is_a?(Array) ? grid[0].length : 0
      return { ok: false, error: 'grid must have at least 2 rows and 2 columns' } if cols < 2 || grid.any? { |row| !row.is_a?(Array) || row.length != cols }
      top = grid.flatten.map { |p| point_mm(p) }
      rows = grid.length
      bottom = top.map { |p| p.offset(Geom::Vector3d.new(0, 0, -thickness.mm)) }
      vertices = top + bottom
      faces = []
      openings = (args['openings'].is_a?(Array) ? args['openings'] : []).map { |cell| [cell[0].to_i, cell[1].to_i] }
      (0...(rows - 1)).each do |r|
        (0...(cols - 1)).each do |c|
          next if openings.include?([r, c])
          a = r * cols + c; b = a + 1; d = (r + 1) * cols + c; e = d + 1
          faces << [a, b, e] << [a, e, d]
          faces << [bottom.length + e, bottom.length + b, bottom.length + a]
          faces << [bottom.length + d, bottom.length + e, bottom.length + a]
        end
      end
      openings.each do |cell|
        r, c = cell
        next if r < 0 || c < 0 || r >= rows - 1 || c >= cols - 1
        a = r * cols + c; b = a + 1; d = (r + 1) * cols + c; e = d + 1
        unless openings.include?([r - 1, c])
          faces << [a, bottom.length + a, bottom.length + b] << [a, bottom.length + b, b]
        end
        unless openings.include?([r, c + 1])
          faces << [b, bottom.length + b, bottom.length + e] << [b, bottom.length + e, e]
        end
        unless openings.include?([r + 1, c])
          faces << [e, bottom.length + e, bottom.length + d] << [e, bottom.length + d, d]
        end
        unless openings.include?([r, c - 1])
          faces << [d, bottom.length + d, bottom.length + a] << [d, bottom.length + a, a]
        end
      end
      (0...(cols - 1)).each do |c|
        faces << [c, bottom.length + c, bottom.length + c + 1] << [c, bottom.length + c + 1, c + 1]
        a = (rows - 1) * cols + c; b = a + 1
        faces << [bottom.length + a, a, b] << [bottom.length + a, b, bottom.length + b]
      end
      (0...(rows - 1)).each do |r|
        a = r * cols; b = (r + 1) * cols
        faces << [bottom.length + b, b, a] << [bottom.length + b, a, bottom.length + a]
        a = r * cols + cols - 1; b = (r + 1) * cols + cols - 1
        faces << [a, b, bottom.length + b] << [a, bottom.length + b, bottom.length + a]
      end
      model = Sketchup.active_model
      model.start_operation('SketchUp MCP Shell Grid', true)
      group = add_mesh_group(model, args['name'] || 'ShellGrid', vertices, faces, args['material'])
      result = { ok: true, entity_id: group.entityID, persistent_id: group.persistent_id, name: group.name.to_s, rows: rows, columns: cols, thickness_mm: thickness, openings: openings, opening_count: openings.length, face_count: faces.length }
      model.commit_operation
      result
    rescue => e
      model.abort_operation if model
      { ok: false, error: "#{e.class}: #{e.message}", backtrace: e.backtrace }
    end
    def create_beam_oriented(args)
      start_pt = point_mm(args['start_mm'])
      end_pt = point_mm(args['end_mm'])
      section = args['section_mm'].is_a?(Array) ? args['section_mm'] : []
      width = positive_number(section[0], nil)
      depth = positive_number(section[1], nil)
      direction = end_pt - start_pt
      return { ok: false, error: 'endpoints must be distinct and section_mm must contain positive width/depth' } unless direction.length > 0.001 && width && depth
      direction.normalize!
      up = Z_AXIS.clone
      side = direction.cross(up)
      side = X_AXIS.clone if side.length < 0.001
      side.normalize!
      normal = side.cross(direction)
      normal.normalize!
      hw = width.mm * 0.5
      hd = depth.mm * 0.5
      vertices = [
        start_pt.offset(side, hw).offset(normal, hd), start_pt.offset(side, -hw).offset(normal, hd),
        start_pt.offset(side, -hw).offset(normal, -hd), start_pt.offset(side, hw).offset(normal, -hd),
        end_pt.offset(side, hw).offset(normal, hd), end_pt.offset(side, -hw).offset(normal, hd),
        end_pt.offset(side, -hw).offset(normal, -hd), end_pt.offset(side, hw).offset(normal, -hd)
      ]
      faces = [[0, 1, 2], [0, 2, 3], [4, 6, 5], [4, 7, 6], [0, 4, 5], [0, 5, 1], [1, 5, 6], [1, 6, 2], [2, 6, 7], [2, 7, 3], [3, 7, 4], [3, 4, 0]]
      model = Sketchup.active_model
      model.start_operation('SketchUp MCP Oriented Beam', true)
      group = add_mesh_group(model, args['name'] || 'OrientedBeam', vertices, faces, args['material'])
      model.commit_operation
      { ok: true, entity_id: group.entityID, persistent_id: group.persistent_id, name: group.name.to_s, face_count: faces.length, direction_mm: [direction.x, direction.y, direction.z] }
    rescue => e
      model.abort_operation if model
      { ok: false, error: "#{e.class}: #{e.message}", backtrace: e.backtrace }
    end

    def create_column_grid(args)
      bx = args['bays_x'].to_i
      by = args['bays_y'].to_i
      sx = positive_number(args['spacing_x_mm'], nil)
      sy = positive_number(args['spacing_y_mm'], nil)
      h = positive_number(args['height_mm'], nil)
      section = args['section_mm'].is_a?(Array) ? args['section_mm'] : []
      w = positive_number(section[0], nil)
      d = positive_number(section[1], nil)
      return { ok: false, error: 'bay counts, spacing, height and section must be positive' } unless bx > 0 && by > 0 && sx && sy && h && w && d
      origin = point_mm(args['origin_mm'] || [0, 0, 0])
      model = Sketchup.active_model
      model.start_operation('SketchUp MCP Ancient Column Grid', true)
      parent = model.active_entities.add_group
      parent.name = args['name'] || 'AncientColumnGrid'
      count = 0
      (0..bx).each do |ix|
        (0..by).each do |iy|
          center = Geom::Point3d.new(origin.x + ix * sx.mm, origin.y + iy * sy.mm, origin.z)
          pts = [
            center.offset(X_AXIS, -w.mm * 0.5).offset(Y_AXIS, -d.mm * 0.5), center.offset(X_AXIS, w.mm * 0.5).offset(Y_AXIS, -d.mm * 0.5),
            center.offset(X_AXIS, w.mm * 0.5).offset(Y_AXIS, d.mm * 0.5), center.offset(X_AXIS, -w.mm * 0.5).offset(Y_AXIS, d.mm * 0.5)
          ]
          face = parent.entities.add_face(pts)
          face.pushpull(h.mm) if face
          count += 1 if face
        end
      end
      model.commit_operation
      { ok: true, entity_id: parent.entityID, persistent_id: parent.persistent_id, name: parent.name.to_s, column_count: count, bay_counts: [bx, by], spacing_mm: [sx, sy], height_mm: h }
    rescue => e
      model.abort_operation if model
      { ok: false, error: "#{e.class}: #{e.message}", backtrace: e.backtrace }
    end

    def array_on_path(args)
      source_id = args['source_persistent_id'].to_i
      raw_path = args['path_mm']
      return { ok: false, error: 'source_persistent_id and at least two path points are required' } unless source_id > 0 && raw_path.is_a?(Array) && raw_path.length >= 2
      model = Sketchup.active_model
      source = model.find_entity_by_persistent_id(source_id)
      return { ok: false, error: 'source entity not found' } unless source && source.respond_to?(:to_component)
      definition = source.to_component.definition
      points = raw_path.map { |p| point_mm(p) }
      instances = []
      points.each_with_index do |point, i|
        tangent = i == 0 ? points[1] - points[0] : (i == points.length - 1 ? points[-1] - points[-2] : points[i + 1] - points[i - 1])
        tangent.normalize!
        angle = Math.atan2(tangent.y, tangent.x)
        tr = Geom::Transformation.translation(point)
        tr = tr * Geom::Transformation.rotation(ORIGIN, Z_AXIS, angle) if args.fetch('rotate_to_tangent', true)
        instance = model.active_entities.add_instance(definition, tr)
        instance.name = "#{args['name_prefix'] || 'PathInstance'}_#{i + 1}"
        instances << instance
      end
      { ok: true, source_persistent_id: source_id, instance_count: instances.length, instance_persistent_ids: instances.map { |x| x.persistent_id } }
    rescue => e
      { ok: false, error: "#{e.class}: #{e.message}", backtrace: e.backtrace }
    end

    def create_curved_eave(args)
      sections = args['sections']
      return { ok: false, error: 'sections must contain at least two equal-point-count sections' } unless sections.is_a?(Array) && sections.length >= 2
      counts = sections.map { |s| s.is_a?(Array) ? s.length : 0 }
      return { ok: false, error: 'all sections require the same point count of at least 3' } if counts.any? { |n| n < 3 || n != counts[0] }
      vertices = sections.flatten.map { |p| point_mm(p) }
      n = counts[0]
      faces = []
      (0...(sections.length - 1)).each do |j|
        n.times do |i|
          a = j * n + i; b = j * n + ((i + 1) % n); c = (j + 1) * n + ((i + 1) % n); d = (j + 1) * n + i
          faces << [a, b, c] << [a, c, d]
        end
      end
      if args['cap']
        faces << (0...n).to_a.reverse
        last = (sections.length - 1) * n
        faces << (0...n).map { |i| last + i }
      end
      model = Sketchup.active_model
      model.start_operation('SketchUp MCP Curved Eave', true)
      group = add_mesh_group(model, args['name'] || 'CurvedEave', vertices, faces, args['material'])
      entity_id = group.entityID
      persistent_id = group.persistent_id
      group_name = group.name.to_s
      model.commit_operation
      { ok: true, entity_id: entity_id, persistent_id: persistent_id, name: group_name, section_count: sections.length, points_per_section: n, face_count: faces.length }
    rescue => e
      model.abort_operation if model
      { ok: false, error: "#{e.class}: #{e.message}", backtrace: e.backtrace }
    end

    def create_tile_course(args)
      profile = args['profile']; path = args['path']; count = args['course_count'].to_i; spacing = positive_number(args['course_spacing_mm'], nil)
      return { ok: false, error: 'profile, path, positive course_count and course_spacing_mm are required' } unless profile.is_a?(Array) && profile.length >= 3 && path.is_a?(Array) && path.length >= 2 && count > 0 && spacing
      model = Sketchup.active_model
      model.start_operation('SketchUp MCP Tile Course', true)
      parent = model.active_entities.add_group
      parent.name = args['name'] || 'TileCourse'
      parent_entity_id = parent.entityID
      parent_persistent_id = parent.persistent_id
      parent_name = parent.name.to_s
      n = profile.length
      count.times do |course|
        offset = course * spacing
        centers = path.map { |p| point_mm(p).offset(Z_AXIS, offset.mm) }
        vertices = []
        centers.each_with_index do |center, j|
          tangent = j == 0 ? centers[1] - centers[0] : (j == centers.length - 1 ? centers[-1] - centers[-2] : centers[j + 1] - centers[j - 1])
          tangent.normalize!
          side = tangent.cross(Z_AXIS); side = X_AXIS.clone if side.length < 0.001; side.normalize!
          normal = side.cross(tangent); normal.normalize!
          profile.each do |q|
            q = q.is_a?(Array) ? q : [0, 0]
            vertices << center.offset(side, number(q[0], 0).mm).offset(normal, number(q[1], 0).mm)
          end
        end
        faces = []
        (0...(centers.length - 1)).each do |j|
          n.times do |i|
            a = j * n + i; b = j * n + ((i + 1) % n); c = (j + 1) * n + ((i + 1) % n); d = (j + 1) * n + i
            faces << [a, b, c] << [a, c, d]
          end
        end
        group = add_mesh_group(model, "#{parent.name}_#{course + 1}", vertices, faces, args['material'])
        component = group.to_component
        parent.entities.add_instance(component.definition, IDENTITY)
      end
      path_count = path.length
      model.commit_operation
      { ok: true, entity_id: parent_entity_id, persistent_id: parent_persistent_id, name: parent_name, course_count: count, path_count: path_count }
    rescue => e
      model.abort_operation if model
      { ok: false, error: "#{e.class}: #{e.message}", backtrace: e.backtrace }
    end

    def export_validation_views(args)
      directory = args['directory'].to_s
      prefix = args['prefix'].to_s
      return { ok: false, error: 'directory and prefix are required' } if directory.empty? || prefix.empty?
      FileUtils.mkdir_p(directory)
      model = Sketchup.active_model
      view = model.active_view
      center = point_mm(args['center_mm'] || [0, 0, 0])
      size = positive_number(args['size_mm'], 12_000) || 12_000
      width = (args['width'] || 1200).to_i; height = (args['height'] || 900).to_i
      cameras = {
        'perspective' => Sketchup::Camera.new(center.offset(Geom::Vector3d.new(1, -1, 0.8), size.mm * 2.3), center, Z_AXIS, true),
        'plan' => Sketchup::Camera.new(center.offset(Geom::Vector3d.new(0, 0, 1), size.mm * 2.0), center, Y_AXIS, false),
        'front' => Sketchup::Camera.new(center.offset(Geom::Vector3d.new(0, -1, 0.15), size.mm * 1.8), center, Z_AXIS, false),
        'side' => Sketchup::Camera.new(center.offset(Geom::Vector3d.new(1, 0, 0.15), size.mm * 1.8), center, Z_AXIS, false),
        'underside' => Sketchup::Camera.new(center.offset(Geom::Vector3d.new(0.6, -0.8, -0.5), size.mm * 1.8), center, Z_AXIS, true)
      }
      outputs = []
      cameras.each do |name, camera|
        view.camera = camera
        view.refresh
        path = File.join(directory, "#{prefix}-#{name}.png")
        view.write_image(path, width, height, true, 0)
        outputs << path
      end
      { ok: true, outputs: outputs }
    rescue => e
      { ok: false, error: "#{e.class}: #{e.message}", backtrace: e.backtrace }
    end

    def create_bracket_unit(args)
      origin = point_mm(args['origin_mm'] || [0, 0, 0])
      span = positive_number(args['span_mm'], nil)
      width = positive_number(args['width_mm'], nil)
      member = positive_number(args['member_mm'], nil)
      level = positive_number(args['level_mm'], nil)
      return { ok: false, error: 'origin, span, width, member and level must be positive/valid' } unless span && width && member && level
      model = Sketchup.active_model
      model.start_operation('SketchUp MCP Single Jump Bracket Unit', true)
      parent = model.active_entities.add_group
      parent.name = args['name'] || 'SingleJumpBracketUnit'
      material = args['material']
      create_local_box = lambda do |name, x0, y0, z0, dx, dy, dz|
        pts = [
          Geom::Point3d.new((origin.x + x0.mm), (origin.y + y0.mm), (origin.z + z0.mm)),
          Geom::Point3d.new((origin.x + (x0 + dx).mm), (origin.y + y0.mm), (origin.z + z0.mm)),
          Geom::Point3d.new((origin.x + (x0 + dx).mm), (origin.y + (y0 + dy).mm), (origin.z + z0.mm)),
          Geom::Point3d.new((origin.x + x0.mm), (origin.y + (y0 + dy).mm), (origin.z + z0.mm))
        ]
        group = parent.entities.add_group
        group.name = name
        f = group.entities.add_face(pts)
        f.pushpull(dz.mm) if f
        group.material = material_for(model, material) if material
        group
      end
      create_local_box.call('ColumnHead', -width * 0.5, -width * 0.5, 0, width, width, member * 0.8)
      create_local_box.call('Root_Dou', -width * 0.42, -width * 0.36, member * 0.8, width * 0.84, width * 0.72, member * 0.72)
      create_local_box.call('Short_HuaGong', -span * 0.15, -width * 0.28, member * 1.52, span * 0.62, width * 0.56, member * 0.46)
      create_local_box.call('Middle_Dou', span * 0.39, -width * 0.36, member * 1.98, width * 0.62, width * 0.72, member * 0.62)
      create_local_box.call('Ang_Nose', span * 0.42, -width * 0.23, member * 2.60, span * 0.42, width * 0.46, member * 0.38)
      create_local_box.call('Eave_Seat', span * 0.77, -width * 0.42, member * 2.98, width * 0.90, width * 0.84, member * 0.44)
      entity_id = parent.entityID; persistent_id = parent.persistent_id; name = parent.name.to_s
      model.commit_operation
      { ok: true, entity_id: entity_id, persistent_id: persistent_id, name: name, member_names: ['ColumnHead', 'Root_Dou', 'Short_HuaGong', 'Middle_Dou', 'Ang_Nose', 'Eave_Seat'], jump_count: 1, contact_datum_mm: [member * 0.8, member * 1.52, member * 1.98, member * 2.60, member * 2.98] }
    rescue => e
      model.abort_operation if model
      { ok: false, error: "#{e.class}: #{e.message}", backtrace: e.backtrace }
    end

    def create_roof_frame(args)
      left = point_mm(args['eave_left_mm']); right = point_mm(args['eave_right_mm']); ridge = point_mm(args['ridge_mm'])
      count = args['rafter_count'].to_i; member = positive_number(args['member_mm'], nil)
      return { ok: false, error: 'eave/ridge points, rafter_count and member_mm are required' } unless count >= 2 && member
      model = Sketchup.active_model
      model.start_operation('SketchUp MCP Ancient Roof Frame', true)
      parent = model.active_entities.add_group
      parent.name = args['name'] || 'AncientRoofFrame'
      (0...count).each do |i|
        t = i / (count - 1).to_f
        eave = Geom::Point3d.linear_combination(1 - t, left, t, right)
        top = Geom::Point3d.linear_combination(0.35, eave, 0.65, ridge)
        direction = top - eave
        direction.normalize!
        side = direction.cross(Z_AXIS); side = X_AXIS.clone if side.length < 0.001; side.normalize!
        normal = side.cross(direction); normal.normalize!
        vertices = [eave.offset(side, member.mm * 0.5).offset(normal, member.mm * 0.5), eave.offset(side, -member.mm * 0.5).offset(normal, member.mm * 0.5), eave.offset(side, -member.mm * 0.5).offset(normal, -member.mm * 0.5), eave.offset(side, member.mm * 0.5).offset(normal, -member.mm * 0.5), top.offset(side, member.mm * 0.5).offset(normal, member.mm * 0.5), top.offset(side, -member.mm * 0.5).offset(normal, member.mm * 0.5), top.offset(side, -member.mm * 0.5).offset(normal, -member.mm * 0.5), top.offset(side, member.mm * 0.5).offset(normal, -member.mm * 0.5)]
        g = add_mesh_group(model, "Rafter_#{i + 1}", vertices, [[0,1,2],[0,2,3],[4,6,5],[4,7,6],[0,4,5],[0,5,1],[1,5,6],[1,6,2],[2,6,7],[2,7,3],[3,7,4],[3,4,0]], args['material'])
        parent.entities.add_instance(g.to_component.definition, IDENTITY)
      end
      entity_id = parent.entityID; persistent_id = parent.persistent_id; name = parent.name.to_s
      model.commit_operation
      { ok: true, entity_id: entity_id, persistent_id: persistent_id, name: name, rafter_count: count, datum: { eave: [left.x, left.y, left.z], ridge: [ridge.x, ridge.y, ridge.z] } }
    rescue => e
      model.abort_operation if model
      { ok: false, error: "#{e.class}: #{e.message}", backtrace: e.backtrace }
    end

    def create_ridge_system(args)
      path = args['path_mm']; profile = args['profile']; count = args['tile_count'].to_i
      return { ok: false, error: 'path, profile and tile_count are required' } unless path.is_a?(Array) && path.length >= 2 && profile.is_a?(Array) && profile.length >= 3 && count > 0
      model = Sketchup.active_model
      model.start_operation('SketchUp MCP Ridge System', true)
      parent = model.active_entities.add_group
      parent.name = args['name'] || 'RidgeSystem'
      points = path.map { |p| point_mm(p) }
      step = (points.length - 1).to_f / count
      count.times do |i|
        a = points[(i * step).floor]
        b = points[[((i + 1) * step).floor, points.length - 1].min]
        b = points[[((i * step).floor + 1), points.length - 1].min] if a == b
        tangent = b - a; tangent.normalize!
        side = tangent.cross(Z_AXIS); side = X_AXIS.clone if side.length < 0.001; side.normalize!
        verts = profile.map do |q|
          q = q.is_a?(Array) ? q : [0, 0]
          a.offset(side, number(q[0], 0).mm).offset(Z_AXIS, number(q[1], 0).mm)
        end
        verts_b = verts.map { |v| v.offset(tangent, [b.distance(a), 1.mm].max) }
        faces = []
        profile.length.times { |j| faces << [j, (j + 1) % profile.length, profile.length + ((j + 1) % profile.length)] << [j, profile.length + ((j + 1) % profile.length), profile.length + j] }
        g = add_mesh_group(model, "RidgeTile_#{i + 1}", verts + verts_b, faces, args['material'])
        parent.entities.add_instance(g.to_component.definition, IDENTITY)
      end
      entity_id = parent.entityID; persistent_id = parent.persistent_id; name = parent.name.to_s
      model.commit_operation
      { ok: true, entity_id: entity_id, persistent_id: persistent_id, name: name, tile_count: count, path_count: path.length }
    rescue => e
      model.abort_operation if model
      { ok: false, error: "#{e.class}: #{e.message}", backtrace: e.backtrace }
    end

    def transform_entities(args)
      ids = args['persistent_ids']; return { ok: false, error: 'persistent_ids must be an array' } unless ids.is_a?(Array) && ids.length > 0
      t = Geom::Transformation.translation(point_mm(args['translation_mm'] || [0,0,0]))
      if args['rotation_deg']
        t = t * Geom::Transformation.rotation(ORIGIN, Z_AXIS, number(args['rotation_deg'], 0).degrees)
      end
      model = Sketchup.active_model; changed = []
      ids.each do |id|
        entity = model.find_entity_by_persistent_id(id.to_i)
        next unless entity && entity.respond_to?(:transform!)
        entity.transform!(t); changed << id.to_i
      end
      { ok: true, transformed: changed, requested: ids.length }
    rescue => e
      { ok: false, error: "#{e.class}: #{e.message}", backtrace: e.backtrace }
    end
    def radial_instance_array(args)
      source_id = args['source_persistent_id'].to_i
      count = args['count'].to_i
      step = number(args['step_deg'], 0)
      center = point_mm(args['center_mm'] || [0, 0, 0])
      return { ok: false, error: 'source_persistent_id and count >= 1 are required' } if source_id <= 0 || count < 1
      model = Sketchup.active_model
      source = model.find_entity_by_persistent_id(source_id)
      if !source
        scan = lambda do |entities|
          entities.each do |entity|
            if entity.respond_to?(:persistent_id) && entity.persistent_id == source_id
              source = entity
              break
            end
            if entity.respond_to?(:entities)
              scan.call(entity.entities)
              break if source
            end
          end
        end
        scan.call(model.entities)
      end
      return { ok: false, error: 'source entity not found' } unless source && source.respond_to?(:to_component)
      definition = source.to_component.definition
      instances = []
      count.times do |i|
        angle = (step * i).degrees
        tr = Geom::Transformation.rotation(center, Z_AXIS, angle)
        instances << model.active_entities.add_instance(definition, tr)
      end
      { ok: true, source_persistent_id: source_id, count: count, step_deg: step, instance_persistent_ids: instances.map { |e| e.persistent_id } }
    rescue => e
      { ok: false, error: "#{e.class}: #{e.message}", backtrace: e.backtrace }
    end
    def radial_shell_array(args)
      grid = args['grid']
      thickness = positive_number(args['thickness_mm'], nil)
      count = args['count'].to_i
      step = number(args['step_deg'], 0)
      base_angle = number(args['base_angle_deg'], 0)
      center = point_mm(args['center_mm'] || [0, 0, 0])
      return { ok: false, error: 'rectangular grid, positive thickness_mm, and count >= 1 are required' } unless grid.is_a?(Array) && grid.length >= 2 && thickness && count >= 1
      cols = grid[0].is_a?(Array) ? grid[0].length : 0
      return { ok: false, error: 'grid must have at least 2 rows and 2 columns' } if cols < 2 || grid.any? { |row| !row.is_a?(Array) || row.length != cols }

      rows = grid.length
      top = grid.flatten.map { |p| point_mm(p) }
      bottom = top.map { |p| p.offset(Geom::Vector3d.new(0, 0, -thickness.mm)) }
      vertices = top + bottom
      openings = (args['openings'].is_a?(Array) ? args['openings'] : []).map { |cell| [cell[0].to_i, cell[1].to_i] }
      faces = []
      (0...(rows - 1)).each do |r|
        (0...(cols - 1)).each do |c|
          next if openings.include?([r, c])
          a = r * cols + c; b = a + 1; d = (r + 1) * cols + c; e = d + 1
          faces << [a, b, e] << [a, e, d]
          faces << [bottom.length + e, bottom.length + b, bottom.length + a]
          faces << [bottom.length + d, bottom.length + e, bottom.length + a]
        end
      end
      openings.each do |r, c|
        next if r < 0 || c < 0 || r >= rows - 1 || c >= cols - 1
        a = r * cols + c; b = a + 1; d = (r + 1) * cols + c; e = d + 1
        faces << [a, bottom.length + a, bottom.length + b] << [a, bottom.length + b, b] unless openings.include?([r - 1, c])
        faces << [b, bottom.length + b, bottom.length + e] << [b, bottom.length + e, e] unless openings.include?([r, c + 1])
        faces << [e, bottom.length + e, bottom.length + d] << [e, bottom.length + d, d] unless openings.include?([r + 1, c])
        faces << [d, bottom.length + d, bottom.length + a] << [d, bottom.length + a, a] unless openings.include?([r, c - 1])
      end
      (0...(cols - 1)).each do |c|
        faces << [c, bottom.length + c, bottom.length + c + 1] << [c, bottom.length + c + 1, c + 1]
        a = (rows - 1) * cols + c; b = a + 1
        faces << [bottom.length + a, a, b] << [bottom.length + a, b, bottom.length + b]
      end
      (0...(rows - 1)).each do |r|
        a = r * cols; b = (r + 1) * cols
        faces << [bottom.length + b, b, a] << [bottom.length + b, a, bottom.length + a]
        a = r * cols + cols - 1; b = (r + 1) * cols + cols - 1
        faces << [a, b, bottom.length + b] << [a, bottom.length + b, bottom.length + a]
      end

      model = Sketchup.active_model
      model.start_operation('SketchUp MCP Radial Shell Array', true)
      definition_name = args['name'].to_s.empty? ? 'RadialShell' : args['name'].to_s
      material = material_for(model, args['material'])
      source_group = model.entities.add_group
      source_group.name = definition_name
      added_faces = 0
      faces.each do |indices|
        pts = indices.map { |i| vertices[i] }
        next if pts.length < 3
        cross = (pts[1] - pts[0]).cross(pts[2] - pts[0])
        next if cross.length < 0.001
        begin
          face = source_group.entities.add_face(pts)
          if face
            face.material = material if material
            face.back_material = material if material
            added_faces += 1
          end
        rescue
          next
        end
      end
      source_group.entities.grep(Sketchup::Edge).each do |edge|
        if edge.faces.length == 2
          angle = edge.faces[0].normal.angle_between(edge.faces[1].normal)
          if angle < 35.degrees
            edge.soft = true
            edge.smooth = true
          end
        end
      end

      raise 'Generated shell group contains no faces' if added_faces == 0
      source_instance = source_group.to_component
      definition = source_instance.definition
      definition.name = "#{definition_name}_#{Time.now.to_i}"
      instances = []
      first_rotation = Geom::Transformation.rotation(center, Z_AXIS, base_angle.degrees)
      source_instance.transform!(first_rotation)
      source_instance.name = "#{definition_name}_1"
      instances << source_instance
      (1...count).each do |i|
        angle = (base_angle + step * i).degrees
        tr = Geom::Transformation.rotation(center, Z_AXIS, angle)
        instance = model.entities.add_instance(definition, tr)
        instance.name = "#{definition_name}_#{i + 1}"
        instances << instance
      end
      result = {
        ok: true,
        definition: definition.name,
        count: count,
        step_deg: step,
        base_angle_deg: base_angle,
        rows: rows,
        columns: cols,
        thickness_mm: thickness,
        opening_count: openings.length,
        requested_face_count: faces.length,
        added_face_count: added_faces,
        instance_persistent_ids: instances.map { |instance| instance.persistent_id }
      }
      model.commit_operation
      result
    rescue => e
      model.abort_operation if model
      { ok: false, error: "#{e.class}: #{e.message}", backtrace: e.backtrace }
    end
    def get_model_summary
      model = Sketchup.active_model
      entities = model.entities
      {
        ok: true,
        title: model.title,
        path: model.path,
        modified: model.modified?,
        counts: {
          entities: entities.length,
          faces: entities.grep(Sketchup::Face).length,
          edges: entities.grep(Sketchup::Edge).length,
          groups: entities.grep(Sketchup::Group).length,
          component_instances: entities.grep(Sketchup::ComponentInstance).length,
          materials: model.materials.length,
          layers: model.layers.length
        },
        selection_count: model.selection.length
      }
    end

    def clear_model
      model = Sketchup.active_model
      model.start_operation('SketchUp MCP Clear Model', true)
      model.entities.erase_entities(model.entities.to_a)
      model.commit_operation
      { ok: true, message: 'Model entities cleared' }
    rescue => e
      model.abort_operation if model
      { ok: false, error: "#{e.class}: #{e.message}", backtrace: e.backtrace }
    end

    def save_model(args)
      model = Sketchup.active_model
      path = args['path'].to_s
      result = path.empty? ? model.save : model.save(path)
      { ok: !!result, path: path.empty? ? model.path : path }
    end

    def open_model(args)
      requested = args['path'].to_s
      absolute = requested.match?(/\A(?:[A-Za-z]:[\\\/]|\\\\)/)
      return {ok: false, error: 'Absolute existing .skp path required'} unless absolute &&
        File.extname(requested).downcase == '.skp' && File.file?(requested)
      normalize = lambda { |value| File.expand_path(value).tr('\\', '/').downcase }
      current = Sketchup.active_model
      if normalize.call(current.path) == normalize.call(requested)
        return {ok: true, already_open: true, path: current.path, process_id: Process.pid}
      end
      if current.modified?
        return {ok: false, error: 'UNSAVED_MODEL: preserve the active document before opening another', active_path: current.path}
      end
      opened = Sketchup.open_file(requested)
      actual = Sketchup.active_model.path
      verified = !!opened && normalize.call(actual) == normalize.call(requested)
      {ok: verified, path: requested, active_model_path: actual, process_id: Process.pid,
        error: verified ? nil : 'OPEN_MODEL_NOT_CONFIRMED'}
    end

    def positive_number(value, fallback)
      parsed = Float(value)
      parsed.positive? ? parsed : fallback
    rescue
      fallback
    end

    def number(value, fallback)
      Float(value)
    rescue
      fallback
    end

    def safe_inspect(value)
      text = value.inspect
      text.length > 10_000 ? "#{text[0, 10_000]}..." : text
    rescue => e
      "#<inspect failed: #{e.class}: #{e.message}>"
    end
  end

  unless defined?(@loaded) && @loaded
    @loaded = true
    menu = UI.menu('Extensions').add_submenu('SketchUp MCP Bridge')
    menu.add_item('Start') { start }
    menu.add_item('Stop') { UI.messagebox(JSON.pretty_generate(stop)) }
    menu.add_item('Status') { UI.messagebox(JSON.pretty_generate(status)) }
    start
  end
end
