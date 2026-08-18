/**
 * WebviewIPCBridge manages bidirectional IPC communication
 * between the Webview UI and the Electron Main process / VS Code Extension Host / Live HTTP Bridge.
 */
class WebviewIPCBridge {
    /**
     * Initializes IPC reference and message dispatchers.
     */
    constructor() {
        this.listeners = new Map();
        this._isElectron = typeof window.electronAPI !== 'undefined';
        this._isVsCode = typeof acquireVsCodeApi === 'function';
        if (!this._isElectron && this._isVsCode) {
            this.vscode = acquireVsCodeApi();
        }
        this._initGlobalErrorHandling();
        this._initMessageListener();
    }

    /**
     * Posts a message object to the host process or handles client-side preview.
     * @param {object} message Message payload.
     */
    postMessage(message) {
        if (this._isElectron && window.electronAPI) {
            window.electronAPI.postMessage(message);
        } else if (this.vscode) {
            this.vscode.postMessage(message);
        } else {
            this._handleClientSideIPC(message);
        }
    }

    /**
     * Handles IPC messages locally in pure JavaScript when running in browser preview.
     * @param {object} message Message payload.
     * @private
     */
    async _handleClientSideIPC(message) {
        if (!message || !message.type) return;

        const emit = (data) => {
            if (data && data.type && this.listeners.has(data.type)) {
                this.listeners.get(data.type).forEach(cb => cb(data));
            }
        };

        switch (message.type) {
            case 'checkConnection': {
                const apiKey = localStorage.getItem('kai.geminiApiKey') || localStorage.getItem('kai.apiKey') || '';
                const serverUrl = localStorage.getItem('kai.serverUrl') || 'http://127.0.0.1:1234/v1';

                const defaultGemini = (typeof KAI_CONSTANTS !== 'undefined' && KAI_CONSTANTS.DEFAULT_GEMINI_MODELS) || [
                    'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite',
                    'gemini-3-flash-preview', 'gemini-3.1-pro-preview', 'gemini-3.1-flash-lite'
                ];

                const defaultProviders = (typeof KAI_CONSTANTS !== 'undefined' && KAI_CONSTANTS.DEFAULT_PROVIDERS_WITH_MODELS) || [];
                const freeProviders = (typeof KAI_CONSTANTS !== 'undefined' && KAI_CONSTANTS.DEFAULT_FREE_PROVIDERS) || [];

                const buildFreeProviders = () => freeProviders.map(p => {
                    const savedKey = localStorage.getItem(`kai.${p.configKey}`) || '';
                    const matchedGroup = defaultProviders.find(dp => dp.name.includes(p.name));
                    const models = matchedGroup ? matchedGroup.models : [];
                    return {
                        name: p.name,
                        configKey: p.configKey,
                        keyHint: p.keyHint,
                        models: models,
                        apiKey: savedKey,
                        connected: !!savedKey.trim()
                    };
                });

                const v0Urls = [
                    'http://127.0.0.1:1234/api/v0/models',
                    'http://localhost:1234/api/v0/models'
                ];
                const v1Urls = [
                    'http://127.0.0.1:1234/v1/models',
                    'http://localhost:1234/v1/models'
                ];

                let lmConnected = false;
                let lmModels = [];
                let loadedModels = [];

                // Fast probe for raw model data
                const probeCandidate = async (url) => {
                    const controller = new AbortController();
                    const timer = setTimeout(() => controller.abort(), 2000);
                    try {
                        const res = await fetch(url, { method: 'GET', signal: controller.signal });
                        clearTimeout(timer);
                        if (res.ok) {
                            const json = await res.json();
                            if (json && Array.isArray(json.data) && json.data.length > 0) {
                                return json.data;
                            }
                        }
                    } catch (e) {
                        clearTimeout(timer);
                    }
                    return [];
                };

                const v0Results = await Promise.allSettled(v0Urls.map(probeCandidate));
                let rawData = null;
                for (const r of v0Results) {
                    if (r.status === 'fulfilled' && r.value && r.value.length > 0) {
                        rawData = r.value;
                        break;
                    }
                }

                if (!rawData) {
                    const v1Results = await Promise.allSettled(v1Urls.map(probeCandidate));
                    for (const r of v1Results) {
                        if (r.status === 'fulfilled' && r.value && r.value.length > 0) {
                            rawData = r.value;
                            break;
                        }
                    }
                }

                if (rawData && Array.isArray(rawData)) {
                    lmConnected = true;
                    // Filter chat models (exclude embeddings)
                    lmModels = rawData
                        .filter(m => {
                            const id = (m.id || m.name || '').toLowerCase();
                            const type = (m.type || '').toLowerCase();
                            return type !== 'embeddings' && !id.includes('embed') && !id.includes('nomic') && !id.includes('bge-') && !id.includes('minilm');
                        })
                        .map(m => m.id || m.name)
                        .filter(Boolean);

                    // ONLY models with state === 'loaded' are considered loaded in memory
                    loadedModels = rawData
                        .filter(m => m.state === 'loaded')
                        .map(m => m.id || m.name)
                        .filter(Boolean);
                }

                const freeProvidersConfig = buildFreeProviders();
                const isGeminiConnected = !!apiKey.trim();
                const activeModel = lmModels.length > 0
                    ? (loadedModels.length > 0 ? loadedModels[0] : lmModels[0])
                    : (isGeminiConnected ? defaultGemini[0] : 'local-model');

                let lmStudioCapabilities = {};
                try {
                    const capRes = await fetch('/api/capabilities');
                    if (capRes.ok) {
                        lmStudioCapabilities = await capRes.json();
                    }
                } catch (e) {}

                const savedWs = localStorage.getItem('kai.workspacePath') || '';
                emit({
                    type: 'connectionStatus',
                    connected: lmConnected,
                    geminiConnected: isGeminiConnected,
                    model: activeModel,
                    lmStudioModels: lmModels,
                    geminiModels: defaultGemini,
                    loadedModels: loadedModels,
                    freeProviders: freeProvidersConfig,
                    serverUrl: serverUrl,
                    apiKey: apiKey,
                    lmStudioCacheDir: localStorage.getItem('kai.lmStudioCacheDir') || '',
                    lmStudioCacheStatus: {
                        valid: lmConnected,
                        modelCount: lmModels.length,
                        error: lmConnected ? '' : 'LM Studio server offline'
                    },
                    lmStudioCapabilities: lmStudioCapabilities,
                    workspacePath: savedWs,
                    workspaceName: savedWs ? savedWs.split(/[\\/]/).pop() : ''
                });
                break;
            }
            case 'updateSettings': {
                if (message.serverUrl !== undefined) localStorage.setItem('kai.serverUrl', message.serverUrl);
                if (message.apiKey !== undefined) {
                    localStorage.setItem('kai.apiKey', message.apiKey);
                    localStorage.setItem('kai.geminiApiKey', message.apiKey);
                }
                if (message.lmStudioCacheDir !== undefined) localStorage.setItem('kai.lmStudioCacheDir', message.lmStudioCacheDir);
                if (Array.isArray(message.freeProviders)) {
                    message.freeProviders.forEach(p => {
                        if (p.configKey && p.apiKey !== undefined) {
                            localStorage.setItem(`kai.${p.configKey}`, p.apiKey);
                        }
                    });
                }
                await this._handleClientSideIPC({ type: 'checkConnection' });
                break;
            }
            case 'openFilePicker': {
                await this._openBrowserFilePicker();
                break;
            }
            case 'browseWorkspaceFolder': {
                await this._openBrowserFolderPicker();
                break;
            }
            case 'saveChat': {
                try {
                    const chat = message.chat;
                    if (chat && (chat.messages?.length > 0 || chat.uiEvents?.length > 0)) {
                        const saved = JSON.parse(localStorage.getItem('kai.savedChats') || '[]');
                        const idx = saved.findIndex(c => c.id === chat.id);
                        if (idx !== -1) {
                            saved[idx] = chat;
                        } else {
                            saved.unshift(chat);
                        }
                        localStorage.setItem('kai.savedChats', JSON.stringify(saved));
                        emit({
                            type: 'chatHistory',
                            chats: saved.map(c => ({ id: c.id, title: c.title || 'New Chat', timestamp: c.timestamp || Date.now() }))
                        });
                    }
                } catch (e) {}
                break;
            }
            case 'loadChatHistory': {
                try {
                    const saved = JSON.parse(localStorage.getItem('kai.savedChats') || '[]');
                    emit({
                        type: 'chatHistory',
                        chats: saved.map(c => ({ id: c.id, title: c.title || 'New Chat', timestamp: c.timestamp || Date.now() }))
                    });
                } catch (e) {
                    emit({ type: 'chatHistory', chats: [] });
                }
                break;
            }
            case 'loadChat': {
                try {
                    const saved = JSON.parse(localStorage.getItem('kai.savedChats') || '[]');
                    const found = saved.find(c => c.id === message.chatId);
                    if (found) emit({ type: 'loadChat', chat: found });
                } catch (e) {}
                break;
            }
            case 'deleteChat': {
                try {
                    let saved = JSON.parse(localStorage.getItem('kai.savedChats') || '[]');
                    saved = saved.filter(c => c.id !== message.chatId);
                    localStorage.setItem('kai.savedChats', JSON.stringify(saved));
                    emit({
                        type: 'chatHistory',
                        chats: saved.map(c => ({ id: c.id, title: c.title || 'New Chat', timestamp: c.timestamp || Date.now() }))
                    });
                } catch (e) {}
                break;
            }
            case 'sendMessage': {
                const rawMessages = message.messages || [];
                const model = message.model || 'local-model';
                const serverUrl = localStorage.getItem('kai.serverUrl') || 'http://127.0.0.1:1234/v1';
                const activeMode = message.mode || 'chat';
                const savedWs = localStorage.getItem('kai.workspacePath') || '';
                const hasWs = !!savedWs;

                // Load appropriate system prompt for browser preview
                let systemPrompt = `You are Kai, a friendly, intelligent, and versatile AI assistant with web access and utility tools. Respond in the user's language.`;
                try {
                    let promptFile = 'system_prompt_chat.md';
                    if (activeMode === 'chat') {
                        promptFile = hasWs ? 'system_prompt_chat_workspace.md' : 'system_prompt_chat.md';
                    } else if (activeMode === 'planning') {
                        promptFile = 'system_prompt_planning.md';
                    } else if (activeMode === 'agent') {
                        promptFile = 'system_prompt_agent.md';
                    }
                    const promptRes = await fetch(`/${promptFile}`);
                    if (promptRes.ok) {
                        systemPrompt = await promptRes.text();
                    }
                } catch (e) {}

                // Load workspace structure if available (mirrors AgentExecutor.ts)
                let workspacePrefix = '';
                if (hasWs && rawMessages.length <= 1) {
                    try {
                        const wsRes = await fetch('/api/tools/execute', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ tool: 'get_workspace_structure', workspacePath: savedWs })
                        });
                        if (wsRes.ok) {
                            const wsData = await wsRes.json();
                            if (wsData.result) {
                                workspacePrefix = wsData.result + '\n';
                            }
                        }
                    } catch (e) {}
                }

                const messagesToSend = [...rawMessages];
                if (workspacePrefix && messagesToSend.length > 0) {
                    const firstMsg = messagesToSend[0];
                    if (firstMsg.role === 'user') {
                        messagesToSend[0] = {
                            role: 'user',
                            content: workspacePrefix + firstMsg.content
                        };
                    }
                }

                const sysIdx = messagesToSend.findIndex(m => m.role === 'system');
                if (sysIdx !== -1) {
                    messagesToSend[sysIdx] = { role: 'system', content: systemPrompt };
                } else {
                    messagesToSend.unshift({ role: 'system', content: systemPrompt });
                }

                emit({
                    type: 'agentProgress',
                    progressType: 'start',
                    text: 'Contacting model...'
                });

                try {
                    const cleanUrl = serverUrl.replace(/\/$/, '') + '/chat/completions';
                    const effortVal = message.geminiThinkingLevel || 'xhigh';
                    const caps = (typeof ThinkingStateFormatter !== 'undefined' && ThinkingStateFormatter._capabilities)
                        ? (ThinkingStateFormatter._capabilities[model] || ThinkingStateFormatter._capabilities[model.toLowerCase()])
                        : null;

                    // Agentic loop: stream response, parse tool calls, execute, repeat
                    const maxIterations = 15;
                    let iteration = 0;
                    let lastFullText = '';

                    while (iteration < maxIterations) {
                        iteration++;

                        const payload = {
                            model: model,
                            messages: messagesToSend.map(m => ({ role: m.role, content: m.content })),
                            stream: true
                        };

                        // Apply thinking/reasoning settings
                        if (message.thinking) {
                            payload.thinking = true;
                            payload.enable_thinking = true;
                            payload.reasoning_effort = effortVal;
                            payload.chat_template_kwargs = { enable_thinking: true };
                            if (caps && Array.isArray(caps.fields)) {
                                for (const field of caps.fields) {
                                    if (field.type === 'boolean') {
                                        payload[field.variable] = true;
                                        payload.chat_template_kwargs[field.variable] = true;
                                    } else if (field.type === 'select') {
                                        payload[field.variable] = effortVal;
                                        payload.chat_template_kwargs[field.variable] = effortVal;
                                    }
                                }
                            }
                        } else {
                            payload.thinking = false;
                            payload.enable_thinking = false;
                            payload.reasoning_effort = 'none';
                            payload.chat_template_kwargs = { enable_thinking: false };
                            if (caps && Array.isArray(caps.fields)) {
                                for (const field of caps.fields) {
                                    if (field.type === 'boolean') {
                                        payload[field.variable] = false;
                                        payload.chat_template_kwargs[field.variable] = false;
                                    } else if (field.type === 'select') {
                                        payload[field.variable] = 'none';
                                        payload.chat_template_kwargs[field.variable] = 'none';
                                    }
                                }
                            }
                        }

                        const response = await fetch(cleanUrl, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(payload)
                        });

                        if (!response.ok) {
                            throw new Error(`LM Studio returned ${response.status}: ${response.statusText}`);
                        }

                        // Stream the response tokens
                        const reader = response.body.getReader();
                        const decoder = new TextDecoder();
                        let fullText = '';
                        let buffer = '';
                        let isThinking = false;
                        const allowThinkingUI = !!message.thinking;

                        while (true) {
                            const { done, value } = await reader.read();
                            if (done) break;
                            buffer += decoder.decode(value, { stream: true });
                            const lines = buffer.split('\n');
                            buffer = lines.pop() || '';

                            for (const line of lines) {
                                const trimmed = line.trim();
                                if (!trimmed || trimmed.startsWith(':')) continue;
                                if (trimmed === 'data: [DONE]') break;
                                if (trimmed.startsWith('data: ')) {
                                    try {
                                        const json = JSON.parse(trimmed.slice(6));
                                        const delta = json.choices?.[0]?.delta;
                                        if (!delta) continue;

                                        const reasoningChunk = delta.reasoning_content || delta.reasoning;
                                        const contentChunk = delta.content || delta.text;

                                        if (reasoningChunk && allowThinkingUI) {
                                            if (!isThinking) {
                                                isThinking = true;
                                                fullText += '<think>';
                                                emit({ type: 'agentProgress', progressType: 'token', output: '<think>' });
                                            }
                                            fullText += reasoningChunk;
                                            emit({ type: 'agentProgress', progressType: 'token', output: reasoningChunk });
                                        } else {
                                            const textToAdd = contentChunk || (!allowThinkingUI ? reasoningChunk : '');
                                            if (textToAdd) {
                                                if (isThinking) {
                                                    isThinking = false;
                                                    fullText += '</think>';
                                                    emit({ type: 'agentProgress', progressType: 'token', output: '</think>' });
                                                }
                                                fullText += textToAdd;

                                                // Check if a tool call was initiated (e.g. <tool_call>, <|tool_call|>, ```json {)
                                                const toolTagMatch = /<\|?tool_call\|?>|```json\s*\{/i.exec(fullText);
                                                if (!toolTagMatch) {
                                                    emit({ type: 'agentProgress', progressType: 'token', output: textToAdd });
                                                }
                                            }
                                        }
                                    } catch (e) {}
                                }
                            }
                        }

                        if (isThinking) {
                            fullText += '</think>';
                            emit({ type: 'agentProgress', progressType: 'token', output: '</think>' });
                        }

                        lastFullText = fullText;

                        // Parse tool call from the streamed response
                        const toolCall = this._parseToolCall(fullText);

                        if (!toolCall) {
                            // No tool call found — this is the final reply
                            break;
                        }

                        // Tool call detected — emit tool_start BEFORE starting execution
                        messagesToSend.push({ role: 'assistant', content: fullText });

                        const toolId = `tool-${Date.now()}-${iteration}`;
                        const targetName = this._getToolTarget(toolCall.name, toolCall.args);

                        emit({
                            type: 'agentProgress',
                            progressType: 'tool_start',
                            tool: toolCall.name,
                            query: toolCall.query,
                            toolId: toolId,
                            fileName: targetName
                        });

                        let toolResult = '';
                        try {
                            toolResult = await this._executeBrowserTool(toolCall.name, toolCall.args);
                        } catch (toolErr) {
                            toolResult = `[Error executing tool ${toolCall.name}]: ${toolErr.message || toolErr}`;
                        }

                        const isError = toolResult.startsWith('[Error');

                        emit({
                            type: 'agentProgress',
                            progressType: 'tool_end',
                            tool: toolCall.name,
                            output: toolResult,
                            toolId: toolId,
                            fileName: targetName
                        });

                        // Append tool result as a user message for next iteration
                        messagesToSend.push({
                            role: 'user',
                            content: `[Tool Result for ${toolCall.name}]:\n${toolResult}`
                        });
                    }

                    // Emit the final reply
                    emit({
                        type: 'reply',
                        content: lastFullText,
                        modifiedFiles: []
                    });

                    // Trigger Background AI Chat Title Generation ONLY on the very first user message
                    const targetChatId = message.chatId;
                    const userMessages = rawMessages.filter(m => m.role === 'user');
                    const firstUserMsg = userMessages[0];
                    if (userMessages.length === 1 && firstUserMsg && firstUserMsg.content) {
                        (async () => {
                            try {
                                const titlePrompt = `Summarize the following user request into a concise 3 to 5 word topic title for a chat sidebar. Answer with ONLY the title words, no quotes, no formatting, no thinking:\n\n${firstUserMsg.content.slice(0, 300)}`;
                                const titlePayload = {
                                    model: model,
                                    messages: [{ role: 'user', content: titlePrompt }],
                                    stream: false,
                                    max_tokens: 300,
                                    temperature: 0.2,
                                    thinking: false,
                                    enable_thinking: false,
                                    reasoning_effort: 'none',
                                    chat_template_kwargs: { enable_thinking: false }
                                };

                                if (caps && Array.isArray(caps.fields)) {
                                    for (const field of caps.fields) {
                                        if (field.type === 'boolean') {
                                            titlePayload[field.variable] = false;
                                            titlePayload.chat_template_kwargs[field.variable] = false;
                                        } else if (field.type === 'select') {
                                            titlePayload[field.variable] = 'none';
                                            titlePayload.chat_template_kwargs[field.variable] = 'none';
                                        }
                                    }
                                }

                                const titleRes = await fetch(cleanUrl, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify(titlePayload)
                                });
                                if (titleRes.ok) {
                                    const titleData = await titleRes.json();
                                    const choice = titleData.choices?.[0]?.message;
                                    let raw = (choice?.content || choice?.reasoning_content || '').trim();
                                    raw = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
                                    const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
                                    let rawTitle = lines.length > 0 ? lines[lines.length - 1] : raw;
                                    rawTitle = rawTitle.replace(/^(title|topic)\s*:\s*/i, '')
                                                       .replace(/["'`*_#]/g, ' ')
                                                       .replace(/\s+/g, ' ')
                                                       .trim();
                                    if (rawTitle && rawTitle.length > 0 && rawTitle.length < 60) {
                                        const savedChats = JSON.parse(localStorage.getItem('kai.savedChats') || '[]');
                                        const foundChat = (targetChatId ? savedChats.find(c => c.id === targetChatId) : null) || savedChats[0];
                                        if (foundChat) {
                                            foundChat.title = rawTitle;
                                            localStorage.setItem('kai.savedChats', JSON.stringify(savedChats));
                                            emit({
                                                type: 'chatHistory',
                                                chats: savedChats.map(c => ({ id: c.id, title: c.title || 'New Chat', timestamp: c.timestamp || Date.now() }))
                                            });
                                            emit({
                                                type: 'chatTitleUpdated',
                                                chatId: foundChat.id,
                                                title: rawTitle
                                            });
                                        }
                                    }
                                }
                            } catch (e) {}
                        })();
                    }
                } catch (err) {
                    emit({
                        type: 'replyError',
                        message: `Fout bij verzenden: ${err.message}`
                    });
                }
                break;
            }
        }
    }

    /**
     * Parses a tool call from LLM response text using multiple regex strategies.
     * Mirrors the parsing logic in AgentExecutor.parseToolCall().
     * @param {string} text Full LLM response text.
     * @returns {{ name: string, args: object, query: string } | null} Parsed tool call or null.
     */
    _openBrowserFilePicker() {
        return new Promise((resolve) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.multiple = true;
            input.accept = '.js,.ts,.jsx,.tsx,.py,.html,.css,.json,.md,.txt,.csv,.java,.c,.cpp,.rs,.go,.php,.rb,.sql,.sh,.yaml,.yml,.xml,.env,.toml,.png,.jpg,.jpeg,.webp,.gif';
            input.addEventListener('change', async () => {
                const files = [];
                for (const file of Array.from(input.files || [])) {
                    if (file.size > 2 * 1024 * 1024) continue;
                    try {
                        const content = await file.text();
                        files.push({ fileName: file.name, filePath: file.name, relativePath: file.name, content });
                    } catch (error) {}
                }
                if (files.length > 0) this._emitClientSide({ type: 'filesSelected', files });
                resolve();
            }, { once: true });
            input.click();
        });
    }

    async _openBrowserFolderPicker() {
        try {
            const res = await fetch('/api/workspace/pick', { method: 'POST' });
            if (res.ok) {
                const data = await res.json();
                if (!data.canceled && data.workspacePath) {
                    localStorage.setItem('kai.workspacePath', data.workspacePath);
                    await this._handleClientSideIPC({ type: 'checkConnection' });
                }
            }
        } catch (e) {
            console.error('Error selecting workspace folder:', e);
        }
    }

    _emitClientSide(message) {
        if (message && message.type && this.listeners.has(message.type)) {
            this.listeners.get(message.type).forEach(cb => cb(message));
        }
    }
    _parseToolCall(text) {
        // Strategy 1: Explicit <|tool_call|> or <tool_call> tags
        const explicitTagRegex = /<\|?tool_call\|?>\s*([\s\S]*?)\s*(?:<\|?\/tool_call\|?>|<\|?tool_call\|?>|$)/i;
        const explicitMatch = explicitTagRegex.exec(text);
        if (explicitMatch) {
            const parsed = this._parseJsonToolCall(explicitMatch[1]);
            if (parsed) return parsed;
        }

        // Strategy 2: Loose tag wrapper with optional call: prefix
        const tagRegex = /(?:<\|?tool_call\|?>)?\s*(?:call:\w+)?\s*(\{[\s\S]*?\})\s*(?:<\|?tool_call\|?>)?/i;
        const tagMatch = tagRegex.exec(text);
        if (tagMatch) {
            const parsed = this._parseJsonToolCall(tagMatch[1]);
            if (parsed) return parsed;
        }

        // Strategy 3: ```json fenced code block
        const jsonBlockRegex = /```json\s*([\s\S]*?)\s*(?:```|$)/i;
        const jsonMatch = jsonBlockRegex.exec(text);
        if (jsonMatch) {
            const parsed = this._parseJsonToolCall(jsonMatch[1]);
            if (parsed) return parsed;
        }

        // Strategy 4: Brace-counted JSON extraction
        const braceJson = this._extractJsonBlock(text);
        if (braceJson) {
            const parsed = this._parseJsonToolCall(braceJson);
            if (parsed) return parsed;
        }

        return null;
    }

    /**
     * Extracts the first JSON object from text using brace counting, anchored on known tool keys.
     * @param {string} text Source text to search.
     * @returns {string | null} Extracted JSON string or null.
     */
    _extractJsonBlock(text) {
        const typeRegex = /\{\s*["'](?:type|path|command|chunks|query|action|tool|name)["']/g;
        let match;
        let startIndex = -1;
        while ((match = typeRegex.exec(text)) !== null) {
            startIndex = match.index;
            break;
        }
        if (startIndex === -1) return null;

        let braceCount = 0;
        let inString = false;
        let escape = false;
        for (let i = startIndex; i < text.length; i++) {
            const char = text[i];
            if (escape) { escape = false; continue; }
            if (char === '\\') { escape = true; continue; }
            if (char === '"') { inString = !inString; continue; }
            if (!inString) {
                if (char === '{') braceCount++;
                else if (char === '}') {
                    braceCount--;
                    if (braceCount === 0) return text.substring(startIndex, i + 1);
                }
            }
        }
        return null;
    }

    /**
     * Parses a JSON string into a tool call object, matching against supported browser tools.
     * @param {string} jsonStr Raw JSON string.
     * @returns {{ name: string, args: object, query: string } | null} Parsed tool call or null.
     */
    _parseJsonToolCall(jsonStr) {
        // List of all recognized tools
        const supportedTools = [
            'utility_tools', 'web_search', 'search_web', 'fetch_url', 'get_time', 'calculate',
            'text_stats', 'unit_converter', 'uuid_random', 'read_file', 'write_file', 'edit_file',
            'replace_file_content', 'multi_replace_file_content', 'list_dir', 'grep_search',
            'symbol_search', 'get_diagnostics', 'run_command', 'delete_item'
        ];

        try {
            const parsed = JSON.parse(jsonStr.trim());
            if (!parsed || typeof parsed !== 'object') return null;

            let type = parsed.type || parsed.action || parsed.tool || parsed.name || parsed.function;

            // Normalize common aliases
            if (type) {
                const normalized = type.toLowerCase();
                if (normalized === 'full-web-search' || normalized === 'websearch' || normalized === 'search_web') {
                    type = 'web_search';
                } else {
                    type = normalized;
                }
            }

            // Fallback inference if type is not explicit
            if (!type) {
                if (parsed.expression) type = 'calculate';
                else if (parsed.from_unit && parsed.to_unit) type = 'unit_converter';
                else if (parsed.query && !parsed.command) type = 'web_search';
                else if (parsed.url) type = 'fetch_url';
                else if (parsed.path && parsed.content !== undefined) type = 'write_file';
                else if (parsed.path && parsed.content === undefined) type = 'read_file';
                else if (parsed.command) type = 'run_command';
            }

            if (type && supportedTools.includes(type)) {
                const args = { ...parsed };
                delete args.type;
                delete args.tool;
                delete args.name;
                delete args.function;

                // For utility_tools, extract sub-action if available
                let effectiveTool = type;
                if (type === 'utility_tools' && args.action) {
                    effectiveTool = args.action;
                }

                let query = `Executing ${effectiveTool}`;
                if (args.query) query = `${effectiveTool}: ${args.query}`;
                else if (args.url) query = `${effectiveTool}: ${args.url}`;
                else if (args.expression) query = `${effectiveTool}: ${args.expression}`;
                else if (args.action) query = `${effectiveTool}: ${args.action}`;
                else if (args.path) query = `${effectiveTool}: ${args.path}`;

                return { name: effectiveTool, args, query };
            }
        } catch (e) {}
        return null;
    }

    /**
     * Extracts a display-friendly target name from tool call arguments.
     * @param {string} tool Tool name.
     * @param {object} args Tool arguments.
     * @returns {string} Human-readable target name.
     */
    _getToolTarget(tool, args) {
        if (!args) return '';
        if (tool === 'web_search' || tool === 'search_web') return args.query ? `"${args.query}"` : '';
        if (tool === 'fetch_url') return args.url || '';
        if (tool === 'utility_tools') return args.action || '';
        if (tool === 'get_time') return 'current time';
        if (tool === 'calculate') return args.expression || '';
        if (tool === 'text_stats') return 'text analysis';
        if (tool === 'unit_converter') return `${args.value || ''} ${args.from_unit || ''} → ${args.to_unit || ''}`;
        if (tool === 'uuid_random') return args.type || 'uuid';
        if (tool === 'read_file' || tool === 'write_file' || tool === 'edit_file' || tool === 'replace_file_content' || tool === 'multi_replace_file_content' || tool === 'list_dir' || tool === 'delete_item') {
            return args.path ? (args.path.split(/[\\/]/).pop() || args.path) : '';
        }
        if (tool === 'run_command') return args.command || '';
        if (tool === 'grep_search') return args.query ? `"${args.query}"` : '';
        return '';
    }

    /**
     * Executes a tool in browser preview mode. Supports utility operations client-side
     * and proxies web_search/fetch_url through run_pc.py endpoints.
     * @param {string} name Tool name.
     * @param {object} args Tool arguments.
     * @returns {Promise<string>} Tool execution result text.
     */
    async _executeBrowserTool(name, args) {
        // Handle utility_tools as a dispatcher for sub-actions
        if (name === 'utility_tools') {
            const action = args.action || '';
            switch (action) {
                case 'get_time':
                    return this._toolGetTime();
                case 'calculate':
                    return this._toolCalculate(args.expression || '');
                case 'unit_converter':
                    return this._toolUnitConverter(args.value, args.from_unit, args.to_unit);
                case 'text_stats':
                    return this._toolTextStats(args.text || '');
                case 'uuid_random':
                    return this._toolUuidRandom(args.type || 'uuid');
                default:
                    return `[Error]: Unknown utility_tools action: ${action}`;
            }
        }

        // Workspace and File System tools (proxied to run_pc.py)
        if ([
            'list_dir', 'read_file', 'write_file', 'replace_file_content',
            'multi_replace_file_content', 'grep_search', 'run_command', 'delete_item'
        ].includes(name)) {
            return this._toolExecuteWorkspaceTool(name, args);
        }

        // Direct tool name matches
        switch (name) {
            case 'get_time':
                return this._toolGetTime();
            case 'calculate':
                return this._toolCalculate(args.expression || '');
            case 'text_stats':
                return this._toolTextStats(args.text || '');
            case 'unit_converter':
                return this._toolUnitConverter(args.value, args.from_unit, args.to_unit);
            case 'uuid_random':
                return this._toolUuidRandom(args.type || 'uuid');
            case 'web_search':
            case 'search_web':
                return this._toolWebSearch(args.query || '', args.limit || 5);
            case 'fetch_url':
                return this._toolFetchUrl(args.url || '');
            default:
                return `[Error]: Tool "${name}" is not available in browser preview mode.`;
        }
    }

    /**
     * Executes a workspace filesystem/command tool via the /api/tools/execute backend endpoint.
     * @param {string} tool Tool identifier.
     * @param {object} args Arguments payload.
     * @returns {Promise<string>} Tool execution result string.
     */
    async _toolExecuteWorkspaceTool(tool, args) {
        const savedWs = localStorage.getItem('kai.workspacePath') || '';
        try {
            const res = await fetch('/api/tools/execute', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    tool: tool,
                    args: args,
                    workspacePath: savedWs
                })
            });
            if (!res.ok) throw new Error(`Proxy error ${res.status}`);
            const data = await res.json();
            return data.result || JSON.stringify(data, null, 2);
        } catch (e) {
            return `[Error executing ${tool}]: ${e.message}`;
        }
    }

    /** Returns the current date, time, timezone, and UNIX timestamp. */
    _toolGetTime() {
        const now = new Date();
        return JSON.stringify({
            date: now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
            time: now.toLocaleTimeString('en-US', { hour12: false }),
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            unix: Math.floor(now.getTime() / 1000)
        }, null, 2);
    }

    /**
     * Evaluates a math expression safely.
     * @param {string} expression Math expression string.
     */
    _toolCalculate(expression) {
        try {
            // Sanitize: only allow digits, operators, parens, dots, spaces, and common math functions
            const sanitized = expression.replace(/[^0-9+\-*/().%\s^,eE]/g, '');
            if (!sanitized.trim()) return '[Error]: Empty expression';
            const result = Function('"use strict"; return (' + sanitized + ')')();
            return `Expression: ${expression}\nResult: ${result}`;
        } catch (e) {
            return `[Error calculating]: ${e.message}`;
        }
    }

    /**
     * Converts a value between two units.
     * @param {number} value Numeric value to convert.
     * @param {string} fromUnit Source unit.
     * @param {string} toUnit Target unit.
     */
    _toolUnitConverter(value, fromUnit, toUnit) {
        // Simple conversion factors to meters / base units
        const lengthUnits = { m: 1, km: 1000, cm: 0.01, mm: 0.001, miles: 1609.344, mi: 1609.344, ft: 0.3048, in: 0.0254, yard: 0.9144, yd: 0.9144 };
        const weightUnits = { kg: 1, g: 0.001, mg: 0.000001, lb: 0.453592, lbs: 0.453592, oz: 0.0283495, ton: 1000 };
        const tempUnits = ['celsius', 'c', 'fahrenheit', 'f', 'kelvin', 'k'];

        const from = (fromUnit || '').toLowerCase();
        const to = (toUnit || '').toLowerCase();

        // Temperature conversions
        if (tempUnits.includes(from) && tempUnits.includes(to)) {
            let celsius;
            if (from === 'celsius' || from === 'c') celsius = value;
            else if (from === 'fahrenheit' || from === 'f') celsius = (value - 32) * 5 / 9;
            else celsius = value - 273.15;

            let result;
            if (to === 'celsius' || to === 'c') result = celsius;
            else if (to === 'fahrenheit' || to === 'f') result = celsius * 9 / 5 + 32;
            else result = celsius + 273.15;

            return `${value} ${fromUnit} = ${result.toFixed(2)} ${toUnit}`;
        }

        // Length conversions
        if (lengthUnits[from] && lengthUnits[to]) {
            const result = value * lengthUnits[from] / lengthUnits[to];
            return `${value} ${fromUnit} = ${result.toFixed(6)} ${toUnit}`;
        }

        // Weight conversions
        if (weightUnits[from] && weightUnits[to]) {
            const result = value * weightUnits[from] / weightUnits[to];
            return `${value} ${fromUnit} = ${result.toFixed(6)} ${toUnit}`;
        }

        return `[Error]: Cannot convert between "${fromUnit}" and "${toUnit}". Unsupported unit pair.`;
    }

    /**
     * Computes basic text statistics.
     * @param {string} text Input text to analyze.
     */
    _toolTextStats(text) {
        const charCount = text.length;
        const wordCount = text.split(/\s+/).filter(Boolean).length;
        const sentenceCount = text.split(/[.!?]+/).filter(s => s.trim()).length;
        const lineCount = text.split(/\r?\n/).length;
        return `Characters: ${charCount}\nWords: ${wordCount}\nSentences: ${sentenceCount}\nLines: ${lineCount}`;
    }

    /**
     * Generates a UUID v4 or random hex token.
     * @param {string} type 'uuid' or 'hex'.
     */
    _toolUuidRandom(type) {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) {
            return crypto.randomUUID();
        }
        // Fallback UUID v4 generation
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
    }

    /**
     * Searches the web via run_pc.py proxy endpoint.
     * @param {string} query Search query.
     * @param {number} limit Max results.
     */
    async _toolWebSearch(query, limit) {
        try {
            const res = await fetch('/api/tools/web_search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query, limit })
            });
            if (!res.ok) throw new Error(`Proxy returned ${res.status}`);
            const data = await res.json();
            return data.result || JSON.stringify(data, null, 2);
        } catch (e) {
            return `[Error searching web]: ${e.message}`;
        }
    }

    /**
     * Fetches a URL's content via run_pc.py proxy endpoint.
     * @param {string} url Target URL to fetch.
     */
    async _toolFetchUrl(url) {
        try {
            const res = await fetch('/api/tools/fetch_url', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url })
            });
            if (!res.ok) throw new Error(`Proxy returned ${res.status}`);
            const data = await res.json();
            return data.result || JSON.stringify(data, null, 2);
        } catch (e) {
            return `[Error fetching URL]: ${e.message}`;
        }
    }

    /**
     * Subscribes a listener function to incoming message types.
     * @param {string} type Incoming message type key.
     * @param {Function} callback Handler function.
     */
    on(type, callback) {
        if (!this.listeners.has(type)) {
            this.listeners.set(type, []);
        }
        this.listeners.get(type).push(callback);
    }

    /**
     * Attaches window.onerror handler to catch unhandled client errors.
     * @private
     */
    _initGlobalErrorHandling() {
        window.onerror = (message, source, lineno, colno, error) => {
            this.postMessage({
                type: 'replyError',
                message: `Webview JS Error: ${message} at line ${lineno}:${colno}`
            });
        };
    }

    /**
     * Registers message event listener to dispatch events to handlers.
     * @private
     */
    _initMessageListener() {
        const dispatch = (message) => {
            if (message && message.type && this.listeners.has(message.type)) {
                const callbacks = this.listeners.get(message.type);
                callbacks.forEach(cb => cb(message));
            }
        };

        if (this._isElectron && window.electronAPI) {
            window.electronAPI.onMessage(dispatch);
        } else {
            window.addEventListener('message', (event) => {
                dispatch(event.data);
            });
        }
    }

    /**
     * Sends message payload to Host to start agent generation.
     * @param {Array} messages Conversation messages array.
     * @param {string} model Selected model ID.
     * @param {boolean} thinking Thinking toggle active status for local models.
     * @param {string} geminiThinkingLevel Selected reasoning level for Gemini models.
     * @param {boolean} planningMode Whether planning mode is toggled on.
     * @param {Array} attachedFiles Array of attached file objects.
     */
    sendUserPrompt(messages, model, thinking, geminiThinkingLevel = 'high', planningMode = false, attachedFiles = [], chatId = null, mode = 'agent') {
        this.postMessage({
            type: 'sendMessage',
            messages,
            model,
            thinking,
            geminiThinkingLevel,
            planningMode,
            attachedFiles,
            chatId,
            mode
        });
    }

    /**
     * Requests Host to open native file picker.
     */
    openFilePicker() {
        this.postMessage({ type: 'openFilePicker' });
    }

    /**
     * Requests Host to open native folder picker for active workspace directory.
     */
    browseWorkspaceFolder() {
        this.postMessage({ type: 'browseWorkspaceFolder' });
    }

    /**
     * Sends chat object to Host for persistence.
     * @param {object} chat Chat data object.
     */
    saveChat(chat) {
        this.postMessage({ type: 'saveChat', chat });
    }

    /**
     * Requests history list from Host.
     */
    loadChatHistory() {
        this.postMessage({ type: 'loadChatHistory' });
    }

    /**
     * Requests loading a specific chat session by ID.
     * @param {string} chatId Unique chat identifier.
     */
    loadChat(chatId) {
        this.postMessage({ type: 'loadChat', chatId });
    }

    /**
     * Requests deleting a specific chat session by ID.
     */
    deleteChat(chatId) {
        this.postMessage({ type: 'deleteChat', chatId });
    }

    /**
     * Triggers server connection verification check.
     */
    checkConnection() {
        this.postMessage({ type: 'checkConnection' });
    }

    /**
     * Posts setting updates to Host.
     * @param {object} settings Settings key-value pairs.
     */
    updateSettings(settings) {
        this.postMessage({ type: 'updateSettings', ...settings });
    }

    /**
     * Requests opening a workspace file.
     * @param {string} filePath File path string.
     */
    openFile(filePath) {
        this.postMessage({ type: 'openFile', filePath });
    }

    /**
     * Triggers abort signal to stop active generation loop.
     */
    abort() {
        this.postMessage({ type: 'abort' });
    }

    /**
     * Requests Host to open native folder picker for LM Studio directory.
     */
    browseLMStudioFolder() {
        this.postMessage({ type: 'browseLMStudioFolder' });
    }

    /**
     * Requests Host to open an external URL in default browser.
     * @param {string} url External URL string.
     */
    openExternalUrl(url) {
        this.postMessage({ type: 'openExternal', url });
    }
}
