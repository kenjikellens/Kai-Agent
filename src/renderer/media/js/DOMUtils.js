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

    /**
     * Creates a standard Lightbulb SVG element for Thinking toggle controls.
     * @param {string} [className] Optional CSS class name.
     * @returns {SVGElement} The created SVG element.
     */
    static createLightbulbIcon(className = '') {
        const svg = DOMUtils.createSvg('svg', {
            class: className,
            width: '13',
            height: '13',
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            'stroke-width': '2',
            'stroke-linecap': 'round',
            'stroke-linejoin': 'round'
        });
        const path = DOMUtils.createSvg('path', {
            d: 'M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5'
        });
        const line1 = DOMUtils.createSvg('path', { d: 'M9 18h6' });
        const line2 = DOMUtils.createSvg('path', { d: 'M10 22h4' });
        svg.appendChild(path);
        svg.appendChild(line1);
        svg.appendChild(line2);
        return svg;
    }

    /**
     * Creates a standard Gauge / Sliders SVG element for Reasoning Effort controls.
     * @param {string} [className] Optional CSS class name.
     * @returns {SVGElement} The created SVG element.
     */
    static createGaugeIcon(className = '') {
        const svg = DOMUtils.createSvg('svg', {
            class: className,
            width: '13',
            height: '13',
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            'stroke-width': '2',
            'stroke-linecap': 'round',
            'stroke-linejoin': 'round'
        });
        const line1 = DOMUtils.createSvg('line', { x1: '4', y1: '21', x2: '4', y2: '14' });
        const line2 = DOMUtils.createSvg('line', { x1: '4', y1: '10', x2: '4', y2: '3' });
        const line3 = DOMUtils.createSvg('line', { x1: '12', y1: '21', x2: '12', y2: '12' });
        const line4 = DOMUtils.createSvg('line', { x1: '12', y1: '8', x2: '12', y2: '3' });
        const line5 = DOMUtils.createSvg('line', { x1: '20', y1: '21', x2: '20', y2: '16' });
        const line6 = DOMUtils.createSvg('line', { x1: '20', y1: '12', x2: '20', y2: '3' });
        const line7 = DOMUtils.createSvg('line', { x1: '1', y1: '14', x2: '7', y2: '14' });
        const line8 = DOMUtils.createSvg('line', { x1: '9', y1: '8', x2: '15', y2: '8' });
        const line9 = DOMUtils.createSvg('line', { x1: '17', y1: '16', x2: '23', y2: '16' });
        svg.appendChild(line1);
        svg.appendChild(line2);
        svg.appendChild(line3);
        svg.appendChild(line4);
        svg.appendChild(line5);
        svg.appendChild(line6);
        svg.appendChild(line7);
        svg.appendChild(line8);
        svg.appendChild(line9);
        return svg;
    }

    /**
     * Creates a debounced function that delays invocation until after wait milliseconds.
     * @param {Function} func The target function to debounce.
     * @param {number} wait Delay in milliseconds.
     * @returns {Function} Debounced function.
     */
    static debounce(func, wait = 250) {
        let timeout = null;
        return function (...args) {
            const context = this;
            if (timeout) clearTimeout(timeout);
            timeout = setTimeout(() => {
                timeout = null;
                func.apply(context, args);
            }, wait);
        };
    }

    /**
     * Creates a throttled function that limits invocation to at most once per wait window.
     * @param {Function} func The target function to throttle.
     * @param {number} limit Window size in milliseconds.
     * @returns {Function} Throttled function.
     */
    static throttle(func, limit = 50) {
        let inThrottle = false;
        let lastArgs = null;
        let lastContext = null;
        return function (...args) {
            if (!inThrottle) {
                func.apply(this, args);
                inThrottle = true;
                setTimeout(() => {
                    inThrottle = false;
                    if (lastArgs) {
                        func.apply(lastContext, lastArgs);
                        lastArgs = null;
                        lastContext = null;
                    }
                }, limit);
            } else {
                lastArgs = args;
                lastContext = this;
            }
        };
    }

    /**
     * Batches execution of a callback using requestAnimationFrame to eliminate layout thrashing.
     * @param {Function} callback Function to execute on next animation frame.
     * @returns {Function} Wrapped batched trigger function.
     */
    static rafBatch(callback) {
        let rafId = null;
        return function (...args) {
            if (rafId !== null) return;
            rafId = requestAnimationFrame(() => {
                rafId = null;
                callback.apply(this, args);
            });
        };
    }

    /**
     * Escapes unsafe HTML characters in a string to prevent XSS vulnerabilities.
     * @param {string} text Raw string input.
     * @returns {string} Escaped safe HTML string.
     */
    static escapeHtml(text) {
        if (!text) return '';
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
}
