import * as path from 'path';
import * as fs from 'fs';
import { LMStudioClient } from './LMStudioClient';
import { Tool, getRegisteredTools } from './tools';

/**
 * AgentExecutor coordinates the autonomous AI agent loop.
 * It manages tool execution (file reads/writes/edits, folder listings, terminal execution),
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
     * @param serverUrl The base API URL for LM Studio.
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
     * Continuously calls the LLM, parses tool JSON blocks, executes them, feeds results back,
     * and stops when the model decides it has finished (no more tool calls generated).
     * @param userPrompt The instruction or request from the user.
     * @param chatHistory The active message log array.
     * @param model The target model selected in the dropdown.
     * @param signal AbortSignal to cancel HTTP requests.
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
            this.onProgress({ type: 'thinking', output: `Step ${iteration}: Consulting local model...` });

            // Call the local LLM with streaming tokens
            const response = await this.client.chatCompletionStream(
                messages,
                model,
                this.temperature,
                (token) => {
                    // Send each chunk/token back to the UI
                    this.onProgress({ type: 'token', output: token });
                },
                signal,
                thinking
            );
            lastAssistantResponse = response;

            // Parse response for any tool json blocks
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

            // Execute the tool
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
     * Constructs the system prompt by loading it from the system_prompt_agent.txt file.
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
        return `You are a powerful, autonomous local AI Developer Agent operating directly within the user's workspace directory. You have full access to view, list, and edit the workspace using tools.`;
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

        // Fallback: Try extracting using brace counting (handles raw JSON or malformed fences)
        const braceJson = this.extractJsonBlock(text);
        if (braceJson) {
            const parsed = this.parseJsonString(braceJson);
            if (parsed) return parsed;
        }

        return null;
    }

    /**
     * Extracts the first JSON object string starting with { "type": ... } using brace counting.
     * This avoids stopping at inner braces (e.g. inside string fields containing CSS/JS code).
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
     * Safely parses raw JSON string and extracts matching arguments.
     */
    private parseJsonString(jsonStr: string): { name: string; args: any; query: string } | null {
        try {
            const parsed = JSON.parse(jsonStr.trim());
            if (parsed && typeof parsed.type === 'string') {
                const type = parsed.type;
                let query = `Executing ${type}`;
                const args: any = {};

                if (type === 'read_file') {
                    args.path = parsed.path;
                    query = `Read file: ${parsed.path}`;
                } else if (type === 'write_file') {
                    args.path = parsed.path;
                    args.content = parsed.content;
                    query = `Write file: ${parsed.path}`;
                } else if (type === 'replace_file_content') {
                    args.path = parsed.path;
                    args.startLine = parsed.startLine;
                    args.endLine = parsed.endLine;
                    args.targetContent = parsed.targetContent;
                    args.replacementContent = parsed.replacementContent;
                    query = `Replace content in file: ${parsed.path}`;
                } else if (type === 'multi_replace_file_content') {
                    args.path = parsed.path;
                    args.chunks = parsed.chunks;
                    query = `Multi-replace content in file: ${parsed.path}`;
                } else if (type === 'grep_search') {
                    args.query = parsed.query;
                    args.path = parsed.path || '.';
                    query = `Grep search: ${parsed.query}`;
                } else if (type === 'list_dir') {
                    args.path = parsed.path || '.';
                    query = `List directory: ${parsed.path || '.'}`;
                } else if (type === 'run_command') {
                    args.command = parsed.command;
                    query = `Run command: ${parsed.command}`;
                } else {
                    return null; // Unknown type
                }
                return { name: type, args, query };
            }
        } catch {
            // Ignore syntax errors to allow fallback to normal text
        }
        return null;
    }

    /**
     * Executes the requested tool and returns the text result.
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
        return '';
    }
}
