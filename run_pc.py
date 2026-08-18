#!/usr/bin/env python3
"""
run_pc.py: Lightweight development server for previewing the KAI Agent UI in a browser.
Serves static renderer files from src/renderer and opens the local URL.
"""

import http.server
import json
import os
import socketserver
import sys
import webbrowser
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent
RENDERER_DIR = APP_DIR / "src" / "renderer"


def get_lmstudio_capabilities():
    """Extracts model capabilities dynamically from local LM Studio cache."""
    candidates = [
        Path.home() / ".lmstudio" / ".internal" / "model-index-cache.json",
        Path.home() / ".cache" / "lm-studio" / ".internal" / "model-index-cache.json",
    ]
    for p in candidates:
        if p.exists():
            try:
                with open(p, "r", encoding="utf-8") as f:
                    data = json.load(f)
                caps = {}
                for m in data.get("models", []):
                    model_id = m.get("indexedModelIdentifier") or m.get("displayName") or ""
                    fields = []
                    for cf in m.get("virtual", {}).get("customFieldDefinitions", []) or []:
                        effects = cf.get("effects", [])
                        eff = effects[0] if effects else {}
                        var = eff.get("variable", "")
                        if not var or "preserve" in var.lower():
                            continue
                        field_type = "select" if cf.get("type") == "select" else "boolean"
                        opts = []
                        if field_type == "select":
                            # Retain exact value names ('xhigh', 'medium', 'low') for display labels
                            opts = [{"label": o.get("value", o.get("label", "")), "value": o.get("value", "")} for o in cf.get("options", [])]
                        fields.append({
                            "displayName": cf.get("displayName", var),
                            "type": field_type,
                            "variable": var,
                            "options": opts,
                            "defaultValue": cf.get("defaultValue", True if field_type == "boolean" else "xhigh")
                        })
                    cap_obj = {
                        "modelId": model_id,
                        "displayName": m.get("displayName", model_id),
                        "domain": m.get("domain", "llm"),
                        "fields": fields,
                        "isReasoning": bool(m.get("virtual", {}).get("metadataOverridesReasoning"))
                    }
                    aliases = [
                        m.get("indexedModelIdentifier"),
                        m.get("defaultIdentifier"),
                        m.get("originalIndexedModelIdentifier"),
                        m.get("altIndexedModelIdentifier"),
                        m.get("displayName"),
                    ]
                    if model_id:
                        aliases.append(model_id)
                        if "@" in model_id:
                            no_at = model_id.split("@")[0]
                            aliases.append(no_at)
                            aliases.append(no_at.split("/")[-1])
                        if "/" in model_id:
                            aliases.append(model_id.split("/")[-1])
                    disp = m.get("displayName")
                    if disp:
                        aliases.append(disp.lower().replace(" ", "-"))
                        aliases.append(disp.lower().replace(" ", "."))
                    
                    for a in filter(None, aliases):
                        caps[a] = cap_obj
                        caps[a.lower()] = cap_obj
                return caps
            except Exception:
                pass
    return {}


class KaiStaticServer(http.server.SimpleHTTPRequestHandler):
    """Simple static HTTP handler serving the src/renderer directory with no-cache headers."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(RENDERER_DIR), **kwargs)

    def log_message(self, format, *args):
        # Suppress noisy standard request logging
        pass

    def end_headers(self):
        """Sends cache-busting headers so the browser always loads fresh JavaScript."""
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def do_GET(self):
        """Serves static files, system prompts and LM Studio capabilities API."""
        if self.path.startswith("/api/capabilities"):
            caps = get_lmstudio_capabilities()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(caps).encode("utf-8"))
            return

        # Serve system prompt markdown files located in APP_DIR
        clean_path = self.path.lstrip("/")
        if clean_path.startswith("system_prompt") and clean_path.endswith(".md"):
            prompt_file = APP_DIR / clean_path
            if prompt_file.exists():
                self.send_response(200)
                self.send_header("Content-Type", "text/markdown; charset=utf-8")
                self.end_headers()
                self.wfile.write(prompt_file.read_bytes())
                return

        super().do_GET()

    def do_POST(self):
        """Routes POST requests to tool proxy endpoints or returns a fallback OK."""
        content_length = int(self.headers.get("Content-Length", 0))
        raw_body = self.rfile.read(content_length) if content_length > 0 else b""

        if self.path.startswith("/api/tools/web_search"):
            self._handle_web_search(raw_body)
            return

        if self.path.startswith("/api/tools/fetch_url"):
            self._handle_fetch_url(raw_body)
            return

        # Fallback for unknown POST paths
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"status":"ok"}')

    def _handle_web_search(self, raw_body):
        """Proxies a web search query via the bundled web-search-mcp server (Playwright-based)."""
        try:
            body = json.loads(raw_body) if raw_body else {}
        except Exception:
            body = {}

        query = body.get("query", "")
        limit = body.get("limit", 5)
        include_content = body.get("includeContent", True)

        if not query:
            self._json_response(400, {"error": "Missing 'query' parameter"})
            return

        tool_name = "full-web-search" if include_content else "get-web-search-summaries"
        try:
            result = _call_mcp_tool(tool_name, {
                "query": query.strip(),
                "limit": limit,
                "includeContent": include_content
            })
            self._json_response(200, {"result": result})
        except Exception as e:
            self._json_response(500, {"result": f"[Error searching web]: {e}"})

    def _handle_fetch_url(self, raw_body):
        """Proxies a URL fetch via the bundled web-search-mcp server (Playwright-based)."""
        try:
            body = json.loads(raw_body) if raw_body else {}
        except Exception:
            body = {}

        url = body.get("url", "")
        if not url:
            self._json_response(400, {"error": "Missing 'url' parameter"})
            return

        try:
            result = _call_mcp_tool("extract-webpage-content", {"url": url})
            self._json_response(200, {"result": result})
        except Exception as e:
            self._json_response(500, {"result": f"[Error fetching URL]: {e}"})

    def _json_response(self, status_code, data):
        """Sends a JSON response with the given status code and data dict."""
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode("utf-8"))


def _call_mcp_tool(tool_name, arguments, timeout_sec=40):
    """
    Calls a tool on the bundled web-search-mcp server via JSON-RPC 2.0 over stdio.
    Mirrors the protocol used by McpProcessBridge.ts in the Electron app.
    """
    import subprocess
    import threading

    # Locate the MCP server script
    mcp_script = APP_DIR / "web-search-mcp-v0.3.2" / "dist" / "index.js"
    if not mcp_script.exists():
        raise RuntimeError(f"MCP server script not found at {mcp_script}")

    mcp_cwd = str(APP_DIR / "web-search-mcp-v0.3.2")

    # Spawn node process
    proc = subprocess.Popen(
        ["node", str(mcp_script)],
        cwd=mcp_cwd,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env={**os.environ, "FORCE_COLOR": "0"}
    )

    result_holder = {"result": None, "error": None}
    stdout_buffer = ""

    def _send(msg):
        """Writes a JSON-RPC message to the child process stdin."""
        proc.stdin.write((json.dumps(msg) + "\n").encode("utf-8"))
        proc.stdin.flush()

    def _communicate():
        """Reads stdout line by line and processes JSON-RPC responses."""
        nonlocal stdout_buffer
        request_id = 1

        # Step 1: Send initialize request
        _send({
            "jsonrpc": "2.0",
            "id": request_id,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "Kai-Agent-Preview", "version": "1.0.0"}
            }
        })

        init_id = request_id
        request_id += 1

        # Read lines until we get both init response and tool call response
        for raw_line in iter(proc.stdout.readline, b""):
            line = raw_line.decode("utf-8", errors="replace").strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except Exception:
                continue

            msg_id = msg.get("id")

            if msg_id == init_id:
                # Initialize succeeded — send initialized notification + tool call
                if msg.get("error"):
                    result_holder["error"] = f"MCP init error: {json.dumps(msg['error'])}"
                    return

                _send({"jsonrpc": "2.0", "method": "notifications/initialized"})

                call_id = request_id
                _send({
                    "jsonrpc": "2.0",
                    "id": call_id,
                    "method": "tools/call",
                    "params": {
                        "name": tool_name,
                        "arguments": arguments
                    }
                })

            elif msg_id is not None and msg_id != init_id:
                # This is the tool call response
                if msg.get("error"):
                    result_holder["error"] = f"MCP tool error: {json.dumps(msg['error'])}"
                    return

                res = msg.get("result", {})
                if isinstance(res, dict) and "content" in res:
                    texts = [
                        c["text"] for c in res["content"]
                        if isinstance(c, dict) and c.get("type") == "text" and isinstance(c.get("text"), str)
                    ]
                    result_holder["result"] = "\n\n".join(texts) if texts else json.dumps(res)
                elif isinstance(res, str):
                    result_holder["result"] = res
                else:
                    result_holder["result"] = json.dumps(res, indent=2)
                return

    # Run communication in a thread with timeout
    thread = threading.Thread(target=_communicate, daemon=True)
    thread.start()
    thread.join(timeout=timeout_sec)

    # Cleanup
    try:
        proc.kill()
    except Exception:
        pass

    if result_holder["error"]:
        raise RuntimeError(result_holder["error"])
    if result_holder["result"] is None:
        raise RuntimeError(f"MCP tool execution timed out after {timeout_sec}s")

    return result_holder["result"]


def start_server(port: int = 5173) -> None:
    """Starts a static test server and opens the browser."""
    if not RENDERER_DIR.exists():
        print(f"Error: Renderer directory not found at {RENDERER_DIR}", file=sys.stderr)
        sys.exit(1)

    url = f"http://localhost:{port}/index.html"
    print("=" * 60)
    print("  KAI Agent Preview Server")
    print("=" * 60)
    print(f"  Serving:   {RENDERER_DIR}")
    print(f"  URL:       {url}")
    print("=" * 60)

    socketserver.TCPServer.allow_reuse_address = True

    try:
        with socketserver.TCPServer(("", port), KaiStaticServer) as httpd:
            try:
                webbrowser.open(url)
            except Exception:
                pass
            print(f"Server running at {url}. Press Ctrl+C to stop.")
            httpd.serve_forever()
    except OSError as e:
        if e.errno in (98, 10048):  # Address already in use
            print(f"Port {port} is in use, trying {port + 1}...")
            start_server(port + 1)
        else:
            raise


if __name__ == "__main__":
    start_server()
