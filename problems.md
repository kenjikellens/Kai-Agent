# Kai Agent - Known Design & Architecture Issues (`problems.md`)

This document outlines key UI design and architectural refactoring targets identified for Kai Agent.

---

## 1. Markdown Rendering Aesthetics (`#2`)
- **Current State**: Rendered Markdown elements (code blocks, headers, lists, inline code) look simple and lack visual hierarchy.
- **Goal**: Enhance Markdown visual styling in `main.css`:
  - Rich syntax header bars for code blocks with language labels and copy buttons.
  - Styled headings (`h1`-`h3`) with subtle borders and balanced line heights.
  - Styled blockquotes, tables, inline code badges, and list bullets.
