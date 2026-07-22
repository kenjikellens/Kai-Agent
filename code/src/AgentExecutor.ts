import * as path from 'path';
import * as fs from 'fs';
import { LMStudioClient } from './LMStudioClient';
import { Tool, getRegisteredTools } from './tools';

/**
 * AgentExecutor coordinates the autonomous AI agent loop.
 * It manages polymorphic tool execution (file operations, search, terminal commands, diagnostics, AST symbols),
 * formats system prompts, parses tool calls, and reports updates back to the UI.
 */
export class AgentExecutor {
    private workspacePath: string;
    private extensionPath: string;
    private client: LMStudioClient;
    private temperature: number;
    private onProgress: (event: { type: string; tool?: string; query?: string; output?: string; toolId?: string; fileName?: string }) => void;
    private tools: Tool[];

    /**
     * Initializes a new instance of the AgentExecutor.
     * @param workspacePath The absolute path to the active workspace directory.
     * @param extensionPath The absolute path to the extension's root directory.
     * @param serverUrl The base API URL for LM Studio / LLM provider.
     * @param temperature The sampling temperature parameter.
     * @param onProgress Callback function to report agent steps and execution logs back to the sidebar.
     */
    constructor(
        workspacePath: string,
        extensionPath: string,
        serverUrl: string,
        temperature: number,
        onProgress: (event: { type: string; tool?: string; query?: string; output?: string; toolId?: string; fileName?: string }) => void
    ) {
        this.workspacePath = workspacePath;
        this.extensionPath = extensionPath;
        this.client = new LMStudioClient(serverUrl);
        this.temperature = temperature;
        this.onProgress = onProgress;
        this.tools = getRegisteredTools();
    }

    /**
     * The main execution loop of the agent.
     * Continuously calls the LLM, parses tool calls, executes them polymorphically, feeds results back,
     * and stops when the model decides it has finished.
     * @param userPrompt The instruction or request from the user.
     * @param chatHistory The active message log array.
     * @param model The target model selected in the dropdown.
     * @param signal AbortSignal to cancel HTTP requests.
     * @param activeFile Active text editor file details.
     * @param thinking Toggle parameter for model reasoning phase.
     * @returns A promise that resolves to the final assistant response.
     */
    public async run(
        userPrompt: string,
        chatHistory: { role: string; content: string }[],
        model: string = 'local-model',
        signal?: any,
        activeFile?: { fileName: string; filePath: string; content: string },
        thinking: boolean = true
    ): Promise<{ reply: string; messages: { role: string; content: string }[]; modifiedFiles: string[] }> {
        // Deep copy history to avoid mutating the original until loop is complete
        const messages = [...chatHistory];

        // Find existing system prompt or inject ours at the beginning
        const existingSystemIndex = messages.findIndex((m) => m.role === 'system');
        if (existingSystemIndex !== -1) {
            messages[existingSystemIndex] = {
                role: 'system',
                content: this.getSystemPrompt()
            };
        } else {
            messages.unshift({
                role: 'system',
                content: this.getSystemPrompt()
            });
        }

        // Add the user request (with active file context if available)
        let promptWithContext = userPrompt;
        if (activeFile) {
            promptWithContext = `[Active File: ${activeFile.filePath}]\n\`\`\`\n${activeFile.content}\n\`\`\`\n\n${userPrompt}`;
        }
        messages.push({ role: 'user', content: promptWithContext });

        let iteration = 0;
        const maxIterations = 10;
        let lastAssistantResponse = '';
        const modifiedFiles = new Set<string>();

        while (iteration < maxIterations) {
            iteration++;
            this.onProgress({ type: 'thinking', output: `Step ${iteration}: Consulting model...` });

            // Call the LLM with streaming tokens
            const response = await this.client.chatCompletionStream(
                messages,
                model,
                this.temperature,
                (token) => {
                    this.onProgress({ type: 'token', output: token });
                },
                signal,
                thinking
            );
            lastAssistantResponse = response;

            // Parse response for tool calls
            const toolCall = this.parseToolCall(response);

            if (!toolCall) {
                // No tools requested, agent is done
                break;
            }

            // Append the model's response containing the tool call to the history
            messages.push({ role: 'assistant', content: response });

            const activeToolId = `tool-${Date.now()}-${iteration}`;
            const targetName = this.getToolTarget(toolCall.name, toolCall.args);

            // Report the tool invocation to the UI
            this.onProgress({
                type: 'tool_start',
                tool: toolCall.name,
                query: toolCall.query,
                toolId: activeToolId,
                fileName: targetName
            });

            // Execute the tool polymorphically
            let toolResult = '';
            try {
                toolResult = await this.executeTool(toolCall.name, toolCall.args);
            } catch (err: any) {
                toolResult = `[Error executing tool ${toolCall.name}]: ${err.message || err}`;
            }

            if (['write_file', 'edit_file', 'replace_file_content', 'multi_replace_file_content'].includes(toolCall.name) && !toolResult.startsWith('[Error')) {
                if (targetName) {
                    modifiedFiles.add(targetName);
                }
            }

            // Report results back to the UI
            this.onProgress({
                type: 'tool_end',
                tool: toolCall.name,
                output: toolResult,
                toolId: activeToolId,
                fileName: targetName
            });

            // Feed the tool output back into the message history for the next iteration
            messages.push({
                role: 'user',
                content: `[Tool Result for ${toolCall.name}]:\n${toolResult}\n\nPlease proceed with the next step based on this result.`
            });
        }

        if (iteration >= maxIterations) {
            lastAssistantResponse += '\n\n*(Agent execution halted: Maximum tool execution steps reached)*';
        }

        // Append the final assistant response to the message history
        messages.push({ role: 'assistant', content: lastAssistantResponse });

        return {
            reply: lastAssistantResponse,
            messages: messages,
            modifiedFiles: Array.from(modifiedFiles)
        };
    }

    /**
     * Constructs the system prompt by loading it from system_prompt.md.
     * @returns The formatting guide system instructions.
     */
    private getSystemPrompt(): string {
        const promptPath = path.join(this.extensionPath, 'system_prompt.md');
        try {
            if (fs.existsSync(promptPath)) {
                return fs.readFileSync(promptPath, 'utf8');
            }
        } catch (e) {
            console.error('Error reading system_prompt.md:', e);
        }
        return `You are a powerful, autonomous local AI Developer Agent operating directly within the user's workspace directory. You have full access to view, list, search, and edit the workspace using tools.`;
    }

    /**
     * Parses the assistant's reply text to extract the first JSON tool call.
     * @param text The model's response.
     * @returns An object representing the tool call name, args, and a readable query, or null if none found.
     */
    private parseToolCall(text: string): { name: string; args: any; query: string } | null {
        // Regex to extract JSON block inside ```json ... ``` code fences
        const jsonBlockRegex = /```json\s*([\s\S]*?)\s*(?:```|$)/i;
        const match = jsonBlockRegex.exec(text);
        if (match) {
            const parsed = this.parseJsonString(match[1]);
            if (parsed) return parsed;
        }

        // Fallback: Try extracting using brace counting
        const braceJson = this.extractJsonBlock(text);
        if (braceJson) {
            const parsed = this.parseJsonString(braceJson);
            if (parsed) return parsed;
        }

        return null;
    }

    /**
     * Extracts the first JSON object string starting with { "type": ... } using brace counting.
     */
    private extractJsonBlock(text: string): string | null {
        let startIndex = -1;
        const typeRegex = /\{\s*["']type["']/g;
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
            if (parsed && typeof parsed.type === 'string') {
                const type = parsed.type;
                const matchedTool = this.tools.find(t => t.name === type);
                if (matchedTool) {
                    const args = { ...parsed };
                    delete args.type;
                    let query = `Executing ${type}`;
                    if (args.path) query = `${type}: ${args.path}`;
                    else if (args.command) query = `${type}: ${args.command}`;
                    else if (args.query) query = `${type}: ${args.query}`;
                    else if (args.url) query = `${type}: ${args.url}`;
                    return { name: type, args, query };
                }
            }
        } catch {
            // Ignore syntax errors to allow text fallback
        }
        return null;
    }

    /**
     * Executes the requested tool polymorphically via Tool interface.
     * @param tool The name of the tool.
     * @param args The arguments object parsed from the JSON blocks.
     * @returns A promise resolving to the execution result text.
     */
    private async executeTool(tool: string, args: any): Promise<string> {
        const matchedTool = this.tools.find((t) => t.name === tool);
        if (!matchedTool) {
            throw new Error(`Unknown tool: ${tool}`);
        }
        return await matchedTool.execute(args, { workspacePath: this.workspacePath });
    }

    /**
     * Extracts the target file basename or command name for compact UI representation.
     */
    private getToolTarget(tool: string, args: any): string {
        if (tool === 'run_command') {
            return args.command || '';
        }
        if (args.path) {
            return path.basename(args.path);
        }
        if (args.url) {
            return args.url;
        }
        return '';
    }
}
