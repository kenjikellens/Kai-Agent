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
   - Python Local Preview Server: `KAI Agent App/run_pc.py` (launches `preview_server.js`).
3. **`docs/`**: Shared documentation and reference configurations (`model_reference.json`, `overview.md`).

---

## 2. Build & Execution Rules

- **NEVER execute `install.bat`**: The agent must NEVER run `install.bat` or `.\install.bat`. The user runs installation and packaging manually.
- **Extension Fast Sync**:
  - Compile extension changes: Run `npm run compile` within `Kai-Agent-extension/code`.
  - Sync to IDE extension folder: Execute `Kai-Agent-extension/update.bat`.
- **Desktop App Preview**:
  - Run via Electron: `npm run dev` / `npm start` in `KAI Agent App`.
  - Run via Python preview: `python run_pc.py` in `KAI Agent App` (spawns `node preview_server.js`).

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

## 4. LM Studio Reasoning / Thinking Toggles & Single-Model Rule

1. **Max 1 Loaded Model Rule**:
   - Before completing with a local model, check active models in memory (`lms ps`).
   - If a different model is loaded, automatically execute `lms unload --all` before loading the target model.
   - If the requested model is already loaded, preserve it in VRAM without redundant reload.

2. **Gemma Models (`google/gemma-*`)**:
   - **Enable**: `"thinking": true`
   - **Disable**: `"thinking": false`, `"reasoning_effort": "none"`, `"reasoning": "off"`

3. **Qwen & GLM Models (`qwen/*`, `glm/*`)**:
   - **Enable**: `"thinking": true`, `"enable_thinking": true`, `"chat_template_kwargs": { "enable_thinking": true }`
   - **Disable**: `"thinking": false`, `"enable_thinking": false`, `"chat_template_kwargs": { "enable_thinking": false }`, `"reasoning_effort": "none"`, `"reasoning": "off"`

4. **Mistral & Codestral Models (`mistral/*`, `codestral/*`)**:
   - **Enable**: `"reasoning_effort": "high"`
   - **Disable**: `"reasoning_effort": "none"`

5. **Muse Glimmer Models (`muse/*`, `*glimmer*`)**:
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

- **`run_pc.py` is ONLY a Launcher**: Its sole responsibility is starting `node preview_server.js` and opening the browser.
- **NEVER put core application logic in Python**: All model switching rules, single-model enforcement, tool execution, session management, and prompt workflows MUST be implemented in JavaScript / TypeScript (`src/renderer/` and `src/main/`). This ensures 100% full parity with the Electron standalone desktop application (EXE) and the VS Code extension.
