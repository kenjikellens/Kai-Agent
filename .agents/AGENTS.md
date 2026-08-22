# KAI Agent Workspace Rules & Architecture Guidelines

This file defines the project-level context, architectural mandates, build workflows, and model-specific configurations for the **KAI Agent** workspace.

---

## 1. Project Ecosystem & Structure

This repository contains two core implementations of the KAI Agent ecosystem:
1. **`Kai-Agent-extension/`**: VS Code & Antigravity IDE Extension.
   - Backend / Host: `Kai-Agent-extension/code/src/` (TypeScript).
   - Frontend / Webview: `Kai-Agent-extension/code/media/` (HTML, CSS, JS).
2. **`KAI Agent App/`**: Standalone Desktop Application.
   - Core / Renderer: `KAI Agent App/src/` (TypeScript, Electron Main & Preload).
   - Python Local Preview Server: `KAI Agent App/run_pc.py`.
3. **`docs/`**: Shared documentation and reference configurations (`model_reference.json`).

---

## 2. Build & Execution Rules

- **NEVER execute `install.bat`**: The agent must NEVER run `install.bat` or `.\install.bat`. The user runs installation and packaging manually.
- **Extension Fast Sync**:
  - Compile extension changes: Run `npm run compile` within `Kai-Agent-extension/code`.
  - Sync to IDE extension folder: Execute `Kai-Agent-extension/update.bat`.
- **Desktop App Preview**:
  - Run via Electron: `npm run dev` in `KAI Agent App`.
  - Run via Python preview: `python run_pc.py` in `KAI Agent App`.

---

## 3. Object-Oriented Architecture (OOP) & Modularity

- **Dedicated Class Files**: Never bundle multiple distinct API providers, tools, or major UI modules into a single monolithic class or file.
- **Provider Pattern**:
  - Every LLM provider (e.g., `LMStudioClient`, `GeminiClient`, `MistralClient`, `CohereClient`, `CerebrasClient`, `ZhipuClient`, `OmniRouteClient`) must have its own dedicated class file in `src/providers/`.
  - All providers must implement `ILLMProvider` or extend `BaseCloudProviderClient`.
- **Tool Parity**:
  - Keep tool contracts consistent across both the Extension and the Desktop App (`read_file`, `write_file`, `replace_file_content`, `multi_replace_file_content`, `delete_item`, `list_dir`, `grep_search`, `symbol_search`, `get_diagnostics`, `run_command`, `web_search`, `fetch_url`).
- **Prompt Management**:
  - Operational modes (`agent`, `ask`, `planning`, `chat`) and their behavior contracts must align with the prompt definitions in `system_prompt_*.md`.

---

## 4. LM Studio Reasoning / Thinking Toggles

When implementing or modifying completions in `LMStudioClient.ts` (or equivalent provider logic), dynamically apply the exact model-specific thinking/reasoning parameters:

1. **Gemma Models (`google/gemma-*`)**:
   - **Enable**: `"thinking": true`
   - **Disable**: `"thinking": false`, `"reasoning_effort": "none"`, `"reasoning": "off"`

2. **Qwen & GLM Models (`qwen/*`, `glm/*`)**:
   - **Enable**: `"thinking": true`, `"enable_thinking": true`, `"chat_template_kwargs": { "enable_thinking": true }`
   - **Disable**: `"thinking": false`, `"enable_thinking": false`, `"chat_template_kwargs": { "enable_thinking": false }`, `"reasoning_effort": "none"`, `"reasoning": "off"`

3. **Mistral & Codestral Models (`mistral/*`, `codestral/*`)**:
   - **Enable**: `"reasoning_effort": "high"`
   - **Disable**: `"reasoning_effort": "none"`

4. **Muse Glimmer Models (`muse/*`, `*glimmer*`)**:
   - **Reasoning format**: Emits `to=self<|message|>[reasoning]<|eom|><|start|>assistant to=user<|message|>[content]`.
   - **Baked-in reasoning**: Cannot be toggled off; do not show a thinking toggle/flyout in the UI. Parse stream output automatically into `<think>...</think>` tags using `MuseGlimmerStreamParser`.

---

## 5. Coding & UI Guidelines

- **Code Documentation**: Every class, interface, method, and function must have a concise doc comment explaining its responsibility.
- **SVG Assets**: Never embed inline SVG markup in HTML, CSS, or JS. Store SVGs as standalone `.svg` files in the appropriate asset directory and reference them.
- **CSS Styling**:
  - Use Vanilla CSS.
  - Do not use `translateX` / `translateY` transforms for hover/focus effects.

---

## 6. Python Preview (`run_pc.py`) vs JavaScript / TypeScript Architecture

- **`run_pc.py` is ONLY a Static Server & CORS Proxy**: Its sole responsibility is serving `index.html`, static assets (`src/renderer`), and forwarding requests when necessary to bypass browser CORS.
- **NEVER put core application logic in Python**: All model switching rules, single-model enforcement, tool execution, session management, and prompt workflows MUST be implemented in JavaScript / TypeScript (`src/renderer/` and `src/main/`). This ensures full compatibility with the Electron standalone desktop application (EXE) and the VS Code extension.

---

## 7. Documentation & Architecture Sync Mandate

- **Triple-File Synchronization**: Whenever architecture, UI components, runtime features, or system design guidelines are modified, the agent MUST always update and synchronize all 3 `AGENTS.md` and all 3 `overview.md` files in lockstep:
  1. Root workspace: `.agents/AGENTS.md` and `.agents/overview.md`
  2. Desktop App: `KAI Agent App/.agents/AGENTS.md` and `KAI Agent App/docs/overview.md`
  3. Extension: `Kai-Agent-extension/.agents/AGENTS.md` and `Kai-Agent-extension/docs/overview.md`
- Never leave any of the 3 instances outdated or out of sync.

---

## 8. Workspace UI Terminology: Sidebar vs. Header

- **Sidebar is ONLY in the Desktop App (`KAI Agent App`)**: The Left Sidebar (containing `+ Nieuwe Chat`, chat history list, folder selection, and footer settings) exists ONLY in the Desktop App.
- **The Extension (`Kai-Agent-extension`) has NO Sidebar**: The extension is hosted inside a VS Code webview panel and has ONLY a Header and Input Card dock. It does NOT have a sidebar.
- **Mandate**: When the user refers to the "sidebar" or "sidebar buttons", this ALWAYS refers exclusively to the Desktop App (`KAI Agent App`) and NEVER to the Extension.

---

## 9. Design Independence & No Blind Copying

- **Distinct UI & Layout Architectures**: The Desktop App and the VS Code Extension have fundamentally different design layouts, viewport constraints, and user experiences (e.g. permanent Desktop Sidebar with multi-chat list vs. compact Extension Webview panel with header navigation and view toggling).
- **Strict Mandate**: Never blindly copy or duplicate UI components, CSS styles, or layout logic 1-to-1 between the Desktop App and the Extension without explicitly respecting and adapting to the dedicated architecture and design requirements of each specific project.

