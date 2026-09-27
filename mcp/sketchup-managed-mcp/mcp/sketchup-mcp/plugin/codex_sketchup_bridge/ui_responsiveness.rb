# SketchUp owns geometry and painting on one thread. Keep an operation on that
# thread, but service paint messages at Ruby safe points. Never run a general
# event loop: input, WM_COMMAND, posted work and UI timers must wait for commit.
require 'fiddle'

module ADAIUIResponsiveness
  extend self
  INTERVAL = 0.25

  class PaintQueue
    WM_PAINT = 0x000F
    WM_QUIT = 0x0012
    PAINT_ONLY = 1 | (0x0020 << 16) # PM_REMOVE | PM_QS_PAINT

    def initialize
      dll = Fiddle.dlopen('user32.dll')
      @peek = Fiddle::Function.new(dll['PeekMessageW'],
        [Fiddle::TYPE_VOIDP, Fiddle::TYPE_VOIDP, Fiddle::TYPE_INT, Fiddle::TYPE_INT, Fiddle::TYPE_INT], Fiddle::TYPE_INT)
      @dispatch = Fiddle::Function.new(dll['DispatchMessageW'], [Fiddle::TYPE_VOIDP], Fiddle::TYPE_INTPTR_T)
      @quit = Fiddle::Function.new(dll['PostQuitMessage'], [Fiddle::TYPE_INT], Fiddle::TYPE_VOID)
      @message = "\0" * (Fiddle::SIZEOF_VOIDP == 8 ? 48 : 28)
    end

    def pulse
      painted = 0
      deadline = Process.clock_gettime(Process::CLOCK_MONOTONIC) + 0.02
      4.times do
        break if @peek.call(@message, 0, WM_PAINT, WM_PAINT, PAINT_ONLY) == 0
        id = @message.byteslice(Fiddle::SIZEOF_VOIDP, 4).unpack('L')[0]
        # Windows retrieves WM_QUIT even with a message filter. Preserve it for
        # the normal application loop; never consume the user's close request.
        if id == WM_QUIT
          offset = Fiddle::SIZEOF_VOIDP == 8 ? 16 : 8
          @quit.call(@message.byteslice(offset, 4).unpack('l')[0])
          break
        end
        if id == WM_PAINT
          @dispatch.call(@message)
          painted += 1
        end
        break if Process.clock_gettime(Process::CLOCK_MONOTONIC) >= deadline
      end
      painted
    end
  end

  def clock
    Process.clock_gettime(Process::CLOCK_MONOTONIC)
  end

  def available?
    RUBY_PLATFORM =~ /mswin|mingw/
  end

  def last_run
    @last_run && @last_run.dup
  end

  def run
    return yield if @active || !available?
    begin
      backend = PaintQueue.new
    rescue StandardError => error
      report("paint service unavailable: #{error.class}: #{error.message}")
      return yield
    end
    @active = true
    owner = Thread.current
    started = clock
    previous_pulse = started
    next_status = started + 1.0
    progress_shown = false
    metrics = {pulses: 0, painted: 0, max_gap_seconds: 0.0}
    enabled = true
    trace = nil
    worker = nil
    begin
      # A permanently enabled TracePoint visits millions of lines per audit.
      # The sleeper only arms a ONE-SHOT callback. Every SketchUp/Win32 access
      # happens in that callback on the owning main thread, never this worker.
      trace = TracePoint.new(:line, :c_return) do
        if Thread.current == owner
          trace.disable
          begin
            now = clock
            metrics[:max_gap_seconds] = [metrics[:max_gap_seconds], now - previous_pulse].max
            previous_pulse = now
            if now >= next_status
              # SketchUp exposes a setter, not a status_text getter (including
              # SU 2019). The bridge owns this temporary progress prompt.
              Sketchup.set_status_text("ADAI 正在处理模型（已用时 #{(now - started).to_i} 秒）")
              progress_shown = true
              next_status = now + 1.0
            end
            metrics[:painted] += backend.pulse
            metrics[:pulses] += 1
          rescue StandardError => error
            enabled = false
            metrics[:paint_error] = "#{error.class}: #{error.message}"
            report("paint service stopped: #{metrics[:paint_error]}")
          end
        end
      end
      worker = Thread.new do
        while enabled
          sleep INTERVAL
          trace.enable if enabled
        end
      end
      yield
    ensure
      enabled = false
      if worker
        begin
          worker.wakeup if worker.alive?
        rescue ThreadError
          # It may finish between alive? and wakeup.
        end
        worker.join
      end
      trace.disable if trace
      finished = clock
      metrics[:seconds] = finished - started
      metrics[:max_gap_seconds] = [metrics[:max_gap_seconds], finished - previous_pulse].max
      @last_run = metrics
      begin
        Sketchup.set_status_text if progress_shown
      rescue StandardError
        # A closing window must not mask a geometry error or commit result.
      end
      @active = false
      report("ui_service #{metrics}") if metrics[:seconds] >= 1.0
    end
  end

  def report(message)
    CodexSketchUpBridge.log(message)
  rescue StandardError
    nil
  end
end
