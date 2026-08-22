#!/usr/bin/env python3
"""
run_pc.py: Lightweight launcher for KAI Agent local browser preview.
Starts the pure Node.js preview server and automatically opens the browser.
All application logic, tools, and model handling execute via JavaScript.
"""

import subprocess
import sys
import time
import webbrowser
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent
PREVIEW_SERVER_JS = APP_DIR / "preview_server.js"
PORT = 5173
URL = f"http://localhost:{PORT}/index.html"


def main():
    print("=" * 60)
    print("  KAI Agent Browser Preview Launcher")
    print("=" * 60)

    # 1. Ensure TypeScript is compiled
    dist_dir = APP_DIR / "dist" / "main"
    if not dist_dir.exists():
        print("[Launcher] Compiling TypeScript backend...")
        subprocess.run(["cmd", "/c", "npm", "run", "compile"], cwd=str(APP_DIR))

    # 2. Launch pure Node.js preview server
    print(f"[Launcher] Starting Node.js Preview Server on port {PORT}...")
    try:
        proc = subprocess.Popen(
            ["node", str(PREVIEW_SERVER_JS)],
            cwd=str(APP_DIR)
        )
    except Exception as e:
        print(f"[Launcher Error]: Failed to start node: {e}", file=sys.stderr)
        sys.exit(1)

    # 3. Open browser
    time.sleep(0.8)
    print(f"[Launcher] Opening browser at {URL}...")
    try:
        webbrowser.open(URL)
    except Exception:
        pass

    try:
        proc.wait()
    except KeyboardInterrupt:
        print("\n[Launcher] Shutting down preview server...")
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except Exception:
            proc.kill()


if __name__ == "__main__":
    main()
