document.addEventListener('DOMContentLoaded', () => {
    /**
     * Checks text overflow for all .model-text-container elements and calculates
     * the exact scroll distance and speed duration needed on hover.
     */
    function updateTextOverflowMetrics() {
        const containers = document.querySelectorAll('.model-text-container');
        
        containers.forEach(container => {
            const innerSpan = container.querySelector('.model-text-inner');
            if (!innerSpan) return;

            // Reset transform & metrics temporarily to measure accurately
            const originalTransform = innerSpan.style.transform;
            innerSpan.style.transform = 'none';

            const containerWidth = container.clientWidth;
            const contentWidth = innerSpan.scrollWidth;
            const overflowAmount = contentWidth - containerWidth;

            if (overflowAmount > 4) {
                // Content overflows container boundary
                container.classList.add('has-overflow');
                
                // Add a small safety padding (e.g. 6px) so the end of text is comfortably visible
                const targetOffset = -(overflowAmount + 6);
                
                // Duration scaled proportionally to text length (between 2.5s and 6s)
                const duration = Math.min(6, Math.max(2.5, overflowAmount / 35)).toFixed(2);
                
                container.style.setProperty('--scroll-offset', `${targetOffset}px`);
                container.style.setProperty('--scroll-duration', `${duration}s`);
            } else {
                container.classList.remove('has-overflow');
                container.style.removeProperty('--scroll-offset');
                container.style.removeProperty('--scroll-duration');
            }

            innerSpan.style.transform = originalTransform;
        });
    }

    // Run initial calculation
    updateTextOverflowMetrics();

    // Recalculate if window resizes
    window.addEventListener('resize', updateTextOverflowMetrics);

    // Dynamic model selection simulation
    const dropdownItems = document.querySelectorAll('.dropdown-menu .dropdown-item:not(.model-hover-item)');
    const selectedModelText = document.getElementById('selected-model-text');

    dropdownItems.forEach(item => {
        item.addEventListener('click', () => {
            const innerText = item.querySelector('.model-text-inner');
            if (innerText && selectedModelText) {
                // Update selected model text in toolbar trigger
                selectedModelText.textContent = innerText.textContent;
                
                // Update selected styling
                document.querySelectorAll('.dropdown-item').forEach(el => el.classList.remove('selected'));
                item.classList.add('selected');

                // Recalculate metrics for the newly updated trigger text
                setTimeout(updateTextOverflowMetrics, 10);
            }
        });
    });
});
