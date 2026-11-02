/**
 * BrowserToolParser: Multi-strategy JSON tool call parser for KAI Agent browser preview.
 * Encapsulates explicit tag parsing, markdown code fences, regex extraction, and brace counting.
 */
class BrowserToolParser {
    static SUPPORTED_TOOLS = [
        'utility_tools', 'web_search', 'search_web', 'fetch_url', 'get_time', 'calculate',
        'text_stats', 'unit_converter', 'uuid_random', 'read_file', 'write_file', 'edit_file',
        'replace_file_content', 'multi_replace_file_content', 'list_dir', 'grep_search',
        'symbol_search', 'get_diagnostics', 'run_command', 'delete_item', 'ask_user'
    ];

    /**
     * Parses a tool call from LLM response text using 4 layered strategies.
     * @param {string} text Full LLM response text.
     * @returns {{ name: string, args: object, query: string } | null}
     */
    static parseToolCall(text) {
        if (!text) return null;

        // Strategy 1: Explicit <|tool_call|>, <tool_call>, or custom execution tags
        const explicitTagRegex = /<\|?(?:tool_call|tool|execute_plan|action)\|?>\s*([\s\S]*?)\s*(?:<\|?\/(?:tool_call|tool|execute_plan|action)\|?>|<\|?(?:tool_call|tool|execute_plan|action)\|?>|$)/i;
        const explicitMatch = explicitTagRegex.exec(text);
        if (explicitMatch && explicitMatch[1]) {
            const parsed = this.parseJsonToolCall(explicitMatch[1]);
            if (parsed) return parsed;
            const innerJson = this.extractJsonBlock(explicitMatch[1]);
            if (innerJson) {
                const innerParsed = this.parseJsonToolCall(innerJson);
                if (innerParsed) return innerParsed;
            }
        }

        // Strategy 2: ```json fenced code block
        const jsonBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*(?:```|$)/i;
        const jsonMatch = jsonBlockRegex.exec(text);
        if (jsonMatch && jsonMatch[1]) {
            const parsed = this.parseJsonToolCall(jsonMatch[1]);
            if (parsed) return parsed;
        }

        // Strategy 3: Loose tag wrapper with optional call: prefix
        const tagRegex = /(?:<\|?[a-z_-]+\|?>)?\s*(?:call:\w+)?\s*(\{[\s\S]*?\})\s*(?:<\|?[a-z_-]+\|?>)?/i;
        const tagMatch = tagRegex.exec(text);
        if (tagMatch && tagMatch[1]) {
            const parsed = this.parseJsonToolCall(tagMatch[1]);
            if (parsed) return parsed;
        }

        // Strategy 4: Full brace-counted JSON extraction anywhere in text
        const braceJson = this.extractJsonBlock(text);
        if (braceJson) {
            const parsed = this.parseJsonToolCall(braceJson);
            if (parsed) return parsed;
        }

        return null;
    }

    /**
     * Extracts the first JSON object from text using brace counting, anchored on known tool keys.
     * @param {string} text Source text to search.
     * @returns {string | null}
     */
    static extractJsonBlock(text) {
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
     * Escapes unescaped literal newline and carriage return characters within JSON string literals.
     * Sanitizes in-memory string without modifying application state or DOM.
     * @param {string} jsonText JSON candidate string.
     * @returns {string} Sanitized JSON string.
     */
    static escapeRawNewlinesInStrings(jsonText) {
        let inString = false;
        let isEscaped = false;
        let result = '';
        for (let i = 0; i < jsonText.length; i++) {
            const char = jsonText[i];
            if (char === '"' && !isEscaped) {
                inString = !inString;
                result += char;
            } else if (inString && (char === '\n' || char === '\r')) {
                if (char === '\r' && jsonText[i + 1] === '\n') continue;
                result += '\\n';
            } else {
                result += char;
            }
            if (char === '\\' && !isEscaped) isEscaped = true;
            else isEscaped = false;
        }
        return result;
    }

    /**
     * Attempts heuristic repairs on malformed JSON containing unescaped newlines, single quotes, or trailing commas.
     * Sanitizes raw text string without mutating application state or DOM elements.
     * @param {string} raw Raw JSON string candidate.
     * @returns {string} Repaired JSON string.
     */
    static repairJson(raw) {
        if (!raw) return '';
        let cleaned = raw.trim();
        cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
        cleaned = cleaned.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'(?=\s*:)/g, '"$1"');
        cleaned = cleaned.replace(/:\s*'([^'\\]*(?:\\.[^'\\]*)*)'/g, ': "$1"');
        cleaned = this.escapeRawNewlinesInStrings(cleaned);
        cleaned = cleaned.replace(/,\s*([}\]])/g, '$1');
        return cleaned;
    }

    /**
     * Normalizes parameter aliases to canonical tool schema keys.
     * @param {object} args Raw tool arguments.
     * @returns {object} Normalized arguments.
     */
    static normalizeArgs(args) {
        if (!args || typeof args !== 'object' || Array.isArray(args)) return args;
        const normalized = {};
        const aliases = {
            'file': 'path', 'filename': 'path', 'filepath': 'path', 'target_file': 'path',
            'code': 'content', 'text': 'content', 'data': 'content', 'body': 'content',
            'cmd': 'command', 'command_line': 'command', 'script': 'command',
            'pattern': 'query', 'search_term': 'query',
            'target': 'targetContent', 'old_content': 'targetContent', 'oldContent': 'targetContent',
            'replacement': 'replacementContent', 'new_content': 'replacementContent', 'newContent': 'replacementContent',
            'start': 'startLine', 'start_line': 'startLine', 'end': 'endLine', 'end_line': 'endLine'
        };
        for (const [key, val] of Object.entries(args)) {
            const canon = aliases[key] || key;
            normalized[canon] = val;
        }
        return normalized;
    }

    /**
     * Parses a JSON string into a structured tool call object.
     * @param {string} jsonStr Raw JSON string.
     * @returns {{ name: string, args: object, query: string } | null}
     */
    static parseJsonToolCall(jsonStr) {
        try {
            let parsed = null;
            try {
                parsed = JSON.parse(jsonStr.trim());
            } catch (e1) {
                try {
                    const repaired = this.repairJson(jsonStr);
                    parsed = JSON.parse(repaired);
                } catch (e2) {}
            }
            if (!parsed || typeof parsed !== 'object') return null;

            let type = parsed.type || parsed.action || parsed.tool || parsed.name || parsed.function;

            if (type) {
                const normalized = type.toLowerCase();
                if (normalized === 'full-web-search' || normalized === 'websearch' || normalized === 'search_web') {
                    type = 'web_search';
                } else if (['clarify', 'question', 'ask_user', 'user_input', 'prompt_user'].includes(normalized)) {
                    type = 'ask_user';
                } else if (['bash', 'terminal', 'cmd', 'shell', 'execute_command', 'run_command'].includes(normalized)) {
                    type = 'run_command';
                } else {
                    type = normalized;
                }
            }

            // Fallback inference if type is omitted
            if (!type) {
                if (parsed.question) type = 'ask_user';
                if (parsed.expression) type = 'calculate';
                else if (parsed.from_unit && parsed.to_unit) type = 'unit_converter';
                else if (parsed.query && !parsed.command) type = 'web_search';
                else if (parsed.url) type = 'fetch_url';
                else if (parsed.path && parsed.content !== undefined) type = 'write_file';
                else if (parsed.path && parsed.content === undefined) type = 'read_file';
                else if (parsed.command) type = 'run_command';
            }

            if (type && this.SUPPORTED_TOOLS.includes(type)) {
                const args = this.normalizeArgs({ ...parsed });
                delete args.type;
                delete args.tool;
                delete args.name;
                delete args.function;

                let effectiveTool = type;
                if (type === 'utility_tools' && args.action) {
                    effectiveTool = args.action;
                }

                let query = `Executing ${effectiveTool}`;
                if (args.question) query = `${effectiveTool}: ${args.question}`;
                else if (args.query) query = `${effectiveTool}: ${args.query}`;
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
    static getToolTarget(tool, args) {
        if (!args) return '';
        if (tool === 'web_search' || tool === 'search_web') return args.query ? `"${args.query}"` : '';
        if (tool === 'fetch_url') return args.url || '';
        if (tool === 'utility_tools') return args.action || '';
        if (tool === 'get_time') return 'current time';
        if (tool === 'calculate') return args.expression || '';
        if (tool === 'text_stats') return 'text analysis';
        if (tool === 'unit_converter') return `${args.value || ''} ${args.from_unit || ''} → ${args.to_unit || ''}`;
        if (tool === 'uuid_random') return args.type || 'uuid';
        if (['read_file', 'write_file', 'edit_file', 'replace_file_content', 'multi_replace_file_content', 'list_dir', 'delete_item'].includes(tool)) {
            return args.path ? (args.path.split(/[\\/]/).pop() || args.path) : '';
        }
        if (tool === 'ask_user') return args.question || 'Clarification';
        if (tool === 'run_command') return args.command || '';
        if (tool === 'grep_search') return args.query ? `"${args.query}"` : '';
        return '';
    }
}

if (typeof window !== 'undefined') {
    window.BrowserToolParser = BrowserToolParser;
}
