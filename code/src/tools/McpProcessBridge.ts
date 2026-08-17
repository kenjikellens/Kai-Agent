import * as path from 'path';
import * as fs from 'fs';
import { spawn, ChildProcess } from 'child_process';

/**
 * Options for executing an MCP tool call via the child process bridge.
 */
export interface McpExecutionOptions {
    /** Absolute path to the MCP server script (e.g. index.js). */
    serverScriptPath: string;
    /** Tool name defined on the MCP server (e.g. 'full-web-search'). */
    toolName: string;
    /** Arguments to pass to the MCP tool. */
    arguments: Record<string, any>;
    /** Timeout in milliseconds (default 30000ms). */
    timeoutMs?: number;
}

/**
 * Manages child process lifecycle and JSON-RPC 2.0 stdio communication with MCP servers.
 */
export class McpProcessBridge {
    /**
     * Executes a single tool call on an MCP server over stdio transport.
     * @param options Execution parameters including script path, tool name, and args.
     * @returns A promise resolving to the MCP response content string.
     */
    public static async callTool(options: McpExecutionOptions): Promise<string> {
        const scriptPath = options.serverScriptPath;
        if (!fs.existsSync(scriptPath)) {
            throw new Error(`MCP server script not found at path: ${scriptPath}`);
        }

        const serverCwd = path.dirname(path.dirname(scriptPath)); // e.g. web-search-mcp-v0.3.2 folder
        const timeoutMs = options.timeoutMs || 30000;

        return new Promise<string>((resolve, reject) => {
            let child: ChildProcess | null = null;
            let timer: NodeJS.Timeout | null = null;
            let stdoutBuffer = '';
            let stderrBuffer = '';
            let requestId = 1;
            const pendingRequests = new Map<number, (response: any) => void>();

            const cleanup = () => {
                if (timer) {
                    clearTimeout(timer);
                    timer = null;
                }
                if (child) {
                    try {
                        child.kill();
                    } catch {
                        // ignore kill errors
                    }
                    child = null;
                }
            };

            timer = setTimeout(() => {
                cleanup();
                reject(new Error(`MCP tool execution timed out after ${timeoutMs / 1000}s.`));
            }, timeoutMs);

            try {
                // Spawn node process in the MCP directory so it resolves its own node_modules cleanly
                child = spawn('node', [scriptPath], {
                    cwd: fs.existsSync(serverCwd) ? serverCwd : path.dirname(scriptPath),
                    env: { ...process.env, FORCE_COLOR: '0' },
                    stdio: ['pipe', 'pipe', 'pipe']
                });
            } catch (err: any) {
                cleanup();
                return reject(new Error(`Failed to spawn MCP process: ${err.message || err}`));
            }

            if (!child.stdout || !child.stdin) {
                cleanup();
                return reject(new Error('Failed to establish stdio streams with MCP process.'));
            }

            // Function to send JSON-RPC message
            const sendJsonRpc = (message: any) => {
                if (child && child.stdin && !child.stdin.destroyed) {
                    child.stdin.write(JSON.stringify(message) + '\n');
                }
            };

            // Process line-by-line JSON-RPC messages from server stdout
            child.stdout.on('data', (chunk: Buffer) => {
                stdoutBuffer += chunk.toString('utf8');
                const lines = stdoutBuffer.split('\n');
                stdoutBuffer = lines.pop() || '';

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed) continue;
                    try {
                        const message = JSON.parse(trimmed);
                        if (message.id !== undefined && pendingRequests.has(message.id)) {
                            const handler = pendingRequests.get(message.id);
                            pendingRequests.delete(message.id);
                            if (handler) {
                                handler(message);
                            }
                        }
                    } catch {
                        // Non-JSON stdout lines (e.g. server startup logs) are ignored
                    }
                }
            });

            if (child.stderr) {
                child.stderr.on('data', (chunk: Buffer) => {
                    stderrBuffer += chunk.toString('utf8');
                });
            }

            child.on('error', (err: Error) => {
                cleanup();
                reject(new Error(`MCP process error: ${err.message}`));
            });

            child.on('exit', (code: number | null) => {
                if (pendingRequests.size > 0) {
                    cleanup();
                    const extra = stderrBuffer.trim() ? ` Stderr: ${stderrBuffer.trim()}` : '';
                    reject(new Error(`MCP server exited prematurely with code ${code}.${extra}`));
                }
            });

            // Perform MCP initialization handshake
            const initId = requestId++;
            pendingRequests.set(initId, (initResponse: any) => {
                if (initResponse.error) {
                    cleanup();
                    return reject(new Error(`MCP initialize error: ${JSON.stringify(initResponse.error)}`));
                }

                // Send initialized notification as per MCP protocol specification
                sendJsonRpc({
                    jsonrpc: '2.0',
                    method: 'notifications/initialized'
                });

                // Execute the requested tool call
                const callId = requestId++;
                pendingRequests.set(callId, (callResponse: any) => {
                    cleanup();
                    if (callResponse.error) {
                        return reject(new Error(`MCP tool call error: ${JSON.stringify(callResponse.error)}`));
                    }

                    const result = callResponse.result;
                    if (result && Array.isArray(result.content)) {
                        const texts = result.content
                            .filter((c: any) => c.type === 'text' && typeof c.text === 'string')
                            .map((c: any) => c.text);
                        return resolve(texts.join('\n\n') || JSON.stringify(result));
                    }
                    if (typeof result === 'string') {
                        return resolve(result);
                    }
                    resolve(JSON.stringify(result, null, 2));
                });

                sendJsonRpc({
                    jsonrpc: '2.0',
                    id: callId,
                    method: 'tools/call',
                    params: {
                        name: options.toolName,
                        arguments: options.arguments
                    }
                });
            });

            // Send initialize request
            sendJsonRpc({
                jsonrpc: '2.0',
                id: initId,
                method: 'initialize',
                params: {
                    protocolVersion: '2024-11-05',
                    capabilities: {},
                    clientInfo: {
                        name: 'Kai-Agent',
                        version: '1.0.0'
                    }
                }
            });
        });
    }
}
