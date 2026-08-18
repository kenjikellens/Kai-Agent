/**
 * ToggleComponent provides a reusable UI toggle switch DOM element.
 */
class ToggleComponent {
    /**
     * Creates a reusable switch container DOM element with checkbox and track.
     * @param {object} options Configuration options.
     * @param {string} [options.id] Element ID for the input checkbox.
     * @param {string} [options.label] Display label text next to the toggle.
     * @param {boolean} [options.checked] Initial checked state.
     * @param {Function} [options.onChange] Callback invoked when toggle state changes.
     * @param {string} [options.title] Tooltip title attribute.
     * @returns {HTMLLabelElement} Switch container label element.
     */
    static create({ id, label = '', checked = false, onChange = null, title = '' } = {}) {
        const container = document.createElement('label');
        container.className = 'switch-container';
        if (title) {
            container.title = title;
        }

        const input = document.createElement('input');
        input.type = 'checkbox';
        if (id) {
            input.id = id;
        }
        input.checked = Boolean(checked);

        const track = document.createElement('span');
        track.className = 'slider-track';

        container.appendChild(input);
        container.appendChild(track);

        if (label) {
            const labelSpan = document.createElement('span');
            labelSpan.className = 'switch-label';
            labelSpan.textContent = label;
            container.appendChild(labelSpan);
        }

        if (typeof onChange === 'function') {
            input.addEventListener('change', (e) => {
                onChange(input.checked, e);
            });
        }

        return container;
    }
}
