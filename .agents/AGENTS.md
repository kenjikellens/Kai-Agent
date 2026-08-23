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
  - Every LLM provider (e.g., `LMStudioClient`, `GeminiClient`, `MistralClient`, `CohereClient`, `CerebrasClient`, `ZhipuClient`, `OmniRouteClient`, `OpenRouterClient`) must have its own dedicated class file in `src/providers/`.
  - All providers must implement `ILLMProvider` or extend `BaseCloudProviderClient`.
- **Tool Parity**:
  - Keep tool contracts consistent across both the Extension and the Desktop App (`read_file`, `write_file`, `replace_file_content`, `multi_replace_file_content`, `delete_item`, `list_dir`, `grep_search`, `symbol_search`, `get_diagnostics`, `run_command`, `web_search`, `fetch_url`).
- **Prompt Management**:
  - Operational modes (`agent`, `ask`, `planning`, `chat`) and their behavior contracts must align with the prompt definitions in `system_prompt_*.md`.

---

## 4. Reasoning & Thinking Pipeline Specifications

When implementing or modifying completions across providers, dynamically apply the model-specific thinking/reasoning parameters:

1. **OpenRouter Models (`openrouter/*`)**:
   - **Reasoning extraction**: Capture `delta.reasoning`, `delta.thought`, and `delta.reasoning_content` into encapsulated `<think>...</think>` blocks.
   - **Request payload**: Send `"reasoning": { "effort": "high" | "medium" | "low" | "none", "exclude": false }`.

2. **Google Gemini Models (`gemini-*`)**:
   - **Gemini 3.x**: `generationConfig.thinkingConfig = { thinkingLevel: "HIGH" | "MEDIUM" | "LOW" | "MINIMAL", includeThoughts: true }`.
   - **Gemini 2.x / 2.5**: `generationConfig.thinkingConfig = { thinkingBudget: -1 | 8192 | 1024 | 0, includeThoughts: true }`.

3. **LM Studio Models**:
   - **Gemma Models (`google/gemma-*`)**: `"thinking": true` / `"thinking": false`
   - **Qwen & GLM Models (`qwen/*`, `glm/*`)**: `"thinking": true`, `"enable_thinking": true`
   - **Mistral & Codestral Models (`mistral/*`, `codestral/*`)**: `"reasoning_effort": "high"` / `"none"`
   - **Muse Glimmer Models (`muse/*`, `*glimmer*`)**: Parse stream output automatically into `<think>...</think>` tags using `MuseGlimmerStreamParser`.

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

## 7. Mandatory Documentation & Overview Sync Mandate

- **MANDATORY TRIPLE-FILE SYNCHRONIZATION AFTER EVERY CHANGE**:
  - Whenever ANY architectural change, UI modification, feature addition, refactoring, or tool/provider adjustment is made, the agent **MUST ALWAYS WITHOUT EXCEPTION** update and synchronize all 3 `AGENTS.md` and all 3 `overview.md` files in lockstep before concluding the task:
    1. Workspace root: `.agents/AGENTS.md` and `.agents/overview.md`
    2. Desktop App: `KAI Agent App/.agents/AGENTS.md` and `KAI Agent App/docs/overview.md`
    3. Extension: `Kai-Agent-extension/.agents/AGENTS.md` and `Kai-Agent-extension/docs/overview.md`
  - **Zero Exceptions**: Never conclude a turn or task with code or structural modifications without verifying and updating all 3 `overview.md` documentation files to reflect the current state.

---

## 8. Workspace UI Terminology: Sidebar vs. Header

- **Sidebar is ONLY in the Desktop App (`KAI Agent App`)**: The Left Sidebar (containing `+ Nieuwe Chat`, chat history list, folder selection, and footer settings) exists ONLY in the Desktop App.
- **The Extension (`Kai-Agent-extension`) has NO Sidebar**: The extension is hosted inside a VS Code webview panel and has ONLY a Header and Input Card dock. It does NOT have a sidebar.
- **Mandate**: When the user refers to the "sidebar" or "sidebar buttons", this ALWAYS refers exclusively to the Desktop App (`KAI Agent App`) and NEVER to the Extension.

---

## 9. Design Independence & No Blind Copying

- **Distinct UI & Layout Architectures**: The Desktop App and the VS Code Extension have fundamentally different design layouts, viewport constraints, and user experiences (e.g. permanent Desktop Sidebar with multi-chat list vs. compact Extension Webview panel with header navigation and view toggling).
- **Strict Mandate**: Never blindly copy or duplicate UI components, CSS styles, or layout logic 1-to-1 between the Desktop App and the Extension without explicitly respecting and adapting to the dedicated architecture and design requirements of each specific project.

---

## 10. Model Selector & Status Dot Architecture

- **LM Studio Server Offline**:
  - The LM Studio accordion is displayed as `LM Studio (Offline)`.
  - Inside the accordion content, only the placeholder text `'LM Studio is offline'` is displayed (no duplicate or casing variations injected from local disk cache).
- **LM Studio Server Online**:
  - Queries live models via `/v1/models` without duplicate aliases or casing variations.
  - In the model list: Green dot (`status-connected`) if loaded in memory (`loadedModels`), Red dot (`status-disconnected`) if available but not loaded.
  - Clicking an unloaded model selects it directly.
- **Cloud & Free Providers (OpenRouter, Gemini, Mistral, Cerebras, Cohere, Zhipu, OmniRoute)**:
  - All providers and their default models are always visible in the dropdown.
  - Green dot (`status-connected`) if API key is configured; Red dot (`status-disconnected`) if not configured.
- **Trigger Button Status**:
  - For LM Studio: Green if selected model is loaded in memory, Red if offline or not loaded.
  - For Cloud providers: Green if API key is configured, Red if missing.

---

## 11. IPC Architecture Boundary: Desktop App vs. Extension

- **Desktop App (`KAI Agent App`)**:
  - Contains the dual Electron Main / Browser Preview architecture.
  - `WebviewIPCBridge.js` includes the browser-preview fallback engine (`_handleClientSideIPC`) and browser tools to support `run_pc.py` in standalone web browsers.
- **VS Code Extension (`Kai-Agent-extension`)**:
  - Operates **exclusively** through the VS Code Extension Host (`code/src/extension.ts`, `code/src/AgentExecutor.ts`, `code/src/providers/*`).
  - `WebviewIPCBridge.js` is a **lean, dedicated bridge (~150 lines)** that exclusively forwards messages via `this.vscode.postMessage(message)`.
  - **STRICT MANDATE**: The extension webview MUST NEVER contain browser-preview fallback engines, direct third-party API fetch loops, or client-side tool execution engines. All LLM requests, streaming, tool executions, and file operations in the extension are handled strictly by the Extension Host backend in TypeScript.

---

## 12. Conversational State & Zero Unsolicited Code Edits

- **Statements & Feedback**: When the user provides feedback, makes a statement, or asks an architectural question, the agent MUST NOT trigger code edits, file rewrites, or build scripts unless the user explicitly requests an implementation or modification.
- **Listen Before Editing**: Clarify, acknowledge, or update guidelines/documentation first. Never assume a conversational comment is an automated trigger to start editing application code.

---

## 13. CSS Architecture, DRY Consolidation & Protected Features

- **Single Unified Class Name (Zero Duplicate Top-Level Aliases)**:
  - Every distinct UI component has **EXACTLY ONE standardized base class name** (e.g., `.icon-btn`, `.dropdown-panel`, `.pill-option-btn`).
  - NEVER invent multiple separate top-level class names for the same structural component across different panels or features.
  - Variations in size, radius, or layout must use clean BEM modifier classes on that single base class (e.g., `.icon-btn--header`, `.icon-btn--toolbar`, `.icon-btn--delete`).
  - When a component is refactored to a unified class, old legacy alias classes MUST be completely purged from stylesheets (no redundant alias lists in CSS selectors).
- **Mandatory Component Documentation**:
  - Above every base class definition in CSS, write a concise JSDoc-style comment listing all concrete features and modules that consume that component.
- **Strict Container vs. Element Spacing**:
  - Always enforce container-to-content spacing via container `padding` (e.g., `padding: 2.5px`), never by adding outer `margin` to inner buttons or child elements.
- **Protected Theme & UI Features (Non-Negotiable Boundaries)**:
  - **Zero Button Regression & Pixel-Perfect UI**: Refactoring must NEVER alter computed visual styles (dimensions, padding, margins, border-radius, accent colors, hover shadows, or transitions) or break click/keyboard event listeners and DOM queries.
  - **VS Code Theme Tokens (Extension)**: The Extension stylesheet MUST always use VS Code theme variables (`var(--vscode-*)`). NEVER replace theme tokens with hardcoded hex colors or remove dynamic theme adaptability.
  - **Thinking Flyout Submenu**: The Thinking & Reasoning flyout submenu's dynamic alignment calculation (fixed positioning, right-side `rect.right + 4px` with left viewport fallback) and container styling (`padding: 2.5px`, `border-radius: 12px` / `999px` for single item) must remain fully preserved across all refactoring batches.
  - **Extension Settings vs. Desktop Settings**: Respect layout boundaries between Extension accordion panels (`.settings-category`) and Desktop standalone settings layout.

---

## 14. Comprehensive i18n & Localization Strict Parity

- **Zero English Leftovers in Non-English Locales**:
  - Whenever new UI strings, setting descriptions (`*Desc`), buttons, or placeholders are added or modified, they **MUST** be translated across ALL 18 supported languages in `AllLocales.js`.
  - Never leave English strings as lazy fallbacks in non-English locale blocks (e.g. Dutch, German, French, Spanish, Japanese, Chinese, etc.).
- **Both Projects Synchronized**:
  - `AllLocales.js` in `KAI Agent App/src/renderer/media/js/` and `Kai-Agent-extension/code/media/js/` must always be identical and 100% in sync.
- **Batch Updates via Scratch Script**:
  - Per global agent rules, always update all locale dictionaries programmatically using a single batch script in `scratch/` and verify that all 18 locales contain every key.
