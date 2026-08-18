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
     * @param {HelpModalController} [helpModalController] Help modal controller instance.
     */
    constructor(formatter, ipcBridge, fileSummaryWidget, settingsController, helpModalController) {
        this.formatter = formatter;
        this.ipcBridge = ipcBridge;
        this.fileSummaryWidget = fileSummaryWidget;
        this.settingsController = settingsController;
        this.helpModalController = helpModalController;

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

        // Callbacks for retry and edit prompt
        this.onRetry = null;
        this.onEditPrompt = null;

        this.initEventListeners();
        this.renderWelcomeHero();
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
                // 1. Welcome Help button
                const helpBtn = e.target.closest('#welcome-help-btn');
                if (helpBtn) {
                    if (this.helpModalController) {
                        this.helpModalController.open();
                    } else {
                        this.showView('settings');
                    }
                    return;
                }

                // 2. Welcome README button (Opens GitHub repository README in default browser)
                const readmeBtn = e.target.closest('#welcome-readme-btn');
                if (readmeBtn) {
                    this.ipcBridge.openExternalUrl('https://github.com/kenjikellens/Kai-Agent#readme');
                    return;
                }

                // 3. Open file in VS Code editor when clicking file cards
                const fileCard = e.target.closest('.file-card');
                if (fileCard) {
                    const filePath = fileCard.dataset.filepath;
                    if (filePath) {
                        this.ipcBridge.openFile(filePath);
                    }
                    return;
                }

                // 4. Toggle tool execution result output dropdown
                const toolRow = e.target.closest('.tool-status-row');
                if (toolRow) {
                    const dropdown = toolRow.querySelector('.tool-result-dropdown');
                    if (dropdown) {
                        dropdown.classList.toggle('hidden');
                        toolRow.classList.toggle('expanded');
                    }
                    return;
                }

                // 5. Collapsible thinking block trigger
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
                    return;
                }

                // 6. Copy code snippet button
                const copyBtn = e.target.closest('.copy-code-btn');
                if (copyBtn) {
                    const wrapper = copyBtn.closest('.code-block-wrapper');
                    const codeEl = wrapper ? wrapper.querySelector('pre code') : null;
                    if (codeEl) {
                        const textToCopy = codeEl.textContent || '';
                        navigator.clipboard.writeText(textToCopy).then(() => {
                            const originalHTML = copyBtn.innerHTML;
                            copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
                            copyBtn.classList.add('copied');
                            setTimeout(() => {
                                copyBtn.innerHTML = originalHTML;
                                copyBtn.classList.remove('copied');
                            }, 1600);
                        });
                    }
                    return;
                }

                // 7. Download code snippet file button
                const downloadBtn = e.target.closest('.download-code-btn');
                if (downloadBtn) {
                    const wrapper = downloadBtn.closest('.code-block-wrapper');
                    const codeEl = wrapper ? wrapper.querySelector('pre code') : null;
                    if (codeEl) {
                        const textToDownload = codeEl.textContent || '';
                        const lang = (downloadBtn.dataset.lang || 'txt').toLowerCase();
                        const extMap = {
                            python: 'py', py: 'py', javascript: 'js', js: 'js', typescript: 'ts', ts: 'ts',
                            html: 'html', css: 'css', json: 'json', csharp: 'cs', cs: 'cs', cpp: 'cpp', c: 'c',
                            java: 'java', rust: 'rs', rs: 'rs', go: 'go', sql: 'sql', sh: 'sh', bash: 'sh',
                            powershell: 'ps1', ps1: 'ps1', yaml: 'yml', yml: 'yml', markdown: 'md', md: 'md',
                            xml: 'xml', php: 'php', ruby: 'rb', rb: 'rb'
                        };
                        const ext = extMap[lang] || 'txt';
                        const blob = new Blob([textToDownload], { type: 'text/plain;charset=utf-8' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `snippet_${Date.now()}.${ext}`;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        URL.revokeObjectURL(url);
                    }
                    return;
                }

                // 8. Copy full response button on assistant message
                const copyRespBtn = e.target.closest('.copy-response-btn');
                if (copyRespBtn) {
                    const assistantMsg = copyRespBtn.closest('.assistant-message');
                    if (assistantMsg) {
                        const contentEl = assistantMsg.querySelector('.message-content');
                        if (contentEl) {
                            const rawText = assistantMsg.dataset.rawContent || contentEl.innerText || '';
                            navigator.clipboard.writeText(rawText).then(() => {
                                const originalHTML = copyRespBtn.innerHTML;
                                copyRespBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
                                copyRespBtn.classList.add('copied');
                                setTimeout(() => {
                                    copyRespBtn.innerHTML = originalHTML;
                                    copyRespBtn.classList.remove('copied');
                                }, 1600);
                            });
                        }
                    }
                    return;
                }

                // 9. Retry / Redo button on assistant message
                const retryBtn = e.target.closest('.retry-btn');
                if (retryBtn) {
                    const assistantMsg = retryBtn.closest('.assistant-message');
                    if (assistantMsg && typeof this.onRetry === 'function') {
                        this.onRetry(assistantMsg);
                    }
                    return;
                }

                // 10. Edit prompt button next to user message (opens inline editor inside chat bubble)
                const editPromptBtn = e.target.closest('.edit-prompt-btn');
                if (editPromptBtn) {
                    const userRow = editPromptBtn.closest('.user-message-row');
                    if (userRow) {
                        this.openInlineEditor(userRow);
                    }
                    return;
                }

                // 11. Cancel button inside inline prompt editor
                const cancelBtn = e.target.closest('.inline-cancel-btn');
                if (cancelBtn) {
                    const userRow = cancelBtn.closest('.user-message-row');
                    if (userRow) {
                        this.closeInlineEditor(userRow);
                    }
                    return;
                }

                // 12. Send button inside inline prompt editor
                const inlineSendBtn = e.target.closest('.inline-send-btn');
                if (inlineSendBtn) {
                    const userRow = inlineSendBtn.closest('.user-message-row');
                    if (userRow) {
                        this.submitInlineEditor(userRow);
                    }
                    return;
                }
            });
        }
    }

    /**
     * Opens an inline editor inside the specified user message row bubble.
     * @param {HTMLElement} userRow The .user-message-row container.
     */
    openInlineEditor(userRow) {
        if (!userRow || userRow.classList.contains('is-editing')) return;

        // Close any other open inline editors first
        if (this.chatContainer) {
            this.chatContainer.querySelectorAll('.user-message-row.is-editing').forEach(row => {
                this.closeInlineEditor(row);
            });
        }

        const rawPrompt = userRow.dataset.rawPrompt || (userRow.querySelector('.message-content') ? userRow.querySelector('.message-content').innerText.trim() : '');
        userRow.classList.add('is-editing');

        const messageBubble = userRow.querySelector('.message.user-message');
        const editBtn = userRow.querySelector('.edit-prompt-btn');
        if (messageBubble) messageBubble.classList.add('hidden');
        if (editBtn) editBtn.classList.add('hidden');

        const sendSvg = window.KAI_SVGS['send'] || '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>';
        const cancelSvg = window.KAI_SVGS['cancel'] || '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';

        const editorDiv = document.createElement('div');
        editorDiv.className = 'inline-prompt-editor';
        editorDiv.innerHTML = `
            <textarea class="inline-prompt-textarea" rows="2">${this.formatter.escapeHtml(rawPrompt)}</textarea>
            <div class="inline-editor-actions">
                <button type="button" class="inline-action-btn inline-cancel-btn" title="Cancel">
                    ${cancelSvg}
                </button>
                <button type="button" class="inline-action-btn inline-send-btn" title="Send">
                    ${sendSvg}
                </button>
            </div>
        `;

        const textarea = editorDiv.querySelector('.inline-prompt-textarea');
        const autoResize = () => {
            textarea.style.height = 'auto';
            textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
        };

        textarea.addEventListener('input', autoResize);
        textarea.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.submitInlineEditor(userRow);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                this.closeInlineEditor(userRow);
            }
        });

        userRow.appendChild(editorDiv);
        autoResize();
        textarea.focus();
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    }

    /**
     * Cancels inline editing and restores normal message bubble view.
     * @param {HTMLElement} userRow The .user-message-row container.
     */
    closeInlineEditor(userRow) {
        if (!userRow) return;
        const editor = userRow.querySelector('.inline-prompt-editor');
        if (editor) editor.remove();

        const messageBubble = userRow.querySelector('.message.user-message');
        const editBtn = userRow.querySelector('.edit-prompt-btn');
        if (messageBubble) messageBubble.classList.remove('hidden');
        if (editBtn) editBtn.classList.remove('hidden');

        userRow.classList.remove('is-editing');
    }

    /**
     * Submits the edited prompt from inside the inline editor.
     * @param {HTMLElement} userRow The .user-message-row container.
     */
    submitInlineEditor(userRow) {
        if (!userRow) return;
        const textarea = userRow.querySelector('.inline-prompt-textarea');
        const newText = textarea ? textarea.value.trim() : '';

        if (!newText) {
            this.closeInlineEditor(userRow);
            return;
        }

        if (typeof this.onEditPrompt === 'function') {
            this.onEditPrompt(userRow, newText);
        }
    }

    /**
     * Renders centered Welcome Hero in chat container when there are no messages.
     */
    renderWelcomeHero() {
        if (!this.chatContainer) return;
        const i18n = window.KAI_I18N || {};
        const svgs = window.KAI_SVGS || {};

        const heroDiv = document.createElement('div');
        heroDiv.className = 'welcome-hero-container';
        heroDiv.id = 'welcome-hero';

        const logoSvg = svgs['kai_icon'] || '<svg width="24" height="24" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><rect x="7.5" y="1" width="1" height="2" fill="currentColor"/><circle cx="8" cy="1" r="0.8" fill="currentColor"/><rect x="2" y="6" width="1" height="3" rx="0.5" fill="currentColor"/><rect x="13" y="6" width="1" height="3" rx="0.5" fill="currentColor"/><path fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" stroke-linecap="round" d="M4 4.5 h8 a0.5 0.5 0 0 1 0.5 0.5 v5.5 a0.5 0.5 0 0 1 -0.5 0.5 h-6 l-2 2 v-2 h-0.5 a0.5 0.5 0 0 1 -0.5 -0.5 v-5.5 a0.5 0.5 0 0 1 0.5 -0.5 z"/><rect x="5.5" y="6.5" width="1.2" height="1.2" fill="currentColor"/><rect x="9.3" y="6.5" width="1.2" height="1.2" fill="currentColor"/><path fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round" d="M6 9.2 Q8 10.5 10 9.2"/></svg>';

        heroDiv.innerHTML = `
            <div class="welcome-badge-icon">
                ${logoSvg}
            </div>
            <div class="welcome-title">${i18n.welcomeTitle || 'Welcome to Kai'}</div>
            <div class="welcome-hint">${i18n.welcomePromptHint || 'Ask a question, edit code, or attach files to begin'}</div>
            <div class="welcome-links-row">
                <button type="button" class="welcome-link-btn" id="welcome-help-btn">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
                    <span>${i18n.help || 'Help'}</span>
                </button>
                <button type="button" class="welcome-link-btn" id="welcome-readme-btn">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>
                    <span>${i18n.readme || 'README'}</span>
                </button>
            </div>
        `;

        this.chatContainer.innerHTML = '';
        this.chatContainer.appendChild(heroDiv);
    }

    /**
     * Removes the welcome hero container from the chat view.
     */
    removeWelcomeHero() {
        const hero = document.getElementById('welcome-hero');
        if (hero) {
            hero.remove();
        }
    }

    /**
     * Resets the active assistant streaming DOM element reference and accumulated text buffer.
     */
    resetAssistantStream() {
        this.currentAssistantMsgElement = null;
        this.currentAssistantText = '';
    }

    /**
     * Creates an action toolbar containing Copy Response, Retry buttons, and a subtle mode badge for assistant messages.
     * @param {string} [mode] The mode under which the reply was generated ('chat' | 'agent' | 'planning').
     * @returns {HTMLElement} The actions toolbar element.
     */
    createAssistantActionBar(mode) {
        const bar = document.createElement('div');
        bar.className = 'message-actions';

        const copySvg = window.KAI_SVGS['copy_response'] || '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
        const retrySvg = window.KAI_SVGS['retry'] || '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>';

        let badgeHtml = '';
        if (mode) {
            const modeLabel = mode === 'planning' ? 'Plan' : (mode.charAt(0).toUpperCase() + mode.slice(1));
            badgeHtml = `<span class="message-mode-badge mode-badge-${mode}">${modeLabel}</span>`;
        }

        bar.innerHTML = `
            <button type="button" class="msg-action-btn copy-response-btn" title="Copy response">
                ${copySvg}
            </button>
            <button type="button" class="msg-action-btn retry-btn" title="Retry">
                ${retrySvg}
            </button>
            ${badgeHtml}
        `;
        return bar;
    }

    /**
     * Appends a message bubble into the scrollable chat container.
     * @param {string} role Sender role ('user', 'assistant', 'system', or 'file-summary').
     * @param {string} text Message content string.
     * @param {string} [mode] Active mode for assistant messages.
     */
    appendMessage(role, text, mode) {
        this.removeWelcomeHero();

        if (role === 'user') {
            this.resetAssistantStream();
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

        if (role === 'user') {
            const rowDiv = document.createElement('div');
            rowDiv.className = 'user-message-row';
            rowDiv.dataset.rawPrompt = text;

            const editSvg = window.KAI_SVGS['edit_prompt'] || '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>';

            const editBtn = document.createElement('button');
            editBtn.type = 'button';
            editBtn.className = 'edit-prompt-btn';
            editBtn.title = 'Edit prompt';
            editBtn.innerHTML = editSvg;

            const messageDiv = document.createElement('div');
            messageDiv.className = 'message user-message';

            const contentDiv = document.createElement('div');
            contentDiv.className = 'message-content';
            contentDiv.innerHTML = formatted;
            messageDiv.appendChild(contentDiv);

            rowDiv.appendChild(editBtn);
            rowDiv.appendChild(messageDiv);

            if (this.chatContainer) {
                this.chatContainer.appendChild(rowDiv);
                this.scrollToBottom();
            }
            return;
        }

        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${role}-message`;
        if (role === 'assistant') {
            messageDiv.dataset.rawContent = text;
            if (mode) messageDiv.dataset.mode = mode;
        }

        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        contentDiv.innerHTML = formatted;
        messageDiv.appendChild(contentDiv);

        if (role === 'assistant') {
            messageDiv.appendChild(this.createAssistantActionBar(mode));
        }

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
        if (progress.progressType === 'status_update') {
            const statusText = progress.text || progress.output || 'Processing...';
            this.updateActivityStatus(statusText);
        } else if (progress.progressType === 'token') {
            this.removeActivityStatus();
            this.currentAssistantText += progress.output;
            appState.updateOrAddAssistantUiEvent(this.currentAssistantText);
            
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
                const isThinkingChecked = (this.settingsController && this.settingsController.showThinkingToggle) 
                    ? this.settingsController.showThinkingToggle.checked 
                    : (localStorage.getItem('kai.showThinking') !== 'false');
                const formatted = this.formatter.formatMarkdown(this.currentAssistantText, forceThinkingCollapsed, isThinkingChecked);
                
                if (formatted.trim()) {
                    if (!this.currentAssistantMsgElement || (this.chatContainer && !this.chatContainer.contains(this.currentAssistantMsgElement))) {
                        this.removeActivityStatus();
                        this.currentAssistantMsgElement = document.createElement('div');
                        this.currentAssistantMsgElement.className = 'message assistant-message';
                        const contentDiv = document.createElement('div');
                        contentDiv.className = 'message-content';
                        this.currentAssistantMsgElement.appendChild(contentDiv);
                        if (this.chatContainer) {
                            this.chatContainer.appendChild(this.currentAssistantMsgElement);
                        }
                    }
                    this.currentAssistantMsgElement.dataset.rawContent = this.currentAssistantText;
                    this.currentAssistantMsgElement.querySelector('.message-content').innerHTML = formatted;

                    // Ensure action bar is removed while actively streaming
                    const existingActions = this.currentAssistantMsgElement.querySelector('.message-actions');
                    if (existingActions) {
                        existingActions.remove();
                    }

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
            this.removeActivityStatus();
            appState.finalizeAssistantUiEvent();
            if (this.currentAssistantMsgElement) {
                const contentEl = this.currentAssistantMsgElement.querySelector('.message-content');
                if (contentEl && !contentEl.innerText.trim()) {
                    this.currentAssistantMsgElement.remove();
                }
            }
            this.resetAssistantStream();
            
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
        } else if (progress.progressType === 'agent_warning') {
            const warning = progress.output || 'The agent stopped before completing the task.';
            appState.addUiEvent({ type: 'system', content: warning });
            this.appendMessage('system', warning);
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
            case 'symbol_search':
                verb = state === 'start' ? 'indexing symbols' : (state === 'success' ? 'found symbols' : 'failed symbol search');
                break;
            case 'get_diagnostics':
                verb = state === 'start' ? 'checking diagnostics' : (state === 'success' ? 'checked diagnostics' : 'failed diagnostics');
                break;
            case 'fetch_url':
                verb = state === 'start' ? 'fetching' : (state === 'success' ? 'fetched' : 'failed fetching');
                break;
            case 'run_command':
                verb = state === 'start' ? 'running' : (state === 'success' ? 'ran' : 'failed running');
                break;
            case 'delete_item':
                verb = state === 'start' ? 'deleting' : (state === 'success' ? 'deleted' : 'failed deleting');
                break;
            case 'utility_tools':
                verb = state === 'start' ? 'running utility' : (state === 'success' ? 'completed utility' : 'failed utility');
                break;
            case 'web_search':
                verb = state === 'start' ? 'searching' : (state === 'success' ? 'searched' : 'failed searching');
                break;
            case 'get_time':
                verb = state === 'start' ? 'checking time' : (state === 'success' ? 'checked time' : 'failed time check');
                break;
            case 'calculate':
                verb = state === 'start' ? 'calculating' : (state === 'success' ? 'calculated' : 'failed calculating');
                break;
            case 'unit_converter':
                verb = state === 'start' ? 'converting' : (state === 'success' ? 'converted' : 'failed converting');
                break;
            case 'text_stats':
                verb = state === 'start' ? 'analysing text' : (state === 'success' ? 'analysed text' : 'failed text analysis');
                break;
            case 'uuid_random':
                verb = state === 'start' ? 'generating' : (state === 'success' ? 'generated' : 'failed generating');
                break;
            default:
                verb = state === 'start' ? 'running' : (state === 'success' ? 'completed' : 'failed');
        }

        const prefixSvg = state === 'start' 
            ? (window.KAI_SVGS['spinner'] || '') 
            : (state === 'success' 
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
     * Appends dynamic activity status card (spinner + status text) into chat container.
     * @param {string} [statusText='Processing...'] Initial status message.
     */
    showActivityStatus(statusText = 'Processing...') {
        this.removeActivityStatus();

        const statusDiv = document.createElement('div');
        statusDiv.id = 'activity-status-container';
        statusDiv.className = 'activity-status-card';
        statusDiv.innerHTML = `
            <span class="thinking-spinner"></span>
            <span class="activity-status-text">${this.formatter.escapeHtml(statusText)}</span>
        `;

        if (this.chatContainer) {
            this.chatContainer.appendChild(statusDiv);
            this.scrollToBottom();
        }
    }

    /**
     * Updates the text inside the active activity status card.
     * @param {string} statusText New status message.
     */
    updateActivityStatus(statusText) {
        if (!statusText) return;
        const statusEl = document.getElementById('activity-status-container');
        if (statusEl) {
            const textEl = statusEl.querySelector('.activity-status-text');
            if (textEl) {
                textEl.textContent = statusText;
            }
        } else {
            this.showActivityStatus(statusText);
        }
    }

    /**
     * Removes active activity status element.
     */
    removeActivityStatus() {
        const statusEl = document.getElementById('activity-status-container');
        if (statusEl) {
            statusEl.remove();
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
                this.sendBtn.innerHTML = window.KAI_SVGS['stop'] || '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"></rect></svg>';
                this.sendBtn.title = 'Stop generation';
                this.showActivityStatus('Processing...');
            } else {
                this.sendBtn.innerHTML = window.KAI_SVGS['send'] || '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>';
                this.sendBtn.title = 'Send message';
                this.removeActivityStatus();
            }
        }
    }

    /**
     * Clears all content elements inside chat container and displays Welcome Hero.
     */
    clearChatContainer() {
        this.resetAssistantStream();
        if (this.chatContainer) {
            this.chatContainer.innerHTML = '';
            this.renderWelcomeHero();
        }
    }

    /**
     * Renders UI event records or message fallback for session loading.
     * @param {Array<object>} uiEvents UI events array.
     * @param {Array<object>} messages Fallback messages array.
     */
    renderUiEvents(uiEvents, messages) {
        this.clearChatContainer();
        this.resetAssistantStream();

        if (uiEvents && uiEvents.length > 0) {
            uiEvents.forEach(evt => {
                if (evt.type === 'user') {
                    this.appendMessage('user', evt.text);
                } else if (evt.type === 'assistant') {
                    this.appendMessage('assistant', evt.content, evt.mode);
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
                    this.appendMessage(msg.role, msg.content, msg.mode);
                }
            });
        }
        this.scrollToBottom();
    }

    /**
     * Swaps active content view in the main area (Chat, History, or Settings).
     * @param {'chat'|'history'|'settings'} viewName Target view name.
     */
    showView(viewName) {
        if (this.settingsController && typeof this.settingsController.hideKeysOverlay === 'function') {
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
