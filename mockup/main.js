/**
 * Kai Agent UI Mockup Client Script
 * Demonstrates interactive behavior for resizable sidebar width, tool result dropdowns, and file opening.
 */
(function() {
    console.log('Kai Agent UI Mockup Loaded - Resizable sidebar & container hierarchy initialized.');

    // DOM Elements
    const sidebarWrapper = document.getElementById('sidebar-wrapper');
    const resizeHandle = document.getElementById('resize-handle');
    const widthIndicator = document.getElementById('width-indicator');

    let isResizing = false;

    // Sidebar Resize Dragging Logic
    if (resizeHandle && sidebarWrapper) {
        resizeHandle.addEventListener('mousedown', (e) => {
            isResizing = true;
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            const ideRect = sidebarWrapper.parentElement.getBoundingClientRect();
            const newWidth = Math.max(200, Math.min(700, e.clientX - ideRect.left));
            sidebarWrapper.style.width = `${newWidth}px`;
            if (widthIndicator) {
                widthIndicator.textContent = `Width: ${Math.round(newWidth)}px`;
            }
        });

        document.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
            }
        });
    }

    // Interactive Delegated Event Handlers
    document.addEventListener('click', (e) => {
        // Toggle Tool Result Dropdown Output
        const toolContainer = e.target.closest('.tool-call-container');
        if (toolContainer) {
            const dropdown = toolContainer.querySelector('.tool-result-dropdown');
            if (dropdown) {
                dropdown.classList.toggle('hidden');
                toolContainer.classList.toggle('expanded');
            }
            return;
        }

        // Handle File Card Click (Simulates VS Code file opening)
        const fileCard = e.target.closest('.file-card');
        if (fileCard) {
            const filepath = fileCard.dataset.filepath || fileCard.querySelector('.file-card-name').textContent;
            alert(`[VS Code Action] Opening file "${filepath}" in VS Code editor.`);
            return;
        }

        // Toggle Thinking Process Content
        const thinkingHeader = e.target.closest('.thinking-header');
        if (thinkingHeader) {
            const block = thinkingHeader.closest('.thinking-block');
            const content = block ? block.querySelector('.thinking-content') : null;
            if (content) {
                content.classList.toggle('hidden');
            }
        }
    });
})();
