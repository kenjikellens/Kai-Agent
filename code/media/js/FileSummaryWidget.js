/**
 * FileSummaryWidget renders file modification summary cards and icons.
 */
class FileSummaryWidget {
    /**
     * Resolves Codicon class, CSS icon color class, and basename for a file path.
     * @param {string} filePath Full path or relative filename.
     * @returns {object} Details object containing basename, icon HTML, and directory path.
     */
    getFileDetails(filePath) {
        const basename = filePath.split(/[/\\]/).pop();
        const ext = basename.includes('.') ? basename.split('.').pop().toLowerCase() : '';
        
        let codiconClass = 'codicon-file';
        let colorClass = 'default-file-icon';

        if (['html', 'htm', 'xhtml'].includes(ext)) {
            codiconClass = 'codicon-file-code';
            colorClass = 'html-icon';
        } else if (['css', 'scss', 'sass', 'less'].includes(ext)) {
            codiconClass = 'codicon-symbol-color';
            colorClass = 'css-icon';
        } else if (['js', 'mjs', 'cjs', 'jsx'].includes(ext)) {
            codiconClass = 'codicon-symbol-method';
            colorClass = 'js-icon';
        } else if (['ts', 'mts', 'cts', 'tsx'].includes(ext)) {
            codiconClass = 'codicon-file-code';
            colorClass = 'ts-icon';
        } else if (['json', 'jsonc', 'json5'].includes(ext)) {
            codiconClass = 'codicon-json';
            colorClass = 'json-icon';
        } else if (['md', 'markdown', 'mdx'].includes(ext)) {
            codiconClass = 'codicon-markdown';
            colorClass = 'md-icon';
        } else if (['py', 'ipynb'].includes(ext)) {
            codiconClass = 'codicon-symbol-variable';
            colorClass = 'py-icon';
        } else if (['java', 'c', 'cpp', 'cc', 'cxx', 'h', 'hpp', 'cs', 'go', 'rs', 'php', 'rb'].includes(ext)) {
            codiconClass = 'codicon-file-code';
            colorClass = 'lang-icon';
        } else if (['sh', 'bash', 'zsh', 'ps1', 'bat', 'cmd'].includes(ext)) {
            codiconClass = 'codicon-terminal';
            colorClass = 'term-icon';
        } else if (['sql', 'db', 'sqlite'].includes(ext)) {
            codiconClass = 'codicon-database';
            colorClass = 'db-icon';
        } else if (['yaml', 'yml', 'toml', 'xml', 'ini', 'env', 'config'].includes(ext)) {
            codiconClass = 'codicon-settings';
            colorClass = 'config-icon';
        } else if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico'].includes(ext)) {
            codiconClass = 'codicon-file-media';
            colorClass = 'media-icon';
        } else if (['mp3', 'wav', 'ogg', 'mp4', 'mov', 'avi', 'mkv'].includes(ext)) {
            codiconClass = 'codicon-file-media';
            colorClass = 'media-icon';
        } else if (ext === 'pdf') {
            codiconClass = 'codicon-file-pdf';
            colorClass = 'pdf-icon';
        } else if (['zip', 'tar', 'gz', '7z', 'rar'].includes(ext)) {
            codiconClass = 'codicon-file-zip';
            colorClass = 'zip-icon';
        } else if (ext.includes('lock') || basename.endsWith('.lock') || basename === 'package-lock.json') {
            codiconClass = 'codicon-lock';
            colorClass = 'lock-icon';
        } else if (basename.startsWith('.git')) {
            codiconClass = 'codicon-source-control';
            colorClass = 'git-icon';
        } else if (basename.toLowerCase().includes('docker')) {
            codiconClass = 'codicon-symbol-misc';
            colorClass = 'docker-icon';
        }

        const icon = `<i class="codicon ${codiconClass} ${colorClass}"></i>`;
        const dirParts = filePath.split(/[/\\]/);
        dirParts.pop();
        const dirPath = dirParts.length > 0 ? '...' + dirParts.join('/') : '';
        
        return { basename, icon, dirPath };
    }

    /**
     * Renders a file summary widget element containing interactive file cards.
     * @param {Array<string>} files Array of file paths.
     * @param {MarkdownFormatter} formatter Formatter instance for HTML escaping.
     * @returns {HTMLElement|null} Rendered message element or null if empty.
     */
    renderWidget(files, formatter) {
        if (!files || files.length === 0) return null;

        const messageDiv = document.createElement('div');
        messageDiv.className = 'message file-summary-message';

        const widgetDiv = document.createElement('div');
        widgetDiv.className = 'file-summary-widget';

        const itemsHtml = files.map(file => {
            const details = this.getFileDetails(file);
            return `
                <div class="file-card" data-filepath="${formatter.escapeHtml(file)}" title="Click to open ${formatter.escapeHtml(details.basename)} in VS Code">
                    ${details.icon}
                    <span class="file-card-name">${formatter.escapeHtml(details.basename)}</span>
                </div>
            `;
        }).join('');

        messageDiv.innerHTML = `
            <div class="files-edited-container">
                <div class="files-edited-scroll-row">
                    ${itemsHtml}
                </div>
            </div>
        `;
        messageDiv.appendChild(widgetDiv);
        return messageDiv;
    }
}
