# Model Capabilities & Thinking/Reasoning Specificatie

Dit document beschrijft de gescheiden werking van **Thinking** (5 opties: `off`, `low`, `medium`, `high`, `on`) en **Reasoning Effort** (`xhigh`, `medium`, `low`).

---

## 1. Cloud AI Providers (API)

| Provider | Model ID | Thinking Opties | Reasoning Opties | Werking |
| :--- | :--- | :--- | :--- | :--- |
| **Google Gemini** | `gemini-3.7-flash`<br>`gemini-3.6-flash`<br>`gemini-3.5-flash`<br>`gemini-3.5-flash-lite`<br>`gemini-3-flash-preview`<br>`gemini-3.1-pro-preview`<br>`gemini-3.1-flash-lite` | `high`, `medium`, `low`, `off` | Geen | Gemini denkbudget niveaus direct instelbaar via flyout. |
| **Mistral AI** | `mistral/magistral-small-latest`<br>`mistral/magistral-medium-latest`<br>`mistral/mistral-small-latest`<br>`mistral/mistral-medium-3-5`<br>`mistral/codestral-latest` | `on` / `off` | Geen | Thinking toggle via flyout menu. |
| **Mistral AI** | `mistral/open-mixtral-8x22b` | `off` | Geen | Standaard model zonder thinking. |
| **Cerebras** | `cerebras/llama-4-scout-17b-16e-instruct`<br>`cerebras/llama-3.3-70b` | `off` | Geen | Standaard snelle inferentie. |
| **Cohere** | `cohere/command-r-plus`<br>`cohere/command-r` | `off` | Geen | Standaard chat/agent modellen. |
| **Zhipu AI** | `zhipu/glm-4-flash`<br>`zhipu/glm-4v-flash` | `off` | Geen | Standaard flash modellen. |
| **OmniRoute** | `omniroute/auto` | `off` | Geen | Gateway router model. |

---

## 2. LM Studio (Lokale Modellen)

| Model / Familie | Manifest Veld | Thinking Opties | Reasoning Opties | Payload Sleutels (`chat/completions`) |
| :--- | :--- | :--- | :--- | :--- |
| **`qwen/qwen3.8-27b`** (en `qwen*`, `qwq*`, `glm*`) | `reasoning_effort` (select)<br>`enable_thinking` (boolean) | `on` / `off` | `xhigh`, `medium`, `low` | `"reasoning_effort": "xhigh"`,<br>`"thinking": true`,<br>`"chat_template_kwargs": { "enable_thinking": true }` |
| **`google/gemma-4-*`** (`e2b`, `e4b`, `12b-qat`, `31b-qat`) | `enable_thinking` (boolean) | `on` / `off` | Geen | `"thinking": true`,<br>`"chat_template_kwargs": { "enable_thinking": true }` |
| **`prism-ml/bonsai-27b`** | `enable_thinking` (boolean) | `on` / `off` | Geen | `"thinking": true`,<br>`"chat_template_kwargs": { "enable_thinking": true }` |
| **DeepSeek R1** (`deepseek*`, `*r1*`) | `enable_thinking` (boolean) | `on` / `off` | Geen | `"thinking": true`,<br>`"chat_template_kwargs": { "enable_thinking": true }` |
| **Llama / Phi / Standaard GGUF** | Geen | `off` | Geen | Geen thinking parameters |

---

## 3. UI Display & Trigger Labels (De 'i' / Statusweergave)

- **Gemini (Thinking Budget)**: Toont `Gemini 3.7 Flash (high)` / `(medium)` / `(low)` of geen suffix bij `off`.
- **Gemma 4 / Bonsai / Mistral (Thinking Aan)**: Toont `Gemma 4 E2B (on)` + batterij icoon.
- **Gemma 4 / Bonsai / Mistral (Thinking Uit)**: Toont `Gemma 4 E2B` (geen suffix).
- **Qwen 3.8 (Thinking Aan + Reasoning)**: Toont `Qwen 3.8 27B (xhigh)` / `(medium)` / `(low)` + batterij icoon.
- **Qwen 3.8 (Thinking Uit)**: Toont `Qwen 3.8 27B` (geen suffix).
- **Modellen zonder Thinking/Reasoning**: Toont modelnaam zonder suffix of icoon.
