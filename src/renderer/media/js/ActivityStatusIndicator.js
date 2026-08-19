/**
 * ActivityStatusIndicator manages the floating bottom status pill
 * displayed during background tasks or streaming generations.
 */
class ActivityStatusIndicator {
    /**
     * Shows or updates the floating activity status badge.
     * @param {HTMLElement} container Parent chat container.
     * @param {string} text Status label text.
     * @returns {HTMLElement} The created or updated status element.
     */
    static show(container, text) {
        if (!container) return null;

        let statusDiv = document.getElementById('activity-status-indicator');
        if (!statusDiv) {
            statusDiv = document.createElement('div');
            statusDiv.id = 'activity-status-indicator';
            statusDiv.className = 'activity-status-pill';
            container.appendChild(statusDiv);
        }

        const svgs = (typeof window !== 'undefined' && window.KAI_SVGS) || {};
        const spinner = svgs['spinner'] || '<span class="thinking-spinner"></span>';
        const safeText = typeof DOMUtils !== 'undefined' ? DOMUtils.escapeHtml(text) : text;
        statusDiv.innerHTML = `${spinner} <span class="activity-status-label">${safeText}</span>`;
        return statusDiv;
    }

    /**
     * Removes the floating activity status badge if present.
     * @param {HTMLElement} [container] Optional parent container.
     */
    static remove(container = null) {
        const el = (container && container.querySelector('#activity-status-indicator')) || document.getElementById('activity-status-indicator');
        if (el) el.remove();
    }
}
