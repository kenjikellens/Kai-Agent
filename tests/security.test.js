const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const { resolveSafePath } = require('../dist/main/tools/Tool.js');
const { getRegisteredTools, WriteFileTool, FetchUrlTool, RunCommandTool } = require('../dist/main/tools/index.js');
const { SessionStore } = require('../dist/main/SessionStore.js');

function loadBrowserClass(filePath, className) {
    const code = fs.readFileSync(filePath, 'utf8');
    const context = { window: { addEventListener: () => {} }, localStorage: { getItem: () => null, setItem: () => {} }, Math, Number, String, Array, RegExp, Object, Error, console };
    vm.createContext(context);
    vm.runInContext(`${code}\nthis.__EXPORTED__ = ${className};`, context);
    return context.__EXPORTED__;
}

test('resolveSafePath blocks empty workspace, sibling prefix, and .. traversal', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kai-safe-'));
    const ws = path.join(tmpRoot, 'proj');
    const sibling = path.join(tmpRoot, 'proj-secret');
    fs.mkdirSync(ws, { recursive: true });
    fs.mkdirSync(sibling, { recursive: true });
    fs.writeFileSync(path.join(ws, 'ok.txt'), 'ok', 'utf8');
    fs.writeFileSync(path.join(sibling, 'secret.txt'), 'secret', 'utf8');

    try {
        assert.throws(() => resolveSafePath('ok.txt', ''), /No active workspace/i);
        assert.throws(() => resolveSafePath('../proj-secret/secret.txt', ws), /Path traversal violation/i);
        assert.throws(() => resolveSafePath('../../outside.txt', ws), /Path traversal violation/i);
        const inside = resolveSafePath('ok.txt', ws);
        assert.equal(inside, path.join(fs.realpathSync(ws), 'ok.txt'));
    } finally {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
});

test('Ask and Agent modes without workspace exclude workspace mutation and command tools', () => {
    for (const m of ['ask', 'chat', 'agent']) {
        const names = getRegisteredTools(m, false).map(t => t.name);
        assert.equal(names.includes('run_command'), false);
        assert.equal(names.includes('write_file'), false);
        assert.equal(names.includes('delete_item'), false);
    }
});

test('Planning mode excludes run_command and delete_item and restricts write_file to .kai/artifacts', async () => {
    const tools = getRegisteredTools('planning', true);
    const names = tools.map(t => t.name);
    assert.equal(names.includes('run_command'), false);
    assert.equal(names.includes('delete_item'), false);
    assert.equal(names.includes('edit_file'), false);
    assert.equal(names.includes('write_file'), true);

    const tmpWs = fs.mkdtempSync(path.join(os.tmpdir(), 'kai-plan-'));
    try {
        const planWriter = new WriteFileTool('.kai/artifacts');
        const blocked = await planWriter.execute({ path: 'src/hack.ts', content: 'x' }, { workspacePath: tmpWs });
        assert.match(blocked, /restricted to "\.kai\/artifacts\/"/);

        const allowed = await planWriter.execute({ path: '.kai/artifacts/implementation_plan.md', content: '# Plan' }, { workspacePath: tmpWs });
        assert.match(allowed, /Successfully wrote/);
    } finally {
        fs.rmSync(tmpWs, { recursive: true, force: true });
    }
});

test('RunCommandTool honors hostServices.requestCommandApproval denial', async () => {
    const tool = new RunCommandTool();
    const res = await tool.execute({ command: 'echo should-not-run' }, {
        workspacePath: process.cwd(),
        hostServices: {
            getDiagnostics: async () => '',
            getPostEditDiagnostics: async () => '',
            searchWorkspaceSymbols: async () => '',
            getConfiguration: (_s, _k, d) => d,
            askUser: async () => '',
            requestCommandApproval: async () => false
        }
    });
    assert.match(res, /Execution Cancelled/);
});

test('FetchUrlTool blocks localhost and link-local SSRF targets', async () => {
    const tool = new FetchUrlTool();
    const resLocal = await tool.execute({ url: 'http://127.0.0.1:5173/api/health' }, { workspacePath: '' });
    assert.match(resLocal, /SSRF protection/i);
    const resMeta = await tool.execute({ url: 'http://169.254.169.254/latest/meta-data/' }, { workspacePath: '' });
    assert.match(resMeta, /SSRF protection/i);
    const resHost = await tool.execute({ url: 'http://localhost:1234/v1/models' }, { workspacePath: '' });
    assert.match(resHost, /SSRF protection/i);
});

test('MarkdownFormatter.escapeHtml escapes quotes and angle brackets', () => {
    const MarkdownFormatter = loadBrowserClass(
        path.resolve(__dirname, '../src/renderer/media/js/MarkdownFormatter.js'),
        'MarkdownFormatter'
    );
    const fmt = new MarkdownFormatter();
    const escaped = fmt.escapeHtml(`<script>"'&`);
    assert.equal(escaped, '&lt;script&gt;&quot;&#39;&amp;');
});

test('BrowserToolsExecutor._evaluateArithmetic evaluates math safely without Function()', () => {
    const BrowserToolsExecutor = loadBrowserClass(
        path.resolve(__dirname, '../src/renderer/media/js/BrowserToolsExecutor.js'),
        'BrowserToolsExecutor'
    );
    assert.equal(BrowserToolsExecutor._evaluateArithmetic('2 + 3 * (4 - 1)'), 11);
    assert.equal(BrowserToolsExecutor._evaluateArithmetic('2 ^ 3 + 1'), 9);
    assert.throws(() => BrowserToolsExecutor._evaluateArithmetic('process.exit(1)'), /Unsupported character/);
    assert.throws(() => BrowserToolsExecutor._evaluateArithmetic('1 / 0'), /Division by zero/);
});

test('SessionStore waits for async storage load before saveChat', async () => {
    let saved = null;
    const store = new SessionStore({
        load: async () => {
            await new Promise(r => setTimeout(r, 20));
            return { old: { id: 'old', title: 'Old', messages: [], mode: 'agent', model: 'm', thinking: true, timestamp: 1 } };
        },
        save: async (data) => { saved = data; }
    });
    await store.saveChat({ id: 'new', title: 'New', messages: [], mode: 'agent', model: 'm', thinking: true, timestamp: 2 });
    assert.ok(saved.old);
    assert.ok(saved.new);
});
