const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadBrowserClass(filePath, className) {
    const code = fs.readFileSync(filePath, 'utf8');
    const context = { window: { addEventListener: () => {} }, localStorage: { getItem: () => null, setItem: () => {} }, Math, Number, String, Array, RegExp, Object, Error, console };
    vm.createContext(context);
    vm.runInContext(`${code}\nthis.__EXPORTED__ = ${className};`, context);
    return context.__EXPORTED__;
}

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
