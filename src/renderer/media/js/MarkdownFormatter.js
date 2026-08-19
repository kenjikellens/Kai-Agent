/**
 * MarkdownFormatter handles Markdown parsing, HTML entity escaping,
 * code block syntax formatting, and reasoning <think> block rendering logic.
 */
class MarkdownFormatter {
    /**
     * Formats basic HTML entities safely to prevent injection.
     * @param {string} text Raw input string.
     * @returns {string} HTML-escaped string.
     */
    escapeHtml(text) {
        if (!text) return '';
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    /**
     * Formats a long model ID or path into a clean display name.
     * @param {string} modelId Full model identifier.
     * @returns {string} Clean display name.
     */
    formatModelName(modelId) {
        if (!modelId) return 'Local Model';
        const slashIdx = modelId.indexOf('/');
        const displayId = slashIdx !== -1 ? modelId.slice(slashIdx + 1) : modelId;
        const parts = displayId.split(/[/\\]/).filter(p => p.trim() !== '');
        if (parts.length === 0) return displayId;
        
        let last = parts[parts.length - 1];
        if (/^model(\.gguf)?$/i.test(last) && parts.length > 1) {
            last = parts[parts.length - 2];
        }
        return last.replace(/\.gguf$/i, '');
    }

    /**
     * Applies lightweight, synchronous VS Code Dark+ syntax highlighting to code snippets.
     * @param {string} code Raw code string (HTML-escaped).
     * @param {string} lang Programming language identifier.
     * @returns {string} HTML with syntax highlight span tokens.
     */
    highlightSyntax(code, lang) {
        if (!code) return '';
        let esc = code;
        const tokens = [];
        const saveToken = (cls, text) => {
            const id = tokens.length;
            tokens.push(`<span class="token ${cls}">${text}</span>`);
            return `__TOK_${id}__`;
        };

        const isHtml = ['html', 'htm', 'xml', 'svg', 'markup', 'vue', 'jsx', 'tsx'].includes((lang || '').toLowerCase());

        // 1. Comments
        esc = esc.replace(/(&lt;!--[\s\S]*?--&gt;|\/\*[\s\S]*?\*\/|\/\/.*|#.*|--.*)/g, (m) => saveToken('comment', m));

        // 2. HTML / XML Tags (DOCTYPE, tags & attributes)
        if (isHtml || /&lt;[\s\S]+&gt;/.test(esc)) {
            // DOCTYPE
            esc = esc.replace(/(&lt;!DOCTYPE[\s\S]*?&gt;)/gi, (m) => saveToken('doctype', m));

            // Tags: &lt;tag ... &gt; or &lt;/tag&gt;
            esc = esc.replace(/&lt;(\/?)([a-zA-Z0-9_\-]+)([\s\S]*?)(\/?&gt;)/g, (match, slash, tagName, attrs, close) => {
                let coloredAttrs = attrs;
                coloredAttrs = coloredAttrs.replace(/([a-zA-Z0-9_\-]+)(=)(&quot;[\s\S]*?&quot;|"(?:\\.|[^"\\])*"|'[^']*'|[^\s&gt;]+)/g, (m, attrName, eq, attrVal) => {
                    return `${saveToken('attr-name', attrName)}${eq}${saveToken('attr-value', attrVal)}`;
                });
                coloredAttrs = coloredAttrs.replace(/\s+([a-zA-Z0-9_\-]+)(?=\s|\/|&gt;|$)/g, (m, boolAttr) => {
                    if (boolAttr.startsWith('__TOK_')) return m;
                    return ` ${saveToken('attr-name', boolAttr)}`;
                });
                return `&lt;${slash}${saveToken('tag', tagName)}${coloredAttrs}${close}`;
            });
        }

        // 3. Strings
        esc = esc.replace(/("""[\s\S]*?"""|'''[\s\S]*?'''|`[\s\S]*?`|&quot;[\s\S]*?&quot;|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g, (m) => {
            if (m.includes('__TOK_')) return m;
            return saveToken('string', m);
        });

        // 4. Numbers & Booleans
        esc = esc.replace(/\b(true|false|null|none|True|False|None|undefined|NaN)\b/gi, (m) => saveToken('boolean', m));
        esc = esc.replace(/\b\d+(\.\d+)?\b/g, (m) => saveToken('number', m));

        // 5. Keywords
        const keywords = [
            'def', 'class', 'return', 'import', 'from', 'as', 'if', 'elif', 'else', 'for', 'while', 'in',
            'try', 'except', 'finally', 'with', 'lambda', 'async', 'await', 'function', 'const', 'let', 'var',
            'export', 'default', 'new', 'this', 'typeof', 'instanceof', 'switch', 'case', 'break', 'continue',
            'SELECT', 'FROM', 'WHERE', 'INSERT', 'UPDATE', 'DELETE', 'JOIN', 'GROUP', 'BY', 'ORDER', 'ASC', 'DESC',
            'public', 'private', 'protected', 'void', 'int', 'string', 'bool', 'interface', 'struct', 'fn', 'mut'
        ];
        const kwRegex = new RegExp(`\\b(${keywords.join('|')})\\b`, 'g');
        esc = esc.replace(kwRegex, (m) => saveToken('keyword', m));

        // 6. Function calls: name(...)
        esc = esc.replace(/\b([a-zA-Z_]\w*)\s*(?=\()/g, (m, fnName) => saveToken('function', fnName));

        // Restore tokens
        esc = esc.replace(/__TOK_(\d+)__/g, (m, id) => tokens[Number(id)]);
        return esc;
    }

    /**
     * Formats raw markdown text into safe rendered HTML.
     * @param {string} text Raw markdown text.
     * @param {boolean|null} forceThinkingCollapsed Optional collapse override.
     * @param {boolean} isThinkingEnabled Whether agent thinking is enabled.
     * @param {boolean|null} forcePlanExpanded Optional plan expansion override.
     * @returns {string} Formatted HTML.
     */
    formatMarkdown(text, forceThinkingCollapsed = null, isThinkingEnabled = true, forcePlanExpanded = null) {
        if (!text) return '';
        const chevronSvg = DOMUtils.getChevronSvgString('custom-chevron');

        let cleanText = text;

        // 1. Strip complete <|tool_call|> ... <|tool_call|> or <tool_call> ... </tool_call> blocks
        cleanText = cleanText.replace(/<\|?tool_?[a-z0-9_]*\|?>[\s\S]*?(?:<\|?\/tool_?[a-z0-9_]*\|?>|<\|?tool_?[a-z0-9_]*\|?>|$)/gi, '');

        // 2. Strip any incomplete or open <|tool or <tool tags anywhere at the end of text
        cleanText = cleanText.replace(/<\|?tool[\s\S]*$/gi, '');
        cleanText = cleanText.replace(/<\|?\/tool[\s\S]*$/gi, '');
        cleanText = cleanText.replace(/<\|[\s\S]*$/gi, '');

        // 3. Strip legacy fenced JSON tool calls (```json ... ```)
        cleanText = cleanText.replace(/```json\s*\{[\s\S]*?\}\s*```/gi, '');
        cleanText = cleanText.replace(/```json[\s\S]*?$/gi, '');

        // 4. Handle tool result formatting
        if (cleanText.startsWith('[Tool Result for')) {
            const match = cleanText.match(/^\[Tool Result for (.*?)\]:\n([\s\S]*)/);
            if (match) {
                const toolName = match[1];
                const resultBody = match[2];
                return `<details class="tool-result-details" open><summary>${chevronSvg}Tool Result: <strong>${this.escapeHtml(toolName)}</strong></summary><pre><code>${this.escapeHtml(resultBody)}</code></pre></details>`;
            }
        }

        // Clean up double/triple blank lines into single clean breaks
        cleanText = cleanText.replace(/(\r?\n){2,}/g, '\n\n');

        let escaped = this.escapeHtml(cleanText);

        // Check preferences to render or strip <think>...</think> blocks
        if (isThinkingEnabled) {
            const showThinking = localStorage.getItem('kai.showThinking') !== 'false';
            const keepThinkingExpanded = localStorage.getItem('kai.keepThinkingExpanded') !== 'false';
            const keepThinkingFinishedExpanded = localStorage.getItem('kai.keepThinkingFinishedExpanded') === 'true';

            const chevronUp = DOMUtils.getChevronUpSvgString('thinking-chevron');
            const chevronDown = DOMUtils.getChevronSvgString('thinking-chevron');

            const i18n = window.KAI_I18N || {};
            const thinkingProcessTitle = i18n.thinkingProcess || 'Thinking Process';
            const thinkingTextTitle = i18n.thinkingText || 'Thinking...';

            if (showThinking) {
                // Completed thinking block
                if (escaped.includes('&lt;/think&gt;')) {
                    escaped = escaped.replace(/&lt;think&gt;([\s\S]*?)&lt;\/think&gt;(\r?\n)?/g, (match, p1) => {
                        const cleanedContent = p1.trim().replace(/(\r?\n\s*){3,}/g, '\n');
                        const shouldRespectExistingState = forceThinkingCollapsed !== null && keepThinkingFinishedExpanded;
                        const isCollapsed = shouldRespectExistingState ? forceThinkingCollapsed : !keepThinkingFinishedExpanded;
                        const activeChevron = isCollapsed ? chevronDown : chevronUp;
                        const activeCollapsedClass = isCollapsed ? ' collapsed' : '';
                        return `<div class="thinking-block"><div class="thinking-header">${thinkingProcessTitle}${activeChevron}</div><div class="thinking-content${activeCollapsedClass}"><em>${cleanedContent}</em></div></div>\n\n`;
                    });
                }
                // Streaming thinking block
                if (escaped.includes('&lt;think&gt;')) {
                    escaped = escaped.replace(/&lt;think&gt;([\s\S]*)$/g, (match, p1) => {
                        const cleanedContent = p1.trim().replace(/(\r?\n\s*){3,}/g, '\n');
                        const shouldRespectExistingState = forceThinkingCollapsed !== null && keepThinkingExpanded;
                        const isCollapsed = shouldRespectExistingState ? forceThinkingCollapsed : !keepThinkingExpanded;
                        const activeChevron = isCollapsed ? chevronDown : chevronUp;
                        const activeCollapsedClass = isCollapsed ? ' collapsed' : '';
                        return `<div class="thinking-block"><div class="thinking-header"><span class="thinking-spinner"></span>${thinkingTextTitle}${activeChevron}</div><div class="thinking-content${activeCollapsedClass}"><em>${cleanedContent}</em></div></div>\n\n`;
                    });
                }
            } else {
                if (escaped.includes('&lt;/think&gt;')) {
                    escaped = escaped.replace(/&lt;think&gt;([\s\S]*?)&lt;\/think&gt;(\r?\n)?/g, '');
                }
                if (escaped.includes('&lt;think&gt;')) {
                    escaped = escaped.replace(/&lt;think&gt;([\s\S]*)$/g, () => {
                        return `<div class="thinking-loader"><span class="thinking-spinner"></span>${thinkingTextTitle}</div>\n\n`;
                    });
                }
            }
        } else {
            escaped = escaped.replace(/&lt;think&gt;([\s\S]*?)&lt;\/think&gt;(\r?\n)?/g, '');
            escaped = escaped.replace(/&lt;think&gt;([\s\S]*)$/g, '');
        }

        // Replace tool call placeholders
        escaped = escaped.replace(/\[\[\[TOOL_CALL_START\]\]\]([\s\S]*?)\[\[\[TOOL_CALL_END\]\]\]/g, '');

        // Plan cards placeholder extraction
        const planCards = [];
        const planChevronSvg = `<svg class="plan-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`;
        const planIconSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg>`;
        const proceedIconSvg = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;

        // Parse <implementation_plan title="...">...</implementation_plan> tags
        escaped = escaped.replace(/&lt;implementation_plan(?:\s+title=&quot;([^&]*)&quot;|\s+title="([^"]*)")?&gt;([\s\S]*?)(?:&lt;\/implementation_plan&gt;|$)/gi, (match, title1, title2, body) => {
            const planTitle = (title1 || title2 || 'Implementation Plan').trim();
            const formattedBody = this.formatMarkdown(body.trim(), null, false, null);
            const isExpanded = forcePlanExpanded === true;
            const expandedClass = isExpanded ? ' expanded' : '';
            const toggleText = isExpanded ? 'Show less' : 'Show more';
            const cardHtml = `\n<div class="kai-plan-card${expandedClass}">` +
                `<div class="kai-plan-header">` +
                    `<div class="plan-header-title-box">` +
                        `<div class="plan-mode-icon">${planIconSvg}</div>` +
                        `<span class="plan-title-text">${this.escapeHtml(planTitle)}</span>` +
                        `<span class="plan-status-badge">Ready for Review</span>` +
                    `</div>` +
                    `<div class="plan-header-right">` +
                        `<span class="plan-toggle-label">${toggleText}</span>` +
                        `${planChevronSvg}` +
                    `</div>` +
                `</div>` +
                `<div class="kai-plan-content-wrapper">` +
                    `<div class="kai-plan-body">${formattedBody}</div>` +
                `</div>` +
                `<div class="kai-plan-footer">` +
                    `<div class="plan-footer-hint">Click Proceed to approve and execute in Agent mode.</div>` +
                    `<button type="button" class="btn-proceed plan-proceed-btn">${proceedIconSvg}<span>Proceed with Plan</span></button>` +
                `</div>` +
            `</div>\n`;
            const idx = planCards.length;
            planCards.push(cardHtml);
            return `\n%%PLANCARD${idx}%%\n`;
        });

        // 1. Extract triple backtick code blocks into isolated placeholders
        const codeBlocks = [];
        const copyIconSvg = `<svg class="copy-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
        const downloadIconSvg = `<svg class="download-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`;

        // Closed code blocks
        escaped = escaped.replace(/```([a-zA-Z0-9_\-\+]*)[ \t]*\r?\n([\s\S]*?)```/g, (match, lang, rawCode) => {
            const languageLabel = (lang || 'code').trim().toLowerCase();
            const highlighted = this.highlightSyntax(rawCode.replace(/\r?\n$/, ''), languageLabel);
            const blockHtml = `<div class="code-block-wrapper"><div class="code-block-header"><span class="code-lang-label">${this.escapeHtml(languageLabel)}</span><div class="code-block-actions"><button type="button" class="copy-code-btn" title="Copy code" aria-label="Copy code">${copyIconSvg}</button><button type="button" class="download-code-btn" title="Download snippet" aria-label="Download snippet" data-lang="${this.escapeHtml(languageLabel)}">${downloadIconSvg}</button></div></div><pre><code class="language-${this.escapeHtml(languageLabel)}">${highlighted}</code></pre></div>`;
            const idx = codeBlocks.length;
            codeBlocks.push(blockHtml);
            return `\n%%CBLOCK${idx}%%\n`;
        });

        // Streaming unclosed code blocks at end
        escaped = escaped.replace(/```([a-zA-Z0-9_\-\+]*)[ \t]*\r?\n([\s\S]*)$/g, (match, lang, rawCode) => {
            const languageLabel = (lang || 'code').trim().toLowerCase();
            const highlighted = this.highlightSyntax(rawCode, languageLabel);
            const blockHtml = `<div class="code-block-wrapper"><div class="code-block-header"><span class="code-lang-label">${this.escapeHtml(languageLabel)}</span><div class="code-block-actions"><button type="button" class="copy-code-btn" title="Copy code" aria-label="Copy code">${copyIconSvg}</button><button type="button" class="download-code-btn" title="Download snippet" aria-label="Download snippet" data-lang="${this.escapeHtml(languageLabel)}">${downloadIconSvg}</button></div></div><pre><code class="language-${this.escapeHtml(languageLabel)}">${highlighted}</code></pre></div>`;
            const idx = codeBlocks.length;
            codeBlocks.push(blockHtml);
            return `\n%%CBLOCK${idx}%%\n`;
        });

        // 2. Extract inline code into isolated placeholders
        const inlineCodes = [];
        escaped = escaped.replace(/`([^`\r\n]+)`/g, (match, inline) => {
            const idx = inlineCodes.length;
            inlineCodes.push(`<code>${inline}</code>`);
            return `%%INLCODE${idx}%%`;
        });

        // 3. Horizontal rules
        escaped = escaped.replace(/(?:^|\r?\n)(?:[\*\-_][ \t]*){3,}(?:\r?\n|$)/g, '\n<hr class="md-divider" />\n');

        // 4. Links [text](url)
        escaped = escaped.replace(/\[([^\]\r\n]+)\]\((https?:\/\/[^\s\)\"]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="md-link">$1</a>');

        // 5. Bold formatting
        escaped = escaped.replace(/\*\*([^\*\r\n]+?)\*\*/g, '<strong>$1</strong>');
        // 6. Italic formatting (supports *italic* and _italic_ cleanly across words and sentences)
        escaped = escaped.replace(/(?:^|[^\*])\*([^\*\r\n]+?)\*(?!\*)/g, (match, p1) => {
            const prefix = match.startsWith('*') ? '' : match.charAt(0);
            return `${prefix}<em>${p1}</em>`;
        });
        escaped = escaped.replace(/(?:^|[\s\(\[\{])_([^_]+?)_(?=[\s\)\.\,\!\?\]\}]|$)/g, (match, p1) => {
            const prefix = match.startsWith('_') ? '' : match.charAt(0);
            return `${prefix}<em>${p1}</em>`;
        });

        // 7. Headers formatting (support # up to ###### across start of text, newlines, and carriage returns)
        escaped = escaped.replace(/(?:^|\r?\n)######[ \t]+([^\r\n]+)/g, '\n<h6>$1</h6>');
        escaped = escaped.replace(/(?:^|\r?\n)#####[ \t]+([^\r\n]+)/g, '\n<h5>$1</h5>');
        escaped = escaped.replace(/(?:^|\r?\n)####[ \t]+([^\r\n]+)/g, '\n<h4>$1</h4>');
        escaped = escaped.replace(/(?:^|\r?\n)###[ \t]+([^\r\n]+)/g, '\n<h3>$1</h3>');
        escaped = escaped.replace(/(?:^|\r?\n)##[ \t]+([^\r\n]+)/g, '\n<h2>$1</h2>');
        escaped = escaped.replace(/(?:^|\r?\n)#[ \t]+([^\r\n]+)/g, '\n<h1>$1</h1>');

        // 8. Blockquotes
        escaped = escaped.replace(/^&gt;\s*(.+)$/gm, '<blockquote>$1</blockquote>');

        // 9. Markdown Tables
        escaped = escaped.replace(/((?:\|[^\n]+\|\r?\n)+)/g, (tableMatch) => {
            const lines = tableMatch.trim().split(/\r?\n/);
            if (lines.length < 2) return tableMatch;

            const isSeparator = (line) => /^\|?\s*(?::?-+:?\s*\|)+\s*(?::?-+:?\s*)?\|?$/.test(line.trim());
            
            let headerLine = '';
            let rows = [];
            
            if (lines.length >= 2 && isSeparator(lines[1])) {
                headerLine = lines[0];
                rows = lines.slice(2);
            } else {
                rows = lines;
            }

            const parseRow = (rowStr, cellTag) => {
                const parts = rowStr.split('|').map(c => c.trim());
                if (parts.length > 2 && parts[0] === '' && parts[parts.length - 1] === '') {
                    parts.shift();
                    parts.pop();
                }
                if (parts.length === 0) return '';
                return `<tr>${parts.map(c => `<${cellTag}>${c}</${cellTag}>`).join('')}</tr>`;
            };

            let tableHtml = '<table class="md-table">';
            if (headerLine) {
                tableHtml += `<thead>${parseRow(headerLine, 'th')}</thead>`;
            }
            if (rows.length > 0) {
                tableHtml += `<tbody>${rows.map(r => parseRow(r, 'td')).join('')}</tbody>`;
            }
            tableHtml += '</table>';
            return tableHtml;
        });

        // 10. Bullet lists
        escaped = escaped.replace(/(^[-\*]\s+.+(?:\r?\n^[-\*]\s+.+)*)/gm, (listMatch) => {
            const items = listMatch.split(/\r?\n/).map(line => line.replace(/^[-\*]\s+/, '').trim());
            return `<ul class="md-list">${items.map(item => `<li>${item}</li>`).join('')}</ul>`;
        });

        // 11. Restore inline code, code blocks and plan card placeholders in proper order
        escaped = escaped.replace(/%%INLCODE(\d+)%%/g, (match, idx) => inlineCodes[Number(idx)] || '');
        escaped = escaped.replace(/%%CBLOCK(\d+)%%/g, (match, idx) => codeBlocks[Number(idx)] || '');
        escaped = escaped.replace(/%%PLANCARD(\d+)%%/g, (match, idx) => planCards[Number(idx)] || '');

        return escaped;
    }
}
