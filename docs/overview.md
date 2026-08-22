# KAI Agent - Architectural Overview & System Design

This document describes the core architecture, execution models, and design guidelines for the **KAI Agent** platform.

---

## 1. Dual Deployment Ecosystem

The KAI Agent ecosystem comprises two primary target runtimes sharing the same JavaScript/TypeScript core:

1. **Standalone Desktop Application (Electron EXE)**:
   - Root: `KAI Agent App/`
   - Main Process: `src/main/` (`AppHost.ts`, `AgentExecutor.ts`, `LMStudioClient.ts`)
   - Renderer UI: `src/renderer/` (`index.html`, `main.css`, `media/js/`)
   - Local Browser Preview: `run_pc.py` launches `preview_server.js` (Node.js) which executes the exact same JS/TS tool and service classes.
2. **VS Code & Antigravity IDE Extension**:
   - Root: `Kai-Agent-extension/`
   - Extension Host: `code/src/` (`SidebarProvider.ts`, `AgentExecutor.ts`, `LMStudioClient.ts`)
   - Webview UI: `code/media/` (`main.js`, `main.css`, `js/`)

---

## 2. JavaScript / TypeScript-First Architecture

- **Single Source of Truth**: All agent tool implementations, prompt orchestrations, model switching mechanics, and filesystem mutations are implemented strictly in **TypeScript/JavaScript**.
- **No Business Logic in Python**: The Python script (`run_pc.py`) acts solely as a minimal launcher for `preview_server.js` and does not duplicate tool execution or prompt parsing.

---

## 3. Core Subsystems

### A. Turn File Snapshots & In-Place Rollback
- Implemented via `TurnSnapshotManager.ts`.
- Automatically records a pre-mutation snapshot of any file before `write_file`, `replace_file_content`, `multi_replace_file_content`, or `delete_item` executes.
- When a user edits a prompt or retries a turn:
  1. The UI DOM is truncated to the edited turn.
  2. `TurnSnapshotManager.rollbackTurn(turnId)` restores modified/deleted files and deletes created files in reverse chronological order.
  3. The prompt is re-executed with the cleanly reset filesystem baseline.

### B. LM Studio Model Management & Single-Model Rule
- **Max 1 Loaded Model Enforcement**:
  - Prior to dispatching a completion request to a different local model, `LMStudioClient.ensureSingleLoadedModel(model)` checks currently loaded models (`lms ps`).
  - If a different model is active in VRAM, it automatically unloads all previous models (`lms unload --all`) before loading the target model.
  - If the requested model is already loaded in memory, it is preserved in VRAM without redundant reload overhead.
- **Dynamic Reasoning Parameters**:
  - Thinking and reasoning parameters (`thinking: true/false`, `enable_thinking`, `chat_template_kwargs`, `reasoning_effort`) are passed as per-request inference options in the JSON payload and never require model reloads.

### C. Agent Tool Parity
Both runtimes maintain 100% contract parity for all registered agent tools:
- `read_file`
- `write_file`
- `replace_file_content`
- `multi_replace_file_content`
- `delete_item`
- `list_dir`
- `grep_search`
- `symbol_search`
- `get_diagnostics`
- `run_command`
- `web_search`
- `fetch_url`
- `utility_tools`
