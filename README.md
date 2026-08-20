# KAI Agent - Standalone Desktop Application

KAI Agent Standalone is an autonomous AI developer desktop application built on Electron, TypeScript, and modern web standards. It delivers an independent, full-screen environment for AI-assisted software engineering, project management, multi-provider model routing, offline inference, and automated workspace tooling.

---

## Table of Contents

1. Architecture Explanation
2. Codebase Overview and File Structure
3. Installation and Setup Guide
4. Operational Modes
5. Tool Protocol and Execution Lifecycle
6. Multi-Provider Intelligence Engine
7. Deep Reasoning and Thinking Protocol
8. Settings and Configuration
9. License

---

## 1. Architecture Explanation

The standalone desktop application implements a three-tier architecture separating system orchestration from UI rendering:

```
+-----------------------------------------------------------------------+
| Electron Main Process (Node.js Environment)                           |
|                                                                       |
|  +-----------------------------------------------------------------+  |
|  | main.ts (App Lifecycle, BrowserWindow, Native OS Menus)         |  |
|  +-----------------------------------------------------------------+  |
|                                  |                                    |
|                                  v                                    |
|  +-----------------------------------------------------------------+  |
|  | AppHost.ts (IPC Dispatcher & Host Orchestrator)                 |  |
|  +-----------------------------------------------------------------+  |
|          |                                   |                        |
|          +---> WorkspaceManager.ts           +---> AgentExecutor.ts   |
|          |     (Folder Boundaries & Sandboxing)   (Tool Loop & Engine)|
|          |                                             |              |
|          |                                             v              |
|          |                                 +-----------------------+  |
|          |                                 | LMStudioClient.ts     |  |
|          |                                 | Cloud Providers       |  |
|          |                                 +-----------------------+  |
+-----------------------------------------------------------------------+
                                   |
                  ipcRenderer / contextBridge Protocol
                                   |
+-----------------------------------------------------------------------+
| Preload Security Layer (src/main/preload.ts)                          |
| - Exposes window.electronAPI with postMessage & onMessage             |
| - Isolates Node.js runtime from DOM rendering engine                  |
+-----------------------------------------------------------------------+
                                   |
+-----------------------------------------------------------------------+
| Renderer Process (Chromium Webview Environment)                       |
|                                                                       |
|  +-----------------------------------------------------------------+  |
|  | index.html (Main Layout: Collapsible Sidebar + Chat View)       |  |
|  +-----------------------------------------------------------------+  |
|          |                                                            |
|          +---> main.js (Renderer Controller Wiring)                   |
|          +---> WebviewIPCBridge.js (IPC Communication Layer)          |
|          +---> HashRouter.js (View Switching: Chat, Settings, Help)  |
|          +---> ChatUIController.js (Message Stream & UI Rendering)    |
|          +---> ModelDropdownController.js (Model Selector & Flyout)   |
|          +---> SettingsController.js (Configuration Manager)          |
|          +---> HelpModalController.js (Quick Guide & Shortcuts)       |
|          +---> FileUploadController.js (Attachment Manager)           |
|          +---> HistoryManager.js (Session History in Left Sidebar)    |
|          +---> MarkdownFormatter.js (Markdown & Code Rendering)       |
|          +---> main.css (Dark Design Tokens & Pill Styling)           |
+-----------------------------------------------------------------------+
```

---

## 2. Codebase Overview and File Structure

Below is an exhaustive breakdown of the standalone desktop application source tree:

```
KAI Agent App/
├── src/
│   ├── main/                                   # Electron Main Process Source
│   │   ├── main.ts                             # Application entry point, window management, lifecycle events
│   │   ├── preload.ts                          # Context isolation bridge exposing electronAPI to renderer
│   │   ├── AppHost.ts                          # Host IPC message router and provider delegator
│   │   ├── AgentExecutor.ts                    # Autonomous multi-step tool execution loop
│   │   ├── LMStudioClient.ts                   # Local LM Studio API client
│   │   ├── WorkspaceManager.ts                 # Active workspace directory resolver and path sandboxing
│   │   └── providers/                          # AI Provider Implementations
│   │       ├── ILLMProvider.ts                 # Common LLM client interface
│   │       ├── LLMProviderFactory.ts           # Model provider resolver
│   │       ├── LMStudioReasoningEngine.ts      # Thinking parameter injection engine
│   │       ├── LMStudioManifestParser.ts       # Local model manifest inspector
│   │       ├── MuseGlimmerStreamParser.ts      # Embedded reasoning stream parser
│   │       ├── GeminiClient.ts                 # Google Gemini client
│   │       ├── MistralClient.ts                # Mistral AI and Codestral client
│   │       ├── FreeProviderClient.ts           # OpenRouter, Cerebras, Cohere, Zhipu, Together AI
│   │       └── ReasoningContent.ts             # Data models for thinking segments
│   │
│   └── renderer/                               # Renderer Webview Source
│       ├── index.html                          # Main desktop application HTML shell
│       └── media/                              # Frontend Styles, Scripts, and Assets
│           ├── main.css                        # Desktop stylesheets: tokens, animations, pill controls
│           ├── main.js                         # Renderer initialization and dependency injection
│           ├── js/                             # ES6 OOP Controllers
│           │   ├── AppState.js                 # Global reactive application state
│           │   ├── WebviewIPCBridge.js         # Unified IPC bridge (Electron + Web preview fallback)
│           │   ├── HashRouter.js               # Client-side hash routing (`#chat`, `#settings`, `#help`)
│           │   ├── ChatUIController.js         # Chat stream renderer, message bubbles, action cards
│           │   ├── ModelDropdownController.js  # Model selector and thinking flyout submenu
│           │   ├── SettingsController.js       # Settings categories and API key management
│           │   ├── HelpModalController.js      # Help modal dialog and shortcut documentation
│           │   ├── FileUploadController.js     # Drag-and-drop file attachment pipeline
│           │   ├── HistoryManager.js           # Conversation history list in collapsible left sidebar
│           │   ├── ModeManager.js              # Mode selector manager (Agent, Ask, Plan)
│           │   ├── MarkdownFormatter.js        # Markdown parser and code syntax highlighter
│           │   ├── DOMUtils.js                 # DOM query and element creation utilities
│           │   ├── Constants.js                # App constants, fallback models, provider metadata
│           │   └── WelcomeHeroComponent.js     # Welcome banner and prompt starters
│           ├── codicons/                       # Icon fonts
│           └── svg/                            # Standalone vector icons
│
├── run_pc.py                                   # Python local server runner with API tool proxy
├── package.json                                # Electron build configuration and dependencies
├── tsconfig.json                               # TypeScript compiler configuration
└── README.md                                   # Desktop application documentation
```

---

## 3. Installation and Setup Guide

### Prerequisites
- Node.js `18.x` or higher and `npm`.
- Python `3.9` or higher (optional, for running via `run_pc.py`).
- LM Studio (optional, for local offline models).

### Option A: Running via Electron (Recommended)

1. Open a terminal in the `KAI Agent App` folder:
   ```bash
   cd "KAI Agent App"
   npm install
   ```

2. Start the application in development mode:
   ```bash
   npm run dev
   ```

3. Build production desktop binaries:
   ```bash
   npm run build
   ```

### Option B: Running via Python Local Server

You can launch the web application with local Python backend tooling directly:
```bash
cd "KAI Agent App"
python run_pc.py
```
This starts a local web server (typically on `http://127.0.0.1:8000`) providing full file, shell, and web search proxy capabilities.

---

## 4. Operational Modes

- **Agent Mode**: Full autonomous operation. The model can inspect folders, search code with regular expressions, read and write files, apply precision diff replacements, check compilation diagnostics, and execute shell commands to complete complex end-to-end tasks.
- **Ask Mode**: Read-only exploration and question answering. File modifications and destructive shell commands are strictly disabled, making this mode safe for code reviews, architectural questions, and code explanations.
- **Plan Mode**: Enforces a strict two-phase protocol. The model must produce an exhaustive, step-by-step implementation plan before writing any code. The user reviews the plan and approves execution using the `Proceed with Plan` action.

---

## 5. Tool Protocol and Execution Lifecycle

| Tool | XML Tag | Description |
| :--- | :--- | :--- |
| `read_file` | `<read_file path="..."/>` | Reads file content with optional line slicing (`start_line`, `end_line`) |
| `write_file` | `<write_file path="...">...</write_file>` | Writes full file content, creating parent directories if missing |
| `replace_file_content` | `<replace_file_content path="...">...</replace_file_content>` | Replaces an exact single contiguous block of code |
| `multi_replace_file_content` | `<multi_replace_file_content path="...">...</multi_replace_file_content>` | Applies multiple non-contiguous edits in a single turn |
| `delete_item` | `<delete_item path="..."/>` | Deletes a file or directory inside the active workspace |
| `list_dir` | `<list_dir path="..."/>` | Lists folder contents with sizes and child counts |
| `grep_search` | `<grep_search query="..." path="..."/>` | Fast regex search with line-number matching |
| `symbol_search` | `<symbol_search query="..."/>` | Searches workspace symbols across code files |
| `get_diagnostics` | `<get_diagnostics path="..."/>` | Retrieves compiler/linter diagnostics for a file |
| `run_command` | `<run_command>...</run_command>` | Executes PowerShell/Bash shell commands in the workspace root |
| `web_search` | `<web_search query="..."/>` | Runs live online web searches |
| `fetch_url` | `<fetch_url url="..."/>` | Scrapes web page and converts content to markdown |

---

## 6. Multi-Provider Intelligence Engine

- **LM Studio Local Server**: Full support for local models via `http://localhost:1234/v1` with zero data leakage.
- **Google Gemini**: Deep thinking model support with customizable token budgets and streaming responses.
- **Mistral AI & Codestral**: High-speed code generation and specialized reasoning.
- **Cloud Providers**: Cohere, Cerebras, OpenRouter, Zhipu AI, Groq, and Together AI with secure global key storage.
- **Auto Model Detection**: Automatically queries LM Studio (`/api/v0/models` and `/v1/models`) to populate the active model dropdown.

---

## 7. Deep Reasoning and Thinking Protocol

- **Jinja Template Compatibility**: Automatically reads model manifest files to extract `enable_thinking` and `chat_template_kwargs` arguments.
- **Reasoning Effort Control**: Choose between `xhigh`, `medium`, `low`, `minimal`, and `off` directly from the model selector flyout.
- **Zero Configuration Mutation**: All parameters are transmitted strictly as ephemeral payload properties per HTTP request, preserving local LM Studio presets.
- **Collapsible Thinking Cards**: Interactive UI cards that allow expanding, collapsing, and inspecting reasoning trajectories during and after generation.

---

## 8. Settings and Configuration

Global settings are stored securely in the user profile configuration directory:

- **Local Server URL**: Configure custom port or remote host for LM Studio.
- **API Keys**: Store API keys for cloud providers without saving secrets into project repositories.
- **Language**: English, Dutch, French, German, Spanish, Chinese, Japanese.
- **Thinking Display**: Configure accordion summary vs expanded thoughts.

---

## 9. License

Proprietary. Developed by Kenji Kellens. All rights reserved.
