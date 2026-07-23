/**
 * Kai Agent UI Mockup Client Script
 * 1:1 replica of official ChatUIController.js event handling with container debug borders.
 */
(function() {
    console.log('Kai Agent UI Mockup Loaded - 1:1 ChatUIController.js replica.');

    // State memory for per-model thinking levels
    const modelThinkingMap = {
        'gemini-3.6-flash': 'high',
        'gemini-3.5-flash-lite': 'medium',
        'qwen2.5-coder-7b': 'low',
        'gemma-2-9b': 'minimal'
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
    const chatContainer = document.getElementById('chat-container');

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
        const currentLevel = modelThinkingMap[activeModel] || 'high';
        const levelCapitalized = currentLevel === 'minimal' ? 'Off' : (currentLevel.charAt(0).toUpperCase() + currentLevel.slice(1));
        
        if (modelThinkingBadge) {
            modelThinkingBadge.textContent = `Thinking: ${levelCapitalized}`;
        }

        // Highlight selected model item in list
        const items = document.querySelectorAll('.model-row-item');
        items.forEach(item => {
            if (item.dataset.model === activeModel) {
                item.classList.add('selected');
            } else {
                item.classList.remove('selected');
            }
        });
    }

    /**
     * Updates active state on segmented buttons per model.
     */
    function updateSegmentedButtons() {
        for (const [model, level] of Object.entries(modelThinkingMap)) {
            const btns = document.querySelectorAll(`.segmented-btn[data-model="${model}"]`);
            btns.forEach(btn => {
                if (btn.dataset.level === level) {
                    btn.classList.add('active');
                } else {
                    btn.classList.remove('active');
                }
            });
        }
    }

    // Toggle Model Dropdown Menu
    if (dropdownTriggerBtn && dropdownOptionsMenu) {
        dropdownTriggerBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdownOptionsMenu.classList.toggle('hidden');
        });
    }

    // Close Model Dropdown Menu when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#model-dropdown-container') && dropdownOptionsMenu) {
            dropdownOptionsMenu.classList.add('hidden');
        }
    });

    // Delegated Event Listeners (1:1 with ChatUIController.js)
    if (chatContainer) {
        chatContainer.addEventListener('click', (e) => {
            // 1. Open file in VS Code editor when clicking file cards
            const fileCard = e.target.closest('.file-card');
            if (fileCard) {
                const filePath = fileCard.dataset.filepath || fileCard.querySelector('.file-card-name').textContent;
                alert(`[VS Code Action] Opening file "${filePath}" in VS Code editor.`);
                return;
            }

            // 2. Toggle tool execution result output dropdown (Exact ChatUIController.js code)
            const toolRow = e.target.closest('.tool-status-row');
            if (toolRow) {
                const dropdown = toolRow.querySelector('.tool-result-dropdown');
                if (dropdown) {
                    dropdown.classList.toggle('hidden');
                    toolRow.classList.toggle('expanded');
                }
                return;
            }

            // 3. Collapsible thinking block trigger (Exact ChatUIController.js code)
            const header = e.target.closest('.thinking-header');
            if (header) {
                const content = header.nextElementSibling;
                if (content && content.classList.contains('thinking-content')) {
                    content.classList.toggle('collapsed');
                    const chevron = header.querySelector('.thinking-chevron');
                    if (chevron) {
                        const isCollapsed = content.classList.contains('collapsed');
                        chevron.innerHTML = isCollapsed 
                            ? '<polyline points="6 9 12 15 18 9"></polyline>'
                            : '<polyline points="18 15 12 9 6 15"></polyline>';
                    }
                }
            }
        });
    }

    // Dropdown Categories & Segmented Controls Interaction
    document.addEventListener('click', (e) => {
        // Handle Category Accordion Header Click
        const catHeader = e.target.closest('.dropdown-category-header');
        if (catHeader) {
            e.stopPropagation();
            const cat = catHeader.dataset.category;
            const content = document.getElementById(`cat-${cat}`);
            if (content) {
                content.classList.toggle('collapsed');
            }
            return;
        }

        // Handle Segmented Thinking Button Click
        const segBtn = e.target.closest('.segmented-btn');
        if (segBtn) {
            e.stopPropagation();
            const model = segBtn.dataset.model;
            const level = segBtn.dataset.level;
            if (model && level) {
                modelThinkingMap[model] = level;
                updateSegmentedButtons();
                updateActiveModelDisplay();
            }
            return;
        }

        // Handle Model Selection Row Click
        const modelRow = e.target.closest('.model-row-item');
        if (modelRow) {
            e.stopPropagation();
            const model = modelRow.dataset.model;
            if (model) {
                activeModel = model;
                updateActiveModelDisplay();
                if (dropdownOptionsMenu) {
                    dropdownOptionsMenu.classList.add('hidden');
                }
            }
            return;
        }
    });

    // Initial render
    updateSegmentedButtons();
    updateActiveModelDisplay();
})();
