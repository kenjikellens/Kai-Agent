/**
 * BrowserToolParser: Multi-strategy JSON tool call parser for KAI Agent browser preview.
 * Encapsulates explicit tag parsing, markdown code fences, regex extraction, and brace counting.
 */
class BrowserToolParser {
    static SUPPORTED_TOOLS = [
        'utility_tools', 'web_search', 'search_web', 'fetch_url', 'get_time', 'calculate',
        'text_stats', 'unit_converter', 'uuid_random', 'read_file', 'write_file', 'edit_file',
        'replace_file_content', 'multi_replace_file_content', 'list_dir', 'grep_search',
        'symbol_search', 'get_diagnostics', 'run_command', 'delete_item'
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
     * Parses a JSON string into a structured tool call object.
     * @param {string} jsonStr Raw JSON string.
     * @returns {{ name: string, args: object, query: string } | null}
     */
    static parseJsonToolCall(jsonStr) {
        try {
            const parsed = JSON.parse(jsonStr.trim());
            if (!parsed || typeof parsed !== 'object') return null;

            let type = parsed.type || parsed.action || parsed.tool || parsed.name || parsed.function;

            if (type) {
                const normalized = type.toLowerCase();
                if (normalized === 'full-web-search' || normalized === 'websearch' || normalized === 'search_web') {
                    type = 'web_search';
                } else {
                    type = normalized;
                }
            }

            // Fallback inference if type is omitted
            if (!type) {
                if (parsed.expression) type = 'calculate';
                else if (parsed.from_unit && parsed.to_unit) type = 'unit_converter';
                else if (parsed.query && !parsed.command) type = 'web_search';
                else if (parsed.url) type = 'fetch_url';
                else if (parsed.path && parsed.content !== undefined) type = 'write_file';
                else if (parsed.path && parsed.content === undefined) type = 'read_file';
                else if (parsed.command) type = 'run_command';
            }

            if (type && this.SUPPORTED_TOOLS.includes(type)) {
                const args = { ...parsed };
                delete args.type;
                delete args.tool;
                delete args.name;
                delete args.function;

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
        if (tool === 'run_command') return args.command || '';
        if (tool === 'grep_search') return args.query ? `"${args.query}"` : '';
        return '';
    }
}

if (typeof window !== 'undefined') {
    window.BrowserToolParser = BrowserToolParser;
}
