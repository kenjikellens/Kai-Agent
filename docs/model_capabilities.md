# Model Capabilities & Thinking/Reasoning Specificatie

Dit document beschrijft de exacte configuratie en werking van **Thinking & Reasoning** voor alle ondersteunde Cloud API providers én lokale LM Studio modellen.

---

## 1. Cloud AI Providers (API)

| Provider | Model ID | Thinking Opties | Reasoning Opties | Werking |
| :--- | :--- | :--- | :--- | :--- |
| **Google Gemini** | `gemini-3.7-flash`<br>`gemini-3.6-flash`<br>`gemini-3.5-flash`<br>`gemini-3.5-flash-lite`<br>`gemini-3-flash-preview`<br>`gemini-3.1-pro-preview`<br>`gemini-3.1-flash-lite` | `High`<br>`Medium`<br>`Low`<br>`Off` (Minimal) | Geen | Gemini budget levels worden geconfigureerd via het flyout menu. |
| **Mistral AI** | `mistral/magistral-small-latest`<br>`mistral/magistral-medium-latest`<br>`mistral/mistral-small-latest`<br>`mistral/mistral-medium-3-5`<br>`mistral/codestral-latest` | `Aan / Uit` (Toggle) | Geen | Reasoning/thinking toggle via flyout menu. |
| **Mistral AI** | `mistral/open-mixtral-8x22b` | Geen | Geen | Standaard model zonder thinking. |
| **Cerebras** | `cerebras/llama-4-scout-17b-16e-instruct`<br>`cerebras/llama-3.3-70b` | Geen | Geen | Standaard snelle inferentie. |
| **Cohere** | `cohere/command-r-plus`<br>`cohere/command-r` | Geen | Geen | Standaard chat/agent modellen. |
| **Zhipu AI** | `zhipu/glm-4-flash`<br>`zhipu/glm-4v-flash` | Geen | Geen | Standaard flash modellen. |
| **OmniRoute** | `omniroute/auto` | Geen | Geen | Gateway router model. |

---

## 2. LM Studio (Lokale Modellen)

De extensie en desktop app gebruiken een **2-traps dynamische detectie**:
1. **Manifest Cache (`~/.lmstudio/.internal/model-index-cache.json`)**: Leest automatisch de `customFieldDefinitions` van elk gedownload model.
2. **Architectuur Fallback**: Kijkt naar de modelfamilie als een model zonder manifest wordt ingeladen.

| Model / Familie | Manifest Veld | Thinking Opties | Reasoning Opties | Payload Sleutels (`chat/completions`) |
| :--- | :--- | :--- | :--- | :--- |
| **`qwen/qwen3.8-27b`** (en `qwen*`, `qwq*`, `glm*`) | `reasoning_effort` (select)<br>`enable_thinking` (boolean) | Aan / Uit | `xhigh`, `medium`, `low` | `"reasoning_effort": "xhigh"`,<br>`"thinking": true`,<br>`"chat_template_kwargs": { "enable_thinking": true }` |
| **`google/gemma-4-*`** (`e2b`, `e4b`, `12b-qat`, `31b-qat`) | `enable_thinking` (boolean) | Aan / Uit | Geen | `"thinking": true`,<br>`"chat_template_kwargs": { "enable_thinking": true }` |
| **`prism-ml/bonsai-27b`** | `enable_thinking` (boolean) | Aan / Uit | Geen | `"thinking": true`,<br>`"chat_template_kwargs": { "enable_thinking": true }` |
| **DeepSeek R1** (`deepseek*`, `*r1*`) | `enable_thinking` (boolean) | Aan / Uit | Geen | `"thinking": true`,<br>`"chat_template_kwargs": { "enable_thinking": true }` |
| **Llama / Phi / Standaard GGUF** | Geen | Geen | Geen | Geen thinking parameters |

---

## 3. UI Display & Trigger Labels (De 'i' / Statusweergave)

- **Qwen met Reasoning (Aan)**: Toont `qwen3.8-27b (xhigh)` / `(medium)` / `(low)` + batterij icoon.
- **Qwen (Thinking Uit)**: Toont `qwen3.8-27b` (zonder suffix).
- **Gemma 4 / Bonsai (Thinking Aan)**: Toont `gemma-4-e2b (thinking)` + batterij icoon (NOOIT `xhigh`).
- **Gemma 4 / Bonsai (Thinking Uit)**: Toont `gemma-4-e2b` (zonder suffix).
- **Standaard Modellen (zonder thinking)**: Toont de modelnaam zonder suffix of icoon.
