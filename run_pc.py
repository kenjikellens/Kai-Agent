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

        if self.path.startswith("/api/workspace/pick"):
            self._handle_workspace_pick()
            return

        if self.path.startswith("/api/tools/execute"):
            self._handle_tool_execute(raw_body)
            return

        if self.path.startswith("/api/tools/rollback"):
            self._handle_tool_rollback(raw_body)
            return

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

    # Global in-memory transaction undo log keyed by turnId/sessionId
    _TRANSACTION_LOGS = {}

    def _record_file_snapshot(self, turn_id, action_type, rel_path, full_path):
        """Records the pre-modification state of a file for clean transactional rollback."""
        if not turn_id:
            return
        if turn_id not in self._TRANSACTION_LOGS:
            self._TRANSACTION_LOGS[turn_id] = []

        # If file already recorded in this turn, keep the earliest original snapshot
        for record in self._TRANSACTION_LOGS[turn_id]:
            if record["path"] == rel_path:
                return

        original_content = None
        file_existed = os.path.exists(full_path) and os.path.isfile(full_path)
        if file_existed:
            try:
                with open(full_path, "r", encoding="utf-8", errors="replace") as f:
                    original_content = f.read()
            except Exception:
                pass

        self._TRANSACTION_LOGS[turn_id].append({
            "action": action_type,
            "path": rel_path,
            "full_path": full_path,
            "existed": file_existed,
            "content": original_content
        })

    def _handle_tool_rollback(self, raw_body):
        """Rolls back all file creations, edits, and deletions made during specified turn(s)."""
        try:
            body = json.loads(raw_body) if raw_body else {}
        except Exception:
            body = {}

        turn_id = body.get("turnId", "")
        turn_ids = body.get("turnIds") or ([turn_id] if turn_id else [])
        rolled_back_files = []

        for tid in reversed(turn_ids):
            logs = self._TRANSACTION_LOGS.pop(tid, [])
            for record in reversed(logs):
                full_path = record["full_path"]
                rel_path = record["path"]
                try:
                    if not record["existed"]:
                        # File was created during this turn -> delete it
                        if os.path.exists(full_path) and os.path.isfile(full_path):
                            os.remove(full_path)
                            rolled_back_files.append(f"Deleted {rel_path}")
                    else:
                        # File existed before -> restore original content
                        if record["content"] is not None:
                            os.makedirs(os.path.dirname(full_path), exist_ok=True)
                            with open(full_path, "w", encoding="utf-8") as f:
                                f.write(record["content"])
                            rolled_back_files.append(f"Restored {rel_path}")
                except Exception as e:
                    print(f"Error rolling back {rel_path}: {e}")

        self._json_response(200, {
            "status": "ok",
            "rolledBack": rolled_back_files,
            "count": len(rolled_back_files)
        })

    def _handle_tool_execute(self, raw_body):
        """Executes local workspace tools (list_dir, read_file, write_file, replace_file_content, grep_search, run_command, delete_item)."""
        try:
            body = json.loads(raw_body) if raw_body else {}
        except Exception:
            body = {}

        tool_name = body.get("tool", "")
        args = body.get("args", {})
        workspace_path = body.get("workspacePath", "")
        turn_id = body.get("turnId", "")

        def _resolve_safe_path(rel_path):
            if not workspace_path:
                raise ValueError("No workspace folder selected.")
            full = os.path.normpath(os.path.join(workspace_path, rel_path or "."))
            # Ensure path does not escape workspace directory
            if not (full == workspace_path or full.startswith(workspace_path + os.sep)):
                raise ValueError(f"Path traversal denied: '{rel_path}' is outside workspace root.")
            return full

        try:
            if tool_name == "get_workspace_structure":
                if not workspace_path or not os.path.isdir(workspace_path):
                    self._json_response(200, {"result": ""})
                    return
                entries = sorted(os.listdir(workspace_path))
                folders = []
                files = []
                for e in entries:
                    if e in (".git", "node_modules", ".vscode", "__pycache__", ".kai"):
                        continue
                    full = os.path.join(workspace_path, e)
                    if os.path.isdir(full):
                        folders.append(e + "/")
                    elif os.path.isfile(full):
                        files.append(e)
                res = "[Workspace Root Structure]\n"
                if folders:
                    res += f"Folders: {', '.join(folders)}\n"
                if files:
                    res += f"Files: {', '.join(files)}\n"
                self._json_response(200, {"result": res})
                return

            if tool_name == "list_dir":
                rel = args.get("path", ".") or "."
                target = _resolve_safe_path(rel)
                if not os.path.exists(target):
                    self._json_response(200, {"result": f"Directory does not exist: {rel}"})
                    return
                if not os.path.isdir(target):
                    self._json_response(200, {"result": f"Path is not a directory: {rel}"})
                    return
                entries = sorted(os.listdir(target))
                if not entries:
                    self._json_response(200, {"result": "Directory is empty."})
                    return
                lines = []
                for e in entries:
                    if e in (".git", "node_modules"):
                        continue
                    full = os.path.join(target, e)
                    prefix = "[DIR]" if os.path.isdir(full) else "[FILE]"
                    lines.append(f"{prefix} {e}")
                self._json_response(200, {"result": "\n".join(lines)})
                return

            if tool_name == "read_file":
                rel = args.get("path", "")
                if not rel:
                    self._json_response(200, {"result": "Error: Missing required parameter 'path'."})
                    return
                target = _resolve_safe_path(rel)
                if not os.path.exists(target) or not os.path.isfile(target):
                    self._json_response(200, {"result": f"File does not exist: {rel}"})
                    return
                with open(target, "r", encoding="utf-8", errors="replace") as f:
                    content = f.read()
                lines = content.splitlines()
                numbered = "\n".join(f"{idx + 1}: {line}" for idx, line in enumerate(lines))
                # Truncate if very long
                if len(numbered) > 8000:
                    numbered = numbered[:8000] + "\n... [truncated]"
                self._json_response(200, {"result": numbered})
                return

            if tool_name == "write_file":
                rel = args.get("path", "")
                content = args.get("content", "")
                if not rel:
                    self._json_response(200, {"result": "Error: Missing required parameter 'path'."})
                    return
                target = _resolve_safe_path(rel)
                self._record_file_snapshot(turn_id, "write_file", rel, target)
                os.makedirs(os.path.dirname(target), exist_ok=True)
                with open(target, "w", encoding="utf-8") as f:
                    f.write(content)
                self._json_response(200, {"result": f"Successfully wrote {len(content)} characters to file: {rel}"})
                return

            if tool_name in ("replace_file_content", "multi_replace_file_content"):
                rel = args.get("path", "")
                target = _resolve_safe_path(rel)
                if not os.path.exists(target):
                    self._json_response(200, {"result": f"File does not exist: {rel}"})
                    return
                with open(target, "r", encoding="utf-8", errors="replace") as f:
                    original = f.read()
                
                target_content = args.get("targetContent", "")
                replacement = args.get("replacementContent", "")
                
                if target_content in original:
                    self._record_file_snapshot(turn_id, "replace_file_content", rel, target)
                    updated = original.replace(target_content, replacement, 1)
                    with open(target, "w", encoding="utf-8") as f:
                        f.write(updated)
                    self._json_response(200, {"result": f"Successfully updated file: {rel}"})
                else:
                    self._json_response(200, {"result": f"[Error]: Target content could not be found in file: {rel}"})
                return

            if tool_name == "grep_search":
                query = args.get("query", "")
                rel = args.get("path", ".") or "."
                if not query:
                    self._json_response(200, {"result": "Error: Missing 'query' parameter."})
                    return
                search_dir = _resolve_safe_path(rel)
                matches = []
                query_lower = query.lower()
                ignore_dirs = {".git", "node_modules", "dist", "out", ".vscode", "__pycache__"}
                bin_exts = {".png", ".jpg", ".jpeg", ".ico", ".exe", ".pdf", ".zip", ".tar", ".gz", ".woff", ".woff2", ".ttf"}

                for root, dirs, files in os.walk(search_dir):
                    dirs[:] = [d for d in dirs if d not in ignore_dirs]
                    for file in files:
                        if os.path.splitext(file)[1].lower() in bin_exts:
                            continue
                        fpath = os.path.join(root, file)
                        try:
                            with open(fpath, "r", encoding="utf-8", errors="ignore") as f:
                                lines = f.readlines()
                            file_matched = False
                            for idx, l in enumerate(lines):
                                if query_lower in l.lower():
                                    if not file_matched:
                                        rel_fpath = os.path.relpath(fpath, workspace_path)
                                        matches.append(f"\nFile: {rel_fpath}")
                                        file_matched = True
                                    matches.append(f"Line {idx + 1}: {l.strip()}")
                        except Exception:
                            pass

                if not matches:
                    self._json_response(200, {"result": f"No matches found for query: '{query}'"})
                else:
                    out = "\n".join(matches)
                    if len(out) > 6000:
                        out = out[:6000] + "\n... [truncated]"
                    self._json_response(200, {"result": out})
                return

            if tool_name == "run_command":
                cmd = args.get("command", "")
                if not cmd:
                    self._json_response(200, {"result": "Error: Missing 'command' parameter."})
                    return
                import subprocess
                cwd = workspace_path if (workspace_path and os.path.isdir(workspace_path)) else str(APP_DIR)
                res = subprocess.run(cmd, shell=True, cwd=cwd, capture_output=True, text=True, timeout=30)
                output = ""
                if res.stdout:
                    output += f"[Stdout]:\n{res.stdout}\n"
                if res.stderr:
                    output += f"[Stderr]:\n{res.stderr}\n"
                if res.returncode != 0:
                    output += f"[Exit Code]: {res.returncode}\n"
                if not output.strip():
                    output = "Command executed successfully (empty output)."
                self._json_response(200, {"result": output})
                return

            if tool_name == "delete_item":
                paths = args.get("paths") or [args.get("path")]
                paths = [p for p in paths if p]
                deleted = []
                errors = []
                import shutil
                for p in paths:
                    try:
                        target = _resolve_safe_path(p)
                        if target == workspace_path:
                            errors.append(f"Cannot delete workspace root: {p}")
                            continue
                        if os.path.isdir(target):
                            shutil.rmtree(target)
                            deleted.append(p)
                        elif os.path.isfile(target):
                            os.remove(target)
                            deleted.append(p)
                        else:
                            errors.append(f"Item does not exist: {p}")
                    except Exception as e:
                        errors.append(f"Failed to delete '{p}': {e}")
                res_lines = []
                if deleted:
                    res_lines.append(f"Successfully deleted: {', '.join(deleted)}")
                if errors:
                    res_lines.append(f"Errors:\n" + "\n".join(errors))
                self._json_response(200, {"result": "\n".join(res_lines)})
                return

            if tool_name == "get_time" or (tool_name == "utility_tools" and args.get("action") == "get_time"):
                import datetime
                now = datetime.datetime.now()
                res = f"Current Local Date and Time: {now.strftime('%A, %B %d, %Y at %H:%M:%S')} (ISO: {now.isoformat()})"
                self._json_response(200, {"result": res})
                return

            self._json_response(400, {"result": f"[Error]: Unknown tool '{tool_name}'"})

        except Exception as e:
            self._json_response(500, {"result": f"[Error executing {tool_name}]: {str(e)}"})

    def _handle_workspace_pick(self):
        """Opens native OS folder picker dialog to select absolute workspace path."""
        import threading
        result = {"path": "", "name": "", "canceled": False, "error": None}

        def _ask():
            try:
                import tkinter
                import tkinter.filedialog
                root = tkinter.Tk()
                root.withdraw()
                root.wm_attributes('-topmost', 1)
                folder_path = tkinter.filedialog.askdirectory(title="Select Workspace Folder")
                root.destroy()
                if folder_path:
                    norm_path = os.path.normpath(folder_path)
                    result["path"] = norm_path
                    result["name"] = os.path.basename(norm_path)
                else:
                    result["canceled"] = True
            except Exception as e:
                result["error"] = str(e)

        thread = threading.Thread(target=_ask)
        thread.start()
        thread.join(timeout=60)

        if result["error"]:
            self._json_response(500, {"error": result["error"]})
        elif result["path"]:
            self._json_response(200, {"workspacePath": result["path"], "workspaceName": result["name"]})
        else:
            self._json_response(200, {"workspacePath": "", "workspaceName": "", "canceled": True})

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
            result = _call_mcp_tool("get-single-web-page-content", {"url": url})
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
