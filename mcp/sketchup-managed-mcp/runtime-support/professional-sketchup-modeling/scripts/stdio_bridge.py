#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SU MCP Stdio Bridge (Python)
=========================================
Cross-platform MCP stdio bridge for SketchUp.
Works on Windows, macOS, Linux without extra dependencies.

Usage:
    python3 stdio_bridge.py [host] [port]

Claude Desktop config:
    {
      "mcpServers": {
        "sketchup": {
          "command": "python3",
          "args": ["/path/to/bridge/stdio_bridge.py"],
          "env": { "SU_MCP_PORT": "9876" }
        }
      }
    }
    Note: On Windows use "python" instead of "python3" if needed.
"""

from __future__ import annotations

import json
import os
import socket
import sys
import time
from typing import BinaryIO, Tuple

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
HOST           = os.environ.get('SU_MCP_HOST', '127.0.0.1')
PORT           = int(os.environ.get('SU_MCP_PORT', '9876'))
RETRY_INTERVAL = 2    # seconds between connection retries
MAX_RETRIES    = 30   # initial connect: SketchUp 可能正在启动，给足重试（~60s）
READ_TIMEOUT   = 30   # seconds to wait for a TCP response

# 会话中途断线的重连预算：必须短而有限。
# 此时 SketchUp 本应已在监听，长时间阻塞重连会卡住 stdin 处理，
# 让 .NET 端的工具调用超时、进而拆掉整个子进程（表现为 "process exited unexpectedly"）。
# 失败就快速放弃并向客户端回一个明确的 JSON-RPC 错误，而不是闷头重试。
RECONNECT_RETRIES  = 3
RECONNECT_INTERVAL = 1

# ---------------------------------------------------------------------------
# 脚本载体闸门
# ---------------------------------------------------------------------------
# SKILL.md 规定：新建几何一律走脚本载体（磁盘上的 .py）；对话内只允许只读查询、
# 已存在对象的微调、保存/截图/相机。纯文档约束实测连续三轮被绕过——AI 读完规则
# 仍直接投 execute_ruby，然后在挤出方向、颜色名、参数顺序上反复返工。
# 这里做最后一道拦截：只认磁盘上是否真的有 .py。
#
# 放在本 bridge 而不是 .NET 侧的 SkillExecutor / FunctionInvocationInterceptor：
# 那两处是所有 skill 共用的，把 execute_ruby / pushpull 这类 SketchUp 专有名字
# 写进通用执行器会污染架构，并波及 Rhino、AutoCAD 等无关 skill。
# 本文件只服务 sketchup 一个 server，是这条规则的正确边界。
#
# 关闭：设环境变量 SU_MCP_REQUIRE_SCRIPT=0
REQUIRE_SCRIPT = os.environ.get('SU_MCP_REQUIRE_SCRIPT', '1') not in ('0', 'false', 'False')

# 建几何的 Ruby API 调用，命中任一个即视为"新建几何"。
_GEOMETRY_CALLS = (
    'add_group', 'add_face', 'pushpull', 'add_instance',
    'add_edges', 'add_line', 'add_curve', 'add_circle', 'add_arc',
    'followme', 'definitions.add',
)

# 工作区根目录，可用 SU_MCP_WORKSPACE 覆盖。
_WORKSPACE_ENV = os.environ.get('SU_MCP_WORKSPACE', '').strip()

# 建模脚本的最大年龄：避免上个月的旧脚本给本次任务放行。
SCRIPT_MAX_AGE_SEC = 7200


def _log(msg: str) -> None:
    """Write to stderr so it doesn't interfere with JSON-RPC on stdout."""
    print(f'[SU-MCP-Bridge] {msg}', file=sys.stderr, flush=True)


def _workspace_roots() -> list:
    """返回要扫描 .py 的候选目录。"""
    if _WORKSPACE_ENV:
        return [_WORKSPACE_ENV]
    skill_dir = os.path.dirname(os.path.abspath(__file__))
    settings_dir = os.path.dirname(os.path.dirname(skill_dir))   # Skills/ 的上一层
    return [
        os.path.join(settings_dir, 'UserData', 'AgentWorkspace'),
        os.path.join(settings_dir, 'UserData', 'AIWorkspace'),
    ]


def _has_build_script(max_age_sec: int = SCRIPT_MAX_AGE_SEC) -> bool:
    """工作区内是否存在近期落盘的建模脚本 .py。

    只看文件是否存在，不解析内容——闸门要的就是"逻辑落在磁盘上"这件事本身。
    """
    now = time.time()
    for root in _workspace_roots():
        if not os.path.isdir(root):
            continue
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d != '__pycache__']
            for fn in filenames:
                if not fn.endswith('.py'):
                    continue
                try:
                    if now - os.path.getmtime(os.path.join(dirpath, fn)) <= max_age_sec:
                        return True
                except OSError:
                    continue
    return False


def _extract_ruby_code(msg: dict) -> "str | None":
    """取出 execute_ruby 的 code 参数；非该调用返回 None。"""
    if msg.get('method') != 'tools/call':
        return None
    params = msg.get('params')
    if not isinstance(params, dict) or params.get('name') != 'execute_ruby':
        return None
    args = params.get('arguments')
    if not isinstance(args, dict):
        return None
    code = args.get('code')
    return code if isinstance(code, str) else None


def _gate_message(hits: list) -> str:
    return (
        '[已被技能闸门阻止] 本次 execute_ruby 含新建几何调用（'
        + '、'.join(hits)
        + '），但工作区里没有找到建模脚本 .py。\n'
        '按 SKILL.md「开工闸门」：新建任何几何一律走脚本载体。请改为：\n'
        '1. 用 FileIO_Write 把建模逻辑写成 [AI工作区]/<项目>/build_model.py'
        '（骨架见 references/ruby-snippets.md 末尾，用 probe_api.Rpc 连 127.0.0.1:9876）；\n'
        '2. 用 py_compile 过一遍语法；\n'
        '3. 用私有 python 执行该脚本完成建模。\n'
        '只读查询、改材质/图层/名称、移动或删除已存在对象、保存、截图、设相机 '
        '不受此闸门限制，可继续直接调用。\n'
        '不要把同一段 Ruby 重发一次来绕过本提示——闸门只认磁盘上的 .py 文件。'
    )


def _tool_error_response(req_id, text: str) -> bytes:
    """构造 tools/call 的失败结果（而非协议错误），让模型能读到并据此改做法。"""
    payload = {
        'jsonrpc': '2.0',
        'id': req_id,
        'result': {
            'content': [{'type': 'text', 'text': text}],
            'isError': True,
        },
    }
    return json.dumps(payload, ensure_ascii=False).encode('utf-8')


def _check_script_gate(line: bytes) -> "bytes | None":
    """命中闸门返回要直接回给客户端的响应，否则返回 None 放行。

    任何内部异常都放行（fail-open）——闸门自身的 bug 不该挡住正常建模。
    """
    if not REQUIRE_SCRIPT:
        return None
    try:
        msg = json.loads(line)
        if not isinstance(msg, dict):
            return None
        req_id = msg.get('id')
        if req_id is None:                       # notification，不拦
            return None
        code = _extract_ruby_code(msg)
        if not code:
            return None
        hits = [c for c in _GEOMETRY_CALLS if c in code]
        if not hits:
            return None                          # 查询/微调/保存/截图，放行
        if _has_build_script():
            return None                          # 已有脚本落盘，放行
        _log(f'Script gate blocked execute_ruby (geometry: {", ".join(hits)})')
        return _tool_error_response(req_id, _gate_message(hits))
    except Exception as exc:
        _log(f'Script gate skipped due to internal error: {exc}')
        return None


# ---------------------------------------------------------------------------
# TCP Connection
# ---------------------------------------------------------------------------

def _connect(max_retries: int = MAX_RETRIES,
             interval: int = RETRY_INTERVAL,
             fatal: bool = True) -> "socket.socket | None":
    """Connect to SketchUp TCP server with retries.

    fatal=True  : 初次连接，耗尽重试后抛 RuntimeError（让进程以明确错误退出）。
    fatal=False : 会话中途重连，耗尽后返回 None，由调用方回报错误并保持 bridge 存活。
    """
    for attempt in range(1, max_retries + 1):
        try:
            sock = socket.create_connection((HOST, PORT), timeout=5)
            sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
            sock.settimeout(READ_TIMEOUT)
            return sock
        except (ConnectionRefusedError, OSError, TimeoutError) as exc:
            if attempt >= max_retries:
                if not fatal:
                    _log(f'Reconnect failed after {max_retries} attempts: {exc}')
                    return None
                raise RuntimeError(
                    f'Cannot connect to SketchUp MCP Server at {HOST}:{PORT} '
                    f'after {max_retries} attempts.\n'
                    f'Make sure SketchUp is running and the MCP Server is started '
                    f'(Extensions > SU MCP Server > Start Server).'
                ) from exc
            _log(f'Attempt {attempt}/{max_retries} failed: {exc}'
                 f', retrying in {interval}s...')
            time.sleep(interval)
    # 这一行逻辑上不可达（max_retries 次后 raise 或 return），
    # 但显式 raise 让 Pyre2 能正确推断函数总能返回 socket 或抛出异常
    raise RuntimeError('Unreachable: connection loop exhausted')


# ---------------------------------------------------------------------------
# Binary stdio helpers (handle Windows line-ending issues)
# ---------------------------------------------------------------------------

def _get_binary_stdio() -> Tuple[BinaryIO, BinaryIO]:
    """Return binary stdin/stdout. On Windows, switch to binary mode."""
    if sys.platform == 'win32':
        import msvcrt
        msvcrt.setmode(sys.stdin.fileno(), os.O_BINARY)
        msvcrt.setmode(sys.stdout.fileno(), os.O_BINARY)
    return sys.stdin.buffer, sys.stdout.buffer


# ---------------------------------------------------------------------------
# Main bridge loop
# ---------------------------------------------------------------------------

def _is_request(line: bytes) -> bool:
    """
    判断是否为 JSON-RPC request（有 id 字段）还是 notification（无 id 或 id 为 null）。
    MCP 协议：request 需要响应，notification 不需要响应。
    """
    try:
        msg = json.loads(line)
        # 有 'id' 字段且不为 None → request，需等待响应
        return isinstance(msg, dict) and msg.get('id') is not None
    except Exception:
        # 解析失败时保守地等待响应
        return True


def _make_sock_file(sock: socket.socket) -> BinaryIO:
    """将 socket 包装为二进制文件对象，并标注返回类型供 Pyre2 推断。"""
    return sock.makefile('rwb', buffering=0)  # type: ignore[return-value]


def _error_response(line: bytes, message: str) -> bytes | None:
    """为一条 request 构造 JSON-RPC 错误响应；notification 无需响应则返回 None。

    用于会话中途 TCP 断开且重连失败时，向 MCP 客户端回报明确错误，
    而不是让请求悬空、最终拖死整个 bridge 进程。
    """
    try:
        msg = json.loads(line)
        req_id = msg.get('id') if isinstance(msg, dict) else None
    except Exception:
        req_id = None
    if req_id is None:
        return None
    err = {
        'jsonrpc': '2.0',
        'id': req_id,
        'error': {'code': -32001, 'message': message},
    }
    return json.dumps(err).encode('utf-8')


def main() -> None:
    # Allow host/port as positional args for convenience
    if len(sys.argv) >= 2:
        global HOST
        HOST = sys.argv[1]
    if len(sys.argv) >= 3:
        global PORT
        PORT = int(sys.argv[2])

    _log(f'Starting bridge -> {HOST}:{PORT}')

    sock = _connect()
    sock_file: "BinaryIO | None" = _make_sock_file(sock)
    _log('Connected to SketchUp MCP Server')

    stdin, stdout = _get_binary_stdio()

    while True:
        # Read one line from Claude (MCP client) via stdin
        try:
            raw = stdin.readline()
        except (KeyboardInterrupt, EOFError):
            break

        if not raw:          # stdin closed
            break

        line = raw.strip()
        if not line:
            continue

        # Determine if this message is a request (needs response) or notification (no response)
        needs_response = _is_request(line)

        # 脚本载体闸门：新建几何但工作区无 .py → 直接回失败，不转发给 SketchUp。
        # 放在转发之前，确保被拦的调用完全不触碰模型。
        gate = _check_script_gate(line)
        if gate is not None:
            stdout.write(gate + b'\n')
            stdout.flush()
            continue

        # 若上一次重连失败导致连接处于断开状态，先尝试按短预算恢复。
        if sock_file is None:
            new_sock = _connect(
                max_retries=RECONNECT_RETRIES,
                interval=RECONNECT_INTERVAL,
                fatal=False)
            if new_sock is None:
                if needs_response:
                    err = _error_response(
                        line, f'SketchUp MCP Server unreachable at {HOST}:{PORT}')
                    if err:
                        stdout.write(err + b'\n')
                        stdout.flush()
                continue
            sock = new_sock
            sock_file = _make_sock_file(sock)
            _log('Reconnected to SketchUp MCP Server')

        # Forward to SketchUp TCP server
        try:
            sock_file.write(line + b'\n')
            sock_file.flush()

            if needs_response:
                # Request: block waiting for response
                response = sock_file.readline()
            else:
                # Notification: do NOT wait for a response
                # (MCP notifications/initialized, etc. have no response)
                decoded = line.decode('utf-8', errors='replace')
                _log(f'Notification sent (no response expected): {decoded[:80]}')  # type: ignore
                continue

        except (BrokenPipeError, ConnectionResetError, OSError) as exc:
            # 会话中途断线：用短预算快速重连，不要长时间阻塞 stdin 处理。
            _log(f'TCP connection lost: {exc}, reconnecting (bounded)...')
            try:
                sock.close()
            except Exception:
                pass

            new_sock = _connect(
                max_retries=RECONNECT_RETRIES,
                interval=RECONNECT_INTERVAL,
                fatal=False)

            if new_sock is None:
                # 重连失败：保持 bridge 存活，向客户端回明确错误（仅 request），
                # 等待 SketchUp 恢复后的后续请求自行重连。绝不静默退出。
                sock_file = None  # type: ignore[assignment]
                if needs_response:
                    err = _error_response(
                        line, f'SketchUp MCP Server unreachable at {HOST}:{PORT}')
                    if err:
                        stdout.write(err + b'\n')
                        stdout.flush()
                continue

            sock = new_sock
            sock_file = _make_sock_file(sock)
            # Retry once after reconnect (only for requests)
            if needs_response:
                try:
                    sock_file.write(line + b'\n')
                    sock_file.flush()
                    response = sock_file.readline()
                except OSError as retry_exc:
                    _log(f'Retry after reconnect failed: {retry_exc}')
                    err = _error_response(line, f'SketchUp request failed: {retry_exc}')
                    if err:
                        stdout.write(err + b'\n')
                        stdout.flush()
                    continue
            else:
                continue

        if response:
            stdout.write(response.strip() + b'\n')
            stdout.flush()


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        _log('Bridge stopped')
    except Exception as exc:
        _log(f'Fatal error: {exc}')
        sys.exit(1)
