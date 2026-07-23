/**
 * DOMUtils provides reusable DOM creation and SVG helper utilities.
 */
class DOMUtils {
    /**
     * Creates an SVG element with attributes.
     * @param {string} tag SVG element tag name.
     * @param {object} attrs Key-value attribute map.
     * @returns {SVGElement} SVG element.
     */
    static createSvg(tag, attrs = {}) {
        const svgNS = 'http://www.w3.org/2000/svg';
        const el = document.createElementNS(svgNS, tag);
        for (const [key, value] of Object.entries(attrs)) {
            el.setAttribute(key, value);
        }
        return el;
    }

    /**
     * Generates a standard chevron SVG element.
     * @param {string} className CSS class name.
     * @returns {SVGElement} Chevron SVG element.
     */
    static createChevronIcon(className = 'chevron-icon') {
        const svg = DOMUtils.createSvg('svg', {
            class: className,
            width: '8',
            height: '8',
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            'stroke-width': '3',
            'stroke-linecap': 'round',
            'stroke-linejoin': 'round'
        });
        const polyline = DOMUtils.createSvg('polyline', { points: '6 9 12 15 18 9' });
        svg.appendChild(polyline);
        return svg;
    }

    /**
     * Returns chevron SVG markup string for inline HTML templates.
     * @param {string} className CSS class name.
     * @returns {string} SVG HTML string.
     */
    static getChevronSvgString(className = 'thinking-chevron') {
        return `<svg class="${className}" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`;
    }

    /**
     * Returns upwards chevron SVG markup string.
     * @param {string} className CSS class name.
     * @returns {string} SVG HTML string.
     */
    static getChevronUpSvgString(className = 'thinking-chevron') {
        return `<svg class="${className}" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>`;
    }
}
