#!/usr/bin/env python3
"""
run_pc.py: Lightweight launcher for KAI Agent local browser preview.
Starts the pure Node.js preview server and automatically opens the browser.
All application logic, tools, and model handling execute via JavaScript.
"""

import subprocess
import sys
import time
import urllib.request
import webbrowser
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent
PREVIEW_SERVER_JS = APP_DIR / "preview_server.js"
PORT = 5173
URL = f"http://localhost:{PORT}/index.html"
HEALTH_URL = f"http://127.0.0.1:{PORT}/api/health"


def wait_for_server(proc: subprocess.Popen, timeout_seconds: float = 6.0) -> bool:
    """Polls /api/health until the preview server is ready or the process exits."""
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            return False
        try:
            with urllib.request.urlopen(HEALTH_URL, timeout=0.5) as resp:
                if resp.status == 200:
                    return True
        except Exception:
            time.sleep(0.2)
    return proc.poll() is None


def main():
    """
    Main entry point for local browser preview launcher.
    Compiles TypeScript if missing, frees lingering node preview processes on port 5173,
    starts Node.js preview server, waits for /api/health, and launches browser.
    """
    print("=" * 60)
    print("  KAI Agent Browser Preview Launcher")
    print("=" * 60)

    # 1. Ensure TypeScript is compiled
    dist_dir = APP_DIR / "dist" / "main"
    if not dist_dir.exists():
        print("[Launcher] Compiling TypeScript backend...")
        compile_res = subprocess.run(["cmd", "/c", "npm", "run", "compile"], cwd=str(APP_DIR))
        if compile_res.returncode != 0:
            print(f"[Launcher Error]: TypeScript compilation failed (exit code {compile_res.returncode}).", file=sys.stderr)
            sys.exit(compile_res.returncode)

    # 2. Free lingering Node.js preview server on port 5173 without terminating unrelated apps
    if sys.platform == "win32":
        try:
            kill_cmd = (
                f"Get-NetTCPConnection -LocalPort {PORT} -ErrorAction SilentlyContinue | "
                "ForEach-Object { $p = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue; "
                "if ($p -and $p.ProcessName -eq 'node') { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } }"
            )
            subprocess.run(["powershell", "-NoProfile", "-Command", kill_cmd], capture_output=True, timeout=5)
        except Exception as exc:
            print(f"[Launcher Warning]: Could not inspect port {PORT}: {exc}", file=sys.stderr)

    # 3. Launch pure Node.js preview server
    print(f"[Launcher] Starting Node.js Preview Server on port {PORT}...")
    try:
        proc = subprocess.Popen(
            ["node", str(PREVIEW_SERVER_JS)],
            cwd=str(APP_DIR)
        )
    except Exception as e:
        print(f"[Launcher Error]: Failed to start node: {e}", file=sys.stderr)
        sys.exit(1)

    # 4. Wait for server readiness before opening browser
    if not wait_for_server(proc):
        print(f"[Launcher Error]: Preview server exited early (code {proc.returncode}).", file=sys.stderr)
        sys.exit(proc.returncode or 1)

    print(f"[Launcher] Opening browser at {URL}...")
    try:
        webbrowser.open(URL)
    except Exception as exc:
        print(f"[Launcher Warning]: Could not open browser automatically ({exc}). Open {URL} manually.")

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
