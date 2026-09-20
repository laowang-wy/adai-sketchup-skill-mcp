require 'sketchup.rb'
require 'extensions.rb'
require 'fileutils'

module CodexSketchUpBridgeLoader
  unless file_loaded?(__FILE__)
    app_data = ENV['APPDATA'] || File.join(ENV['USERPROFILE'], 'AppData', 'Roaming')
    data_dir = File.join(app_data, 'SketchUpLiveMCP')
    log_path = File.join(data_dir, 'bridge.log')
    FileUtils.mkdir_p(data_dir)
    File.open(log_path, 'a') { |f| f.puts("#{Time.now} loader start #{__FILE__}") }
    extension = SketchupExtension.new(
      'SketchUp MCP Bridge',
      File.join('codex_sketchup_bridge', 'main')
    )
    extension.description = 'Local bridge that lets the local MCP execute SketchUp Ruby for real-time modeling.'
    extension.version = '0.3.1'
    extension.creator = 'PipClaw'
    Sketchup.register_extension(extension, true)
    begin
      require File.join(File.dirname(__FILE__), 'codex_sketchup_bridge', 'main')
      File.open(log_path, 'a') { |f| f.puts("#{Time.now} loader required main") }
    rescue Exception => e
      File.open(log_path, 'a') { |f| f.puts("#{Time.now} loader error #{e.class}: #{e.message}\n#{e.backtrace&.join("\n")}") }
      raise
    end
    file_loaded(__FILE__)
  end
end

