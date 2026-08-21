import * as path from 'path';
import * as fs from 'fs';
import { LLMProviderFactory } from './providers/LLMProviderFactory';
import { Tool, getRegisteredTools } from './tools';
import { ContextManager, ContextMessage } from './ContextManager';
import { EditorContextProvider, EditorContext } from './EditorContextProvider';
import { DiagnosticsHelper } from './tools/DiagnosticsHelper';

/**
 * AgentExecutor coordinates the autonomous AI agent loop in the standalone desktop app.
 * It executes multi-step tool calls (file operations, search, terminal commands, web search, MCP),
 * parses responses, manages context token budgeting, and streams events back to the UI.
 */
export class AgentExecutor {
    private workspacePath: string;
    private extensionPath: string;
    private serverUrl: string;
    private temperature: number;
    private onProgress: (event: { type: string; text?: string; tool?: string; query?: string; output?: string; toolId?: string; fileName?: string }) => void;
    private tools: Tool[];
    private contextManager: ContextManager;

    /**
     * Initializes a new instance of AgentExecutor.
     * @param workspacePath Absolute path to active workspace root.
     * @param extensionPath Absolute path to app root.
     * @param serverUrl LLM provider / LM Studio server endpoint.
     * @param temperature Sampling temperature.
     * @param onProgress Callback to report progress events to the frontend.
     */
    constructor(
        workspacePath: string,
        extensionPath: string,
        serverUrl: string,
        temperature: number,
        onProgress: (event: { type: string; text?: string; tool?: string; query?: string; output?: string; toolId?: string; fileName?: string }) => void
    ) {
        this.workspacePath = workspacePath;
        this.extensionPath = extensionPath;
        this.serverUrl = serverUrl;
        this.temperature = temperature;
        this.onProgress = onProgress;
        this.tools = getRegisteredTools();
        this.contextManager = new ContextManager();
    }

    /**
     * Main execution loop of the agent.
     */
    public async run(
        userPrompt: string,
        chatHistory: { role: string; content: string }[],
        model: string = 'local-model',
        signal?: any,
        activeFile?: EditorContext | { fileName: string; filePath: string },
        thinking: boolean = true,
        geminiThinkingLevel: string = 'high',
        planningMode: boolean = false,
        attachedFiles?: any[],
        maxContextTokens: number = 16000,
        mode: 'chat' | 'agent' | 'planning' = 'agent'
    ): Promise<{ reply: string; messages: { role: string; content: string }[]; modifiedFiles: string[] }> {
        let messages: ContextMessage[] = [...chatHistory];
        this.contextManager = new ContextManager(maxContextTokens);

        // Dynamically instantiate registered tools matching the active mode and workspace state
        const hasWorkspace = Boolean(this.workspacePath && fs.existsSync(this.workspacePath));
        const effectiveMode = planningMode ? 'planning' : mode;
        this.tools = getRegisteredTools(effectiveMode, hasWorkspace);

        const provider = LLMProviderFactory.getProvider(model, this.serverUrl);
        const useNativeFunctionCalling = Boolean(
            provider.supportsNativeFunctionCalling?.() && provider.chatCompletionStreamWithTools
        );

        let systemContent = this.getSystemPrompt(effectiveMode, hasWorkspace, useNativeFunctionCalling);
        const now = new Date();
        const currentDayTimeStr = `[Temporal Context & Knowledge Cutoff]\n- Current Date and Time: ${now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}, ${now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}\n- Your internal training cutoff is in the past. Events, releases, and information dated prior to the current date are historical facts, not future speculation.\n- NEVER state that an event, product, or topic prior to the current date is unreleased or speculative based on training cutoff limitations. Use available search tools if current details are required.`;
        systemContent += `\n\n${currentDayTimeStr}\n`;

        const existingSystemIndex = messages.findIndex((m) => m.role === 'system');
        if (existingSystemIndex !== -1) {
            messages[existingSystemIndex] = {
                role: 'system',
                content: systemContent
            };
        } else {
            messages.unshift({
                role: 'system',
                content: systemContent
            });
        }

        const isFirstMessage = messages.filter((m) => m.role === 'user' || m.role === 'assistant').length === 0;
        let contextPrefix = '';

        if (planningMode) {
            contextPrefix += `[STRICT PLANNING MODE ACTIVE]\n`;
            contextPrefix += `You are operating in strict Planning Mode. Follow this protocol strictly:\n`;
            contextPrefix += `1. RESEARCH PHASE: First, inspect the codebase using read-only tools (view_file, list_dir, grep_search) to understand context.\n`;
            contextPrefix += `2. ARTIFACT CREATION: Create a structured implementation plan in '.kai/artifacts/implementation_plan.md'.\n`;
            contextPrefix += `3. ARTIFACT FORMATTING: The plan MUST follow standard headings:\n`;
            contextPrefix += `   # Implementation Plan: [Goal Description]\n`;
            contextPrefix += `   ## User Review Required\n`;
            contextPrefix += `   ## Open Questions\n`;
            contextPrefix += `   ## Proposed Changes\n`;
            contextPrefix += `   ## Verification Plan\n`;
            contextPrefix += `4. CHAT OUTPUT: In chat, output ONLY a brief 2-sentence summary pointing to the plan.\n`;
            contextPrefix += `5. GUARDRAIL: Do NOT modify code until approved.\n\n`;
        }

        if (isFirstMessage && this.workspacePath && fs.existsSync(this.workspacePath)) {
            try {
                const entries = fs.readdirSync(this.workspacePath, { withFileTypes: true });
                const folders: string[] = [];
                const files: string[] = [];

                for (const entry of entries) {
                    if (entry.name === '.git' || entry.name === 'node_modules') continue;
                    if (entry.isDirectory()) {
                        folders.push(entry.name + '/');
                    } else if (entry.isFile()) {
                        files.push(entry.name);
                    }
                }

                contextPrefix += `[Workspace Root Structure]\n`;
                if (folders.length > 0) {
                    contextPrefix += `Folders: ${folders.join(', ')}\n`;
                }
                if (files.length > 0) {
                    contextPrefix += `Files: ${files.join(', ')}\n`;
                }
            } catch {
                // ignore
            }
        }

        if (activeFile) {
            if ('activeFile' in activeFile || 'selection' in activeFile || 'openTabs' in activeFile) {
                const banner = EditorContextProvider.formatContextBanner(activeFile as EditorContext);
                if (banner) {
                    contextPrefix += banner;
                }
            } else if ((activeFile as any).filePath) {
                contextPrefix += `[Active Opened File: ${(activeFile as any).filePath}]\n`;
            }
        }

        if (attachedFiles && attachedFiles.length > 0) {
            for (const file of attachedFiles) {
                contextPrefix += `[Attached File: ${file.relativePath || file.fileName}]\n`;
                if (file.content) {
                    contextPrefix += `\`\`\`\n${file.content}\n\`\`\`\n\n`;
                }
            }
        }

        let promptWithContext = userPrompt;
        if (contextPrefix) {
            promptWithContext = `${contextPrefix}\n${userPrompt}`;
        }
        messages.push({ role: 'user', content: promptWithContext });

        let iteration = 0;
        const maxIterations = 25;
        let lastAssistantResponse = '';
        const modifiedFiles = new Set<string>();
        let stoppedAtIterationLimit = false;

        const isLocalLM = !model.toLowerCase().startsWith('gemini') && !model.toLowerCase().startsWith('omniroute');
        if (isLocalLM && typeof (provider as any).getLoadedModels === 'function') {
            this.onProgress({ type: 'status_update', text: 'Processing...' });
            try {
                const loaded = await (provider as any).getLoadedModels();
                if (loaded && !loaded.some((m: string) => m.toLowerCase().includes(model.toLowerCase()) || model.toLowerCase().includes(m.toLowerCase()))) {
                    this.onProgress({ type: 'status_update', text: 'Loading model into RAM...' });
                }
            } catch {
                this.onProgress({ type: 'status_update', text: 'Processing...' });
            }
        } else {
            this.onProgress({ type: 'status_update', text: 'Processing...' });
        }

        while (iteration < maxIterations) {
            iteration++;
            this.onProgress({ type: 'status_update', text: 'Processing...' });

            let response = '';
            let nativeToolCallId: string | undefined;
            let nativeThoughtSignature: string | undefined;
            let toolCall: { name: string; args: any; query: string } | null;

            if (useNativeFunctionCalling && provider.chatCompletionStreamWithTools) {
                const nativeResult = await provider.chatCompletionStreamWithTools(
                    messages,
                    model,
                    this.temperature,
                    this.getToolSchemas(),
                    (token) => {
                        this.onProgress({ type: 'token', output: token });
                    },
                    signal,
                    thinking,
                    geminiThinkingLevel
                );
                response = nativeResult.text;
                if (nativeResult.type === 'tool_call' && nativeResult.toolCall) {
                    nativeToolCallId = nativeResult.toolCall.id;
                    nativeThoughtSignature = nativeResult.toolCall.thoughtSignature;
                    toolCall = {
                        name: nativeResult.toolCall.name,
                        args: nativeResult.toolCall.args,
                        query: `Native tool call: ${nativeResult.toolCall.name}`
                    };
                } else {
                    toolCall = null;
                }
            } else {
                response = await provider.chatCompletionStream(
                    messages,
                    model,
                    this.temperature,
                    (token) => {
                        this.onProgress({ type: 'token', output: token });
                    },
                    signal,
                    thinking,
                    geminiThinkingLevel
                );
                toolCall = this.parseToolCall(response);
            }
            lastAssistantResponse = response;

            if (!toolCall) {
                if (!response.trim()) {
                    this.onProgress({
                        type: 'agent_warning',
                        output: 'The agent stopped because the model returned an empty response.'
                    });
                    lastAssistantResponse = 'The agent stopped because the model returned an empty response.';
                }
                break;
            }

            if (nativeToolCallId) {
                messages.push({
                    role: 'assistant',
                    content: response,
                    tool_calls: [{
                        id: nativeToolCallId,
                        type: 'function',
                        ...(nativeThoughtSignature ? { thoughtSignature: nativeThoughtSignature } : {}),
                        function: {
                            name: toolCall.name,
                            arguments: JSON.stringify(toolCall.args)
                        }
                    }]
                });
            } else {
                messages.push({ role: 'assistant', content: response });
            }
            messages = this.contextManager.compressIfNeeded(messages);

            const activeToolId = `tool-${Date.now()}-${iteration}`;
            const targetName = this.getToolTarget(toolCall.name, toolCall.args);

            this.onProgress({
                type: 'tool_start',
                tool: toolCall.name,
                query: toolCall.query,
                toolId: activeToolId,
                fileName: targetName
            });

            await new Promise<void>(resolve => setTimeout(resolve, 0));

            let toolResult = '';
            try {
                toolResult = await this.executeTool(toolCall.name, toolCall.args);
            } catch (err: any) {
                toolResult = `[Error executing tool ${toolCall.name}]: ${err.message || err}`;
            }

            if (['write_file', 'edit_file', 'replace_file_content', 'multi_replace_file_content'].includes(toolCall.name) && !toolResult.startsWith('[Error')) {
                if (targetName) {
                    modifiedFiles.add(targetName);
                    const isNewFile = toolCall.name === 'write_file';
                    const diagNote = await DiagnosticsHelper.getPostEditDiagnosticsNote(targetName, this.workspacePath, isNewFile);
                    if (diagNote) {
                        toolResult += diagNote;
                    }
                }
            } else if (toolCall.name === 'delete_item' && !toolResult.startsWith('[Error')) {
                if (targetName) {
                    modifiedFiles.add(targetName);
                }
            }

            this.onProgress({
                type: 'tool_end',
                tool: toolCall.name,
                output: toolResult,
                toolId: activeToolId,
                fileName: targetName
            });

            if (nativeToolCallId) {
                messages.push({
                    role: 'tool',
                    name: toolCall.name,
                    tool_call_id: nativeToolCallId,
                    content: toolResult
                });
            } else {
                messages.push({
                    role: 'user',
                    content: `[Tool Result for ${toolCall.name}]:\n${toolResult}\n\nPlease proceed with the next step based on this result.`
                });
            }
            messages = this.contextManager.compressIfNeeded(messages);

            if (iteration >= maxIterations) {
                stoppedAtIterationLimit = true;
            }
        }

        if (stoppedAtIterationLimit) {
            const warning = `The agent stopped after ${maxIterations} tool steps. The latest changes were kept, but verification may be incomplete.`;
            this.onProgress({ type: 'agent_warning', output: warning });
            lastAssistantResponse += `\n\n⚠ ${warning}`;
        }

        messages.push({ role: 'assistant', content: lastAssistantResponse });

        return {
            reply: lastAssistantResponse,
            messages: messages,
            modifiedFiles: Array.from(modifiedFiles)
        };
    }

    /**
     * Constructs the system prompt by loading the appropriate mode-specific markdown file from the prompts directory.
     * @param mode Active execution mode ('chat' | 'agent' | 'planning' | 'ask').
     * @param hasWorkspace Whether a workspace folder is open.
     * @param nativeFunctionCalling Whether the provider handles native function schemas.
     */
    private getSystemPrompt(
        mode: 'chat' | 'agent' | 'planning' | 'ask' | string = 'agent',
        hasWorkspace: boolean = true,
        nativeFunctionCalling: boolean = false
    ): string {
        let fileName = 'system_prompt_agent.md';
        if (mode === 'chat') {
            fileName = hasWorkspace ? 'system_prompt_chat_workspace.md' : 'system_prompt_chat.md';
        } else if (mode === 'ask') {
            fileName = 'system_prompt_ask.md';
        } else if (mode === 'planning') {
            fileName = 'system_prompt_planning.md';
        }

        const candidatePaths = [
            path.join(this.extensionPath, 'prompts', fileName),
            path.join(process.cwd(), 'prompts', fileName),
            path.join(__dirname, '..', '..', 'prompts', fileName),
            path.join(__dirname, 'prompts', fileName),
            path.join(__dirname, fileName),
            path.join(this.extensionPath, fileName),
            path.join(process.cwd(), fileName),
            // Fallback candidate paths
            path.join(this.extensionPath, 'prompts', 'system_prompt.md'),
            path.join(process.cwd(), 'prompts', 'system_prompt.md'),
            path.join(__dirname, '..', '..', 'prompts', 'system_prompt.md'),
            path.join(__dirname, 'system_prompt.md'),
            path.join(this.extensionPath, 'system_prompt.md'),
            path.join(process.cwd(), 'system_prompt.md')
        ];

        for (const p of candidatePaths) {
            try {
                if (fs.existsSync(p)) {
                    const prompt = fs.readFileSync(p, 'utf8');
                    return nativeFunctionCalling ? this.getNativeFunctionCallingPrompt(prompt) : prompt;
                }
            } catch {
                // ignore
            }
        }

        return `You are Kai, an autonomous AI Developer Agent operating directly within the user's workspace directory.`;
    }

    /**
     * Removes text-protocol instructions when providers receive native tool schemas.
     */
    private getNativeFunctionCallingPrompt(prompt: string): string {
        return prompt
            .replace(
                'output a concise explanation followed by exactly ONE tool call enclosed inside `<|tool_call|>` tags per turn.',
                'execute actions using the provided native function tools. Make at most one function call per turn.'
            )
            .replace(
                'Execute actions by outputting exactly ONE tool call enclosed inside `<|tool_call|>` tags per turn.',
                'execute actions using the provided native function tools. Make at most one function call per turn.'
            )
            .replace(/\n## RESPONSE FORMAT[\s\S]*?\n## CORE OPERATIONAL RULES/, '\n## CORE OPERATIONAL RULES')
            .replace(/\n## ACTION SCHEMAS[\s\S]*?\n## JSON ESCAPING RULES/, '\n## JSON ESCAPING RULES');
    }

    /**
     * Returns the native function declarations for all registered tools.
     */
    private getToolSchemas() {
        return this.tools.map((tool) => tool.getFunctionDeclaration());
    }

    /**
     * Parses the assistant reply text to extract the first JSON tool call.
     */
    private parseToolCall(text: string): { name: string; args: any; query: string } | null {
        const explicitTagRegex = /<\|?tool_call\|?>\s*([\s\S]*?)\s*(?:<\|?\/tool_call\|?>|<\|?tool_call\|?>|$)/i;
        const explicitTagMatch = explicitTagRegex.exec(text);
        if (explicitTagMatch) {
            const parsed = this.parseJsonString(explicitTagMatch[1]);
            if (parsed) return parsed;
        }

        const tagRegex = /(?:<\|?tool_call\|?>)?\s*(?:call:\w+)?\s*(\{[\s\S]*?\})\s*(?:<\|?tool_call\|?>)?/i;
        const tagMatch = tagRegex.exec(text);
        if (tagMatch) {
            const parsed = this.parseJsonString(tagMatch[1]);
            if (parsed) return parsed;
        }

        const jsonBlockRegex = /```json\s*([\s\S]*?)\s*(?:```|$)/i;
        const match = jsonBlockRegex.exec(text);
        if (match) {
            const parsed = this.parseJsonString(match[1]);
            if (parsed) return parsed;
        }

        const braceJson = this.extractJsonBlock(text);
        if (braceJson) {
            const parsed = this.parseJsonString(braceJson);
            if (parsed) return parsed;
        }

        return null;
    }

    /**
     * Extracts the first JSON object string starting with known tool keys using brace counting.
     */
    private extractJsonBlock(text: string): string | null {
        let startIndex = -1;
        const typeRegex = /\{\s*["'](?:type|path|command|chunks|query|action|tool|name)["']/g;
        let match;
        while ((match = typeRegex.exec(text)) !== null) {
            startIndex = match.index;
            break;
        }
        if (startIndex === -1) {
            return null;
        }

        let braceCount = 0;
        let inString = false;
        let escape = false;
        for (let i = startIndex; i < text.length; i++) {
            const char = text[i];
            if (escape) {
                escape = false;
                continue;
            }
            if (char === '\\') {
                escape = true;
                continue;
            }
            if (char === '"') {
                inString = !inString;
                continue;
            }
            if (!inString) {
                if (char === '{') {
                    braceCount++;
                } else if (char === '}') {
                    braceCount--;
                    if (braceCount === 0) {
                        return text.substring(startIndex, i + 1);
                    }
                }
            }
        }
        return null;
    }

    /**
     * Polymorphically matches JSON payload with registered Tool instances.
     */
    private parseJsonString(jsonStr: string): { name: string; args: any; query: string } | null {
        try {
            const parsed = JSON.parse(jsonStr.trim());
            if (parsed && typeof parsed === 'object') {
                let type = parsed.type || parsed.action || parsed.tool || parsed.name || parsed.function;
                
                if (!type) {
                    if (Array.isArray(parsed.chunks) || (parsed.targetContent && parsed.replacementContent)) {
                        type = parsed.chunks && parsed.chunks.length > 1 ? 'multi_replace_file_content' : 'replace_file_content';
                    } else if ((parsed.path || parsed.paths) && (parsed.action === 'delete' || parsed.paths !== undefined)) {
                        type = 'delete_item';
                    } else if (parsed.path && parsed.content !== undefined) {
                        type = 'write_file';
                    } else if (parsed.path && parsed.content === undefined) {
                        type = 'read_file';
                    } else if (parsed.command) {
                        type = 'run_command';
                    } else if (parsed.query && !parsed.command) {
                        type = 'grep_search';
                    }
                }

                if (type && typeof type === 'string') {
                    const normalizedType = type.toLowerCase() === 'full-web-search' || type.toLowerCase() === 'websearch'
                        ? 'web_search'
                        : type.toLowerCase();
                    const matchedTool = this.tools.find(t => t.name.toLowerCase() === normalizedType);
                    if (matchedTool) {
                        const args = { ...parsed };
                        delete args.type;
                        delete args.action;
                        delete args.tool;
                        delete args.name;
                        delete args.function;

                        let query = `Executing ${matchedTool.name}`;
                        if (args.path) query = `${matchedTool.name}: ${Array.isArray(args.path) ? args.path.join(', ') : args.path}`;
                        else if (args.paths) query = `${matchedTool.name}: ${Array.isArray(args.paths) ? args.paths.join(', ') : args.paths}`;
                        else if (args.command) query = `${matchedTool.name}: ${args.command}`;
                        else if (args.query) query = `${matchedTool.name}: ${args.query}`;
                        else if (args.url) query = `${matchedTool.name}: ${args.url}`;

                        return { name: matchedTool.name, args, query };
                    }
                }
            }
        } catch {
            // Ignore syntax errors
        }
        return null;
    }

    /**
     * Executes the requested tool polymorphically.
     */
    private async executeTool(tool: string, args: any): Promise<string> {
        const matchedTool = this.tools.find((t) => t.name === tool);
        if (!matchedTool) {
            throw new Error(`Unknown tool: ${tool}`);
        }

        let result = await matchedTool.execute(args, {
            workspacePath: this.workspacePath,
            extensionPath: this.extensionPath
        });
        const absoluteMaxBytes = 10000;
        if (Buffer.byteLength(result, 'utf8') > absoluteMaxBytes) {
            result = this.truncateToolOutput(result, absoluteMaxBytes);
        }
        return result;
    }

    /**
     * Applies a final size guard for tools that do not enforce their own output limits.
     */
    private truncateToolOutput(output: string, maxBytes: number): string {
        const lines = output.split('\n');
        const marker = `\n\n... [AgentExecutor: output truncated from ${lines.length} lines] ...\n\n`;
        const availableBytes = Math.max(0, maxBytes - Buffer.byteLength(marker, 'utf8'));
        const head = lines.slice(0, 60).join('\n');
        const tail = lines.slice(-30).join('\n');
        const combined = `${head}${marker}${tail}`;

        if (Buffer.byteLength(combined, 'utf8') <= maxBytes) {
            return combined;
        }

        return `${Buffer.from(combined, 'utf8').subarray(0, availableBytes).toString('utf8')}${marker.trimEnd()}`;
    }

    /**
     * Extracts the target file basename or command name for compact UI representation.
     */
    private getToolTarget(tool: string, args: any): string {
        if (tool === 'web_search') {
            return args.query ? `"${args.query}"` : '';
        }
        if (tool === 'run_command') {
            return args.command || '';
        }
        if (args.paths && Array.isArray(args.paths)) {
            return args.paths.map((p: string) => path.basename(p)).join(', ');
        }
        if (args.path) {
            return Array.isArray(args.path) ? args.path.map((p: string) => path.basename(p)).join(', ') : path.basename(args.path);
        }
        if (args.url) {
            return args.url;
        }
        return '';
    }
}
