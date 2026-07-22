"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentExecutor = void 0;
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const LMStudioClient_1 = require("./LMStudioClient");
const tools_1 = require("./tools");
/**
 * AgentExecutor coordinates the autonomous AI agent loop.
 * It manages polymorphic tool execution (file operations, search, terminal commands, diagnostics, AST symbols),
 * formats system prompts, parses tool calls, and reports updates back to the UI.
 */
class AgentExecutor {
    /**
     * Initializes a new instance of the AgentExecutor.
     * @param workspacePath The absolute path to the active workspace directory.
     * @param extensionPath The absolute path to the extension's root directory.
     * @param serverUrl The base API URL for LM Studio / LLM provider.
     * @param temperature The sampling temperature parameter.
     * @param onProgress Callback function to report agent steps and execution logs back to the sidebar.
     */
    constructor(workspacePath, extensionPath, serverUrl, temperature, onProgress) {
        this.workspacePath = workspacePath;
        this.extensionPath = extensionPath;
        this.client = new LMStudioClient_1.LMStudioClient(serverUrl);
        this.temperature = temperature;
        this.onProgress = onProgress;
        this.tools = (0, tools_1.getRegisteredTools)();
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
    async run(userPrompt, chatHistory, model = 'local-model', signal, activeFile, thinking = true) {
        // Deep copy history to avoid mutating the original until loop is complete
        const messages = [...chatHistory];
        // Find existing system prompt or inject ours at the beginning
        const existingSystemIndex = messages.findIndex((m) => m.role === 'system');
        if (existingSystemIndex !== -1) {
            messages[existingSystemIndex] = {
                role: 'system',
                content: this.getSystemPrompt()
            };
        }
        else {
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
        const modifiedFiles = new Set();
        while (iteration < maxIterations) {
            iteration++;
            this.onProgress({ type: 'thinking', output: `Step ${iteration}: Consulting model...` });
            // Call the LLM with streaming tokens
            const response = await this.client.chatCompletionStream(messages, model, this.temperature, (token) => {
                this.onProgress({ type: 'token', output: token });
            }, signal, thinking);
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
            }
            catch (err) {
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
    getSystemPrompt() {
        const promptPath = path.join(this.extensionPath, 'system_prompt.md');
        try {
            if (fs.existsSync(promptPath)) {
                return fs.readFileSync(promptPath, 'utf8');
            }
        }
        catch (e) {
            console.error('Error reading system_prompt.md:', e);
        }
        return `You are a powerful, autonomous local AI Developer Agent operating directly within the user's workspace directory. You have full access to view, list, search, and edit the workspace using tools.`;
    }
    /**
     * Parses the assistant's reply text to extract the first JSON tool call.
     * @param text The model's response.
     * @returns An object representing the tool call name, args, and a readable query, or null if none found.
     */
    /**
     * Parses the assistant's reply text to extract the first JSON tool call.
     * @param text The model's response.
     * @returns An object representing the tool call name, args, and a readable query, or null if none found.
     */
    parseToolCall(text) {
        // 1. Regex to extract JSON block inside ```json ... ``` code fences
        const jsonBlockRegex = /```json\s*([\s\S]*?)\s*(?:```|$)/i;
        const match = jsonBlockRegex.exec(text);
        if (match) {
            const parsed = this.parseJsonString(match[1]);
            if (parsed)
                return parsed;
        }
        // 2. Regex to extract tool call JSON payload surrounded by <tool_call|>, <|tool_call>, <tool_call>, or call:name
        const tagRegex = /(?:<\|?tool_call\|?>)?\s*(?:call:\w+)?\s*(\{[\s\S]*?\})\s*(?:<\|?tool_call\|?>)?/i;
        const tagMatch = tagRegex.exec(text);
        if (tagMatch) {
            const parsed = this.parseJsonString(tagMatch[1]);
            if (parsed)
                return parsed;
        }
        // 3. Fallback: Try extracting using brace counting starting at any JSON object containing known keys
        const braceJson = this.extractJsonBlock(text);
        if (braceJson) {
            const parsed = this.parseJsonString(braceJson);
            if (parsed)
                return parsed;
        }
        return null;
    }
    /**
     * Extracts the first JSON object string starting with known tool keys using brace counting.
     */
    extractJsonBlock(text) {
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
                }
                else if (char === '}') {
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
     * Auto-infers tool type from payload schema if "type" field is omitted by the model.
     */
    parseJsonString(jsonStr) {
        try {
            const parsed = JSON.parse(jsonStr.trim());
            if (parsed && typeof parsed === 'object') {
                let type = parsed.type || parsed.action || parsed.tool || parsed.name || parsed.function;
                // Infer tool type from object signature if type is omitted by model
                if (!type) {
                    if (Array.isArray(parsed.chunks) || (parsed.targetContent && parsed.replacementContent)) {
                        type = parsed.chunks && parsed.chunks.length > 1 ? 'multi_replace_file_content' : 'replace_file_content';
                    }
                    else if (parsed.path && parsed.content !== undefined) {
                        type = 'write_file';
                    }
                    else if (parsed.path && parsed.content === undefined) {
                        type = 'read_file';
                    }
                    else if (parsed.command) {
                        type = 'run_command';
                    }
                    else if (parsed.query && !parsed.command) {
                        type = 'grep_search';
                    }
                }
                if (type && typeof type === 'string') {
                    const matchedTool = this.tools.find(t => t.name.toLowerCase() === type.toLowerCase());
                    if (matchedTool) {
                        const args = { ...parsed };
                        delete args.type;
                        delete args.action;
                        delete args.tool;
                        delete args.name;
                        delete args.function;
                        let query = `Executing ${matchedTool.name}`;
                        if (args.path)
                            query = `${matchedTool.name}: ${args.path}`;
                        else if (args.command)
                            query = `${matchedTool.name}: ${args.command}`;
                        else if (args.query)
                            query = `${matchedTool.name}: ${args.query}`;
                        else if (args.url)
                            query = `${matchedTool.name}: ${args.url}`;
                        return { name: matchedTool.name, args, query };
                    }
                }
            }
        }
        catch {
            // Ignore syntax errors
        }
        return null;
    }
    /**
     * Executes the requested tool polymorphically via Tool interface.
     * @param tool The name of the tool.
     * @param args The arguments object parsed from the JSON blocks.
     * @returns A promise resolving to the execution result text.
     */
    async executeTool(tool, args) {
        const matchedTool = this.tools.find((t) => t.name === tool);
        if (!matchedTool) {
            throw new Error(`Unknown tool: ${tool}`);
        }
        return await matchedTool.execute(args, { workspacePath: this.workspacePath });
    }
    /**
     * Extracts the target file basename or command name for compact UI representation.
     */
    getToolTarget(tool, args) {
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
exports.AgentExecutor = AgentExecutor;
//# sourceMappingURL=AgentExecutor.js.map