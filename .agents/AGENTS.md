# Workspace Rules: Reasoning / Thinking Toggles for LM Studio Models

When editing or implementing completions inside the `LMStudioClient.ts` class, always follow the model-specific parameters to toggle the reasoning/thinking phase:

1. **Gemma Models (`google/gemma-*`)**:
   - Enable: `"thinking": true`
   - Disable: `"thinking": false`, `"reasoning_effort": "none"`, `"reasoning": "off"`

2. **Qwen & GLM Models (`qwen/*`, `glm/*`)**:
   - Enable: `"thinking": true`, `"enable_thinking": true`, `"chat_template_kwargs": { "enable_thinking": true }`
   - Disable: `"thinking": false`, `"enable_thinking": false`, `"chat_template_kwargs": { "enable_thinking": false }`, `"reasoning_effort": "none"`, `"reasoning": "off"`

Always check the model ID dynamically and pass these parameters to avoid models ignoring the toggle.
