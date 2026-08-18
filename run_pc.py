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
        """Serves static files and LM Studio capabilities API."""
        if self.path.startswith("/api/capabilities"):
            caps = get_lmstudio_capabilities()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(caps).encode("utf-8"))
            return
        super().do_GET()

    def do_POST(self):
        """Fallback handler for any POST requests in preview mode."""
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"status":"ok"}')


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
