/**
 * BrowserCompletionEngine: Coordinates multi-turn LLM generation loops and streaming in browser preview mode.
 */
class BrowserCompletionEngine {
    constructor(toolsExecutor) {
        this.toolsExecutor = toolsExecutor;
        this.activeAbortController = null;
    }

    /**
     * Executes an agent turn loop (up to 25 iterations).
     * @param {object} message User prompt configuration message.
     * @param {Function} emit Event emission callback.
     */
    async executeTurn(message, emit) {
        this.activeAbortController = new AbortController();
        const abortSignal = this.activeAbortController.signal;

        const rawMessages = message.messages || [];
        const model = message.model || 'local-model';
        const serverUrl = localStorage.getItem('kai.serverUrl') || 'http://localhost:1234/v1';
        const mode = message.mode || 'agent';
        const isPlanning = message.planningMode || mode === 'planning';

        // Load prompt file
        let promptFile = 'system_prompt_chat.md';
        const hasWs = !!(localStorage.getItem('kai.workspacePath'));
        if (mode === 'ask') promptFile = hasWs ? 'system_prompt_ask.md' : 'system_prompt_chat.md';
        else if (isPlanning) promptFile = 'system_prompt_planning.md';
        else if (mode === 'agent') promptFile = 'system_prompt_agent.md';

        let systemPrompt = '';
        try {
            const promptRes = await fetch(`/prompts/${promptFile}`);
            if (promptRes.ok) systemPrompt = await promptRes.text();
        } catch (e) {}

        if (!systemPrompt) {
            systemPrompt = 'You are Kai, an autonomous AI Developer Agent operating directly within the user workspace directory.';
        }

        if (hasWs) {
            try {
                const savedWs = localStorage.getItem('kai.workspacePath');
                const wsRes = await fetch('/api/tools/execute', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ tool: 'get_workspace_structure', workspacePath: savedWs })
                });
                if (wsRes.ok) {
                    const wsData = await wsRes.json();
                    if (wsData.result) systemPrompt += `\n\n${wsData.result}\n`;
                }
            } catch (e) {}
        }

        const nowObj = new Date();
        const currentDayTimeStr = `[Temporal Context & Knowledge Cutoff]\n- Current Date and Time: ${nowObj.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}, ${nowObj.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}\n- Your internal training cutoff is in the past. Events, releases, and information dated prior to the current date are historical facts, not future speculation.\n- NEVER state that an event, product, or topic prior to the current date is unreleased or speculative based on training cutoff limitations. Use available search tools if current details are required.`;
        systemPrompt += `\n\n${currentDayTimeStr}\n`;

        const messagesToSend = [...rawMessages];
        const sysIdx = messagesToSend.findIndex(m => m.role === 'system');
        if (sysIdx !== -1) {
            messagesToSend[sysIdx] = { role: 'system', content: systemPrompt };
        } else {
            messagesToSend.unshift({ role: 'system', content: systemPrompt });
        }

        emit({ type: 'agentProgress', progressType: 'start', text: 'Contacting model...' });

        let iteration = 0;
        const maxIterations = 25;
        const modifiedFiles = new Set();
        let lastResponseText = '';
        let lastTokensPerSecond = null;

        try {
            while (iteration < maxIterations) {
                iteration++;
                if (abortSignal.aborted) break;

                const { targetUrl, fetchHeaders, payload, isGemini, isCloudProvider } = BrowserProviderPayloadBuilder.build({
                    model,
                    messagesToSend,
                    serverUrl,
                    message
                });

                let response;
                try {
                    response = await fetch(targetUrl, {
                        method: 'POST',
                        headers: fetchHeaders,
                        body: JSON.stringify(payload),
                        signal: abortSignal
                    });
                } catch (fetchErr) {
                    if (!isCloudProvider) {
                        response = await fetch('/api/lmstudio/chat', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(payload),
                            signal: abortSignal
                        });
                    } else {
                        throw fetchErr;
                    }
                }

                if (!response.ok) {
                    const errBody = await response.text().catch(() => '');
                    throw new Error(`Model error (${response.status}): ${errBody || response.statusText}`);
                }

                emit({ type: 'agentProgress', progressType: 'status_update', text: 'Generating response...' });

                const allowThinkingUI = !!message.thinking;
                let tokenCount = 0;
                const streamStartTime = Date.now();
                const fullText = await BrowserStreamReader.readStream(response, abortSignal, {
                    isGemini,
                    allowThinkingUI,
                    onToken: (token) => {
                        tokenCount++;
                        emit({ type: 'agentProgress', progressType: 'token', output: token });
                    }
                });

                if (!isGemini && !isCloudProvider) {
                    const elapsedSec = Math.max(0.1, (Date.now() - streamStartTime) / 1000);
                    lastTokensPerSecond = `${(tokenCount / elapsedSec).toFixed(1)} tok/s`;
                } else {
                    lastTokensPerSecond = null;
                }

                lastResponseText = fullText;
                if (abortSignal.aborted) break;

                const toolCall = BrowserToolParser.parseToolCall(fullText);
                if (!toolCall) {
                    break;
                }

                const targetName = BrowserToolParser.getToolTarget(toolCall.name, toolCall.args);
                const activeToolId = `tool-${Date.now()}-${iteration}`;

                emit({
                    type: 'agentProgress',
                    progressType: 'tool_start',
                    tool: toolCall.name,
                    query: toolCall.query,
                    toolId: activeToolId,
                    fileName: targetName
                });

                await new Promise(r => setTimeout(r, 0));

                let toolResult = '';
                try {
                    toolResult = await this.toolsExecutor.execute(toolCall.name, toolCall.args);
                } catch (toolErr) {
                    toolResult = `[Error executing ${toolCall.name}]: ${toolErr.message || toolErr}`;
                }

                if (['write_file', 'edit_file', 'replace_file_content', 'multi_replace_file_content', 'delete_item'].includes(toolCall.name) && !toolResult.startsWith('[Error')) {
                    if (targetName) modifiedFiles.add(targetName);
                }

                emit({
                    type: 'agentProgress',
                    progressType: 'tool_end',
                    tool: toolCall.name,
                    output: toolResult,
                    toolId: activeToolId,
                    fileName: targetName
                });

                messagesToSend.push({ role: 'assistant', content: fullText });
                messagesToSend.push({
                    role: 'user',
                    content: `[Tool Result for ${toolCall.name}]:\n${toolResult}\n\nPlease proceed with the next step based on this result.`
                });
            }

            emit({
                type: 'reply',
                content: lastResponseText,
                modifiedFiles: Array.from(modifiedFiles),
                tokensPerSecond: lastTokensPerSecond
            });

            this.generateTitleAsync(rawMessages, model, serverUrl, message.chatId, emit);
        } catch (err) {
            if (err.name !== 'AbortError') {
                emit({ type: 'replyError', message: `Fout bij verzenden: ${err.message}` });
            }
        } finally {
            this.activeAbortController = null;
        }
    }

    /** Generates concise chat title asynchronously after turn completion using JSON output. */
    async generateTitleAsync(rawMessages, model, serverUrl, targetChatId, emit) {
        if (rawMessages.length > 2) return;
        try {
            const firstUserMsg = rawMessages.find(m => m.role === 'user');
            if (!firstUserMsg || !firstUserMsg.content) return;

            const isGemini = (model || '').toLowerCase().startsWith('gemini');
            const cleanModel = (model || '').endsWith(' (thinking)') ? model.slice(0, -11) : model;
            const targetUrl = isGemini ? '' : serverUrl.replace(/\/$/, '') + '/chat/completions';
            if (!targetUrl) return;

            const titlePayload = {
                model: cleanModel,
                messages: [
                    {
                        role: 'system',
                        content: 'You are a title generator. Generate a concise 3-5 word title in English for the conversation based on the user prompt.\nYou MUST respond ONLY with a JSON object in this exact format:\n{"title": "Concise Conversation Title"}\nDo not include any extra text, markdown formatting, or thoughts outside the JSON object.'
                    },
                    { role: 'user', content: firstUserMsg.content.substring(0, 500) }
                ],
                stream: false,
                max_tokens: 150
            };

            const titleRes = await fetch(targetUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(titlePayload)
            });

            if (titleRes.ok) {
                const titleData = await titleRes.json();
                const choice = titleData.choices?.[0]?.message;
                let raw = (choice?.content || choice?.reasoning_content || '').trim();

                // Strip thinking tags if present
                raw = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
                raw = raw.replace(/^<think>[\s\S]*?$/gi, '').trim();

                let extractedTitle = '';

                // Stage 1: Match fenced markdown codeblocks ```json { "title": "..." } ```
                const codeBlockMatch = raw.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/i);
                if (codeBlockMatch && codeBlockMatch[1]) {
                    try {
                        const parsed = JSON.parse(codeBlockMatch[1]);
                        if (parsed && typeof parsed.title === 'string' && parsed.title.trim()) {
                            extractedTitle = parsed.title.trim();
                        }
                    } catch (e) {}
                }

                // Stage 2: Match raw JSON objects containing "title"
                if (!extractedTitle) {
                    const jsonObjectMatch = raw.match(/\{[\s\S]*?"title"\s*:\s*"[\s\S]*?"[\s\S]*?\}/i);
                    if (jsonObjectMatch && jsonObjectMatch[0]) {
                        try {
                            const parsed = JSON.parse(jsonObjectMatch[0]);
                            if (parsed && typeof parsed.title === 'string' && parsed.title.trim()) {
                                extractedTitle = parsed.title.trim();
                            }
                        } catch (e) {}
                    }
                }

                // Stage 3: Regex extract "title": "..."
                if (!extractedTitle) {
                    const regexMatch = raw.match(/"title"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/i);
                    if (regexMatch && regexMatch[1]) {
                        extractedTitle = regexMatch[1].replace(/\\"/g, '"').trim();
                    }
                }

                // Stage 4: Fallback line cleaner
                if (!extractedTitle && raw.length > 0) {
                    const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
                    const lastLine = lines.length > 0 ? lines[lines.length - 1] : raw;
                    extractedTitle = lastLine
                        .replace(/^(title|topic)\s*:\s*/i, '')
                        .replace(/["'`*_#{}[\]]/g, ' ')
                        .replace(/\s+/g, ' ')
                        .trim();
                }

                // Sanitize and validate length
                let cleanTitle = (extractedTitle || '')
                    .replace(/^["'`]|["'`]$/g, '')
                    .replace(/\s+/g, ' ')
                    .trim();

                if (cleanTitle && cleanTitle.length > 0 && cleanTitle.length <= 60) {
                    const savedChats = JSON.parse(localStorage.getItem('kai.savedChats') || '[]');
                    const foundChat = (targetChatId ? savedChats.find(c => c.id === targetChatId) : null) || savedChats[0];
                    if (foundChat) {
                        foundChat.title = cleanTitle;
                        localStorage.setItem('kai.savedChats', JSON.stringify(savedChats));
                    }

                    try {
                        const fullSessions = JSON.parse(localStorage.getItem('kai.savedFullSessions') || '[]');
                        const fullSession = (targetChatId ? fullSessions.find(c => c.id === targetChatId) : null) || fullSessions[0];
                        if (fullSession) {
                            fullSession.title = cleanTitle;
                            localStorage.setItem('kai.savedFullSessions', JSON.stringify(fullSessions));
                        }
                    } catch (err) {}

                    try {
                        const summaries = JSON.parse(localStorage.getItem('kai.savedChatsSummary') || '[]');
                        const summaryChat = (targetChatId ? summaries.find(c => c.id === targetChatId) : null) || summaries[0];
                        if (summaryChat) {
                            summaryChat.title = cleanTitle;
                            localStorage.setItem('kai.savedChatsSummary', JSON.stringify(summaries));
                        }
                    } catch (err) {}

                    const updatedHistory = savedChats.map(c => ({
                        id: c.id,
                        title: c.title || 'New Chat',
                        timestamp: c.timestamp || Date.now()
                    }));

                    emit({
                        type: 'chatHistory',
                        chats: updatedHistory
                    });
                    emit({ type: 'chatTitleUpdated', chatId: (foundChat ? foundChat.id : targetChatId), title: cleanTitle });
                }
            }
        } catch (e) {}
    }

    /** Aborts active completion turn. */
    abort() {
        if (this.activeAbortController) {
            this.activeAbortController.abort();
            this.activeAbortController = null;
        }
    }
}

if (typeof window !== 'undefined') {
    window.BrowserCompletionEngine = BrowserCompletionEngine;
}
