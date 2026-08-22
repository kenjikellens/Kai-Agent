# KAI Agent - Architectural Overview & System Design

This document provides a comprehensive architectural map, component breakdown, and system design specifications for the **KAI Agent** workspace.

---

## 1. Dual Deployment Ecosystem & Architecture

The KAI Agent ecosystem comprises two primary target runtimes sharing the same JavaScript/TypeScript core:

1. **Standalone Desktop Application (Electron EXE)**:
   - Location: `KAI Agent App/`
   - Main Process: `src/main/` (`AppHost.ts`, `AgentExecutor.ts`, `LMStudioClient.ts`, etc.)
   - Renderer UI: `src/renderer/` (`index.html`, `main.css`, `media/js/`)
   - Local Browser Preview: `run_pc.py` launches a minimal static file server and CORS proxy for rapid web testing.
2. **VS Code & Antigravity IDE Extension**:
   - Location: `Kai-Agent-extension/`
   - Extension Host: `code/src/` (`SidebarProvider.ts`, `AgentExecutor.ts`, `LMStudioClient.ts`, etc.)
   - Webview UI: `code/media/` (`main.js`, `main.css`, `js/`, `svg/`, `codicons/`)

---

## 2. Project File Structure & Core Components Tree

```text
KAI Agent/
│
├── .agents/                               # Workspace Customizations & Documentation
│   ├── AGENTS.md                          # Mandatory workspace rules & architectural guidelines
│   └── overview.md                        # Master architectural blueprint and file tree
│
├── docs/                                  # Shared Reference Documentation
│   └── model_reference.json               # Model inference parameters, thinking configs & provider metadata
│
├── Kai-Agent-extension/                   # VS Code / Antigravity IDE Extension
│   ├── .agents/
│   │   └── AGENTS.md                      # Synchronized agent guidelines
│   ├── docs/
│   │   ├── model_capabilities.md          # Provider feature matrices
│   │   └── overview.md                    # Synchronized extension overview
│   ├── update.bat                         # Fast build & sync script to IDE extension directories
│   └── code/                              # Extension Source Code
│       ├── package.json                   # Extension manifest, commands & settings schema
│       ├── tsconfig.json                  # TypeScript compiler options
│       ├── prompts/                       # Operational mode system prompts
│       │   ├── system_prompt_agent.md     # Agent mode prompt (full tool autonomy)
│       │   ├── system_prompt_ask.md       # Ask mode prompt (read-only consultation)
│       │   └── system_prompt_planning.md  # Planning mode prompt (structured design artifacts)
│       ├── src/                           # Extension Host Backend (TypeScript)
│       │   ├── extension.ts               # Extension activation & command registrations
│       │   ├── SidebarProvider.ts         # Webview sidebar host, HTML compiler, CSP & IPC bridge
│       │   ├── AgentExecutor.ts           # Tool dispatch pipeline & agent loop orchestration
│       │   ├── TurnSnapshotManager.ts     # In-place file snapshot and turn rollback manager
│       │   ├── I18nManager.ts             # Internationalization & translation dictionary
│       │   ├── providers/                 # LLM Client Provider Implementations
│       │   │   ├── ILLMProvider.ts        # Common provider interface contract
│       │   │   ├── BaseCloudProviderClient.ts # Base cloud provider HTTP abstractions
│       │   │   ├── LMStudioClient.ts      # Local LM Studio API client & model manager
│       │   │   ├── GeminiClient.ts        # Google Gemini Cloud API client
│       │   │   ├── MistralClient.ts       # Mistral AI Cloud API client
│       │   │   ├── CohereClient.ts        # Cohere Command Cloud API client
│       │   │   ├── CerebrasClient.ts      # Cerebras Cloud API client
│       │   │   ├── ZhipuClient.ts         # Zhipu AI (GLM) API client
│       │   │   └── OmniRouteClient.ts     # OmniRoute local AI gateway client
│       │   └── tools/                     # Agent Tool Implementations
│       │       ├── ToolRegistry.ts        # Tool registration and execution dispatcher
│       │       ├── ReadFileTool.ts        # Workspace file reader
│       │       ├── WriteFileTool.ts       # File creator / overwrite tool
│       │       ├── ReplaceFileContentTool.ts # Single-block precise code replacement tool
│       │       ├── MultiReplaceFileContentTool.ts # Multi-chunk code replacement tool
│       │       ├── DeleteItemTool.ts      # File / directory deletion tool
│       │       ├── ListDirTool.ts         # Directory lister & child inspector
│       │       ├── GrepSearchTool.ts      # Regex & text search across files
│       │       ├── SymbolSearchTool.ts    # Workspace code symbol search tool
│       │       ├── DiagnosticsTool.ts     # Linter & language server diagnostics tool
│       │       ├── RunCommandTool.ts      # Terminal command execution tool
│       │       ├── WebSearchTool.ts       # Web search MCP client tool
│       │       ├── FetchUrlTool.ts        # Web page scraper & HTML text fetcher
│       │       └── UtilityTools.ts        # Math, time, UUID & string utilities
│       └── media/                         # Webview Frontend Assets
│           ├── main.js                    # Webview entry script & OOP instantiator
│           ├── main.css                   # Webview CSS styling tokens & components
│           ├── vendor/
│           │   └── mermaid.min.js         # Offline Mermaid diagram rendering bundle
│           ├── codicons/                  # VS Code Codicon webfont icons
│           ├── svg/                       # Standalone SVG icon assets
│           └── js/                        # Modular Frontend OOP Classes
│               ├── AppState.js            # Active chat session state & history tracker
│               ├── Constants.js           # Frontend constant tokens & limits
│               ├── DOMUtils.js            # DOM helpers & SVG icon injectors
│               ├── MarkdownFormatter.js   # Markdown parser, syntax highlighting & card builder
│               ├── MermaidRenderer.js     # Mermaid diagram compiler & SVG exporter
│               ├── WebviewIPCBridge.js    # Bidirectional IPC communication bridge
│               ├── ChatUIController.js    # Message bubble renderer, stream updates & view manager
│               ├── PromptSubmissionOrchestrator.js # Turn submission, retries & prompt edits
│               ├── ModelDropdownController.js # Model selector dropdown & connection status
│               ├── ModeManager.js         # Operational mode switch controller
│               ├── HistoryManager.js      # Session history list controller
│               ├── SettingsController.js  # Settings panels & API key configuration
│               ├── FileSummaryWidget.js   # Modified files summary chip widget
│               ├── FileUploadController.js# Context file attachments handler
│               └── ThinkingStateFormatter.js # Collapsible reasoning thought block parser
│
└── KAI Agent App/                         # Standalone Desktop Application (Electron)
    ├── .agents/
    │   └── AGENTS.md                      # Synchronized desktop app guidelines
    ├── docs/
    │   ├── model_capabilities.md          # Provider feature matrices
    │   └── overview.md                    # Synchronized desktop app overview
    ├── run_pc.py                          # Python local preview server & CORS proxy
    ├── package.json                       # Electron app manifest, dependencies & build targets
    ├── tsconfig.json                      # TypeScript build configuration
    ├── prompts/                           # Operational mode prompts (identical to extension)
    │   ├── system_prompt_agent.md
    │   ├── system_prompt_ask.md
    │   ├── system_prompt_chat.md
    │   ├── system_prompt_chat_workspace.md
    │   └── system_prompt_planning.md
    ├── src/
    │   ├── main/                          # Electron Main Process (TypeScript)
    │   │   ├── index.ts                   # Electron app bootstrap & window lifecycle
    │   │   ├── preload.ts                 # Secure contextBridge IPC exposure
    │   │   ├── AppHost.ts                 # Desktop host service & IPC event broker
    │   │   ├── AgentExecutor.ts           # Tool dispatch & execution pipeline
    │   │   ├── TurnSnapshotManager.ts     # In-place file snapshot & rollback manager
    │   │   ├── I18nManager.ts             # Localization dictionaries
    │   │   ├── providers/                 # LLM provider clients (ILLMProvider, LMStudioClient, etc.)
    │   │   └── tools/                     # Tool implementations (100% parity with extension)
    │   └── renderer/                      # Electron Renderer UI (HTML, CSS, JS)
    │       ├── index.html                 # App layout shell, collapsible sidebar & views
    │       └── media/                     # Static media, CSS, vendor bundles & frontend modules
    │           ├── main.js                # Desktop frontend orchestrator
    │           ├── main.css               # Desktop layout stylesheet & component styling
    │           ├── vendor/
    │           │   └── mermaid.min.js     # Standalone offline Mermaid bundle
    │           └── js/                    # Modular OOP classes (100% parity with extension)
```

---

## 3. Core Subsystems & Technical Mandates

### A. Turn File Snapshots & In-Place Rollback
- Implemented via `TurnSnapshotManager.ts`.
- Automatically captures pre-mutation file snapshots prior to executing mutating tools (`write_file`, `replace_file_content`, `multi_replace_file_content`, `delete_item`).
- When a user retries a turn or edits a previous prompt:
  1. The UI truncates message rows back to the edited turn.
  2. `TurnSnapshotManager.rollbackTurn(turnId)` restores modified/deleted files and deletes created files in reverse chronological order.
  3. The prompt re-executes cleanly on top of the restored baseline.

### B. LM Studio Model Management & Single-Model Rule
- **Max 1 Loaded Model Enforcement**:
  - Prior to dispatching completions to a local model, `LMStudioClient.ensureSingleLoadedModel(model)` checks loaded models (`lms ps`).
  - If a different model is loaded, it unloads previous models (`lms unload --all`) before loading the target model.
  - If the requested model is already in memory, it is preserved without reload latency.
- **Dynamic Reasoning Parameters**:
  - Model-specific reasoning configurations (`thinking`, `enable_thinking`, `chat_template_kwargs`, `reasoning_effort`) are passed as per-request inference parameters.

### C. Agent Tool Parity Contract
Both runtimes maintain 100% contract parity across all registered tools:
`read_file`, `write_file`, `replace_file_content`, `multi_replace_file_content`, `delete_item`, `list_dir`, `grep_search`, `symbol_search`, `get_diagnostics`, `run_command`, `web_search`, `fetch_url`, `utility_tools`.

### D. Mermaid Diagram Rendering Engine
- **Offline Library Integration**: `mermaid.min.js` bundled locally in `media/vendor/` ensuring complete offline capability and strict CSP compliance.
- **Markdown Fenced Code Block Detection**: `MarkdownFormatter.js` formats closed ` ```mermaid ` code blocks into `.mermaid-diagram-card` elements.
- **Asynchronous Rendering Pipeline**: `MermaidRenderer.js` renders SVGs asynchronously via `mermaid.render()`. Errors are caught gracefully, displaying a syntax error notice while preserving chat stability.
- **Interactive Diagram Controls**: Provides Diagram / Code tab switching, Copy Mermaid Code, Copy SVG markup, and Download SVG.
- **Theme Adaptation**: Auto-detects light and dark themes (`vscode-light`, dark tokens) and initializes Mermaid styling variables accordingly.

### E. Triple-File Documentation Synchronization Mandate
Whenever architecture, UI components, runtime features, or system design guidelines are modified, all 3 `AGENTS.md` and all 3 `overview.md` files must be updated simultaneously in lockstep:
1. Root workspace: `.agents/AGENTS.md` and `.agents/overview.md`
2. Desktop App: `KAI Agent App/.agents/AGENTS.md` and `KAI Agent App/docs/overview.md`
3. Extension: `Kai-Agent-extension/.agents/AGENTS.md` and `Kai-Agent-extension/docs/overview.md`
