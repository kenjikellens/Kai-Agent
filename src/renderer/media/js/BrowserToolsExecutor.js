/**
 * BrowserToolsExecutor: Handles tool execution and backend proxying for KAI Agent browser preview.
 * Executes mathematical, unit conversion, and utility functions in-browser, and forwards filesystem/search requests.
 */
class BrowserToolsExecutor {
    constructor(activeTurnIdGetter, approvalRequestHandler) {
        this.activeTurnIdGetter = activeTurnIdGetter;
        this.onCommandApprovalRequest = approvalRequestHandler;
    }

    /**
     * Executes a tool in browser preview mode.
     * @param {string} name Tool identifier.
     * @param {object} args Arguments payload.
     * @returns {Promise<string>} Execution output text.
     */
    async execute(name, args) {
        if (name === 'utility_tools') {
            const action = args.action || '';
            switch (action) {
                case 'get_time': return this.toolGetTime();
                case 'calculate': return this.toolCalculate(args.expression || '');
                case 'unit_converter': return this.toolUnitConverter(args.value, args.from_unit, args.to_unit);
                case 'text_stats': return this.toolTextStats(args.text || '');
                case 'uuid_random': return this.toolUuidRandom(args.type || 'uuid');
                default: return `[Error]: Unknown utility_tools action: ${action}`;
            }
        }

        if ([
            'list_dir', 'read_file', 'write_file', 'replace_file_content',
            'multi_replace_file_content', 'grep_search', 'run_command', 'delete_item'
        ].includes(name)) {
            if (name === 'run_command' && this.onCommandApprovalRequest && typeof this.onCommandApprovalRequest === 'function') {
                const allowed = await this.onCommandApprovalRequest(args.command || '');
                if (!allowed) {
                    return `[Execution Cancelled]: User refused to execute the command: ${args.command || ''}`;
                }
            }
            return this.toolExecuteWorkspaceTool(name, args);
        }

        switch (name) {
            case 'get_time': return this.toolGetTime();
            case 'calculate': return this.toolCalculate(args.expression || '');
            case 'text_stats': return this.toolTextStats(args.text || '');
            case 'unit_converter': return this.toolUnitConverter(args.value, args.from_unit, args.to_unit);
            case 'uuid_random': return this.toolUuidRandom(args.type || 'uuid');
            case 'web_search':
            case 'search_web': return this.toolWebSearch(args.query || '', args.limit || 5);
            case 'fetch_url': return this.toolFetchUrl(args.url || '');
            default: return `[Error]: Tool "${name}" is not available in browser preview mode.`;
        }
    }

    /**
     * Executes a workspace filesystem/command tool via the /api/tools/execute backend endpoint.
     */
    async toolExecuteWorkspaceTool(tool, args) {
        const savedWs = localStorage.getItem('kai.workspacePath') || '';
        const currentTurnId = (this.activeTurnIdGetter ? this.activeTurnIdGetter() : '') || localStorage.getItem('kai.activeChatId') || '';
        try {
            const res = await fetch('/api/tools/execute', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    tool: tool,
                    args: args,
                    workspacePath: savedWs,
                    turnId: currentTurnId
                })
            });
            if (!res.ok) throw new Error(`Proxy error ${res.status}`);
            const data = await res.json();
            return data.result || JSON.stringify(data, null, 2);
        } catch (e) {
            return `[Error executing ${tool}]: ${e.message}`;
        }
    }

    /** Returns formatted date/time and timezone details. */
    toolGetTime() {
        const now = new Date();
        return JSON.stringify({
            date: now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
            time: now.toLocaleTimeString('en-US', { hour12: false }),
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            unix: Math.floor(now.getTime() / 1000)
        }, null, 2);
    }

    /** Evaluates mathematical expression securely. */
    toolCalculate(expression) {
        try {
            const sanitized = expression.replace(/[^0-9+\-*/().%\s^,eE]/g, '');
            if (!sanitized.trim()) return '[Error]: Empty expression';
            const result = Function('"use strict"; return (' + sanitized + ')')();
            return `Expression: ${expression}\nResult: ${result}`;
        } catch (e) {
            return `[Error calculating]: ${e.message}`;
        }
    }

    /** Converts units across distance, weight, and temperature. */
    toolUnitConverter(value, fromUnit, toUnit) {
        const lengthUnits = { m: 1, km: 1000, cm: 0.01, mm: 0.001, miles: 1609.344, mi: 1609.344, ft: 0.3048, in: 0.0254, yard: 0.9144, yd: 0.9144 };
        const weightUnits = { kg: 1, g: 0.001, mg: 0.000001, lb: 0.453592, lbs: 0.453592, oz: 0.0283495, ton: 1000 };
        const tempUnits = ['celsius', 'c', 'fahrenheit', 'f', 'kelvin', 'k'];

        const from = (fromUnit || '').toLowerCase();
        const to = (toUnit || '').toLowerCase();

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

        if (lengthUnits[from] && lengthUnits[to]) {
            const result = value * lengthUnits[from] / lengthUnits[to];
            return `${value} ${fromUnit} = ${result.toFixed(6)} ${toUnit}`;
        }

        if (weightUnits[from] && weightUnits[to]) {
            const result = value * weightUnits[from] / weightUnits[to];
            return `${value} ${fromUnit} = ${result.toFixed(6)} ${toUnit}`;
        }

        return `[Error]: Cannot convert between "${fromUnit}" and "${toUnit}". Unsupported unit pair.`;
    }

    /** Computes character, word, sentence, and line counts. */
    toolTextStats(text) {
        const charCount = text.length;
        const wordCount = text.split(/\s+/).filter(Boolean).length;
        const sentenceCount = text.split(/[.!?]+/).filter(s => s.trim()).length;
        const lineCount = text.split(/\r?\n/).length;
        return `Characters: ${charCount}\nWords: ${wordCount}\nSentences: ${sentenceCount}\nLines: ${lineCount}`;
    }

    /** Generates UUID v4 token. */
    toolUuidRandom(type) {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) {
            return crypto.randomUUID();
        }
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
    }

    /** Searches web via run_pc.py backend proxy. */
    async toolWebSearch(query, limit) {
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

    /** Fetches web page content via backend proxy. */
    async toolFetchUrl(url) {
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

    /** Triggers rollback of snapshot changes for given turn IDs. */
    async rollbackTurnChanges(turnIds) {
        try {
            const ids = Array.isArray(turnIds) ? turnIds : [turnIds];
            const res = await fetch('/api/tools/rollback', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ turnIds: ids })
            });
            if (!res.ok) throw new Error(`Rollback HTTP error ${res.status}`);
            return await res.json();
        } catch (e) {
            console.error('Error in rollbackTurnChanges:', e);
            return { status: 'error', message: e.message };
        }
    }
}

if (typeof window !== 'undefined') {
    window.BrowserToolsExecutor = BrowserToolsExecutor;
}
