# Model Capabilities Specificatie (Manifest-Driven)

Dit document beschrijft de werking van **Thinking** en **Reasoning Effort** in Kai Agent. De eigenschappen van LM Studio modellen worden **100% dynamisch** uitgelezen uit LM Studio's manifesten (`model-index-cache.json`).

---

## 1. Cloud AI Providers (API)

| Provider | Model ID | Thinking Opties | Reasoning Opties | Werking |
| :--- | :--- | :--- | :--- | :--- |
| **Google Gemini** | `gemini-3.7-flash`<br>`gemini-3.6-flash`<br>`gemini-3.5-flash`<br>`gemini-3.5-flash-lite`<br>`gemini-3-flash-preview`<br>`gemini-3.1-pro-preview`<br>`gemini-3.1-flash-lite` | `High`, `Medium`, `Low`, `Off` | Geen | Gemini denkbudget niveaus direct instelbaar via geïntegreerd flyout menu. |
| **Mistral AI** | `mistral/magistral-small-latest`<br>`mistral/magistral-medium-latest`<br>`mistral/mistral-small-latest`<br>`mistral/mistral-medium-3-5`<br>`mistral/codestral-latest` | `Thinking: On` / `Thinking: Off` | Geen | Thinking toggle via geïntegreerd flyout menu (`(thinking)`). |
| **Mistral AI** | `mistral/open-mixtral-8x22b` | `off` | Geen | Standaard model zonder thinking. |
| **Cerebras** | `cerebras/llama-3.3-70b`<br>`cerebras/llama-3.1-8b` | `off` | Geen | Standaard snelle inferentie. |
| **Cohere** | `cohere/command-r-plus`<br>`cohere/command-r` | `off` | Geen | Standaard chat/agent modellen. |
| **Zhipu AI** | `zhipu/glm-4-flash`<br>`zhipu/glm-4-plus` | `off` | Geen | Standaard flash modellen. |
| **OmniRoute** | `omniroute/auto` | `off` | Geen | Gateway router model. |

---

## 2. LM Studio (Lokale Modellen via Cache Manifest)

De lijst met lokale modellen en hun capabilities wordt dynamisch geladen uit `model-index-cache.json` (geëxtraheerd in `docs/model_reference.json`):

| Model Identifier | Manifest Veld(en) | Thinking | Reasoning Effort | Payload Parameters |
| :--- | :--- | :--- | :--- | :--- |
| **`qwen/qwen3.8-27b`** | `reasoning_effort` (select)<br>`enable_thinking` (boolean) | Toggle (`enable_thinking`) | `xhigh`, `medium`, `low` | `"reasoning_effort": "{level}"`,<br>`"thinking": true`,<br>`"chat_template_kwargs": { "enable_thinking": true }` |
| **`google/gemma-4-*`** (`e2b`, `e4b`, `12b-qat`, `31b-qat`) | `enable_thinking` (boolean) | Toggle (`enable_thinking`) | Geen | `"thinking": true`,<br>`"enable_thinking": true`,<br>`"chat_template_kwargs": { "enable_thinking": true }` |
| **`prism-ml/bonsai-27b`** | Geen | Geen | Geen | Geen thinking parameters |
| **Standaard GGUF modellen** | Geen | Geen | Geen | Geen thinking parameters |

---

## 3. UI Display & Label Contexten (Geen Icons, Zuiver Tekst + Flyouts)

| Context | Gemma (Thinking Aan) | Gemma (Thinking Uit) | Qwen (xhigh) | Gemini (High) | Bonsai / Standaard |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Trigger Knop (Toolbar)** | `Gemma (thinking)` | `Gemma` | `Qwen (xhigh)` | `Gemini 3.7 Flash (High)` | *(geen suffix)* |
| **Dropdown Item (Selector)** | `Gemma` + `›` (Flyout) | `Gemma` + `›` (Flyout) | `Qwen` + `›` (Flyout) | `Gemini 3.7 Flash` + `›` (Flyout) | *(geen flyout chevron)* |
| **Flyout Submenu (Hover)** | `Thinking` [🔘 Toggle Aan] | `Thinking` [⚪ Toggle Uit] | `xhigh` ✓<br>`medium`<br>`low` | `High` ✓<br>`Medium`<br>`Low`<br>`Off` | *(geen flyout)* |
| **Info Modus ('i') - Thinking** | `on` | `off` | `on` | `on` | *(geen info)* |
| **Info Modus ('i') - Reasoning** | *(niet aanwezig)* | *(niet aanwezig)* | `xhigh` | `high` | *(geen info)* |
