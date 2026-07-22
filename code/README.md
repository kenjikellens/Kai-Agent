# K.ai (Kenji AI)

K.ai (Kenji AI) is a powerful, lightweight, and fully offline AI developer agent extension for VS Code-compatible IDEs. It integrates with your local **LM Studio** server (running any GGUF text model) to provide interactive chat and autonomous file, folder, and shell command operations directly within your workspace.

---

## Features

- 🤖 **Status Bar Integration**: A single click on the `🤖 Kai` status bar button at the bottom-right toggles and focuses the chat view.
- 📂 **Autonomous Agent Loop**: The agent can plan, read, write, create files, check folder contents, and run terminal commands to accomplish your requests.
- 🧠 **Thinking Toggle**: Dynamically enables or disables the model's reasoning/thinking process using model-specific API parameters (like `thinking: false`, `reasoning_effort: "none"`, and `chat_template_kwargs` overrides for Qwen/GLM architectures).
- 🗑️ **New Chat**: Easily clear the conversation log, resets the message history, and start a fresh session with the `＋ New Chat` button.
- ✏️ **Inline Code Editing**: Select code, press `Ctrl+Alt+K` to perform inline editing, and review changes via VS Code's side-by-side Diff View before applying them.
- 🔧 **In-Workspace Tooling**:
  - **Read File**: Reads files in the workspace.
  - **Write File**: Creates/edits files (automatically building subfolders if needed).
  - **Delete Item**: Safely deletes files or folders within the workspace.
  - **List Directory**: Views folders in the workspace.
  - **Run Terminal Command**: Executes commands (like `npm install`, `mkdir`, `git init`) in the root of the workspace.
- 💻 **Code Selection Context**: Select code in any editor tab, run the command `Kai: Send Code Selection to Chat` from the command palette (`Ctrl+Shift+P`), and the agent will ingest it as context.
- 🎨 **Sleek UI**: Premium dark glassmorphic chat container that visually displays agent progress and tool results as compact pills instead of raw text code blocks.

---

## Extension Settings

You can customize the extension via your standard VS Code settings editor (`Ctrl+,`):

* `kai.serverUrl`: The API base URL of the local LM Studio server.
  - **Default**: `"http://localhost:1234/v1"`
* `kai.temperature`: The generation sampling temperature.
  - **Default**: `0.7`

---

## Installation & Setup

1. Make sure **LM Studio** is open, its **Local Server** is enabled, and a model is loaded.
2. Build the project:
   - Run `code/node_modules/.bin/tsc -p code/tsconfig.json` to compile TypeScript.
3. Run the installer:
   - Double-click `install.bat` in the project root to copy compiled code to your local extensions directory (`%USERPROFILE%/.vscode/extensions/`).
4. Restart or reload your IDE (`Ctrl+Shift+P` -> `Developer: Reload Window`).

---

## How the Agent Works (Tool Protocol)

The local model is instructed via the system prompt to output specific XML tags when it wants to execute operations:
- **Read File**: `<read_file path="relative/path/to/file"/>`
- **Write File**: `<write_file path="relative/path/to/file">content</write_file>`
- **List Directory**: `<list_dir path="relative/path"/>`
- **Run Command**: `<run_command>command to run</run_command>`

The extension intercepts these tags, executes the action inside the workspace directory, and returns the console stdout/result directly back to the model's history context to proceed to the next step.

