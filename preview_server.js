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
const crypto = require('crypto');

const APP_DIR = __dirname;
const RENDERER_DIR = path.resolve(APP_DIR, 'src', 'renderer');
const PROMPTS_DIR = path.resolve(APP_DIR, 'prompts');
const PORT = 5173;
const HOST = '127.0.0.1';
const MAX_BODY_BYTES = 10 * 1024 * 1024;
const PREVIEW_SESSION_TOKEN = crypto.randomBytes(24).toString('hex');
const ALLOWED_ORIGINS = new Set([`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`]);
const WORKSPACE_TOOLS = new Set([
    'get_workspace_structure', 'list_dir', 'read_file', 'write_file', 'edit_file',
    'replace_file_content', 'multi_replace_file_content', 'grep_search',
    'symbol_search', 'get_diagnostics', 'run_command', 'delete_item'
]);

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

/**
 * Returns strict same-origin CORS headers for allowed localhost origins.
 */
function getCorsHeaders(req) {
    const origin = req && req.headers ? req.headers.origin : '';
    const headers = {
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-KAI-Token',
        'Vary': 'Origin'
    };
    if (origin && ALLOWED_ORIGINS.has(origin)) {
        headers['Access-Control-Allow-Origin'] = origin;
    }
    return headers;
}

/**
 * Validates Origin header and per-session X-KAI-Token on mutating API calls.
 */
function isAuthorizedApiPost(req) {
    const origin = req.headers.origin;
    if (origin && !ALLOWED_ORIGINS.has(origin)) {
        return false;
    }
    const token = String(req.headers['x-kai-token'] || '');
    const expectedBuf = Buffer.from(PREVIEW_SESSION_TOKEN, 'utf8');
    const actualBuf = Buffer.from(token, 'utf8');
    if (actualBuf.length !== expectedBuf.length) {
        return false;
    }
    return crypto.timingSafeEqual(actualBuf, expectedBuf);
}

/**
 * Resolves a request path safely inside a base directory, rejecting traversal.
 */
function resolveSafeStaticPath(baseDir, rawRelPath) {
    let decoded;
    try {
        decoded = decodeURIComponent(rawRelPath);
    } catch {
        return null;
    }
    const cleanRel = decoded.replace(/^[/\\]+/, '');
    const resolvedBase = path.resolve(baseDir);
    const targetPath = path.resolve(resolvedBase, cleanRel);
    const rel = path.relative(resolvedBase, targetPath);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
        return null;
    }
    return targetPath;
}

/**
 * Spawns a Windows FolderBrowserDialog with a TopMost owner form so it stays visible above browser windows.
 */
function openWindowsFolderPicker(description, showNewFolderButton) {
    return new Promise((resolve) => {
        const { spawn } = require('child_process');
        const safeDesc = String(description || 'Select Folder').replace(/'/g, "''");
        const newBtnFlag = showNewFolderButton ? '$true' : '$false';
        const script = `
Add-Type -AssemblyName System.Windows.Forms | Out-Null
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.StartPosition = 'Manual'
$owner.Location = New-Object System.Drawing.Point(-32000, -32000)
$owner.Size = New-Object System.Drawing.Size(1, 1)
$owner.ShowInTaskbar = $false
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = '${safeDesc}'
$dialog.ShowNewFolderButton = ${newBtnFlag}
$result = $dialog.ShowDialog($owner)
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
    [Console]::Out.WriteLine($dialog.SelectedPath)
} else {
    [Console]::Out.WriteLine('CANCELED')
}
$dialog.Dispose()
$owner.Dispose()
`;
        const ps = spawn('powershell.exe', ['-STA', '-NoProfile', '-Command', script]);
        let output = '';
        let settled = false;
        const finish = (val) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(val);
        };
        const timer = setTimeout(() => {
            try { ps.kill(); } catch (e) {}
            finish(null);
        }, 120000);
        ps.stdout.on('data', data => { output += data.toString(); });
        ps.on('error', () => finish(null));
        ps.on('close', () => {
            const picked = output.trim();
            if (picked && picked !== 'CANCELED' && !picked.includes('Exception')) {
                finish(picked);
            } else {
                finish(null);
            }
        });
    });
}

function sendJson(req, res, statusCode, data) {
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        ...getCorsHeaders(req),
        'Cache-Control': 'no-cache'
    });
    res.end(JSON.stringify(data));
}

function readRawBody(req, maxBytes = MAX_BODY_BYTES) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let totalBytes = 0;
        let aborted = false;

        req.on('data', chunk => {
            if (aborted) return;
            totalBytes += chunk.length;
            if (totalBytes > maxBytes) {
                aborted = true;
                const err = new Error('Request payload exceeds maximum allowed size.');
                err.code = 'PAYLOAD_TOO_LARGE';
                req.destroy();
                reject(err);
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => {
            if (!aborted) {
                resolve(Buffer.concat(chunks).toString('utf8'));
            }
        });
        req.on('error', reject);
    });
}

async function parseBody(req) {
    const raw = await readRawBody(req);
    if (!raw || !raw.trim()) {
        return {};
    }
    try {
        return JSON.parse(raw);
    } catch {
        const err = new Error('Invalid JSON payload.');
        err.code = 'INVALID_JSON';
        throw err;
    }
}

const server = http.createServer(async (req, res) => {
    // Enable CORS preflight strictly for allowed local origins
    if (req.method === 'OPTIONS') {
        res.writeHead(204, getCorsHeaders(req));
        res.end();
        return;
    }

    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname || '';

    // Health check endpoint for launcher readiness polling
    if (pathname === '/api/health' && req.method === 'GET') {
        return sendJson(req, res, 200, { status: 'ok', port: PORT });
    }

    // Enforce per-session CSRF token + origin verification on all POST /api/* endpoints
    if (pathname.startsWith('/api/') && req.method === 'POST' && !isAuthorizedApiPost(req)) {
        return sendJson(req, res, 403, { error: 'Forbidden: Invalid origin or missing session token.' });
    }

    // Dynamically load fresh compiled modules strictly for API requests (supports instant hot reload without overhead for static assets)
    const { getRegisteredTools, TurnSnapshotManager, LMStudioClient, LMStudioManifestParser } = pathname.startsWith('/api/')
        ? loadFreshDistModules()
        : {};

    // 1. API: Capabilities
    if (pathname === '/api/capabilities' && req.method === 'GET') {
        try {
            const caps = LMStudioManifestParser ? LMStudioManifestParser.parseModelCapabilities() : {};
            return sendJson(req, res, 200, caps);
        } catch (e) {
            return sendJson(req, res, 200, {});
        }
    }

    // 2. API: LM Studio Models Discovery
    if ((pathname === '/api/lmstudio/models' || pathname === '/api/models') && req.method === 'GET') {
        try {
            const client = new LMStudioClient();
            const lmModels = await client.getLMStudioModels().catch(() => []);
            const loadedModels = await client.getLoadedModels().catch(() => []);

            let modelIds = lmModels;

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
            const isServerOnline = uniqueModels.length > 0 || loadedModels.length > 0;
            return sendJson(req, res, 200, { connected: isServerOnline, data });
        } catch (e) {
            return sendJson(req, res, 200, { connected: false, data: [] });
        }
    }

    // 3. API: Tool Execution via JavaScript Tool classes
    if (pathname === '/api/tools/execute' && req.method === 'POST') {
        let body;
        try {
            body = await parseBody(req);
        } catch (err) {
            return sendJson(req, res, err.code === 'PAYLOAD_TOO_LARGE' ? 413 : 400, { error: err.message });
        }

        const toolName = body.tool || body.name;
        const args = body.args || body;
        const rawWorkspacePath = typeof body.workspacePath === 'string' ? body.workspacePath.trim() : '';
        const turnId = body.turnId || body.chatId || 'default';

        if (!toolName || typeof toolName !== 'string') {
            return sendJson(req, res, 400, { result: '[Error]: Missing tool name.' });
        }

        if (WORKSPACE_TOOLS.has(toolName) && (!rawWorkspacePath || !fs.existsSync(rawWorkspacePath))) {
            return sendJson(req, res, 400, { result: '[Error]: Valid workspacePath is required for workspace tools.' });
        }
        const workspacePath = rawWorkspacePath ? path.resolve(rawWorkspacePath) : '';

        if (toolName === 'get_workspace_structure') {
            try {
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
                return sendJson(req, res, 200, { result });
            } catch (e) {}
            return sendJson(req, res, 200, { result: '' });
        }

        try {
            const allTools = getRegisteredTools ? getRegisteredTools('agent', Boolean(workspacePath)) : [];
            const matchedTool = allTools.find(t => t.name === toolName);
            if (!matchedTool) {
                return sendJson(req, res, 400, { result: `[Error]: Unknown tool '${toolName}'` });
            }

            const toolOutput = await matchedTool.execute(args, {
                workspacePath: workspacePath,
                extensionPath: APP_DIR,
                turnId: turnId
            });

            return sendJson(req, res, 200, { result: toolOutput });
        } catch (err) {
            return sendJson(req, res, 500, { result: `[Error executing ${toolName}]: ${err.message || err}` });
        }
    }

    // 4. API: Turn Rollback via TurnSnapshotManager
    if (pathname === '/api/tools/rollback' && req.method === 'POST') {
        let body;
        try {
            body = await parseBody(req);
        } catch (err) {
            return sendJson(req, res, err.code === 'PAYLOAD_TOO_LARGE' ? 413 : 400, { error: err.message });
        }
        const turnIds = body.turnIds || (body.chatId ? [body.chatId] : ['default']);
        try {
            if (TurnSnapshotManager) {
                const result = await TurnSnapshotManager.getInstance().rollbackTurn(turnIds);
                return sendJson(req, res, 200, result);
            }
        } catch (e) {
            console.error('[PreviewServer] Rollback error:', e);
        }
        return sendJson(req, res, 200, { status: 'ok', reverted: [] });
    }

    // 4b. API: Workspace Folder Picker (Windows Native Folder Picker Dialog)
    if (pathname === '/api/workspace/pick' && req.method === 'POST') {
        const picked = await openWindowsFolderPicker('Select Workspace Folder', true);
        if (picked) {
            return sendJson(req, res, 200, { canceled: false, workspacePath: picked });
        }
        return sendJson(req, res, 200, { canceled: true });
    }

    // 4c. API: LM Studio Cache Folder Picker
    if (pathname === '/api/lmstudio/pick' && req.method === 'POST') {
        const picked = await openWindowsFolderPicker('Select LM Studio Directory', false);
        if (picked) {
            return sendJson(req, res, 200, { canceled: false, lmStudioCacheDir: picked });
        }
        return sendJson(req, res, 200, { canceled: true });
    }

    // 5. API: Switch LM Studio Model (enforcing max 1 loaded model)
    if (pathname === '/api/lmstudio/switch' && req.method === 'POST') {
        let body;
        try {
            body = await parseBody(req);
        } catch (err) {
            return sendJson(req, res, err.code === 'PAYLOAD_TOO_LARGE' ? 413 : 400, { error: err.message });
        }
        const targetModel = body.model;
        if (targetModel && LMStudioClient) {
            try {
                const client = new LMStudioClient();
                await client.ensureSingleLoadedModel(targetModel);
            } catch (e) {
                console.error('[PreviewServer] Switch error:', e);
            }
        }
        return sendJson(req, res, 200, { status: 'ok' });
    }

    // 6. API: LM Studio Chat Completions Proxy (Streaming SSE)
    if ((pathname === '/api/lmstudio/chat' || pathname === '/api/proxy/chat') && req.method === 'POST') {
        let rawBody = '';
        try {
            rawBody = await readRawBody(req);
        } catch (err) {
            return sendJson(req, res, err.code === 'PAYLOAD_TOO_LARGE' ? 413 : 400, { error: err.message });
        }

        try {
            const parsed = JSON.parse(rawBody);
            if (parsed.model && LMStudioClient) {
                const client = new LMStudioClient();
                await client.ensureSingleLoadedModel(parsed.model);
            }
        } catch (e) {
            return sendJson(req, res, 400, { error: 'Invalid JSON payload.' });
        }

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
                ...getCorsHeaders(req)
            });
            proxyRes.pipe(res);
        });

        proxyReq.on('error', err => {
            sendJson(req, res, 502, { error: `Failed to connect to LM Studio: ${err.message}` });
        });

        proxyReq.write(rawBody);
        proxyReq.end();
        return;
    }

    // 7. Static file serving (Renderer assets & Prompts) with strict boundary validation
    let filePath = null;
    if (pathname.startsWith('/prompts/')) {
        filePath = resolveSafeStaticPath(PROMPTS_DIR, pathname.slice(9));
    } else if (pathname === '/' || pathname === '/index.html') {
        filePath = path.join(RENDERER_DIR, 'index.html');
    } else {
        filePath = resolveSafeStaticPath(RENDERER_DIR, pathname.slice(1));
    }

    if (!filePath) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('403 Forbidden');
        return;
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
            ...getCorsHeaders(req)
        });
        if (filePath === path.join(RENDERER_DIR, 'index.html')) {
            const html = fs.readFileSync(filePath, 'utf8').replace(
                '</head>',
                `    <meta name="kai-preview-token" content="${PREVIEW_SESSION_TOKEN}">\n</head>`
            );
            res.end(html);
        } else {
            fs.createReadStream(filePath).pipe(res);
        }
    } else {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`404 Not Found: ${pathname}`);
    }
});

server.listen(PORT, HOST, () => {
    console.log('========================================================');
    console.log('  KAI Agent - Pure Node.js Preview Server');
    console.log('========================================================');
    console.log(`  Serving:   http://localhost:${PORT}`);
    console.log(`  Renderer:  ${RENDERER_DIR}`);
    console.log('========================================================');
});
