/**
 * ChatUIController controls message bubble rendering, streaming updates,
 * tool status cards, typing indicators, view switching, and auto-scrolling.
 */
class ChatUIController {
    /**
     * Initializes UI references, helper widgets, and event delegation.
     * @param {MarkdownFormatter} formatter Formatter instance.
     * @param {WebviewIPCBridge} ipcBridge IPC bridge instance.
     * @param {FileSummaryWidget} fileSummaryWidget File summary widget instance.
     * @param {SettingsController} settingsController Settings controller instance.
     */
    constructor(formatter, ipcBridge, fileSummaryWidget, settingsController) {
        this.formatter = formatter;
        this.ipcBridge = ipcBridge;
        this.fileSummaryWidget = fileSummaryWidget;
        this.settingsController = settingsController;

        this.chatContainer = document.getElementById('chat-container');
        this.messageInput = document.getElementById('message-input');
        this.sendBtn = document.getElementById('send-btn');
        this.thinkingToggle = document.getElementById('thinking-toggle');
        this.chatView = document.getElementById('chat-view');
        this.historyContainer = document.getElementById('history-container');
        this.settingsContainer = document.getElementById('settings-container');
        this.settingsBtn = document.getElementById('settings-btn');
        this.closeSettingsBtn = document.getElementById('close-settings-btn');

        this.currentAssistantMsgElement = null;
        this.currentAssistantText = '';

        this.initEventListeners();
    }

    /**
     * Registers settings button, close settings button, and container event delegation.
     */
    initEventListeners() {
        if (this.settingsBtn) {
            this.settingsBtn.addEventListener('click', () => {
                this.showView('settings');
            });
        }

        if (this.closeSettingsBtn) {
            this.closeSettingsBtn.addEventListener('click', () => {
                if (this.settingsController) {
                    this.settingsController.hideKeysOverlay();
                }
                this.showView('chat');
            });
        }

        if (this.chatContainer) {
            this.chatContainer.addEventListener('click', (e) => {
                // 1. Open file in VS Code editor when clicking file cards
                const fileCard = e.target.closest('.file-card');
                if (fileCard) {
                    const filePath = fileCard.dataset.filepath;
                    if (filePath) {
                        this.ipcBridge.openFile(filePath);
                    }
                    return;
                }

                // 2. Toggle tool execution result output dropdown
                const toolRow = e.target.closest('.tool-status-row');
                if (toolRow) {
                    const dropdown = toolRow.querySelector('.tool-result-dropdown');
                    if (dropdown) {
                        dropdown.classList.toggle('hidden');
                        toolRow.classList.toggle('expanded');
                    }
                    return;
                }

                // 3. Collapsible thinking block trigger
                const header = e.target.closest('.thinking-header');
                if (header) {
                    const content = header.nextElementSibling;
                    if (content && content.classList.contains('thinking-content')) {
                        content.classList.toggle('collapsed');
                        const chevron = header.querySelector('.thinking-chevron');
                        if (chevron) {
                            const isCollapsed = content.classList.contains('collapsed');
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
        }
    }

    /**
     * Appends a message bubble into the scrollable chat container.
     * @param {string} role Sender role ('user', 'assistant', 'system', or 'file-summary').
     * @param {string} text Message content string.
     */
    appendMessage(role, text) {
        if (role === 'user') {
            if (!text || 
                text.startsWith('[Tool Result') || 
                text.startsWith('[Tool Execution') || 
                text.startsWith('[Tool Error') || 
                text.startsWith('[Execution Output') ||
                text.startsWith('[Tool Call') ||
                text.includes('[Tool Result for')) {
                return;
            }
        }

        if (role === 'file-summary') {
            let files = [];
            try {
                files = JSON.parse(text);
            } catch (e) {
                files = [];
            }
            const widgetEl = this.fileSummaryWidget.renderWidget(files, this.formatter);
            if (widgetEl && this.chatContainer) {
                this.chatContainer.appendChild(widgetEl);
                this.scrollToBottom();
            }
            return;
        }

        const formatted = this.formatter.formatMarkdown(text);
        if (!formatted.trim()) return;

        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${role}-message`;

        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        contentDiv.innerHTML = formatted;
        messageDiv.appendChild(contentDiv);

        if (this.chatContainer) {
            this.chatContainer.appendChild(messageDiv);
            this.scrollToBottom();
        }
    }

    /**
     * Handles streaming agent progress updates from extension host.
     * @param {object} progress Progress event object.
     * @param {AppState} appState Active state instance.
     */
    handleAgentProgress(progress, appState) {
        if (progress.progressType === 'token') {
            this.currentAssistantText += progress.output;
            
            let forceThinkingCollapsed = null;
            if (this.currentAssistantMsgElement) {
                const existingThinking = this.currentAssistantMsgElement.querySelector('.thinking-content');
                if (existingThinking) {
                    forceThinkingCollapsed = existingThinking.classList.contains('collapsed');
                }
            }

            const isStreamingThinking = this.currentAssistantMsgElement && 
                                        this.currentAssistantMsgElement.querySelector('.thinking-content em') && 
                                        !this.currentAssistantText.includes('</think>');
            
            if (isStreamingThinking) {
                const thinkStartTag = '<think>';
                const thinkStartIndex = this.currentAssistantText.indexOf(thinkStartTag);
                if (thinkStartIndex !== -1) {
                    const rawThinkingText = this.currentAssistantText.substring(thinkStartIndex + thinkStartTag.length);
                    const escapedThinkingText = this.formatter.escapeHtml(rawThinkingText).trim().replace(/(\r?\n\s*){3,}/g, '\n');
                    this.currentAssistantMsgElement.querySelector('.thinking-content em').innerHTML = escapedThinkingText;
                    
                    const thinkingContentEl = this.currentAssistantMsgElement.querySelector('.thinking-content');
                    if (thinkingContentEl && !thinkingContentEl.classList.contains('collapsed')) {
                        thinkingContentEl.scrollTop = thinkingContentEl.scrollHeight;
                    }
                    this.scrollToBottom();
                }
            } else {
                const isThinkingChecked = this.thinkingToggle ? this.thinkingToggle.checked : true;
                const formatted = this.formatter.formatMarkdown(this.currentAssistantText, forceThinkingCollapsed, isThinkingChecked);
                
                if (formatted.trim()) {
                    if (!this.currentAssistantMsgElement) {
                        this.currentAssistantMsgElement = document.createElement('div');
                        this.currentAssistantMsgElement.className = 'message assistant-message';
                        const contentDiv = document.createElement('div');
                        contentDiv.className = 'message-content';
                        this.currentAssistantMsgElement.appendChild(contentDiv);
                        if (this.chatContainer) {
                            this.chatContainer.appendChild(this.currentAssistantMsgElement);
                        }
                    }
                    this.currentAssistantMsgElement.querySelector('.message-content').innerHTML = formatted;

                    const thinkingContentEl = this.currentAssistantMsgElement.querySelector('.thinking-content');
                    if (thinkingContentEl && !this.currentAssistantText.includes('</think>')) {
                        if (!thinkingContentEl.classList.contains('collapsed')) {
                            thinkingContentEl.scrollTop = thinkingContentEl.scrollHeight;
                        }
                    }

                    this.scrollToBottom();
                }
            }
        } else if (progress.progressType === 'tool_start') {
            if (this.currentAssistantMsgElement) {
                const contentEl = this.currentAssistantMsgElement.querySelector('.message-content');
                if (contentEl && !contentEl.innerText.trim()) {
                    this.currentAssistantMsgElement.remove();
                }
            }
            this.currentAssistantMsgElement = null;
            this.currentAssistantText = '';
            
            appState.addUiEvent({
                type: 'tool',
                toolId: progress.toolId,
                tool: progress.tool,
                fileName: progress.fileName,
                state: 'start'
            });

            const statusDiv = document.createElement('div');
            statusDiv.id = progress.toolId;
            statusDiv.className = 'tool-status-row in-progress';
            statusDiv.innerHTML = this.getToolDescription(progress.tool, progress.fileName, 'start');
            if (this.chatContainer) {
                this.chatContainer.appendChild(statusDiv);
            }
        } else if (progress.progressType === 'tool_end') {
            const isError = progress.output && (
                progress.output.startsWith('[Error') || 
                progress.output.startsWith('[Execution Cancelled]')
            );

            const evt = appState.uiEvents.find(e => e.type === 'tool' && e.toolId === progress.toolId);
            if (evt) {
                evt.state = isError ? 'error' : 'success';
                evt.output = progress.output || '';
            }

            const statusDiv = document.getElementById(progress.toolId);
            if (statusDiv) {
                statusDiv.className = `tool-status-row ${isError ? 'errored' : 'completed'}`;
                statusDiv.innerHTML = this.getToolDescription(progress.tool, progress.fileName, isError ? 'error' : 'success');
                
                if (progress.output) {
                    const dropdownDiv = document.createElement('div');
                    dropdownDiv.className = 'tool-result-dropdown hidden';
                    dropdownDiv.innerHTML = `<pre><code>${this.formatter.escapeHtml(progress.output)}</code></pre>`;
                    statusDiv.appendChild(dropdownDiv);
                }
            }
        }
        this.scrollToBottom();
    }

    /**
     * Translates tool name and arguments into SVG icons and status header HTML.
     * @param {string} tool Tool identifier name.
     * @param {string} targetName Tool argument target name.
     * @param {string} state Execution state ('start', 'success', 'error').
     * @returns {string} Status header HTML string.
     */
    getToolDescription(tool, targetName, state) {
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
            case 'replace_file_content':
            case 'multi_replace_file_content':
                verb = state === 'start' ? 'editing' : (state === 'success' ? 'edited' : 'failed editing');
                break;
            case 'list_dir':
                verb = state === 'start' ? 'scanning' : (state === 'success' ? 'scanned' : 'failed scanning');
                break;
            case 'grep_search':
            case 'search_web':
                verb = state === 'start' ? 'searching' : (state === 'success' ? 'searched' : 'failed searching');
                break;
            case 'run_command':
                verb = state === 'start' ? 'running' : (state === 'success' ? 'ran' : 'failed running');
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

        return `
            <div class="tool-call-header">
                <div class="tool-call-title">
                    ${prefixSvg}${iconSvg} ${verb} <code>${this.formatter.escapeHtml(target)}</code>
                </div>
                <i class="codicon codicon-chevron-right tool-chevron"></i>
            </div>
        `;
    }

    /**
     * Appends pulsing typing indicator element into chat container.
     */
    showTypingIndicator() {
        this.removeTypingIndicator();

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
        if (this.chatContainer) {
            this.chatContainer.appendChild(indicatorDiv);
            this.scrollToBottom();
        }
    }

    /**
     * Removes active typing indicator element.
     */
    removeTypingIndicator() {
        const indicator = document.getElementById('typing-indicator-container');
        if (indicator) {
            indicator.remove();
        }
    }

    /**
     * Scrolls chat container element to bottom.
     */
    scrollToBottom() {
        if (this.chatContainer) {
            this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
        }
    }

    /**
     * Toggles UI control lock state during agent generation.
     * @param {boolean} isLoading True when generation is active.
     * @param {AppState} appState Active state instance.
     */
    setUiLoading(isLoading, appState) {
        if (appState) {
            appState.isWaitingForResponse = isLoading;
        }
        if (this.messageInput) {
            this.messageInput.disabled = isLoading;
        }
        if (this.sendBtn) {
            this.sendBtn.disabled = false;
            if (isLoading) {
                this.sendBtn.innerHTML = window.KAI_SVGS['stop'] || '';
                this.sendBtn.title = 'Stop generation';
                this.showTypingIndicator();
            } else {
                this.sendBtn.innerHTML = window.KAI_SVGS['send'] || '';
                this.sendBtn.title = 'Send message';
                this.removeTypingIndicator();
            }
        }
    }

    /**
     * Clears all content elements inside chat container.
     */
    clearChatContainer() {
        if (this.chatContainer) {
            this.chatContainer.innerHTML = '';
        }
    }

    /**
     * Renders UI event records or message fallback for session loading.
     * @param {Array<object>} uiEvents UI events array.
     * @param {Array<object>} messages Fallback messages array.
     */
    renderUiEvents(uiEvents, messages) {
        this.clearChatContainer();

        if (uiEvents && uiEvents.length > 0) {
            uiEvents.forEach(evt => {
                if (evt.type === 'user') {
                    this.appendMessage('user', evt.text);
                } else if (evt.type === 'assistant') {
                    this.appendMessage('assistant', evt.content);
                } else if (evt.type === 'file-summary') {
                    this.appendMessage('file-summary', JSON.stringify(evt.files));
                } else if (evt.type === 'tool') {
                    const statusDiv = document.createElement('div');
                    statusDiv.id = evt.toolId;
                    statusDiv.className = `tool-status-row ${evt.state === 'error' ? 'errored' : (evt.state === 'success' ? 'completed' : 'in-progress')}`;
                    statusDiv.innerHTML = this.getToolDescription(evt.tool, evt.fileName, evt.state === 'error' ? 'error' : 'success');
                    if (evt.output) {
                        const dropdownDiv = document.createElement('div');
                        dropdownDiv.className = 'tool-result-dropdown hidden';
                        dropdownDiv.innerHTML = `<pre><code>${this.formatter.escapeHtml(evt.output)}</code></pre>`;
                        statusDiv.appendChild(dropdownDiv);
                    }
                    if (this.chatContainer) {
                        this.chatContainer.appendChild(statusDiv);
                    }
                }
            });
        } else if (messages && messages.length > 0) {
            messages.forEach(msg => {
                if (msg.role === 'user' || msg.role === 'assistant' || msg.role === 'file-summary') {
                    this.appendMessage(msg.role, msg.content);
                }
            });
        }
        this.scrollToBottom();
    }

    /**
     * Swaps active content view in the main sidebar container.
     * @param {'chat'|'history'|'settings'} viewName Target view name.
     */
    showView(viewName) {
        if (this.settingsController) {
            this.settingsController.hideKeysOverlay();
        }
        if (viewName === 'chat') {
            if (this.chatView) this.chatView.classList.remove('hidden');
            if (this.historyContainer) this.historyContainer.classList.add('hidden');
            if (this.settingsContainer) this.settingsContainer.classList.add('hidden');
        } else if (viewName === 'history') {
            if (this.chatView) this.chatView.classList.add('hidden');
            if (this.historyContainer) this.historyContainer.classList.remove('hidden');
            if (this.settingsContainer) this.settingsContainer.classList.add('hidden');
        } else if (viewName === 'settings') {
            if (this.chatView) this.chatView.classList.add('hidden');
            if (this.historyContainer) this.historyContainer.classList.add('hidden');
            if (this.settingsContainer) this.settingsContainer.classList.remove('hidden');
        }
    }
}
