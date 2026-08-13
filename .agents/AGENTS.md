# Workspace Rules: Reasoning / Thinking Toggles for LM Studio Models

When editing or implementing completions inside the `LMStudioClient.ts` class, always follow the model-specific parameters to toggle the reasoning/thinking phase:

1. **Gemma Models (`google/gemma-*`)**:
   - Enable: `"thinking": true`
   - Disable: `"thinking": false`, `"reasoning_effort": "none"`, `"reasoning": "off"`

2. **Qwen & GLM Models (`qwen/*`, `glm/*`)**:
   - Enable: `"thinking": true`, `"enable_thinking": true`, `"chat_template_kwargs": { "enable_thinking": true }`
   - Disable: `"thinking": false`, `"enable_thinking": false`, `"chat_template_kwargs": { "enable_thinking": false }`, `"reasoning_effort": "none"`, `"reasoning": "off"`

3. **Mistral Models (`mistral/*`, `codestral/*`)**:
   - Enable: `"reasoning_effort": "high"`
   - Disable: `"reasoning_effort": "none"`

4. **Muse Glimmer Models (`muse/*`, `*glimmer*`)**:
   - Reasoning format: Emits `to=self<|message|>[reasoning]<|eom|><|start|>assistant to=user<|message|>[content]`
   - Baked-in reasoning: Cannot be disabled; no thinking toggle/flyout is shown in the UI. Output is automatically parsed into `<think>...</think>` tags via `MuseGlimmerStreamParser`.

Always check the model ID dynamically and pass these parameters to avoid models ignoring the toggle.

## Build Scripts Rule
- **Do NOT execute `install.bat`**: Never run `isntall.bat` (or `.\isntall.bat`). The user will execute `isntall.bat` manually.

## Object-Oriented Programming (OOP) & File Architecture Rule
- **STRICT OOP MANDATE**: Never write ad-hoc procedural logic or bundle multiple distinct API providers, services, UI widgets, or features into a single monolithic class or file.
- **Dedicated Class File Per API / Feature**: EVERY single API provider (e.g. `MistralClient`, `CohereClient`, `CerebrasClient`, `ZhipuClient`, `OmniRouteClient`, `GeminiClient`, `LMStudioClient`), UI component, tool, or service MUST reside in its own dedicated Class file in its respective directory (`code/src/providers/`, `code/media/js/`, `code/src/tools/`, etc.).
- **Interfaces & Base Classes**: Every provider class MUST implement `ILLMProvider` (or extend `BaseCloudProviderClient`).
- **Class & Method Documentation**: Every class, method, and function must have a concise doc comment describing what it does.


