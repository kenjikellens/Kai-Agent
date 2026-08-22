#!/usr/bin/env node
/**
 * preview_server.js
 * 
 * Pure Node.js local preview server for KAI Agent.
 * Serves the browser renderer (src/renderer) and executes all agent tools,
 * LM Studio model unloads, and snapshot rollbacks using the shared TypeScript/JS classes.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const APP_DIR = __dirname;
const RENDERER_DIR = path.join(APP_DIR, 'src', 'renderer');
const PROMPTS_DIR = path.join(APP_DIR, 'prompts');

function loadFreshDistModules() {
    try {
        const distDir = path.join(APP_DIR, 'dist', 'main');
        Object.keys(require.cache).forEach(cacheKey => {
            if (cacheKey.startsWith(distDir)) {
                delete require.cache[cacheKey];
            }
        });
        const toolsModule = require(path.join(APP_DIR, 'dist', 'main', 'tools', 'index.js'));
        const snapModule = require(path.join(APP_DIR, 'dist', 'main', 'services', 'TurnSnapshotManager.js'));
        const clientModule = require(path.join(APP_DIR, 'dist', 'main', 'LMStudioClient.js'));
        const parserModule = require(path.join(APP_DIR, 'dist', 'main', 'providers', 'LMStudioManifestParser.js'));
        return {
            getRegisteredTools: toolsModule.getRegisteredTools,
            TurnSnapshotManager: snapModule.TurnSnapshotManager,
            LMStudioClient: clientModule.LMStudioClient,
            LMStudioManifestParser: parserModule.LMStudioManifestParser
        };
    } catch (e) {
        return {};
    }
}

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.ico': 'image/x-icon',
    '.md': 'text/markdown; charset=utf-8'
};

function sendJson(res, statusCode, data) {
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': '*',
        'Cache-Control': 'no-cache'
    });
    res.end(JSON.stringify(data));
}

function parseBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch (err) {
                resolve({});
            }
        });
        req.on('error', reject);
    });
}

const server = http.createServer(async (req, res) => {
    // Dynamically load fresh compiled modules on every request (supports instant Ctrl+F5 hot reload)
    const { getRegisteredTools, TurnSnapshotManager, LMStudioClient, LMStudioManifestParser } = loadFreshDistModules();

    // Enable CORS preflight
    if (req.method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': '*'
        });
        res.end();
        return;
    }

    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;

    // 1. API: Capabilities
    if (pathname === '/api/capabilities' && req.method === 'GET') {
        try {
            const caps = LMStudioManifestParser ? LMStudioManifestParser.parseModelCapabilities() : {};
            return sendJson(res, 200, caps);
        } catch (e) {
            return sendJson(res, 200, {});
        }
    }

    // 2. API: LM Studio Models Discovery
    if ((pathname === '/api/lmstudio/models' || pathname === '/api/models') && req.method === 'GET') {
        try {
            const client = new LMStudioClient();
            const lmModels = await client.getLMStudioModels().catch(() => []);
            const loadedModels = await client.getLoadedModels().catch(() => []);

            let modelIds = lmModels;
            if (modelIds.length === 0 && LMStudioManifestParser) {
                const uniqueEntries = LMStudioManifestParser.getUniqueChatModels();
                modelIds = uniqueEntries.map(e => e.id);
            }

            // Deduplicate case-insensitively
            const seen = new Set();
            const uniqueModels = [];
            for (const id of modelIds) {
                const lower = id.toLowerCase();
                if (!seen.has(lower)) {
                    seen.add(lower);
                    uniqueModels.push(id);
                }
            }

            const data = uniqueModels.map(id => ({
                id: id,
                name: id,
                state: loadedModels.some(lm => lm.toLowerCase() === id.toLowerCase()) ? 'loaded' : 'downloaded'
            }));
            return sendJson(res, 200, { data });
        } catch (e) {
            return sendJson(res, 200, { data: [] });
        }
    }

    // 3. API: Tool Execution via JavaScript Tool classes
    if (pathname === '/api/tools/execute' && req.method === 'POST') {
        const body = await parseBody(req);
        const toolName = body.tool || body.name;
        const args = body.args || body;
        const workspacePath = body.workspacePath || process.cwd();
        const turnId = body.turnId || body.chatId || 'default';

        if (toolName === 'get_workspace_structure') {
            try {
                if (fs.existsSync(workspacePath)) {
                    const entries = fs.readdirSync(workspacePath, { withFileTypes: true });
                    const folders = [];
                    const files = [];
                    for (const entry of entries) {
                        if (['.git', 'node_modules', '.vscode', '__pycache__', '.kai'].includes(entry.name)) continue;
                        if (entry.isDirectory()) folders.push(entry.name + '/');
                        else if (entry.isFile()) files.push(entry.name);
                    }
                    let result = '[Workspace Root Structure]\n';
                    if (folders.length > 0) result += `Folders: ${folders.join(', ')}\n`;
                    if (files.length > 0) result += `Files: ${files.join(', ')}\n`;
                    return sendJson(res, 200, { result });
                }
            } catch (e) {}
            return sendJson(res, 200, { result: '' });
        }

        try {
            const allTools = getRegisteredTools ? getRegisteredTools('agent', true) : [];
            const matchedTool = allTools.find(t => t.name === toolName);
            if (!matchedTool) {
                return sendJson(res, 400, { result: `[Error]: Unknown tool '${toolName}'` });
            }

            const toolOutput = await matchedTool.execute(args, {
                workspacePath: workspacePath,
                extensionPath: APP_DIR,
                turnId: turnId
            });

            return sendJson(res, 200, { result: toolOutput });
        } catch (err) {
            return sendJson(res, 500, { result: `[Error executing ${toolName}]: ${err.message || err}` });
        }
    }

    // 4. API: Turn Rollback via TurnSnapshotManager
    if (pathname === '/api/tools/rollback' && req.method === 'POST') {
        const body = await parseBody(req);
        const turnIds = body.turnIds || (body.chatId ? [body.chatId] : ['default']);
        try {
            if (TurnSnapshotManager) {
                const result = await TurnSnapshotManager.getInstance().rollbackTurn(turnIds);
                return sendJson(res, 200, result);
            }
        } catch (e) {
            console.error('[PreviewServer] Rollback error:', e);
        }
        return sendJson(res, 200, { status: 'ok', reverted: [] });
    }

    // 5. API: Switch LM Studio Model (enforcing max 1 loaded model)
    if (pathname === '/api/lmstudio/switch' && req.method === 'POST') {
        const body = await parseBody(req);
        const targetModel = body.model;
        if (targetModel && LMStudioClient) {
            try {
                const client = new LMStudioClient();
                await client.ensureSingleLoadedModel(targetModel);
            } catch (e) {
                console.error('[PreviewServer] Switch error:', e);
            }
        }
        return sendJson(res, 200, { status: 'ok' });
    }

    // 6. API: LM Studio Chat Completions Proxy (Streaming SSE)
    if ((pathname === '/api/lmstudio/chat' || pathname === '/api/proxy/chat') && req.method === 'POST') {
        let rawBody = '';
        req.on('data', chunk => { rawBody += chunk.toString(); });
        req.on('end', async () => {
            try {
                const parsed = JSON.parse(rawBody);
                if (parsed.model && LMStudioClient) {
                    const client = new LMStudioClient();
                    await client.ensureSingleLoadedModel(parsed.model);
                }
            } catch (e) {}

            const proxyReq = http.request({
                hostname: '127.0.0.1',
                port: 1234,
                path: '/v1/chat/completions',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(rawBody),
                    'Accept': 'text/event-stream'
                }
            }, proxyRes => {
                res.writeHead(proxyRes.statusCode || 200, {
                    'Content-Type': 'text/event-stream; charset=utf-8',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                    'Access-Control-Allow-Origin': '*'
                });
                proxyRes.pipe(res);
            });

            proxyReq.on('error', err => {
                sendJson(res, 502, { error: `Failed to connect to LM Studio: ${err.message}` });
            });

            proxyReq.write(rawBody);
            proxyReq.end();
        });
        return;
    }

    // 7. Static file serving (Renderer assets & Prompts)
    let filePath = '';
    if (pathname.startsWith('/prompts/')) {
        filePath = path.join(PROMPTS_DIR, pathname.slice(9));
    } else if (pathname === '/' || pathname === '/index.html') {
        filePath = path.join(RENDERER_DIR, 'index.html');
    } else {
        filePath = path.join(RENDERER_DIR, pathname.slice(1));
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath).toLowerCase();
        const mimeType = MIME_TYPES[ext] || 'application/octet-stream';
        res.writeHead(200, {
            'Content-Type': mimeType,
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
            'Pragma': 'no-cache',
            'Expires': '0',
            'Surrogate-Control': 'no-store',
            'Access-Control-Allow-Origin': '*'
        });
        fs.createReadStream(filePath).pipe(res);
    } else {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`404 Not Found: ${pathname}`);
    }
});

const PORT = 5173;
server.listen(PORT, () => {
    console.log('========================================================');
    console.log('  KAI Agent - Pure Node.js Preview Server');
    console.log('========================================================');
    console.log(`  Serving:   http://localhost:${PORT}`);
    console.log(`  Renderer:  ${RENDERER_DIR}`);
    console.log('========================================================');
});
