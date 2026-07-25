/**
 * Kai Settings UI Mockup Interactive Script.
 */
document.addEventListener('DOMContentLoaded', () => {
    // Accordion Category Toggles
    const categoryBtns = document.querySelectorAll('.category-header-btn');
    categoryBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const categoryEl = btn.closest('.settings-category');
            if (categoryEl) {
                categoryEl.classList.toggle('collapsed');
            }
        });
    });

    // Mock Custom Select Component Creation
    function createMockSelect(containerId, options, initialValue, onChange) {
        const container = document.getElementById(containerId);
        if (!container) return;

        let currentValue = initialValue;

        const triggerBtn = document.createElement('button');
        triggerBtn.type = 'button';
        triggerBtn.className = 'mock-select-trigger';

        const labelSpan = document.createElement('span');
        triggerBtn.appendChild(labelSpan);

        const chevronSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        chevronSvg.setAttribute('width', '8');
        chevronSvg.setAttribute('height', '8');
        chevronSvg.setAttribute('viewBox', '0 0 24 24');
        chevronSvg.setAttribute('fill', 'none');
        chevronSvg.setAttribute('stroke', 'currentColor');
        chevronSvg.setAttribute('stroke-width', '3');
        chevronSvg.innerHTML = '<polyline points="6 9 12 15 18 9"></polyline>';
        triggerBtn.appendChild(chevronSvg);

        const menuEl = document.createElement('div');
        menuEl.className = 'mock-select-menu hidden';

        function updateUI() {
            const currentOpt = options.find(o => o.value === currentValue) || options[0];
            labelSpan.textContent = currentOpt.label;

            menuEl.innerHTML = '';
            options.forEach(opt => {
                const optBtn = document.createElement('button');
                optBtn.type = 'button';
                const isSelected = opt.value === currentValue;
                optBtn.className = `mock-select-option ${isSelected ? 'selected' : ''}`;
                
                const optText = document.createElement('span');
                optText.textContent = opt.label;
                optBtn.appendChild(optText);

                if (isSelected) {
                    const checkSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                    checkSvg.setAttribute('width', '12');
                    checkSvg.setAttribute('height', '12');
                    checkSvg.setAttribute('viewBox', '0 0 24 24');
                    checkSvg.setAttribute('fill', 'none');
                    checkSvg.setAttribute('stroke', 'currentColor');
                    checkSvg.setAttribute('stroke-width', '2.5');
                    checkSvg.innerHTML = '<polyline points="20 6 9 17 4 12"></polyline>';
                    optBtn.appendChild(checkSvg);
                }

                optBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    currentValue = opt.value;
                    updateUI();
                    menuEl.classList.add('hidden');
                    triggerBtn.classList.remove('active');
                    if (typeof onChange === 'function') {
                        onChange(currentValue);
                    }
                });

                menuEl.appendChild(optBtn);
            });
        }

        triggerBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            menuEl.classList.toggle('hidden');
            triggerBtn.classList.toggle('active');
        });

        document.addEventListener('click', (e) => {
            if (!container.contains(e.target)) {
                menuEl.classList.add('hidden');
                triggerBtn.classList.remove('active');
            }
        });

        updateUI();
        container.appendChild(triggerBtn);
        container.appendChild(menuEl);
    }

    // Initialize Language Select in Mockup
    createMockSelect(
        'mock-lang-container',
        [
            { value: 'auto', label: 'Auto (VS Code)' },
            { value: 'en', label: 'English' },
            { value: 'nl', label: 'Nederlands' },
            { value: 'de', label: 'Deutsch' },
            { value: 'fr', label: 'Français' },
            { value: 'es', label: 'Español' }
        ],
        'auto',
        (val) => console.log('Language changed:', val)
    );

    // Initialize Thinking Display Format Select in Mockup (Icon + Text, Icon Only, Text Only)
    createMockSelect(
        'mock-style-container',
        [
            { value: 'both', label: 'Icon + Text' },
            { value: 'icon', label: 'Icon Only' },
            { value: 'text', label: 'Text Only' }
        ],
        'both',
        (val) => console.log('Thinking Display Format changed:', val)
    );

    // Mock Show Thinking Toggle
    const mockShowToggle = document.getElementById('mock-show-thinking');
    const mockSubsettings = document.getElementById('mock-subsettings');
    if (mockShowToggle && mockSubsettings) {
        mockShowToggle.addEventListener('change', () => {
            if (mockShowToggle.checked) {
                mockSubsettings.style.display = 'flex';
            } else {
                mockSubsettings.style.display = 'none';
            }
        });
    }
});
