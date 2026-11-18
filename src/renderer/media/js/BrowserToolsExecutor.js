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
        if (name === 'ask_user') {
            return new Promise((resolve) => {
                const uiController = window.chatUIController;
                if (uiController && typeof uiController.renderAskUserCard === 'function') {
                    uiController.renderAskUserCard({
                        requestId: 'ask_' + Date.now(),
                        question: args.question || 'Please provide clarification:',
                        options: args.options || [],
                        allowCustom: args.allowCustom !== false
                    }, (answer) => {
                        resolve(`User response: ${answer}`);
                    });
                } else {
                    resolve(`[Ask User Error]: Interactive UI is not available.`);
                }
            });
        }

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
            const res = await (typeof DOMUtils !== 'undefined' && DOMUtils.fetchWithPreviewAuth
                ? DOMUtils.fetchWithPreviewAuth('/api/tools/execute', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        tool: tool,
                        args: args,
                        workspacePath: savedWs,
                        turnId: currentTurnId
                    })
                })
                : fetch('/api/tools/execute', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        tool: tool,
                        args: args,
                        workspacePath: savedWs,
                        turnId: currentTurnId
                    })
                }));
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

    /** Evaluates arithmetic expression securely without dynamic code execution. */
    toolCalculate(expression) {
        try {
            const raw = String(expression || '').trim();
            if (!raw) return '[Error]: Empty expression';
            const result = BrowserToolsExecutor._evaluateArithmetic(raw);
            return `Expression: ${expression}\nResult: ${result}`;
        } catch (e) {
            return `[Error calculating]: ${e.message}`;
        }
    }

    /** Tokenizes and evaluates basic arithmetic (+ - * / % ^ and parentheses) safely. */
    static _evaluateArithmetic(expr) {
        const tokens = [];
        let i = 0;
        while (i < expr.length) {
            const ch = expr[i];
            if (/\s/.test(ch)) {
                i++;
                continue;
            }
            if (/[0-9.]/.test(ch)) {
                const match = expr.slice(i).match(/^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/);
                if (!match) throw new Error(`Invalid number at position ${i}`);
                tokens.push({ type: 'num', val: Number(match[0]) });
                i += match[0].length;
                continue;
            }
            if ('+-*/%^()'.includes(ch)) {
                tokens.push({ type: 'op', val: ch });
                i++;
                continue;
            }
            throw new Error(`Unsupported character "${ch}" in expression`);
        }

        let pos = 0;
        const peek = () => tokens[pos];
        const consume = () => tokens[pos++];

        const parseExpr = () => {
            let left = parseTerm();
            while (peek() && peek().type === 'op' && (peek().val === '+' || peek().val === '-')) {
                const op = consume().val;
                const right = parseTerm();
                left = op === '+' ? left + right : left - right;
            }
            return left;
        };

        const parseTerm = () => {
            let left = parsePower();
            while (peek() && peek().type === 'op' && (peek().val === '*' || peek().val === '/' || peek().val === '%')) {
                const op = consume().val;
                const right = parsePower();
                if ((op === '/' || op === '%') && right === 0) throw new Error('Division by zero');
                left = op === '*' ? left * right : (op === '/' ? left / right : left % right);
            }
            return left;
        };

        const parsePower = () => {
            let base = parseUnary();
            if (peek() && peek().type === 'op' && peek().val === '^') {
                consume();
                const exp = parsePower();
                base = Math.pow(base, exp);
            }
            return base;
        };

        const parseUnary = () => {
            if (peek() && peek().type === 'op' && (peek().val === '+' || peek().val === '-')) {
                const op = consume().val;
                const val = parseUnary();
                return op === '-' ? -val : val;
            }
            return parsePrimary();
        };

        const parsePrimary = () => {
            const tok = peek();
            if (!tok) throw new Error('Unexpected end of expression');
            if (tok.type === 'num') {
                consume();
                return tok.val;
            }
            if (tok.type === 'op' && tok.val === '(') {
                consume();
                const val = parseExpr();
                const closing = consume();
                if (!closing || closing.val !== ')') throw new Error('Mismatched parentheses');
                return val;
            }
            throw new Error(`Unexpected token "${tok.val}"`);
        };

        const value = parseExpr();
        if (pos < tokens.length) throw new Error(`Unexpected trailing token "${tokens[pos].val}"`);
        if (!Number.isFinite(value)) throw new Error('Result is not finite');
        return value;
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
        return this.toolExecuteWorkspaceTool('web_search', { query, limit: limit || 5 });
    }

    /** Fetches web page content via backend proxy. */
    async toolFetchUrl(url) {
        return this.toolExecuteWorkspaceTool('fetch_url', { url });
    }

    /** Triggers rollback of snapshot changes for given turn IDs. */
    async rollbackTurnChanges(turnIds) {
        try {
            const ids = Array.isArray(turnIds) ? turnIds : [turnIds];
            const res = await (typeof DOMUtils !== 'undefined' && DOMUtils.fetchWithPreviewAuth
                ? DOMUtils.fetchWithPreviewAuth('/api/tools/rollback', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ turnIds: ids })
                })
                : fetch('/api/tools/rollback', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ turnIds: ids })
                }));
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
