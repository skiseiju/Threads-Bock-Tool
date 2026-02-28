import { CONFIG } from './config.js';

export const Utils = {
    _myUsername: null,
    getMyUsername: () => {
        if (Utils._myUsername) return Utils._myUsername;

        // Approach: Find the profile link in the navigation bar
        const allLinks = document.querySelectorAll('a[href^="/@"]');
        for (let a of allLinks) {
            // Usually the navigation bar links are outside the main feed role
            if (!a.closest('main') && !a.closest('div[role="main"]') && !a.closest('div[data-pressable-container="true"]')) {
                // Profile nav link usually has an SVG or no text
                if (a.textContent.trim() === '' || a.querySelector('svg')) {
                    const href = a.getAttribute('href');
                    if (href) {
                        const u = href.split('/@')[1].split('/')[0];
                        if (u) {
                            Utils._myUsername = u;
                            return u;
                        }
                    }
                }
            }
        }
        return null;
    },
    sleep: (ms) => new Promise(r => setTimeout(r, ms)),

    log: (msg) => {
        if (!CONFIG.DEBUG_MODE) return;
        console.log(`[RightBlock] ${msg}`);
        // Dispatch to UI console if available
        if (window.hegeLogUI) window.hegeLogUI(msg);
    },

    simClick: (element) => {
        if (!element) return;
        const opts = { bubbles: true, cancelable: true, view: window };

        // Touch events for iOS/Mobile/React
        if (typeof TouchEvent !== 'undefined') {
            element.dispatchEvent(new TouchEvent('touchstart', opts));
            element.dispatchEvent(new TouchEvent('touchend', opts));
        }

        element.dispatchEvent(new MouseEvent('mousedown', opts));
        element.dispatchEvent(new MouseEvent('mouseup', opts));
        element.click();
    },

    isMobile: () => {
        const isIPad = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || isIPad;
        return isIOS || /Android|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    },

    // Trusted Types Policy for Meta sites
    htmlPolicy: null,
    getPolicy: () => {
        if (Utils.htmlPolicy) return Utils.htmlPolicy;
        if (window.trustedTypes && window.trustedTypes.createPolicy) {
            try {
                Utils.htmlPolicy = window.trustedTypes.createPolicy('hege_policy', {
                    createHTML: (string) => string
                });
            } catch (e) {
                console.warn('[RightBlock] Policy creation failed', e);
                // Fallback: simple object to pass-through if policy exists but creation failed (e.g. duplicate name)
                // Try to find existing? Hard. Just return mock if fail.
                Utils.htmlPolicy = { createHTML: s => s };
            }
        } else {
            Utils.htmlPolicy = { createHTML: s => s };
        }
        return Utils.htmlPolicy;
    },

    setHTML: (element, html) => {
        // Method 1: Trusted Types Policy
        if (window.trustedTypes && window.trustedTypes.createPolicy) {
            try {
                const policy = Utils.getPolicy();
                element.innerHTML = policy.createHTML(html);
                return;
            } catch (e) {
                // Policy failed, fall through to parser
            }
        }

        // Method 2: DOMParser (Bypasses innerHTML sink)
        // Note: Scripts won't execute, which is what we want for UI.
        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            element.innerHTML = '';
            // Move children
            while (doc.body.firstChild) {
                element.appendChild(doc.body.firstChild);
            }
        } catch (e) {
            console.error('[RightBlock] setHTML failed', e);
            // Last resort
            element.innerHTML = html;
        }
    }
};
