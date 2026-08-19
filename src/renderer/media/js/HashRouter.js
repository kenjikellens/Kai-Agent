/**
 * HashRouter manages URL hash routing (#session-<id>, #settings, #help),
 * route registration, and browser history synchronization.
 */
class HashRouter {
    /**
     * Initializes route handlers and attaches window hashchange event listener.
     * @param {object} [options] Optional configuration options.
     * @param {Function} [options.onSettingsRoute] Callback for #settings route.
     * @param {Function} [options.onHelpRoute] Callback for #help route.
     * @param {Function} [options.onSessionRoute] Callback for #session-<id> route.
     * @param {Function} [options.onDefaultRoute] Callback for default/empty route.
     */
    constructor(options = {}) {
        this.routes = new Map();
        this.options = options;

        if (options.onSettingsRoute) {
            this.register('settings', () => options.onSettingsRoute());
        }
        if (options.onHelpRoute) {
            this.register('help', () => options.onHelpRoute());
        }
        if (options.onSessionRoute) {
            this.register('session-', (sessionId) => options.onSessionRoute(sessionId));
        }

        this._initEventListener();
    }

    /**
     * Registers a route prefix handler.
     * @param {string} prefix Route prefix (e.g. 'session-', 'settings', 'help').
     * @param {Function} handler Callback receiving the remaining hash argument.
     */
    register(prefix, handler) {
        this.routes.set(prefix, handler);
    }

    /**
     * Navigates to a target URL hash.
     * @param {string} hash Target hash string.
     */
    navigate(hash) {
        window.location.hash = hash.startsWith('#') ? hash.substring(1) : hash;
    }

    /**
     * Handles current window.location.hash dispatching to registered routes.
     */
    dispatch() {
        const rawHash = (window.location.hash || '').replace(/^#\/?/, '').trim();
        for (const [prefix, handler] of this.routes.entries()) {
            if (rawHash === prefix || rawHash.startsWith(prefix)) {
                const param = rawHash.startsWith(prefix) ? rawHash.substring(prefix.length) : '';
                handler(param);
                return;
            }
        }

        if (this.options && typeof this.options.onDefaultRoute === 'function') {
            this.options.onDefaultRoute();
        }
    }

    /**
     * Alias for dispatch to handle current route.
     */
    handleRoute() {
        this.dispatch();
    }

    /**
     * Registers window hashchange event listener.
     * @private
     */
    _initEventListener() {
        window.addEventListener('hashchange', () => this.dispatch());
    }
}
