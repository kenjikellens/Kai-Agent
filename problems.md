# Kai Agent - Known Design & Architecture Issues (`problems.md`)

This document outlines key UI design and architectural refactoring targets identified for Kai Agent.

---

## 1. Chat History UI Design (`#1`)
- **Current State**: The chat history overlay panel is a basic vertical list (`.history-item`) with simple borders.
- **Goal**: Redesign the history panel into a modern, polished overlay featuring clean cards, hover animations, timestamp formatting, chat model tags, and empty-state graphics.

---

## 2. Refactor `main.js` to Object-Oriented Programming (OOP) (`#2`)
- **Current State**: `code/media/main.js` is a monolithic ~1500 line procedural script holding state, DOM manipulation, Markdown parsing, dropdown handling, and IPC receivers in one file.
- **Goal**: Modularize `main.js` into clean, maintainable ES6 classes / modules:
  - `ChatUIController`: Manages DOM rendering, typing indicators, and message scrolling.
  - `HistoryManager`: Handles history list rendering and session loading/deletion.
  - `ModelDropdownController`: Controls model status dots, provider accordions, and selection state.
  - `MarkdownFormatter`: Handles Markdown parsing, code block syntax highlighting, and thinking block toggles.
  - `WebviewIPCBridge`: Handles bidirectional communication with the extension host.

---

## 3. Font & Typography Refinement (`#3`)
- **Current State**: Chat bubbles rely on default system sans-serif fonts, which look plain.
- **Goal**: Upgrade font family to modern, high-legibility typography (e.g., `Inter`, `-apple-system`, `Segoe UI Variable Text`) for chat text, and a crisp monospace font (e.g., `Cascadia Code`, `Fira Code`, `JetBrains Mono`) for code snippets and tool outputs.

---

## 4. Markdown Rendering Aesthetics (`#4`)
- **Current State**: Rendered Markdown elements (code blocks, headers, lists, inline code) look simple and lack visual hierarchy.
- **Goal**: Enhance Markdown visual styling in `main.css`:
  - Rich syntax header bars for code blocks with language labels and copy buttons.
  - Styled headings (`h1`-`h3`) with subtle borders and balanced line heights.
  - Styled blockquotes, tables, inline code badges, and list bullets.
