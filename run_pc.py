#!/usr/bin/env python3
"""
run_pc.py: Lightweight development server for previewing the KAI Agent UI in a browser.
Serves static renderer files from src/renderer and opens the local URL.
"""

import http.server
import socketserver
import sys
import webbrowser
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent
RENDERER_DIR = APP_DIR / "src" / "renderer"


class KaiStaticServer(http.server.SimpleHTTPRequestHandler):
    """Simple static HTTP handler serving the src/renderer directory."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(RENDERER_DIR), **kwargs)

    def log_message(self, format, *args):
        # Suppress noisy standard request logging
        pass


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
            except Exception as e:
                print(f"Could not automatically open browser: {e}")
            httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
    except OSError as e:
        if "Address already in use" in str(e) or getattr(e, "errno", None) in (98, 10048):
            print(f"Port {port} in use, trying port {port + 1}...")
            start_server(port + 1)
        else:
            raise


if __name__ == "__main__":
    start_server(5173)
