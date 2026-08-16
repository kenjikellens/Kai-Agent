# LM Studio Reasoning & Thinking Parameters Reference

This document serves as an architectural and technical reference for LM Studio model preset configurations, reasoning parameters, and token budget mechanisms for local LLMs.

---

## 1. LM Studio Reasoning Parameters Overview

In modern open-weight models running on LM Studio (e.g. Qwen 3.8, Gemma 4, GLM 4.7 Flash, DeepSeek-R1):

### A. `enableThinking` (Thinking Toggle)
- **Preset key**: `ext.virtualModel.customField.<family>.<modelName>.enableThinking`
- **Type**: `boolean` (`true` | `false`)
- **API Payloads**:
  - `enable_thinking`: `true` / `false`
  - `thinking`: `true` / `false`
  - `chat_template_kwargs`: `{ "enable_thinking": true / false }`
- **Purpose**: Enables or disables the chain-of-thought `<think>` phase in the model's Jinja2 template and inference pipeline.

### B. `reasoningEffort` (Reasoning Effort Level)
- **Preset key**: `ext.virtualModel.customField.<family>.<modelName>.reasoningEffort`
- **Type**: `string` (`"xhigh"` | `"medium"` | `"low"`)
- **API Payloads**:
  - `reasoning_effort`: `"xhigh"` | `"medium"` | `"low"`
- **Purpose**: Dictates the intensity and depth of the reasoning phase.
  - `xhigh`: Maximum reasoning depth.
  - `medium`: Balanced reasoning depth.
  - `low`: Concise reasoning depth.

### C. `budgetTokens` (Reasoning Token Budget - For Future Use)
- **Preset key**: `llm.prediction.reasoning.budgetTokens`
- **Type**: Object `{ "checked": boolean, "value": number }`
  - Example: `{ "checked": false, "value": 1024 }`
- **API Payloads (when enabled)**:
  - `max_thinking_tokens`: `<number>` (or `budget_tokens`: `<number>`)
- **Purpose**: Hard token cap on the number of tokens generated inside `<think>...</think>` before the model is forced to conclude reasoning and emit the final response.
- **Status**: Currently optional / not exposed in default UI flyout, but documented here for future expansion (e.g. custom user model configuration or slider controls).

### D. `preserveThinking`
- **Preset key**: `ext.virtualModel.customField.<family>.<modelName>.preserveThinking`
- **Type**: `boolean` (`true` | `false`)
- **Purpose**: Whether LM Studio retains raw thinking tokens in chat logs or strips them after response completion.
