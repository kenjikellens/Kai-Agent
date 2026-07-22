/**
 * Client-side script for the LM Studio Agent Chat Webview.
 * Handles DOM updates, message state tracking, formatting, and postMessage integration.
 */
(function () {
    // Acquire reference to VS Code's Webview API for message posting
    const vscode = acquireVsCodeApi();

    // Global error listener to report webview errors to the user
    window.onerror = function(message, source, lineno, colno, error) {
        vscode.postMessage({
            type: 'replyError',
            message: `Webview JS Error: ${message} at line ${lineno}:${colno}`
        });
    };

    // DOM Elements
    const chatContainer = document.getElementById('chat-container');
    const messageInput = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');
    const statusDot = document.getElementById('status-dot');
    const dropdownTriggerBtn = document.getElementById('dropdown-trigger-btn');
    const dropdownOptionsMenu = document.getElementById('dropdown-options-menu');
    const selectedModelText = document.getElementById('selected-model-text');
    const thinkingToggle = document.getElementById('thinking-toggle');
    const newChatBtn = document.getElementById('new-chat-btn');
    const historyBtn = document.getElementById('history-btn');
    const historyContainer = document.getElementById('history-container');
    const historyList = document.getElementById('history-list');
    const closeHistoryBtn = document.getElementById('close-history-btn');
    const settingsBtn = document.getElementById('settings-btn');
    const settingsContainer = document.getElementById('settings-container');
    const closeSettingsBtn = document.getElementById('close-settings-btn');
    const showThinkingToggle = document.getElementById('show-thinking-toggle');
    const thinkingSubsettings = document.getElementById('thinking-subsettings');
    const keepThinkingExpandedToggle = document.getElementById('keep-thinking-expanded-toggle');
    const keepThinkingFinishedExpandedToggle = document.getElementById('keep-thinking-finished-expanded-toggle');
    const apiKeyInput = document.getElementById('api-key-input');
    const apiKeyContainer = document.getElementById('api-key-container');

    // Initialize show thinking process setting from localStorage (default to true)
    if (showThinkingToggle) {
        const stored = localStorage.getItem('kai.showThinking');
        showThinkingToggle.checked = stored === null ? true : stored === 'true';
        showThinkingToggle.addEventListener('change', () => {
            localStorage.setItem('kai.showThinking', showThinkingToggle.checked);
            updateSubsettingsVisibility();
        });
    }

    // Initialize keep thinking expanded setting from localStorage (default to true)
    if (keepThinkingExpandedToggle) {
        const stored = localStorage.getItem('kai.keepThinkingExpanded');
        keepThinkingExpandedToggle.checked = stored === null ? true : stored === 'true';
        keepThinkingExpandedToggle.addEventListener('change', () => {
            localStorage.setItem('kai.keepThinkingExpanded', keepThinkingExpandedToggle.checked);
        });
    }

    // Initialize keep thinking finished expanded setting from localStorage (default to false)
    if (keepThinkingFinishedExpandedToggle) {
        const stored = localStorage.getItem('kai.keepThinkingFinishedExpanded');
        keepThinkingFinishedExpandedToggle.checked = stored === null ? false : stored === 'true';
        keepThinkingFinishedExpandedToggle.addEventListener('change', () => {
            localStorage.setItem('kai.keepThinkingFinishedExpanded', keepThinkingFinishedExpandedToggle.checked);
        });
    }

    function updateSubsettingsVisibility() {
        if (thinkingSubsettings && showThinkingToggle) {
            if (showThinkingToggle.checked) {
                thinkingSubsettings.classList.remove('hidden');
            } else {
                thinkingSubsettings.classList.add('hidden');
            }
        }
    }
    updateSubsettingsVisibility();

    // Initialize api key event listeners
    if (apiKeyInput) {
        apiKeyInput.addEventListener('change', () => {
            // Collect all per-provider API key values from their dynamic inputs
            const providerKeys = {};
            document.querySelectorAll('.provider-api-key-input').forEach(input => {
                const configKey = input.dataset.configKey;
                if (configKey) { providerKeys[configKey] = input.value; }
            });
            vscode.postMessage({
                type: 'updateSettings',
                apiKey: apiKeyInput.value,
                providerKeys
            });
        });
    }

    const languageSelectInput = document.getElementById('language-select-input');
    if (languageSelectInput) {
        if (window.KAI_LANG) {
            languageSelectInput.value = window.KAI_LANG;
        }
        languageSelectInput.addEventListener('change', () => {
            vscode.postMessage({
                type: 'updateSettings',
                language: languageSelectInput.value
            });
        });
    }

    // Conversation & Context State
    let currentChatId = generateChatId();
    let messages = [];
    let selectedCodeContext = '';
    let isWaitingForResponse = false;
    let currentAssistantMsgElement = null;
    let currentAssistantText = '';
    let selectedModelValue = localStorage.getItem('kai.selectedModel') || 'local-model';
    if (selectedModelText && selectedModelValue && selectedModelValue !== 'local-model') {
        selectedModelText.textContent = formatModelName(selectedModelValue);
    }
    const accordionStates = {};

    /** Tracks free provider metadata received from backend for settings panel rendering. */
    let freeProvidersConfig = [];

    /**
     * Instantly populates the dropdown menu with default cloud and free models so user never waits.
     */
    function initDefaultDropdown() {
        if (!dropdownOptionsMenu || dropdownOptionsMenu.children.length > 0) return;
        
        const i18n = window.KAI_I18N || {};
        const defaultGemini = ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash-lite'];
        const defaultProviders = [
            { name: 'OmniRoute Gateway', models: ['omniroute/auto'] },
            { name: 'Mistral AI', models: ['mistral/mistral-small-latest', 'mistral/codestral-latest', 'mistral/open-mixtral-8x22b'] },
            { name: 'Cohere', models: ['cohere/command-r-plus', 'cohere/command-r'] },
            { name: 'Cerebras', models: ['cerebras/llama-3.3-70b', 'cerebras/llama-3.1-8b'] },
            { name: 'Zhipu AI (GLM)', models: ['zhipu/glm-4-flash', 'zhipu/glm-4-plus'] }
        ];

        // LM Studio group (checking placeholder)
        const lmDiv = document.createElement('div');
        lmDiv.className = 'dropdown-category';
        lmDiv.innerHTML = `<div class="dropdown-category-header"><span>${i18n.lmStudioHeader || 'LM Studio (Local)'} (${i18n.checkingServer || 'Checking...'})</span></div><div class="dropdown-category-content"><div class="dropdown-item-placeholder">Checking local server...</div></div>`;
        dropdownOptionsMenu.appendChild(lmDiv);

        // Gemini group
        const gemDiv = document.createElement('div');
        gemDiv.className = 'dropdown-category';
        let gemHtml = defaultGemini.map(m => `<div class="dropdown-item${m === selectedModelValue ? ' selected' : ''}" data-value="${m}"><span class="status-dot status-connected"></span><span class="dropdown-item-text">${m}</span></div>`).join('');
        gemDiv.innerHTML = `<div class="dropdown-category-header"><span>Gemini (Cloud)</span></div><div class="dropdown-category-content">${gemHtml}</div>`;
        dropdownOptionsMenu.appendChild(gemDiv);

        // Free provider groups
        defaultProviders.forEach(p => {
            const pDiv = document.createElement('div');
            pDiv.className = 'dropdown-category';
            let pHtml = p.models.map(m => `<div class="dropdown-item${m === selectedModelValue ? ' selected' : ''}" data-value="${m}"><span class="status-dot status-connected"></span><span class="dropdown-item-text">${formatModelName(m)}</span></div>`).join('');
            pDiv.innerHTML = `<div class="dropdown-category-header"><span>${p.name} (Free)</span></div><div class="dropdown-category-content">${pHtml}</div>`;
            dropdownOptionsMenu.appendChild(pDiv);
        });

        // Attach click handlers to instant options
        dropdownOptionsMenu.querySelectorAll('.dropdown-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const val = item.dataset.value;
                if (val) {
                    selectedModelValue = val;
                    localStorage.setItem('kai.selectedModel', val);
                    selectedModelText.textContent = formatModelName(val);
                    dropdownOptionsMenu.classList.add('hidden');
                    saveCurrentChat();
                }
            });
        });
    }

    // Populate dropdown immediately on startup
    initDefaultDropdown();

    /**
     * Generates a unique string identifier for a new chat session.
     * @returns {string} The unique chat ID.
     */
    function generateChatId() {
        return 'chat_' + Math.random().toString(36).substring(2, 11) + '_' + Date.now();
    }

    /**
     * Triggers a message to the VS Code backend to save the current chat state.
     */
    function saveCurrentChat() {
        const firstUserMsg = messages.find(m => m.role === 'user');
        let title = 'New Chat';
        if (firstUserMsg) {
            title = firstUserMsg.content;
            if (title.startsWith('Here is the selected code context')) {
                const parts = title.split('\n\n');
                title = parts[parts.length - 1] || 'New Chat';
            }
            if (title.length > 30) {
                title = title.substring(0, 27) + '...';
            }
        }
        vscode.postMessage({
            type: 'saveChat',
            chat: {
                id: currentChatId,
                title: title,
                messages: messages,
                model: selectedModelValue,
                thinking: thinkingToggle.checked,
                timestamp: Date.now()
            }
        });
    }

    // Trigger initial connection verification
    checkServerConnection();

    // Periodically verify server connection and active model every 5 seconds
    setInterval(checkServerConnection, 5000);

    /**
     * Posts a message to the extension host to check LM Studio connection and loaded models.
     */
    function checkServerConnection() {
        // Only trigger status dot animation on initial/explicit check to prevent distracting visual jumps
        vscode.postMessage({ type: 'checkConnection' });
    }

    /**
     * Appends a message bubble into the scrollable chat container.
     * Parses simple markdown code blocks for visual clarity.
     * @param {string} role The sender role: 'user', 'assistant', or 'system'.
     * @param {string} text The raw text content of the message.
     */
    function appendMessage(role, text) {
        const messageDiv = document.createElement('div');
        
        if (role === 'file-summary') {
            messageDiv.className = 'message file-summary-message';
            
            let files = [];
            try {
                files = JSON.parse(text);
            } catch (e) {
                files = [];
            }
            
            if (files.length === 0) return;
            
            const widgetDiv = document.createElement('div');
            widgetDiv.className = 'file-summary-widget';
            
            const getFileDetails = (filePath) => {
                const basename = filePath.split(/[/\\]/).pop();
                const ext = basename.includes('.') ? basename.split('.').pop().toLowerCase() : '';
                let icon = '{}';
                if (['js', 'ts', 'jsx', 'tsx'].includes(ext)) {
                    icon = '<span class="file-icon js-icon">JS</span>';
                } else if (['html', 'htm'].includes(ext)) {
                    icon = '<span class="file-icon html-icon">&lt;/&gt;</span>';
                } else if (['css', 'scss', 'sass'].includes(ext)) {
                    icon = '<span class="file-icon css-icon">{}</span>';
                } else {
                    icon = '<span class="file-icon doc-icon">📄</span>';
                }
                
                const dirParts = filePath.split(/[/\\]/);
                dirParts.pop();
                const dirPath = dirParts.length > 0 ? '...' + dirParts.join('/') : '';
                
                return { basename, icon, dirPath };
            };
            
            const itemsHtml = files.map(file => {
                const details = getFileDetails(file);
                return `
                    <div class="file-summary-item">
                        ${details.icon}
                        <span class="file-name">${escapeHtml(details.basename)}</span>
                        <span class="file-path">${escapeHtml(details.dirPath)}</span>
                    </div>
                `;
            }).join('');
            
            widgetDiv.innerHTML = `
                <div class="file-summary-header">
                    <span class="file-summary-count">${files.length} file${files.length > 1 ? 's' : ''} changed</span>
                </div>
                <div class="file-summary-body">
                    ${itemsHtml}
                </div>
            `;
            messageDiv.appendChild(widgetDiv);
        } else {
            messageDiv.className = `message ${role}-message`;

            const contentDiv = document.createElement('div');
            contentDiv.className = 'message-content';

            contentDiv.innerHTML = formatMarkdown(text);
            messageDiv.appendChild(contentDiv);
        }

        chatContainer.appendChild(messageDiv);
        scrollToBottom();
    }

    /**
     * Formats a long model ID or path into a clean, readable name.
     * @param {string} modelId The full path or identifier.
     * @returns {string} The formatted name.
     */
    function formatModelName(modelId) {
        if (!modelId) return 'Local Model';
        // Strip provider namespace prefix (e.g. "mistral/mistral-small-latest" → "mistral-small-latest")
        const slashIdx = modelId.indexOf('/');
        const displayId = slashIdx !== -1 ? modelId.slice(slashIdx + 1) : modelId;
        const parts = displayId.split(/[/\\]/).filter(p => p.trim() !== '');
        if (parts.length === 0) return displayId;
        
        let last = parts[parts.length - 1];
        // If the filename is generic, use the parent folder name
        if (/^model(\.gguf)?$/i.test(last) && parts.length > 1) {
            last = parts[parts.length - 2];
        }
        return last.replace(/\.gguf$/i, '');
    }

    /**
     * Formats basic HTML entities safely.
     * @param {string} text The raw string.
     * @returns {string} The HTML-safe escaped string.
     */
    function escapeHtml(text) {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    /**
     * Formats basic Markdown code blocks (```code```) and inline code (`code`) into HTML tags.
     * Escapes HTML entities first to prevent rendering bugs.
     * Also parses or strips reasoning <think> blocks based on user preferences.
     * @param {string} text The raw string.
     * @param {boolean|null} forceThinkingCollapsed Optional override for collapse state.
     * @returns {string} The formatted HTML string.
     */
    function formatMarkdown(text, forceThinkingCollapsed = null) {
        const chevronSvg = `<svg class="custom-chevron" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 5px; display: inline-block; vertical-align: middle;"><polyline points="6 9 12 15 18 9"></polyline></svg>`;

        // Safely strip incomplete streaming tool calls (prevents flickering)
        let cleanText = text;
        cleanText = cleanText.replace(/```json(?:(?!```)[\s\S])*$/i, '');
        cleanText = cleanText.replace(/```\s*\{\s*["']type["'](?:(?!```)[\s\S])*$/i, '');

        // Handle tool result formatting
        if (cleanText.startsWith('[Tool Result for')) {
            const match = cleanText.match(/^\[Tool Result for (.*?)\]:\n([\s\S]*)/);
            if (match) {
                const toolName = match[1];
                const resultBody = match[2];
                return `<details class="tool-result-details" open><summary>${chevronSvg}Tool Result: <strong>${escapeHtml(toolName)}</strong></summary><pre><code>${escapeHtml(resultBody)}</code></pre></details>`;
            }
        }

        // Wrap JSON blocks in custom placeholder tags so they don't get escaped
        cleanText = cleanText.replace(/```json\s*([\s\S]*?)```/gi, (match, p1) => {
            return `[[[TOOL_CALL_START]]]${p1}[[[TOOL_CALL_END]]]`;
        });
        cleanText = cleanText.replace(/```\s*(\{\s*["']type["'][\s\S]*?\})\s*```/gi, (match, p1) => {
            return `[[[TOOL_CALL_START]]]${p1}[[[TOOL_CALL_END]]]`;
        });

        let escaped = escapeHtml(cleanText);

        // Check toggle to show or completely strip <think>...</think> blocks
        const isThinkingEnabled = thinkingToggle.checked;
        if (isThinkingEnabled) {
            const showThinking = localStorage.getItem('kai.showThinking') !== 'false';
            const keepThinkingExpanded = localStorage.getItem('kai.keepThinkingExpanded') !== 'false';
            const keepThinkingFinishedExpanded = localStorage.getItem('kai.keepThinkingFinishedExpanded') === 'true';

            // Open chevron: points up (polyline points: 18 15 12 9 6 15)
            const chevronUp = `<svg class="thinking-chevron" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>`;
            // Closed chevron: points down (polyline points: 6 9 12 15 18 9)
            const chevronDown = `<svg class="thinking-chevron" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`;

            if (showThinking) {
                // Case 1: Completed thinking block
                if (escaped.includes('&lt;/think&gt;')) {
                    escaped = escaped.replace(/&lt;think&gt;([\s\S]*?)&lt;\/think&gt;/g, (match, p1) => {
                        const cleanedContent = p1.trim().replace(/(\r?\n\s*){3,}/g, '\n');
                        const shouldRespectExistingState = forceThinkingCollapsed !== null && keepThinkingFinishedExpanded;
                        const isCollapsed = shouldRespectExistingState ? forceThinkingCollapsed : !keepThinkingFinishedExpanded;
                        const activeChevron = isCollapsed ? chevronDown : chevronUp;
                        const activeCollapsedClass = isCollapsed ? ' collapsed' : '';
                        return `<div class="thinking-block"><div class="thinking-header">Thinking Process${activeChevron}</div><div class="thinking-content${activeCollapsedClass}"><em>${cleanedContent}</em></div></div>`;
                    });
                }
                // Case 2: Streaming thinking block (starts with <think> but not closed yet)
                else if (escaped.includes('&lt;think&gt;')) {
                    escaped = escaped.replace(/&lt;think&gt;([\s\S]*)$/g, (match, p1) => {
                        const cleanedContent = p1.trim().replace(/(\r?\n\s*){3,}/g, '\n');
                        const shouldRespectExistingState = forceThinkingCollapsed !== null && keepThinkingExpanded;
                        const isCollapsed = shouldRespectExistingState ? forceThinkingCollapsed : !keepThinkingExpanded;
                        const activeChevron = isCollapsed ? chevronDown : chevronUp;
                        const activeCollapsedClass = isCollapsed ? ' collapsed' : '';
                        return `<div class="thinking-block"><div class="thinking-header"><span class="thinking-spinner"></span>Thinking...${activeChevron}</div><div class="thinking-content${activeCollapsedClass}"><em>${cleanedContent}</em></div></div>`;
                    });
                }
            } else {
                // Show thinking is disabled:
                // Case 1: Completed thinking block -> strip completely
                if (escaped.includes('&lt;/think&gt;')) {
                    escaped = escaped.replace(/&lt;think&gt;([\s\S]*?)&lt;\/think&gt;/g, '');
                }
                // Case 2: Streaming thinking block -> show simple loader only, no content details
                else if (escaped.includes('&lt;think&gt;')) {
                    escaped = escaped.replace(/&lt;think&gt;([\s\S]*)$/g, () => {
                        return `<div class="thinking-loader"><span class="thinking-spinner"></span>Thinking...</div>`;
                    });
                }
            }
        } else {
            // Strip completed
            escaped = escaped.replace(/&lt;think&gt;([\s\S]*?)&lt;\/think&gt;/g, '');
            // Strip streaming/incomplete
            escaped = escaped.replace(/&lt;think&gt;([\s\S]*)$/g, '');
        }

        // Replace tool call placeholders with empty string to hide them from the chat
        escaped = escaped.replace(/\[\[\[TOOL_CALL_START\]\]\]([\s\S]*?)\[\[\[TOOL_CALL_END\]\]\]/g, (match, p1) => {
            return '';
        });

        // Replace triple backtick code blocks: ```language ... ```
        escaped = escaped.replace(/```(?:[a-zA-Z0-9\-]+)?\n([\s\S]*?)\n```/g, '<pre><code>$1</code></pre>');

        // Replace single backtick inline code: `code`
        escaped = escaped.replace(/`([^`]+)`/g, '<code>$1</code>');

        // Bold formatting: **bold text**
        escaped = escaped.replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>');

        // Italic formatting: *italic text*
        escaped = escaped.replace(/\*([\s\S]+?)\*/g, '<em>$1</em>');

        // Headers formatting: # h1, ## h2, ### h3
        escaped = escaped.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
        escaped = escaped.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
        escaped = escaped.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');

        // Bullet lists formatting: - item or * item
        escaped = escaped.replace(/^[-\*]\s+(.+)$/gm, '• $1');

        return escaped;
    }

    /**
     * Scrolls the chat output container to the very bottom.
     */
    function scrollToBottom() {
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }

    /**
     * Shows a visual pulsing dot typing indicator to indicate processing.
     */
    function showTypingIndicator() {
        removeTypingIndicator();

        const indicatorDiv = document.createElement('div');
        indicatorDiv.id = 'typing-indicator-container';
        indicatorDiv.className = 'message assistant-message';

        const contentsDiv = document.createElement('div');
        contentsDiv.className = 'typing-indicator';
        contentsDiv.innerHTML = `
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
        `;

        indicatorDiv.appendChild(contentsDiv);
        chatContainer.appendChild(indicatorDiv);
        scrollToBottom();
    }

    /**
     * Removes the active typing indicator from the view log.
     */
    function removeTypingIndicator() {
        const indicator = document.getElementById('typing-indicator-container');
        if (indicator) {
            indicator.remove();
        }
    }

    /**
     * Gathers current state and sends the user prompt to the extension backend.
     */
    function sendMessage() {
        if (isWaitingForResponse) {
            // Abort the ongoing generation request
            vscode.postMessage({ type: 'abort' });
            setUiLoading(false);
            appendMessage('system', 'Generation stopped.');
            return;
        }

        const text = messageInput.value.trim();
        if (!text && !selectedCodeContext) {
            return;
        }

        let userPrompt = '';

        // If code selection context exists, package it nicely into the user's prompt
        if (selectedCodeContext) {
            userPrompt += `Here is the selected code context from the editor:\n\`\`\`\n${selectedCodeContext}\n\`\`\`\n\n`;
        }

        userPrompt += text;

        // Add user message to state and view
        messages.push({ role: 'user', content: userPrompt });
        appendMessage('user', text || 'Sent selected code context');

        // Reset inputs and context panel
        messageInput.value = '';
        clearCodeContext();

        // Lock interface buttons during inference
        setUiLoading(true);

        // Save current chat history state locally
        saveCurrentChat();

        // Forward message history stack and selected model to extension host
        vscode.postMessage({
            type: 'sendMessage',
            messages: messages,
            model: selectedModelValue,
            thinking: thinkingToggle.checked
        });
    }

    /**
     * Toggles interaction controls (textarea, buttons) during request lifecycle.
     * @param {boolean} isLoading True to lock inputs, False to unlock.
     */
    function setUiLoading(isLoading) {
        isWaitingForResponse = isLoading;
        messageInput.disabled = isLoading;
        // Keep the send button enabled so it can function as a stop button
        sendBtn.disabled = false;
        
        if (isLoading) {
            // Stop button
            sendBtn.innerHTML = window.KAI_SVGS['stop'] || '';
            sendBtn.title = 'Stop generation';
            showTypingIndicator();
        } else {
            // Send button
            sendBtn.innerHTML = window.KAI_SVGS['send'] || '';
            sendBtn.title = 'Send message';
            removeTypingIndicator();
        }
    }

    /**
     * Resets current active editor code selections and hides visual indicators.
     */
    function clearCodeContext() {
        selectedCodeContext = '';
    }

    /**
     * Translates tool types and filenames/commands into structured text and icon templates.
     */
    function getToolDescription(tool, targetName, state) {
        const iconSvg = window.KAI_SVGS[tool] || window.KAI_SVGS['default_tool'] || '';
        let verb = '';
        
        switch (tool) {
            case 'read_file':
                verb = state === 'start' ? 'analysing' : (state === 'success' ? 'analysed' : 'failed analysing');
                break;
            case 'write_file':
                verb = state === 'start' ? 'creating' : (state === 'success' ? 'created' : 'failed creating');
                break;
            case 'edit_file':
                verb = state === 'start' ? 'editing' : (state === 'success' ? 'edited' : 'failed editing');
                break;
            case 'list_dir':
                verb = state === 'start' ? 'scanning' : (state === 'success' ? 'scanned' : 'failed scanning');
                break;
            case 'run_command':
                verb = state === 'start' ? 'running' : (state === 'success' ? 'executed' : 'failed executing');
                break;
            default:
                verb = state === 'start' ? 'running' : (state === 'success' ? 'completed' : 'failed');
        }

        const prefixSvg = state === 'start' ? '' : (state === 'success' 
            ? (window.KAI_SVGS['success'] || '') 
            : (window.KAI_SVGS['error'] || ''));
        
        let target = targetName || '';
        if (tool === 'run_command' && target.length > 40) {
            target = target.substring(0, 37) + '...';
        }

        return `${prefixSvg}${iconSvg} ${verb} <code>${escapeHtml(target)}</code>`;
    }

    /**
     * Ingests and renders tool execution status events from the extension backend.
     * @param {object} progress The progress event payload.
     */
    function handleAgentProgress(progress) {
        if (progress.progressType === 'token') {
            currentAssistantText += progress.output;
            
            // Capture existing collapse state from the DOM if it exists
            let forceThinkingCollapsed = null;
            if (currentAssistantMsgElement) {
                const existingThinking = currentAssistantMsgElement.querySelector('.thinking-content');
                if (existingThinking) {
                    forceThinkingCollapsed = existingThinking.classList.contains('collapsed');
                }
            }

            // Delta-update for streaming thinking content
            const isStreamingThinking = currentAssistantMsgElement && 
                                        currentAssistantMsgElement.querySelector('.thinking-content em') && 
                                        !currentAssistantText.includes('</think>');
            
            if (isStreamingThinking) {
                const thinkStartTag = '<think>';
                const thinkStartIndex = currentAssistantText.indexOf(thinkStartTag);
                if (thinkStartIndex !== -1) {
                    const rawThinkingText = currentAssistantText.substring(thinkStartIndex + thinkStartTag.length);
                    const escapedThinkingText = escapeHtml(rawThinkingText).trim().replace(/(\r?\n\s*){3,}/g, '\n');
                    currentAssistantMsgElement.querySelector('.thinking-content em').innerHTML = escapedThinkingText;
                    
                    const thinkingContentEl = currentAssistantMsgElement.querySelector('.thinking-content');
                    if (thinkingContentEl && !thinkingContentEl.classList.contains('collapsed')) {
                        thinkingContentEl.scrollTop = thinkingContentEl.scrollHeight;
                    }
                    scrollToBottom();
                }
            } else {
                const formatted = formatMarkdown(currentAssistantText, forceThinkingCollapsed);
                
                if (formatted.trim()) {
                    if (!currentAssistantMsgElement) {
                        currentAssistantMsgElement = document.createElement('div');
                        currentAssistantMsgElement.className = 'message assistant-message';
                        const contentDiv = document.createElement('div');
                        contentDiv.className = 'message-content';
                        currentAssistantMsgElement.appendChild(contentDiv);
                        chatContainer.appendChild(currentAssistantMsgElement);
                    }
                    currentAssistantMsgElement.querySelector('.message-content').innerHTML = formatted;

                    // Auto-scroll the active thinking container to show the latest thinking process text
                    const thinkingContentEl = currentAssistantMsgElement.querySelector('.thinking-content');
                    if (thinkingContentEl && !currentAssistantText.includes('</think>')) {
                        if (!thinkingContentEl.classList.contains('collapsed')) {
                            thinkingContentEl.scrollTop = thinkingContentEl.scrollHeight;
                        }
                    }

                    scrollToBottom();
                }
            }
        } else if (progress.progressType === 'thinking') {
            // Render thinking steps (disabled)
        } else if (progress.progressType === 'tool_start') {
            currentAssistantMsgElement = null;
            currentAssistantText = '';
            
            // Create a compact status row
            const statusDiv = document.createElement('div');
            statusDiv.id = progress.toolId;
            statusDiv.className = 'tool-status-row in-progress';
            statusDiv.innerHTML = getToolDescription(progress.tool, progress.fileName, 'start');
            chatContainer.appendChild(statusDiv);
        } else if (progress.progressType === 'tool_end') {
            const statusDiv = document.getElementById(progress.toolId);
            if (statusDiv) {
                const isError = progress.output && (
                    progress.output.startsWith('[Error') || 
                    progress.output.startsWith('[Execution Cancelled]')
                );
                statusDiv.className = `tool-status-row ${isError ? 'errored' : 'completed'}`;
                statusDiv.innerHTML = getToolDescription(progress.tool, progress.fileName, isError ? 'error' : 'success');
                
                // Show raw error feedback if execution failed
                if (isError) {
                    const errorDetail = document.createElement('div');
                    errorDetail.className = 'tool-error-detail';
                    errorDetail.textContent = progress.output;
                    statusDiv.appendChild(errorDetail);
                }
            }
        }
        scrollToBottom();
    }

    // --- Interactive Actions ---

    // Send click trigger
    sendBtn.addEventListener('click', sendMessage);

    // New Chat / Clear Chat trigger
    newChatBtn.addEventListener('click', () => {
        if (isWaitingForResponse) {
            vscode.postMessage({ type: 'abort' });
        }
        currentChatId = generateChatId();
        messages = [];
        chatContainer.innerHTML = '';
        clearCodeContext();
        setUiLoading(false);
        historyContainer.classList.add('hidden');
    });

    // Textarea Enter key submit (excluding Shift+Enter newline breaks)
    messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    // Wire up historyBtn to load and show previous chats overlay
    historyBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'loadChatHistory' });
        historyContainer.classList.remove('hidden');
    });

    // Wire up close button for the history panel
    closeHistoryBtn.addEventListener('click', () => {
        historyContainer.classList.add('hidden');
    });

    // Keys container DOM elements
    const keysContainer = document.getElementById('keys-container');
    const manageKeysBtn = document.getElementById('manage-keys-btn');
    const closeKeysBtn = document.getElementById('close-keys-btn');
    const dynamicKeysList = document.getElementById('dynamic-keys-list');

    // Wire up settingsBtn to open settings overlay
    settingsBtn.addEventListener('click', () => {
        settingsContainer.classList.remove('hidden');
    });

    // Wire up manageKeysBtn to open keys manager popup overlay
    if (manageKeysBtn) {
        manageKeysBtn.addEventListener('click', () => {
            keysContainer.classList.remove('hidden');
            renderProviderKeyInputs();
        });
    }

    // Wire up close button for keys panel
    if (closeKeysBtn) {
        closeKeysBtn.addEventListener('click', () => {
            keysContainer.classList.add('hidden');
        });
    }

    /**
     * Renders password input fields for each free-tier provider inside the keys popup overlay,
     * pre-filling existing API key values received from VS Code configuration.
     * Each input sends an updateSettings message on change to immediately persist the new key.
     */
    function renderProviderKeyInputs() {
        if (!dynamicKeysList) return;

        // Clear previous elements
        dynamicKeysList.innerHTML = '';

        for (const provider of freeProvidersConfig) {
            const wrapper = document.createElement('div');
            wrapper.className = 'setting-item';

            const label = document.createElement('label');
            label.textContent = `${provider.name} API Key`;
            label.setAttribute('for', `provider-key-${provider.configKey}`);

            const input = document.createElement('input');
            input.type = 'password';
            input.id = `provider-key-${provider.configKey}`;
            input.className = 'provider-api-key-input';
            input.dataset.configKey = provider.configKey;
            input.placeholder = provider.keyHint || 'Enter API key…';
            input.value = provider.apiKey || ''; // Set previously saved key

            // Persist on change by sending all provider keys together
            input.addEventListener('change', () => {
                const providerKeys = {};
                document.querySelectorAll('.provider-api-key-input').forEach(inp => {
                    const k = inp.dataset.configKey;
                    if (k) { providerKeys[k] = inp.value; }
                });
                vscode.postMessage({
                    type: 'updateSettings',
                    apiKey: apiKeyInput ? apiKeyInput.value : '',
                    providerKeys
                });
            });

            wrapper.appendChild(label);
            wrapper.appendChild(input);
            dynamicKeysList.appendChild(wrapper);
        }
    }

    // Wire up close button for settings panel
    closeSettingsBtn.addEventListener('click', () => {
        settingsContainer.classList.add('hidden');
        if (keysContainer) {
            keysContainer.classList.add('hidden');
        }
    });

    // Toggle model dropdown menu visibility on trigger click
    dropdownTriggerBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdownOptionsMenu.classList.toggle('hidden');
    });

    // Close dropdown menu when clicking outside of it
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#model-dropdown-container')) {
            dropdownOptionsMenu.classList.add('hidden');
        }
    });

    // Collapsible thinking block trigger via event delegation on chatContainer
    chatContainer.addEventListener('click', (e) => {
        const header = e.target.closest('.thinking-header');
        if (header) {
            const content = header.nextElementSibling;
            if (content && content.classList.contains('thinking-content')) {
                content.classList.toggle('collapsed');
                const chevron = header.querySelector('.thinking-chevron');
                if (chevron) {
                    const isCollapsed = content.classList.contains('collapsed');
                    // Down chevron: 6 9 12 15 18 9 | Up chevron: 18 15 12 9 6 15
                    chevron.innerHTML = isCollapsed 
                        ? '<polyline points="6 9 12 15 18 9"></polyline>'
                        : '<polyline points="18 15 12 9 6 15"></polyline>';
                    if (!isCollapsed) {
                        content.scrollTop = content.scrollHeight;
                    }
                }
            }
        }
    });

    // --- Incoming Event Receivers from VS Code Extension ---
    window.addEventListener('message', (event) => {
        const message = event.data;

        switch (message.type) {
            case 'initialState': {
                if (message.isRunning) {
                    setUiLoading(true);
                    if (message.messages && message.messages.length > 0) {
                        messages = message.messages;
                        chatContainer.innerHTML = '';
                        messages.forEach(msg => {
                            if (msg.role === 'user' || msg.role === 'assistant' || msg.role === 'file-summary') {
                                appendMessage(msg.role, msg.content);
                            }
                        });
                    }
                    if (message.streamingText) {
                        currentAssistantText = message.streamingText;
                        const formatted = formatMarkdown(currentAssistantText);
                        currentAssistantMsgElement = document.createElement('div');
                        currentAssistantMsgElement.className = 'message assistant-message';
                        const contentDiv = document.createElement('div');
                        contentDiv.className = 'message-content';
                        contentDiv.innerHTML = formatted;
                        currentAssistantMsgElement.appendChild(contentDiv);
                        chatContainer.appendChild(currentAssistantMsgElement);
                        scrollToBottom();
                    }
                }
                break;
            }
            case 'connectionStatus': {
                if (apiKeyInput && message.apiKey !== undefined) {
                    apiKeyInput.value = message.apiKey;
                }

                /**
                 * Checks if a specific model is connected or loaded.
                 * @param {string} m - The model ID to check.
                 * @returns {boolean} True if the model is connected/loaded, false otherwise.
                 */
                const isModelConnected = (m) => {
                    if (!m) return false;
                    const lowerM = m.toLowerCase();
                    if (lowerM.startsWith('gemini')) {
                        return !!message.apiKey;
                    }
                    const freeProviders = message.freeProviders || [];
                    for (const provider of freeProviders) {
                        if (provider.models.includes(m)) {
                            return !!provider.apiKey;
                        }
                    }
                    return message.connected && message.loadedModels && message.loadedModels.includes(m);
                };

                const isSelectedModelLoaded = isModelConnected(selectedModelValue);
                
                const lmStudioModels = message.lmStudioModels || [];
                const geminiModels = message.geminiModels || [];
                const combinedModels = [...lmStudioModels, ...geminiModels];

                // Ensure selectedModelText trigger button text ALWAYS shows active model name
                if (selectedModelValue && selectedModelValue !== 'local-model' && selectedModelValue !== 'No Models Loaded') {
                    selectedModelText.textContent = formatModelName(selectedModelValue);
                    statusDot.className = isModelConnected(selectedModelValue) ? 'status-dot status-connected' : 'status-dot status-disconnected';
                } else if (combinedModels.length > 0) {
                    selectedModelValue = combinedModels[0];
                    selectedModelText.textContent = formatModelName(selectedModelValue);
                    statusDot.className = isModelConnected(selectedModelValue) ? 'status-dot status-connected' : 'status-dot status-disconnected';
                } else {
                    selectedModelValue = 'local-model';
                    selectedModelText.textContent = 'local-model';
                    statusDot.className = isModelConnected('local-model') ? 'status-dot status-connected' : 'status-dot status-disconnected';
                }

                /**
                 * Creates and appends an accordion category group to the dropdown menu.
                 * @param {string} title - The category header text.
                 * @param {string[]} modelsList - List of model IDs under this category.
                 * @param {boolean} isInitiallyExpanded - Whether the category should be expanded initially.
                 */
                const createAccordionGroup = (title, modelsList, isInitiallyExpanded) => {
                    const groupDiv = document.createElement('div');
                    groupDiv.className = 'dropdown-category';

                    const headerDiv = document.createElement('div');
                    headerDiv.className = 'dropdown-category-header';
                    
                    const titleSpan = document.createElement('span');
                    titleSpan.textContent = title;
                    headerDiv.appendChild(titleSpan);

                    const svgNS = 'http://www.w3.org/2000/svg';
                    const chevronSvg = document.createElementNS(svgNS, 'svg');
                    chevronSvg.setAttribute('class', 'chevron-icon');
                    chevronSvg.setAttribute('width', '8');
                    chevronSvg.setAttribute('height', '8');
                    chevronSvg.setAttribute('viewBox', '0 0 24 24');
                    chevronSvg.setAttribute('fill', 'none');
                    chevronSvg.setAttribute('stroke', 'currentColor');
                    chevronSvg.setAttribute('stroke-width', '3');
                    chevronSvg.setAttribute('stroke-linecap', 'round');
                    chevronSvg.setAttribute('stroke-linejoin', 'round');

                    const polyline = document.createElementNS(svgNS, 'polyline');
                    polyline.setAttribute('points', '6 9 12 15 18 9');
                    chevronSvg.appendChild(polyline);
                    headerDiv.appendChild(chevronSvg);

                    const contentDiv = document.createElement('div');
                    contentDiv.className = 'dropdown-category-content';
                    
                    let isExpanded = accordionStates[title];
                    if (isExpanded === null) {
                        isExpanded = isInitiallyExpanded;
                        accordionStates[title] = isExpanded;
                    }

                    if (!isExpanded) {
                        contentDiv.classList.add('collapsed');
                        chevronSvg.style.transform = 'rotate(-90deg)';
                    }

                    headerDiv.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const isCollapsed = contentDiv.classList.toggle('collapsed');
                        chevronSvg.style.transform = isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)';
                        accordionStates[title] = !isCollapsed;
                    });

                    if (modelsList.length === 0) {
                        const placeholder = document.createElement('div');
                        placeholder.className = 'dropdown-item-placeholder';
                        placeholder.textContent = title.includes('Gemini') ? 'Add API key in settings' : (title.includes('LM Studio') ? 'LM Studio server offline' : 'No Models Available');
                        contentDiv.appendChild(placeholder);
                    } else {
                        modelsList.forEach(m => {
                            const item = document.createElement('div');
                            item.className = 'dropdown-item';
                            if (m === selectedModelValue) {
                                item.classList.add('selected');
                            }
                            item.dataset.value = m;
                            const isLoaded = isModelConnected(m);
                            const dotClass = isLoaded ? 'status-connected' : 'status-disconnected';
                            
                            const statusDotSpan = document.createElement('span');
                            statusDotSpan.className = `status-dot ${dotClass}`;
                            item.appendChild(statusDotSpan);

                            const textSpan = document.createElement('span');
                            textSpan.className = 'dropdown-item-text';
                            textSpan.textContent = formatModelName(m);
                            item.appendChild(textSpan);
                            
                            item.addEventListener('click', (e) => {
                                e.stopPropagation();
                                selectedModelValue = m;
                                localStorage.setItem('kai.selectedModel', m);
                                selectedModelText.textContent = formatModelName(m);
                                
                                // Selected model set
                                statusDot.className = isModelConnected(m) ? 'status-dot status-connected' : 'status-dot status-disconnected';
                                dropdownOptionsMenu.classList.add('hidden');
                                
                                saveCurrentChat();
                            });
                            contentDiv.appendChild(item);
                        });
                    }

                    groupDiv.appendChild(headerDiv);
                    groupDiv.appendChild(contentDiv);
                    dropdownOptionsMenu.appendChild(groupDiv);
                };

                // Rebuild with fixed groups + free provider groups using i18n translations
                const i18n = window.KAI_I18N || {};
                const lmStudioStatus = message.connected ? (i18n.connected || 'Connected') : (i18n.offline || 'Offline');
                const lmTitle = `${i18n.lmStudioHeader || 'LM Studio (Local)'} (${lmStudioStatus})`;
                const geminiTitle = 'Gemini (Cloud)';

                const showGeminiExpanded = selectedModelValue && selectedModelValue.toLowerCase().startsWith('gemini');
                createAccordionGroup(lmTitle, lmStudioModels, !showGeminiExpanded);
                createAccordionGroup(geminiTitle, geminiModels, showGeminiExpanded);

                // Add one accordion group per free-tier provider
                const freeProviders = message.freeProviders || [];
                freeProvidersConfig = freeProviders;
                for (const provider of freeProviders) {
                    const isExpanded = selectedModelValue && provider.models.includes(selectedModelValue);
                    createAccordionGroup(provider.name + ' (Free)', provider.models, isExpanded);
                }
                break;
            }
            case 'addCodeSelection': {
                // Ingest selection from active editor window and focus input silently
                selectedCodeContext = message.text;
                messageInput.focus();
                break;
            }
            case 'agentProgress': {
                handleAgentProgress(message);
                break;
            }
            case 'typing': {
                setUiLoading(true);
                currentAssistantMsgElement = null;
                currentAssistantText = '';
                break;
            }
            case 'reply': {
                // Ingest model response and append
                setUiLoading(false);
                
                // Capture final collapse state from the streaming UI
                let forceThinkingCollapsed = null;
                if (currentAssistantMsgElement) {
                    const existingThinking = currentAssistantMsgElement.querySelector('.thinking-content');
                    if (existingThinking) {
                        forceThinkingCollapsed = existingThinking.classList.contains('collapsed');
                    }
                }

                if (currentAssistantMsgElement) {
                    const formatted = formatMarkdown(message.content, forceThinkingCollapsed);
                    if (formatted.trim()) {
                        currentAssistantMsgElement.querySelector('.message-content').innerHTML = formatted;
                    } else {
                        // Remove empty assistant element if it was somehow created but ended up empty
                        currentAssistantMsgElement.remove();
                    }
                } else {
                    const formatted = formatMarkdown(message.content, forceThinkingCollapsed);
                    if (formatted.trim()) {
                        appendMessage('assistant', message.content);
                    }
                }
                if (message.fullHistory) {
                    messages = message.fullHistory;
                } else {
                    messages.push({ role: 'assistant', content: message.content });
                }
                if (message.modifiedFiles && message.modifiedFiles.length > 0) {
                    messages.push({ role: 'file-summary', content: JSON.stringify(message.modifiedFiles) });
                    appendMessage('file-summary', JSON.stringify(message.modifiedFiles));
                }
                saveCurrentChat();
                currentAssistantMsgElement = null;
                currentAssistantText = '';
                break;
            }
            case 'replyError': {
                // Log execution failure in chat view
                setUiLoading(false);
                appendMessage('system', `Error: ${message.message}`);
                saveCurrentChat();
                currentAssistantMsgElement = null;
                currentAssistantText = '';
                break;
            }
            case 'chatHistory': {
                renderHistoryList(message.chats);
                break;
            }
            case 'loadChat': {
                loadChatSession(message.chat);
                break;
            }
        }
    });

    /**
     * Renders the list of previous chat sessions in the history overlay panel.
     * @param {Array} chats List of stored chat sessions.
     */
    function renderHistoryList(chats) {
        historyList.innerHTML = '';
        if (!chats || chats.length === 0) {
            const emptyDiv = document.createElement('div');
            emptyDiv.className = 'system-message';
            emptyDiv.style.padding = '20px';
            emptyDiv.textContent = 'No previous chats found.';
            historyList.appendChild(emptyDiv);
            return;
        }

        chats.forEach(chat => {
            const item = document.createElement('div');
            item.className = 'history-item';
            
            const details = document.createElement('div');
            details.className = 'history-item-details';
            
            const title = document.createElement('div');
            title.className = 'history-item-title';
            title.textContent = chat.title || 'New Chat';
            title.title = chat.title || 'New Chat';
            
            const time = document.createElement('div');
            time.className = 'history-item-time';
            const date = new Date(chat.timestamp);
            time.textContent = date.toLocaleString();
            
            details.appendChild(title);
            details.appendChild(time);
            
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'history-item-delete-btn';
            deleteBtn.title = 'Delete Chat';
            deleteBtn.innerHTML = window.KAI_SVGS['delete'] || '';
            
            // Delete button behavior
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                vscode.postMessage({ type: 'deleteChat', chatId: chat.id });
            });
            
            // Load chat behavior
            item.addEventListener('click', () => {
                if (isWaitingForResponse) {
                    vscode.postMessage({ type: 'abort' });
                }
                vscode.postMessage({ type: 'loadChat', chatId: chat.id });
                historyContainer.classList.add('hidden');
            });
            
            item.appendChild(details);
            item.appendChild(deleteBtn);
            historyList.appendChild(item);
        });
    }

    /**
     * Loads and renders a past chat session in the main interface.
     * @param {object} chat The chat session object to load.
     */
    function loadChatSession(chat) {
        if (!chat) return;
        currentChatId = chat.id;
        messages = chat.messages || [];
        
        // Rebuild chat output HTML
        chatContainer.innerHTML = '';
        
        // Render messages
        if (messages.length > 0) {
            messages.forEach(msg => {
                if (msg.role === 'user' || msg.role === 'assistant' || msg.role === 'file-summary') {
                    appendMessage(msg.role, msg.content);
                }
            });
        }
        
        // Restore controls state
        if (chat.model) {
            selectedModelValue = chat.model;
            selectedModelText.textContent = formatModelName(chat.model);
            
            // Highlight selected item in custom dropdown list
            const items = dropdownOptionsMenu.querySelectorAll('.dropdown-item');
            items.forEach(item => {
                if (item.dataset.value === chat.model) {
                    item.classList.add('selected');
                } else {
                    item.classList.remove('selected');
                }
            });
        }
        if (chat.thinking !== undefined) {
            thinkingToggle.checked = chat.thinking;
        }
        
        clearCodeContext();
        setUiLoading(false);
        checkServerConnection();
    }
})();
