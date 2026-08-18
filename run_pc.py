#!/usr/bin/env python3
"""
run_pc.py: Lightweight local testing server for KAI Agent Standalone Webview UI.
Starts a local HTTP server serving the renderer directory and automatically opens
the web interface in your default browser for quick interactive UI testing.
"""

import http.server
import socketserver
import os
import sys
import webbrowser
from pathlib import Path


class KaiUIRequestHandler(http.server.SimpleHTTPRequestHandler):
    """
    Custom HTTP request handler that routes static assets to src/renderer
    and node_modules if needed.
    """
    def __init__(self, *args, **kwargs):
        renderer_dir = Path(__file__).resolve().parent / "src" / "renderer"
        super().__init__(*args, directory=str(renderer_dir), **kwargs)

    def end_headers(self):
        """Adds CORS and no-cache headers for easy development and testing."""
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        super().end_headers()


def start_server(port: int = 5173) -> None:
    """
    Starts the local HTTP server on the specified port and opens the browser.
    """
    app_dir = Path(__file__).resolve().parent
    renderer_dir = app_dir / "src" / "renderer"

    if not renderer_dir.exists():
        print(f"Error: Renderer directory not found at {renderer_dir}", file=sys.stderr)
        sys.exit(1)

    url = f"http://localhost:{port}/index.html"
    print(f"==================================================")
    print(f"  KAI Agent Standalone UI Browser Preview")
    print(f"==================================================")
    print(f"  Serving: {renderer_dir}")
    print(f"  URL:     {url}")
    print(f"  Press Ctrl+C to stop the server.")
    print(f"==================================================")

    # Allow socket address reuse to avoid port collision
    socketserver.TCPServer.allow_reuse_address = True

    try:
        with socketserver.TCPServer(("", port), KaiUIRequestHandler) as httpd:
            # Open the browser automatically
            try:
                webbrowser.open(url)
            except Exception as e:
                print(f"Could not automatically open browser: {e}")

            httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
    except OSError as e:
        if "Address already in use" in str(e) or e.errno == 98 or e.errno == 10048:
            print(f"Port {port} in use, trying port {port + 1}...")
            start_server(port + 1)
        else:
            raise


if __name__ == "__main__":
    start_server(5173)
