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
exports.resolveSafePath = exports.Tool = void 0;
const path = __importStar(require("path"));
/**
 * Abstract base class that all agent tools must extend.
 * Provides OOP structure, schema generation for function calling, and output truncation utilities.
 */
class Tool {
    constructor() {
        /** Maximum number of lines returned by this tool. Subclasses may override this. */
        this.maxOutputLines = 150;
        /** Maximum number of UTF-8 bytes returned by this tool. Subclasses may override this. */
        this.maxOutputBytes = 8000;
    }
    /**
     * Truncates large tool execution output to save context window tokens.
     * Keeps head and tail lines with a clear truncation marker.
     */
    truncateOutput(output, maxLines = this.maxOutputLines, maxBytes = this.maxOutputBytes) {
        if (!output) {
            return output;
        }
        let result = output;
        // Truncate by complete lines first, retaining useful context from both ends.
        const allLines = result.split('\n');
        if (allLines.length > maxLines) {
            const headCount = Math.floor(maxLines * 0.6);
            const tailCount = maxLines - headCount;
            const head = allLines.slice(0, headCount).join('\n');
            const tail = allLines.slice(-tailCount).join('\n');
            const omitted = allLines.length - maxLines;
            result = `${head}\n\n... [${omitted} lines omitted] ...\n\n${tail}`;
        }
        if (Buffer.byteLength(result, 'utf8') <= maxBytes) {
            return result;
        }
        // Keep the byte limit UTF-8 safe and avoid cutting through a line where possible.
        const marker = '\n... [Output truncated at byte limit]';
        const availableBytes = Math.max(0, maxBytes - Buffer.byteLength(marker, 'utf8'));
        const lines = result.split('\n');
        let byteLength = 0;
        const keptLines = [];
        for (const line of lines) {
            const lineBytes = Buffer.byteLength(line, 'utf8');
            const separatorBytes = keptLines.length > 0 ? 1 : 0;
            if (byteLength + separatorBytes + lineBytes > availableBytes) {
                break;
            }
            keptLines.push(line);
            byteLength += separatorBytes + lineBytes;
        }
        if (keptLines.length > 0) {
            return `${keptLines.join('\n')}${marker}`;
        }
        // A single very long line cannot fit as a complete line; Buffer safely handles
        // the UTF-8 boundary and the marker makes the truncation explicit.
        return `${Buffer.from(result, 'utf8').subarray(0, availableBytes).toString('utf8')}${marker}`;
    }
}
exports.Tool = Tool;
/**
 * Resolves a relative path to an absolute path inside the active workspace directory.
 * Throws an error if the path tries to traverse outside of the workspace directory.
 * @param relativePath The relative path supplied by the LLM.
 * @param workspacePath The absolute path to the workspace directory.
 * @returns The resolved absolute path.
 */
function resolveSafePath(relativePath, workspacePath) {
    const resolved = path.resolve(workspacePath, relativePath);
    if (!resolved.startsWith(workspacePath)) {
        throw new Error(`Path traversal violation: Access to path "${relativePath}" outside the workspace is denied.`);
    }
    return resolved;
}
exports.resolveSafePath = resolveSafePath;
//# sourceMappingURL=Tool.js.map