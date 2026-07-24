document.addEventListener('DOMContentLoaded', () => {
    // Mouseover listener delegation for model text containers
    document.addEventListener('mouseover', (e) => {
        const targetContainer = e.target.closest('.model-text-container') || e.target.closest('.dropdown-trigger') || e.target.closest('.dropdown-item');
        if (!targetContainer) return;

        const container = targetContainer.classList.contains('model-text-container') ? targetContainer : targetContainer.querySelector('.model-text-container');
        if (!container) return;

        const innerSpan = container.querySelector('.model-text-inner');
        if (!innerSpan) return;

        innerSpan.style.flexShrink = '0';
        const containerWidth = container.clientWidth;
        const contentWidth = innerSpan.scrollWidth;
        const overflowAmount = contentWidth - containerWidth;

        if (overflowAmount > 2) {
            container.classList.add('has-overflow');
            const targetOffset = -(overflowAmount + 8);
            const basePauseTime = 1.2;
            const travelSpeed = 22; // px/sec
            const travelTime = (2 * Math.abs(targetOffset)) / travelSpeed;
            const duration = Math.min(24, Math.max(4.5, basePauseTime + travelTime)).toFixed(2);

            container.style.setProperty('--scroll-offset', `${targetOffset}px`);
            container.style.setProperty('--scroll-duration', `${duration}s`);
        } else {
            container.classList.remove('has-overflow');
        }
    }, true);
});
