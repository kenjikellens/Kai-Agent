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

    /**
     * Generates a standard checkmark SVG element.
     * @param {string} className CSS class name.
     * @returns {SVGElement} Checkmark SVG element.
     */
    static createCheckIcon(className = 'check-icon') {
        const svg = DOMUtils.createSvg('svg', {
            class: className,
            width: '12',
            height: '12',
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            'stroke-width': '2.5',
            'stroke-linecap': 'round',
            'stroke-linejoin': 'round'
        });
        const polyline = DOMUtils.createSvg('polyline', { points: '20 6 9 17 4 12' });
        svg.appendChild(polyline);
        return svg;
    }

    /**
     * Generates a 3-block vector battery SVG element representing thinking level.
     * @param {string|boolean} level Reasoning level ('high', 'medium', 'low', 'minimal', 'off') or boolean (true/false).
     * @param {string} className CSS class name.
     * @returns {SVGElement} Battery SVG element.
     */
    static createBatteryIcon(level = 'high', className = 'thinking-battery-icon') {
        let filledCount = 0;
        if (typeof level === 'boolean') {
            filledCount = level ? 3 : 0;
        } else {
            const normalized = String(level).toLowerCase();
            if (normalized === 'xhigh' || normalized === 'high' || normalized === 'full') {
                filledCount = 3;
            } else if (normalized === 'medium' || normalized === 'med') {
                filledCount = 2;
            } else if (normalized === 'low') {
                filledCount = 1;
            } else {
                filledCount = 0;
            }
        }

        const svg = DOMUtils.createSvg('svg', {
            class: className,
            width: '18',
            height: '10',
            viewBox: '0 0 22 11',
            fill: 'none',
            stroke: 'currentColor'
        });

        const body = DOMUtils.createSvg('rect', {
            x: '1',
            y: '1',
            width: '16',
            height: '9',
            rx: '1.5',
            ry: '1.5',
            'stroke-width': '1.2',
            fill: 'none'
        });
        svg.appendChild(body);

        const tip = DOMUtils.createSvg('path', {
            d: 'M18.5 3.5 V7.5',
            'stroke-width': '1.2',
            'stroke-linecap': 'round'
        });
        svg.appendChild(tip);

        const blockPositions = ['2.5', '7.25', '12'];
        for (let i = 0; i < 3; i++) {
            const isFilled = i < filledCount;
            const block = DOMUtils.createSvg('rect', {
                x: blockPositions[i],
                y: '2.5',
                width: '3.25',
                height: '6',
                rx: '0.75',
                ry: '0.75',
                fill: isFilled ? 'currentColor' : 'none',
                stroke: isFilled ? 'currentColor' : 'rgba(255, 255, 255, 0.2)',
                'stroke-width': isFilled ? '0' : '0.5',
                opacity: isFilled ? '1' : '0.25'
            });
            svg.appendChild(block);
        }

        return svg;
    }
}
