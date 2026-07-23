/**
 * Kai Agent UI Mockup Client Script
 * Demonstrates interactive per-model thinking selection, hover flyout submenus,
 * model state memory, resizable sidebar width, and tool result dropdowns.
 */
(function() {
    console.log('Kai Agent UI Mockup Loaded - Per-model thinking state & flyout submenus initialized.');

    // Per-Model Thinking State Memory Map
    const modelThinkingMap = {
        'gemini-3.6-flash': 'high',
        'gemini-3.5-flash-lite': 'medium',
        'qwen2.5-coder-7b': 'low'
    };

    let activeModel = 'gemini-3.6-flash';

    // DOM Elements
    const sidebarWrapper = document.getElementById('sidebar-wrapper');
    const resizeHandle = document.getElementById('resize-handle');
    const widthIndicator = document.getElementById('width-indicator');
    const dropdownTriggerBtn = document.getElementById('dropdown-trigger-btn');
    const dropdownOptionsMenu = document.getElementById('dropdown-options-menu');
    const selectedModelText = document.getElementById('selected-model-text');
    const modelThinkingBadge = document.getElementById('model-thinking-badge');

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

    /**
     * Updates active model display text and thinking badge.
     */
    function updateActiveModelDisplay() {
        if (selectedModelText) {
            selectedModelText.textContent = activeModel;
        }
        if (modelThinkingBadge) {
            const currentLevel = modelThinkingMap[activeModel] || 'high';
            const capitalized = currentLevel.charAt(0).toUpperCase() + currentLevel.slice(1);
            modelThinkingBadge.textContent = capitalized;
        }
    }

    /**
     * Updates checkmarks and item pills inside flyout submenus.
     */
    function updateFlyoutPills() {
        for (const [model, level] of Object.entries(modelThinkingMap)) {
            const pill = document.getElementById(`pill-${model}`);
            if (pill) {
                const capitalized = level.charAt(0).toUpperCase() + level.slice(1);
                pill.textContent = capitalized;
            }

            // Update checkmarks in options
            const options = document.querySelectorAll(`.flyout-option[data-model="${model}"]`);
            options.forEach(opt => {
                const check = opt.querySelector('.codicon-check');
                if (check) {
                    if (opt.dataset.level === level) {
                        check.classList.remove('opacity-0');
                    } else {
                        check.classList.add('opacity-0');
                    }
                }
            });
        }
    }

    // Toggle Dropdown Options Menu
    if (dropdownTriggerBtn && dropdownOptionsMenu) {
        dropdownTriggerBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdownOptionsMenu.classList.toggle('hidden');
        });
    }

    // Close Dropdown Menu when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#model-dropdown-container') && dropdownOptionsMenu) {
            dropdownOptionsMenu.classList.add('hidden');
        }
    });

    // Delegated Event Listeners
    document.addEventListener('click', (e) => {
        // Handle Flyout Thinking Level Option Click
        const flyoutOption = e.target.closest('.flyout-option');
        if (flyoutOption) {
            e.stopPropagation();
            const model = flyoutOption.dataset.model;
            const level = flyoutOption.dataset.level;
            if (model && level) {
                modelThinkingMap[model] = level;
                console.log(`[State Update] Set model "${model}" thinking level to "${level}"`);
                updateFlyoutPills();
                updateActiveModelDisplay();
            }
            return;
        }

        // Handle Model Item Selection Click
        const modelItem = e.target.closest('.model-hover-item');
        if (modelItem && !e.target.closest('.thinking-flyout-menu')) {
            e.stopPropagation();
            const model = modelItem.dataset.model;
            if (model) {
                activeModel = model;
                console.log(`[Model Selected] Active model switched to "${activeModel}" with thinking level "${modelThinkingMap[activeModel] || 'high'}"`);
                updateActiveModelDisplay();
                if (dropdownOptionsMenu) {
                    dropdownOptionsMenu.classList.add('hidden');
                }
            }
            return;
        }

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

        // Handle File Card Click
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

    // Initial render
    updateFlyoutPills();
    updateActiveModelDisplay();
})();
