/**
 * PlanCardComponent encapsulates rendering and interactivity for the implementation plan card,
 * including collapsible body toggle and the proceed execution button.
 */
class PlanCardComponent {
    /**
     * Renders an implementation plan card element.
     * @param {string} planHtml Formatted markdown HTML of the implementation plan.
     * @param {boolean} [isExpanded] Whether the card is initially expanded.
     * @param {Function} [onProceed] Optional callback when 'Proceed' button is clicked.
     * @returns {HTMLElement} The created plan card DOM element.
     */
    static render(planHtml, isExpanded = false, onProceed = null) {
        const card = document.createElement('div');
        card.className = `kai-plan-card ${isExpanded ? 'expanded' : ''}`;

        const header = document.createElement('div');
        header.className = 'kai-plan-header';
        header.innerHTML = `
            <div class="kai-plan-title-row">
                <span class="kai-plan-icon">📋</span>
                <span class="kai-plan-title">Implementation Plan</span>
                <span class="kai-plan-badge">Planning Mode</span>
            </div>
            <button type="button" class="kai-plan-toggle-btn">
                <span class="plan-toggle-label">${isExpanded ? 'Show less' : 'Show more'}</span>
                <svg class="plan-toggle-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
            </button>
        `;

        const body = document.createElement('div');
        body.className = 'kai-plan-body';
        body.innerHTML = planHtml;

        if (onProceed) {
            const footer = document.createElement('div');
            footer.className = 'kai-plan-footer';
            const proceedBtn = document.createElement('button');
            proceedBtn.type = 'button';
            proceedBtn.className = 'kai-plan-proceed-btn';
            proceedBtn.innerHTML = '<span>Proceed to Implementation</span> <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>';
            proceedBtn.addEventListener('click', () => onProceed());
            footer.appendChild(proceedBtn);
            card.appendChild(header);
            card.appendChild(body);
            card.appendChild(footer);
        } else {
            card.appendChild(header);
            card.appendChild(body);
        }

        return card;
    }

    /**
     * Toggles expanded state of a plan card element.
     * @param {HTMLElement} headerElement The .kai-plan-header element that was clicked.
     */
    static toggle(headerElement) {
        if (!headerElement) return;
        const card = headerElement.closest('.kai-plan-card');
        if (!card) return;

        const isExpanded = card.classList.toggle('expanded');
        const label = headerElement.querySelector('.plan-toggle-label');
        if (label) {
            label.textContent = isExpanded ? 'Show less' : 'Show more';
        }
    }
}
