#!/usr/bin/env python3
"""
run_pc.py: Live development server for KAI Agent Standalone Webview UI.
Handles real-time communication with LM Studio, session management (save/delete/load chat),
free cloud provider listings, and serves the frontend Webview interface.
"""

import http.server
import socketserver
import os
import sys
import json
import subprocess
import urllib.request
import urllib.error
import webbrowser
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent
RENDERER_DIR = APP_DIR / "src" / "renderer"
SVG_DIR = RENDERER_DIR / "media" / "svg"
CONFIG_DIR = Path.home() / ".kai-agent"
CONFIG_FILE = CONFIG_DIR / "config.json"
SESSIONS_FILE = CONFIG_DIR / "sessions.json"

DEFAULT_PROVIDERS = [
    {
        "name": "OmniRoute Gateway",
        "configKey": "omnirouteApiKey",
        "keyHint": "Run OmniRoute via npm: npx omniroute",
        "models": ["omniroute/auto"]
    },
    {
        "name": "Mistral AI",
        "configKey": "mistralApiKey",
        "keyHint": "Get free key at console.mistral.ai",
        "models": [
            "mistral/magistral-small-latest",
            "mistral/magistral-medium-latest",
            "mistral/mistral-small-latest",
            "mistral/mistral-medium-3-5",
            "mistral/codestral-latest",
            "mistral/open-mixtral-8x22b"
        ]
    },
    {
        "name": "Cohere",
        "configKey": "cohereApiKey",
        "keyHint": "Get free key at dashboard.cohere.com",
        "models": [
            "cohere/command-r-plus",
            "cohere/command-r"
        ]
    },
    {
        "name": "Cerebras",
        "configKey": "cerebrasApiKey",
        "keyHint": "Get free key at cloud.cerebras.ai",
        "models": [
            "cerebras/llama-3.3-70b",
            "cerebras/llama-3.1-8b"
        ]
    },
    {
        "name": "Zhipu AI",
        "configKey": "zhipuApiKey",
        "keyHint": "Get free key at open.bigmodel.cn",
        "models": [
            "zhipu/glm-4-flash",
            "zhipu/glm-4-plus"
        ]
    }
]


def get_config() -> dict:
    """Reads configuration from ~/.kai-agent/config.json."""
    if CONFIG_FILE.exists():
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {
        "serverUrl": "http://localhost:1234/v1",
        "lmStudioCacheDir": "",
        "apiKey": "",
        "language": "auto"
    }


def load_svgs() -> dict:
    """Dynamically reads all SVG files from media/svg directory on disk."""
    svgs = {}
    if SVG_DIR.exists():
        for file in SVG_DIR.glob("*.svg"):
            try:
                svgs[file.stem] = file.read_text(encoding="utf-8").strip()
            except Exception:
                pass
    return svgs


def query_lmstudio_models(server_url: str) -> tuple[bool, list]:
    """Queries live LM Studio server for currently available chat models."""
    url = f"{server_url.rstrip('/')}/models"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "KAI-Agent"})
        with urllib.request.urlopen(req, timeout=1.5) as resp:
            if resp.status == 200:
                data = json.loads(resp.read().decode("utf-8"))
                models = [m.get("id") for m in data.get("data", []) if m.get("id")]
                chat_models = [m for m in models if not any(x in m.lower() for x in ["embed", "nomic-embed", "bge-", "minilm"])]
                return True, chat_models
    except Exception:
        pass
    return False, []


def query_loaded_models() -> list:
    """Queries models actively loaded into RAM/VRAM via `lms ps --json` matching LMStudioClient."""
    try:
        res = subprocess.run(["lms", "ps", "--json"], capture_output=True, text=True, timeout=2)
        if res.returncode == 0 and res.stdout.strip():
            parsed = json.loads(res.stdout)
            if isinstance(parsed, list):
                return [m.get("modelKey") or m.get("identifier") or m.get("path") for m in parsed if m]
    except Exception:
        pass
    return []


def read_sessions() -> dict:
    """Reads saved sessions from ~/.kai-agent/sessions.json."""
    if SESSIONS_FILE.exists():
        try:
            with open(SESSIONS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def write_sessions(data: dict) -> None:
    """Writes sessions dict to ~/.kai-agent/sessions.json."""
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    with open(SESSIONS_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def load_all_locales() -> dict:
    """Reads all compiled translations from media/js/AllLocales.js."""
    locales_file = RENDERER_DIR / "media" / "js" / "AllLocales.js"
    if locales_file.exists():
        try:
            txt = locales_file.read_text(encoding="utf-8")
            start = txt.find("{")
            end = txt.rfind("}") + 1
            if start != -1 and end != -1:
                return json.loads(txt[start:end])
        except Exception:
            pass
    return {}


def get_translations_for_lang(lang: str) -> dict:
    all_locales = load_all_locales()
    if not lang or lang == "auto":
        lang = "en"
    return all_locales.get(lang) or all_locales.get("en", {})


class KaiLiveRequestHandler(http.server.SimpleHTTPRequestHandler):
    """
    HTTP Request Handler that serves renderer static files and handles /api/ipc endpoints.
    """
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(RENDERER_DIR), **kwargs)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_POST(self):
        if self.path == "/api/ipc":
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length).decode("utf-8")
            try:
                msg = json.loads(body)
            except Exception:
                msg = {}

            response_data = self.handle_ipc_message(msg)
            response_bytes = json.dumps(response_data).encode("utf-8")

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(response_bytes)))
            self.end_headers()
            self.wfile.write(response_bytes)
        else:
            self.send_error(404, "Endpoint not found")

    def build_connection_status(self) -> dict:
        config = get_config()
        server_url = config.get("serverUrl", "http://localhost:1234/v1")
        connected, models = query_lmstudio_models(server_url)
        loaded_models = query_loaded_models()
        active_model = loaded_models[0] if loaded_models else (models[0] if models else "local-model")
        svgs = load_svgs()
        workspace_path = str(APP_DIR)
        active_lang = config.get("language", "auto")
        translations = get_translations_for_lang(active_lang)

        free_providers = [
            {
                "name": p["name"],
                "configKey": p["configKey"],
                "keyHint": p["keyHint"],
                "models": p["models"],
                "apiKey": config.get(p["configKey"], "")
            }
            for p in DEFAULT_PROVIDERS
        ]

        return {
            "type": "connectionStatus",
            "connected": connected,
            "model": active_model,
            "lmStudioModels": models,
            "geminiModels": [
                "gemini-3.7-flash",
                "gemini-3.6-flash",
                "gemini-3.5-flash",
                "gemini-3.5-flash-lite",
                "gemini-3-flash-preview",
                "gemini-3.1-pro-preview",
                "gemini-3.1-flash-lite"
            ],
            "loadedModels": loaded_models,
            "freeProviders": free_providers,
            "serverUrl": server_url,
            "apiKey": config.get("apiKey", ""),
            "lmStudioCacheDir": config.get("lmStudioCacheDir", ""),
            "lmStudioCacheStatus": {"valid": True},
            "workspacePath": workspace_path,
            "workspaceName": Path(workspace_path).name,
            "language": active_lang,
            "translations": translations,
            "svgs": svgs
        }

    def handle_ipc_message(self, msg: dict) -> dict:
        """Dispatches live IPC commands."""
        msg_type = msg.get("type")
        config = get_config()
        server_url = config.get("serverUrl", "http://localhost:1234/v1")

        if msg_type == "checkConnection":
            return self.build_connection_status()

        elif msg_type == "updateSettings":
            cfg = get_config()
            for k, v in msg.items():
                if k != "type" and v is not None:
                    cfg[k] = v
            CONFIG_DIR.mkdir(parents=True, exist_ok=True)
            with open(CONFIG_FILE, "w", encoding="utf-8") as f:
                json.dump(cfg, f, indent=2)
            return self.build_connection_status()

        elif msg_type == "loadChatHistory":
            sessions = read_sessions()
            chats = sorted(sessions.values(), key=lambda x: x.get("timestamp", 0), reverse=True)
            return {"type": "chatHistory", "chats": chats}

        elif msg_type == "deleteChat":
            chat_id = msg.get("chatId")
            sessions = read_sessions()
            if chat_id and chat_id in sessions:
                del sessions[chat_id]
                write_sessions(sessions)
            updated_chats = sorted(sessions.values(), key=lambda x: x.get("timestamp", 0), reverse=True)
            return {"type": "chatHistory", "chats": updated_chats}

        elif msg_type == "loadChat":
            chat_id = msg.get("chatId")
            sessions = read_sessions()
            found = sessions.get(chat_id)
            if found:
                return {"type": "loadChat", "chat": found}
            return {"type": "replyError", "message": "Chat session not found"}

        elif msg_type == "saveChat":
            chat = msg.get("chat", {})
            if chat.get("id"):
                sessions = read_sessions()
                sessions[chat["id"]] = chat
                write_sessions(sessions)
            return {"type": "saveChatResult", "success": True}

        elif msg_type == "openFilePicker":
            files = []
            try:
                import tkinter as tk
                from tkinter import filedialog
                root = tk.Tk()
                root.withdraw()
                root.attributes("-topmost", True)
                file_paths = filedialog.askopenfilenames(
                    title="Attach Files",
                    filetypes=[
                        ("All Supported Files", "*.js;*.ts;*.jsx;*.tsx;*.py;*.html;*.css;*.json;*.md;*.txt;*.csv;*.png;*.jpg;*.jpeg;*.webp"),
                        ("All Files", "*.*")
                    ]
                )
                root.destroy()
                for fp in file_paths:
                    p = Path(fp)
                    if p.exists() and p.stat().st_size <= 2 * 1024 * 1024:
                        try:
                            content = p.read_text(encoding="utf-8", errors="replace")
                        except Exception:
                            content = ""
                        files.append({
                            "fileName": p.name,
                            "filePath": str(p),
                            "relativePath": p.name,
                            "content": content
                        })
            except Exception:
                pass
            return {"type": "filesSelected", "files": files}

        elif msg_type == "browseWorkspaceFolder":
            try:
                import tkinter as tk
                from tkinter import filedialog
                root = tk.Tk()
                root.withdraw()
                root.attributes("-topmost", True)
                folder_path = filedialog.askdirectory(title="Select Workspace Folder")
                root.destroy()
                if folder_path:
                    p = Path(folder_path)
                    return {
                        "type": "connectionStatus",
                        "workspacePath": str(p),
                        "workspaceName": p.name
                    }
            except Exception:
                pass
            return {"type": "ack"}

        elif msg_type == "sendMessage":
            messages = msg.get("messages", [])
            model = msg.get("model", "local-model")
            return self.execute_chat_request(messages, model, server_url)

        return {"type": "ack"}

    def execute_chat_request(self, messages: list, model: str, server_url: str) -> dict:
        """Sends chat request to local LM Studio server."""
        url = f"{server_url.rstrip('/')}/chat/completions"
        payload = {
            "model": model,
            "messages": messages,
            "temperature": 0.2,
            "stream": False
        }
        try:
            req = urllib.request.Request(
                url,
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json", "User-Agent": "KAI-Agent"}
            )
            with urllib.request.urlopen(req, timeout=60) as resp:
                if resp.status == 200:
                    data = json.loads(resp.read().decode("utf-8"))
                    content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
                    return {
                        "type": "reply",
                        "content": content,
                        "modifiedFiles": []
                    }
        except urllib.error.URLError as e:
            return {
                "type": "replyError",
                "message": f"Cannot connect to LM Studio at {server_url}. Make sure the server is started in LM Studio."
            }
        except Exception as e:
            return {
                "type": "replyError",
                "message": f"Error from LLM: {str(e)}"
            }


def start_server(port: int = 5173) -> None:
    """Starts the HTTP server and opens the browser."""
    if not RENDERER_DIR.exists():
        print(f"Error: Renderer directory not found at {RENDERER_DIR}", file=sys.stderr)
        sys.exit(1)

    url = f"http://localhost:{port}/index.html"
    print("=" * 60)
    print("  KAI Agent Standalone Live UI Server")
    print("=" * 60)
    print(f"  UI Directory:  {RENDERER_DIR}")
    print(f"  Local URL:     {url}")
    print(f"  Live Backend:  http://localhost:1234/v1 (LM Studio)")
    print("=" * 60)

    socketserver.TCPServer.allow_reuse_address = True

    try:
        with socketserver.TCPServer(("", port), KaiLiveRequestHandler) as httpd:
            try:
                webbrowser.open(url)
            except Exception as e:
                print(f"Could not automatically open browser: {e}")
            httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
    except OSError as e:
        if "Address already in use" in str(e) or e.errno in (98, 10048):
            print(f"Port {port} in use, trying port {port + 1}...")
            start_server(port + 1)
        else:
            raise


if __name__ == "__main__":
    start_server(5173)
