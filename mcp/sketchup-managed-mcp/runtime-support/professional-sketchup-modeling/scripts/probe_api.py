#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""探测 SketchUp MCP 服务的可用工具面与 Ruby 侧 API。

直连 Ruby 插件的 TCP 端口（默认 127.0.0.1:9876），不经过 stdio_bridge，
也不需要 MCP 客户端。只用标准库。

用法:
    python probe_api.py [--host H] [--port P] [--out 报告.json] [--no-ruby]

退出码: 0 探测成功, 1 部分失败, 2 连不上 SketchUp
"""
from __future__ import annotations

import argparse
import json
import socket
import sys

TIMEOUT = 20

# Windows 控制台默认 GBK，插件描述里含 ⚠ 等字符会导致 UnicodeEncodeError。
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except (AttributeError, OSError):
    pass


class Rpc:
    """一条 TCP 连接上的 JSON-RPC 会话。"""

    def __init__(self, host: str, port: int):
        self.sock = socket.create_connection((host, port), timeout=8)
        self.sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        self.sock.settimeout(TIMEOUT)
        self.f = self.sock.makefile("rwb", buffering=0)
        self._id = 0

    def call(self, method: str, params=None):
        """发一条 request 并等响应；返回 (result, error)。"""
        self._id += 1
        req = {"jsonrpc": "2.0", "id": self._id, "method": method}
        if params is not None:
            req["params"] = params
        self.f.write(json.dumps(req).encode("utf-8") + b"\n")
        self.f.flush()
        line = self.f.readline()
        if not line:
            return None, "无响应（连接被关闭）"
        try:
            msg = json.loads(line.decode("utf-8", errors="replace"))
        except json.JSONDecodeError as exc:
            return None, "响应不是合法 JSON: %s" % exc
        if "error" in msg:
            return None, json.dumps(msg["error"], ensure_ascii=False)
        return msg.get("result"), None

    def notify(self, method: str, params=None):
        req = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            req["params"] = params
        self.f.write(json.dumps(req).encode("utf-8") + b"\n")
        self.f.flush()

    def close(self):
        try:
            self.f.close()
            self.sock.close()
        except Exception:
            pass


# ── Ruby 侧探测片段 ─────────────────────────────────────────────────────────
# 每项: (探测名, Ruby 代码)。代码必须返回可 inspect 的值，避免超大输出。

RUBY_PROBES = [
    ("版本与环境", r'''
{
  "su_version"  => Sketchup.version,
  "su_version_n"=> Sketchup.version_number,
  "is_pro"      => Sketchup.is_pro?,
  "platform"    => RUBY_PLATFORM,
  "ruby"        => RUBY_VERSION,
  "locale"      => Sketchup.get_locale
}.inspect
'''),
    ("模型与单位", r'''
m = Sketchup.active_model
o = m.options["UnitsOptions"]
{
  "title"       => (m.title.empty? ? "(未命名)" : m.title),
  "path"        => (m.path.to_s.empty? ? "(未保存)" : m.path),
  "entities"    => m.entities.count,
  "layers"      => m.layers.count,
  "materials"   => m.materials.count,
  "definitions" => m.definitions.count,
  "length_unit" => o["LengthUnit"],
  "length_fmt"  => o["LengthFormat"]
}.inspect
'''),
    ("图层清单", r'''
Sketchup.active_model.layers.map { |l| l.name }.inspect
'''),
    ("组件定义清单", r'''
Sketchup.active_model.definitions.reject { |d| d.image? }
  .map { |d| { "name" => d.name, "count" => d.instances.length,
               "entities" => d.entities.count } }.first(40).inspect
'''),
    ("实体类型分布", r'''
h = {}
Sketchup.active_model.entities.each { |e|
  k = e.class.name.split("::").last
  h[k] = (h[k] || 0) + 1
}
h.inspect
'''),
    ("几何构造能力", r'''
caps = {}
ents = Sketchup.active_model.entities
caps["add_face"]        = ents.respond_to?(:add_face)
caps["add_group"]       = ents.respond_to?(:add_group)
caps["add_line"]        = ents.respond_to?(:add_line)
caps["add_instance"]    = ents.respond_to?(:add_instance)
caps["pushpull"]        = Sketchup::Face.instance_methods.include?(:pushpull)
caps["followme"]        = Sketchup::Face.instance_methods.include?(:followme)
caps["intersect_with"]  = Sketchup::Group.instance_methods.include?(:intersect_with)
caps["subtract"]        = Sketchup::Group.instance_methods.include?(:subtract)
caps["union"]           = Sketchup::Group.instance_methods.include?(:union)
caps["trim"]            = Sketchup::Group.instance_methods.include?(:trim)
caps["explode"]         = Sketchup::Group.instance_methods.include?(:explode)
caps["transform!"]      = Sketchup::Group.instance_methods.include?(:transform!)
caps["start_operation"] = Sketchup::Model.instance_methods.include?(:start_operation)
caps.inspect
'''),
    ("插件命名空间", r'''
mods = Object.constants.select { |c|
  begin
    v = Object.const_get(c)
    v.is_a?(Module) && c.to_s =~ /MCP|SUMCP|SuMcp/i
  rescue
    false
  end
}.map(&:to_s)
detail = {}
mods.each { |name|
  begin
    m = Object.const_get(name)
    detail[name] = {
      "methods"  => m.methods(false).map(&:to_s).first(60),
      "consts"   => m.constants.map(&:to_s).first(40)
    }
  rescue => e
    detail[name] = { "error" => e.message }
  end
}
detail.inspect
'''),
]


# ── 主流程 ──────────────────────────────────────────────────────────────────

def find_ruby_tool(tools):
    """在工具清单里找能跑任意 Ruby 的工具名。"""
    names = [t.get("name", "") for t in tools]
    for cand in ("execute_ruby", "eval_ruby", "run_ruby", "ruby"):
        if cand in names:
            return cand
    for n in names:
        if "ruby" in n.lower():
            return n
    return None


def ruby_param_key(tools, tool_name):
    """猜 Ruby 工具的入参字段名。"""
    for t in tools:
        if t.get("name") == tool_name:
            props = (t.get("inputSchema") or {}).get("properties") or {}
            for cand in ("code", "ruby", "script", "expression", "source"):
                if cand in props:
                    return cand
            if props:
                return list(props)[0]
    return "code"


def main():
    ap = argparse.ArgumentParser(description="探测 SketchUp MCP 工具面与 Ruby API")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=9876)
    ap.add_argument("--out", help="报告 JSON 输出路径")
    ap.add_argument("--no-ruby", action="store_true", help="只列工具，不跑 Ruby 探测")
    args = ap.parse_args()

    report = {"host": args.host, "port": args.port,
              "tools": [], "ruby": {}, "notes": []}

    try:
        rpc = Rpc(args.host, args.port)
    except OSError as exc:
        print("[FATAL] 连不上 %s:%d — %s" % (args.host, args.port, exc))
        print("        请先启动 SketchUp，并在 扩展程序 > SU MCP Server > Start Server 开启服务。")
        return 2

    print("已连接 %s:%d\n" % (args.host, args.port))
    try:
        return _probe(rpc, args, report)
    finally:
        rpc.close()


def _probe(rpc, args, report):
    failed = False

    # 1. MCP 握手
    init, err = rpc.call("initialize", {
        "protocolVersion": "2024-11-05",
        "capabilities": {},
        "clientInfo": {"name": "probe_api", "version": "1.0"},
    })
    if err:
        report["notes"].append("initialize 失败: %s" % err)
        print("[WARN] initialize 失败: %s（继续尝试 tools/list）" % err)
        failed = True
    else:
        srv = (init or {}).get("serverInfo") or {}
        report["server"] = srv
        print("服务端: %s %s" % (srv.get("name", "?"), srv.get("version", "")))
        rpc.notify("notifications/initialized")

    # 2. 工具清单
    res, err = rpc.call("tools/list")
    if err:
        print("[FATAL] tools/list 失败: %s" % err)
        report["notes"].append("tools/list 失败: %s" % err)
        _write(args, report)
        return 1

    tools = (res or {}).get("tools") or []
    report["tools"] = tools
    print("\n=== 工具清单（%d 个）===" % len(tools))
    for t in tools:
        props = (t.get("inputSchema") or {}).get("properties") or {}
        req = set((t.get("inputSchema") or {}).get("required") or [])
        sig = ", ".join(("%s*" % k) if k in req else k for k in props)
        print("  %-26s (%s)" % (t.get("name", "?"), sig or "无参数"))
        desc = (t.get("description") or "").strip().replace("\n", " ")
        if desc:
            print("      %s" % desc[:110])

    if args.no_ruby:
        _write(args, report)
        return 1 if failed else 0

    return _probe_ruby(rpc, args, report, tools, failed)


def _probe_ruby(rpc, args, report, tools, failed):
    """用 execute_ruby 跑 Ruby 侧探测。"""
    tool = find_ruby_tool(tools)
    if not tool:
        print("\n[跳过] 工具清单里没有可执行 Ruby 的工具")
        report["notes"].append("无 Ruby 工具，跳过 Ruby 探测")
        _write(args, report)
        return 1 if failed else 0

    key = ruby_param_key(tools, tool)
    print("\n=== Ruby 探测（用 %s，入参 %s）===" % (tool, key))

    for label, code in RUBY_PROBES:
        res, err = rpc.call("tools/call", {
            "name": tool,
            "arguments": {key: code.strip()},
        })
        if err:
            print("  [%s] 调用失败: %s" % (label, err))
            report["ruby"][label] = {"error": err}
            failed = True
            continue

        text = _extract_text(res)
        payload = text
        try:
            inner = json.loads(text)
            if isinstance(inner, dict):
                if inner.get("success") is False:
                    print("  [%s] Ruby 报错: %s" % (label, inner.get("error")))
                    report["ruby"][label] = {"error": inner.get("error")}
                    failed = True
                    continue
                payload = inner.get("result", text)
        except (json.JSONDecodeError, TypeError):
            pass

        report["ruby"][label] = payload
        print("  [%s]" % label)
        shown = payload if isinstance(payload, str) else json.dumps(
            payload, ensure_ascii=False)
        print("      %s" % shown[:400])

    _write(args, report)
    return 1 if failed else 0


def _extract_text(res):
    """从 MCP tools/call 结果里取出文本内容。"""
    if not isinstance(res, dict):
        return str(res)
    content = res.get("content")
    if isinstance(content, list):
        parts = [c.get("text", "") for c in content
                 if isinstance(c, dict) and c.get("type") == "text"]
        if parts:
            return "\n".join(parts)
    return json.dumps(res, ensure_ascii=False)


def _write(args, report):
    if not args.out:
        return
    try:
        with open(args.out, "w", encoding="utf-8") as fh:
            json.dump(report, fh, ensure_ascii=False, indent=2)
        print("\n报告已写入 %s" % args.out)
    except OSError as exc:
        print("\n[WARN] 写报告失败: %s" % exc)


if __name__ == "__main__":
    sys.exit(main())
