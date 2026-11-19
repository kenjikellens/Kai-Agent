/**
 * WelcomeHeroComponent encapsulates rendering of the welcome hero greeting
 * and quick-action prompt starter pills for empty chat sessions.
 */
class WelcomeHeroComponent {
    /**
     * Renders localized welcome hero greeting and starter prompt buttons into the target chat container.
     * Replaces any prior `.welcome-hero` node inside `container` using plain typography without emojis.
     * @param {HTMLElement} container Parent chat container.
     * @param {object} [options] Customization options and click callbacks.
     * @returns {HTMLElement|null} The created welcome hero DOM element or null.
     */
    static render(container, options = {}) {
        if (!container) return null;

        const oldHero = container.querySelector('.welcome-hero');
        if (oldHero) oldHero.remove();

        const hero = document.createElement('div');
        hero.className = 'welcome-hero';

        const i18n = (typeof window !== 'undefined' && window.KAI_I18N) || {};
        const title = i18n.welcomeTitle || 'Welcome to Kai';
        const subtitle = options.isExtension
            ? (i18n.welcomeSubtitleExt || 'Ask questions about your codebase, edit code, or generate plans.')
            : (i18n.welcomeSubtitleApp || 'Chat freely, calculate, convert, search the web, or manage project tasks.');

        const header = document.createElement('div');
        header.className = 'welcome-hero-header';

        const avatar = document.createElement('div');
        avatar.className = 'welcome-hero-avatar';
        avatar.innerHTML = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8z"></path><path d="M12 6v6l4 2"></path></svg>';

        const titleEl = document.createElement('h2');
        titleEl.className = 'welcome-hero-title';
        titleEl.textContent = title;

        const subEl = document.createElement('p');
        subEl.className = 'welcome-hero-subtitle';
        subEl.textContent = subtitle;

        header.appendChild(avatar);
        header.appendChild(titleEl);
        header.appendChild(subEl);

        const starters = document.createElement('div');
        starters.className = 'welcome-hero-starters';

        const starterDefs = options.isExtension
            ? [
                {
                    label: i18n.starterArchLabel || 'Explain Architecture',
                    prompt: i18n.starterArchPrompt || 'Explain this workspace architecture and main entry points.'
                },
                {
                    label: i18n.starterOptLabel || 'Find Optimizations',
                    prompt: i18n.starterOptPrompt || 'Find potential bugs or optimizations in this codebase.'
                },
                {
                    label: i18n.starterPlanLabel || 'Create Plan',
                    prompt: i18n.starterPlanPrompt || 'Create an implementation plan for adding a new feature.'
                }
            ]
            : [
                {
                    label: i18n.starterCapabilitiesLabel || 'Explore Capabilities',
                    prompt: i18n.starterCapabilitiesPrompt || 'What can you do? Show me your capabilities.'
                },
                {
                    label: i18n.starterCalcLabel || 'Fast Calculation',
                    prompt: i18n.starterCalcPrompt || 'Calculate 25% tip on a $120 dinner bill.'
                },
                {
                    label: i18n.starterSearchLabel || 'Web Search',
                    prompt: i18n.starterSearchPrompt || 'Search the web for the latest TypeScript release highlights.'
                }
            ];

        starterDefs.forEach(item => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'starter-pill';
            btn.dataset.prompt = item.prompt;
            btn.textContent = item.label;
            if (typeof options.onPromptClick === 'function') {
                btn.addEventListener('click', () => options.onPromptClick(item.prompt));
            }
            starters.appendChild(btn);
        });

        hero.appendChild(header);
        hero.appendChild(starters);
        container.appendChild(hero);
        return hero;
    }

    /**
     * Removes the welcome hero from the container if present.
     * @param {HTMLElement} container Parent container.
     */
    static remove(container) {
        if (!container) return;
        const hero = container.querySelector('.welcome-hero');
        if (hero) hero.remove();
    }
}
