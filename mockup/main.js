/**
 * Interactive controller script for mockup preview.
 */
document.addEventListener('DOMContentLoaded', () => {
    const options = document.querySelectorAll('.flyout-option');
    options.forEach(opt => {
        opt.addEventListener('click', (e) => {
            e.stopPropagation();
            options.forEach(o => {
                o.classList.remove('selected');
                const existingCheck = o.querySelector('.check-icon');
                if (existingCheck) existingCheck.remove();
            });
            opt.classList.add('selected');
            const checkSpan = document.createElement('span');
            checkSpan.className = 'check-icon';
            checkSpan.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
            opt.appendChild(checkSpan);
        });
    });
});
