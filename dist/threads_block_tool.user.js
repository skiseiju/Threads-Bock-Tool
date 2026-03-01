// ==UserScript==
// @name         留友封 (Threads 封鎖工具)
// @namespace    http://tampermonkey.net/
// @version      2.0.7
// @description  Modular Refactor Build
// @author       海哥
// @match        https://www.threads.net/*
// @match        https://threads.net/*
// @match        https://www.threads.com/*
// @match        https://threads.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=threads.net
// @grant        none
// ==/UserScript==

(function() {
    'use strict';
    console.log('[HegeBlock] Content Script Injected, Version: 2.0.7');
// --- config.js ---
const CONFIG = {
    VERSION: '2.0.7', // Fix Worker internal nav Universal Links
    DEBUG_MODE: true,
    DB_KEY: 'hege_block_db_v1',
    KEYS: {
        PENDING: 'hege_pending_users',
        BG_STATUS: 'hege_bg_status',
        BG_QUEUE: 'hege_active_queue',
        BG_CMD: 'hege_bg_command',
        IOS_MODE: 'hege_ios_active',
        MAC_MODE: 'hege_mac_mode',
        COOLDOWN: 'hege_rate_limit_until',
        VERSION_CHECK: 'hege_version_check',
        POS: 'hege_panel_pos',
        STATE: 'hege_panel_state',
        DISCLAIMER_AGREED: 'hege_disclaimer_agreed_v2_1',
        FAILED_QUEUE: 'hege_failed_queue'
    },
    SELECTORS: {
        MORE_SVG: 'svg[aria-label="更多"], svg[aria-label="More"]',
        MENU_ITEM: 'div[role="menuitem"], div[role="button"]',
        DIALOG: 'div[role="dialog"]',
        DIALOG_HEADER: 'div[role="dialog"] h1',
        DIALOG_USER_LINK: 'div[role="dialog"] div.html-div a[href^="/@"]',
    }
};

// --- utils.js ---


const Utils = {
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

// --- storage.js ---
// Simple Adapter for LocalStorage / SessionStorage with Memory Cache
const Storage = {
    cache: {},
    sessionCache: {},

    get: (key, defaultVal = null) => {
        if (Storage.cache[key] !== undefined) return Storage.cache[key];
        const val = localStorage.getItem(key);
        Storage.cache[key] = val !== null ? val : defaultVal;
        return Storage.cache[key];
    },
    set: (key, value) => {
        Storage.cache[key] = value;
        localStorage.setItem(key, value);
    },
    remove: (key) => {
        delete Storage.cache[key];
        localStorage.removeItem(key);
    },
    invalidate: (key) => {
        delete Storage.cache[key];
    },
    getJSON: (key, defaultVal = []) => {
        let parsed;
        if (Storage.cache[key] !== undefined && typeof Storage.cache[key] !== 'string') {
            parsed = Storage.cache[key];
        } else {
            const val = localStorage.getItem(key);
            try {
                parsed = val ? JSON.parse(val) : defaultVal;
                Storage.cache[key] = parsed;
            } catch (e) {
                parsed = defaultVal;
            }
        }
        // Return a clone to prevent accidental reference mutation bugs across contexts
        return Array.isArray(parsed) ? [...parsed] : (typeof parsed === 'object' && parsed !== null ? { ...parsed } : parsed);
    },
    setJSON: (key, value) => {
        Storage.cache[key] = value;
        localStorage.setItem(key, JSON.stringify(value));
    },

    // Session Storage
    getSessionJSON: (key, defaultVal = []) => {
        let parsed;
        if (Storage.sessionCache[key] !== undefined) {
            parsed = Storage.sessionCache[key];
        } else {
            const val = sessionStorage.getItem(key);
            try {
                parsed = val ? JSON.parse(val) : defaultVal;
                Storage.sessionCache[key] = parsed;
            } catch (e) {
                parsed = defaultVal;
            }
        }
        // Return a clone
        return Array.isArray(parsed) ? [...parsed] : (typeof parsed === 'object' && parsed !== null ? { ...parsed } : parsed);
    },
    setSessionJSON: (key, value) => {
        Storage.sessionCache[key] = value;
        sessionStorage.setItem(key, JSON.stringify(value));
    }
};

// --- ui.js ---




const UI = {
    injectStyles: () => {
        const style = document.createElement('style');
        style.textContent = `
            .hege-checkbox-container {
                position: absolute; right: -8px; top: 50%; transform: translateY(-50%);
                width: 36px; height: 36px; z-index: 1000;
                display: flex; align-items: center; justify-content: center;
                border-radius: 50%; cursor: pointer; transition: background-color 0.2s;
            }
            .hege-checkbox-container:hover { background-color: rgba(255, 255, 255, 0.1); }
            .hege-svg-icon { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 2; color: rgb(119, 119, 119); transition: all 0.2s; }
            @media (prefers-color-scheme: dark) { .hege-svg-icon { color: rgb(119, 119, 119); } }
            @media (prefers-color-scheme: light) { .hege-svg-icon { color: rgb(153, 153, 153); } .hege-checkbox-container:hover { background-color: rgba(0, 0, 0, 0.05); } }
            
            .hege-checkbox-container.checked .hege-svg-icon { color: #ff3b30; fill: #ff3b30; stroke: none; transform: scale(1.1); }
            .hege-checkmark { display: none; stroke: white; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
            .hege-checkbox-container.checked .hege-checkmark { display: block; }

            .hege-checkbox-container.finished { opacity: 0.6; }
            .hege-checkbox-container.finished .hege-svg-icon { color: #555; }
            .hege-checkbox-container:active { transform: translateY(-50%) scale(0.9); }
            
            .hege-block-all-btn {
                display: flex; align-items: center; justify-content: center;
                gap: 6px; padding: 6px 12px; margin-left: 12px;
                background-color: rgba(255, 59, 48, 0.1); color: #ff3b30;
                border: 1px solid rgba(255, 59, 48, 0.3); border-radius: 16px;
                font-size: 14px; font-weight: bold; cursor: pointer;
                transition: all 0.2s;
            }
            .hege-block-all-btn:hover { background-color: rgba(255, 59, 48, 0.2); }
            .hege-block-all-btn:active { transform: scale(0.95); }
            .hege-block-all-btn svg { width: 16px; height: 16px; }

            #hege-panel {
                position: fixed; z-index: 2147483647;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                user-select: none;
            }

            #hege-header {
                background: #101010; color: #fff;
                padding: 8px 12px;
                border-radius: 18px;
                border: 1px solid #333;
                font-weight: bold; font-size: 14px;
                cursor: pointer;
                display: flex; align-items: center; justify-content: space-between;
                box-shadow: 0 2px 5px rgba(0,0,0,0.3);
            }
            #hege-toggle { font-size: 10px; opacity: 0.7; margin-left: 6px; }

            #hege-panel.minimized .hege-content { display: none; }
            
            #hege-panel:not(.minimized) .hege-content {
                 position: absolute; 
                 top: 100%; right: 0;
                 margin-top: 8px; /* Gap */
                 background: #181818; 
                 border: 1px solid #333;
                 border-radius: 16px;
                 width: 240px;
                 box-shadow: 0 4px 20px rgba(0,0,0,0.6);
                 overflow: hidden;
                 display: flex; flex-direction: column;
            }

            .hege-menu-item {
                padding: 14px 16px;
                color: #f5f5f5;
                font-size: 15px;
                font-weight: 500;
                cursor: pointer;
                border-bottom: 1px solid #2a2a2a;
                display: flex; justify-content: space-between; align-items: center;
                transition: background 0.1s;
            }
            .hege-menu-item:hover { background: #222; }
            .hege-menu-item:last-child { border-bottom: none; }
            
            .hege-menu-item.danger { color: #ff3b30; }
            .hege-menu-item .status { font-size: 12px; color: #888; }
            
            #hege-bg-status { padding: 4px 16px; font-size: 11px; color: #4cd964; background: #1a1a1a; display: none; }
            body.hege-ghost-mode div[role="menu"], body.hege-ghost-mode div[role="dialog"] { opacity: 0 !important; pointer-events: auto !important; }
            
            #hege-disclaimer-overlay {
                position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                background: rgba(0,0,0,0.85); z-index: 2147483647;
                display: flex; align-items: center; justify-content: center;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            }
            #hege-disclaimer-box {
                background: #181818; border: 1px solid #333; border-radius: 16px;
                padding: 24px; max-width: 85%; width: 400px;
                color: #f5f5f5; text-align: center;
                box-shadow: 0 10px 40px rgba(0,0,0,0.8);
            }
            #hege-disclaimer-title { font-size: 18px; font-weight: bold; margin-bottom: 16px; color: #fff; }
            #hege-disclaimer-text { font-size: 14px; line-height: 1.5; color: #ccc; margin-bottom: 24px; text-align: left; background: #222; padding: 12px; border-radius: 8px; }
            #hege-disclaimer-btn {
                background: #fff; color: #000; border: none; padding: 10px 32px;
                border-radius: 30px; font-size: 15px; font-weight: 600; cursor: pointer;
                transition: transform 0.1s;
            }
            #hege-disclaimer-btn:active { transform: scale(0.95); }
        `;
        (document.head || document.documentElement).appendChild(style);
    },

    createPanel: (callbacks) => {
        const isMinimized = Storage.get(CONFIG.KEYS.STATE, 'true') === 'true';
        const isMobile = Utils.isMobile();

        const panel = document.createElement('div');
        panel.id = 'hege-panel';
        panel.className = isMinimized ? 'minimized' : '';

        const htmlContent = `
            <div id="hege-header">
                <div>留友封 <span id="hege-queue-badge" style="font-size:12px; color:#4cd964; margin-left:4px;"></span></div>
                <span id="hege-toggle">${isMinimized ? '▼' : '▲'}</span>
            </div>
            <div class="hege-content">
                <div id="hege-bg-status">執行狀態...</div>
                
                <div class="hege-menu-item" id="hege-main-btn-item">
                    <span>開始封鎖</span>
                    <span class="status" id="hege-sel-count">0 選取</span>
                </div>

                <div class="hege-menu-item" id="hege-clear-sel-item">
                    <span>清除選取</span>
                </div>
                
                <div class="hege-menu-item" id="hege-import-item">
                    <span>匯入名單</span>
                </div>
                
                <div class="hege-menu-item" id="hege-export-item">
                    <span>匯出紀錄</span>
                </div>
                
                <div class="hege-menu-item danger" id="hege-retry-failed-item" style="display:none;">
                    <span>重試失敗清單</span>
                    <span class="status" id="hege-failed-count">0</span>
                </div>
                
                <!-- Use isMobile from Utils -->
                <div class="hege-menu-item" id="hege-mode-toggle-item" style="border-top:1px solid #333; display: ${isMobile ? 'none' : 'flex'};">
                    <span>模式: <span id="hege-mode-text">自動</span></span>
                    <span class="status" id="hege-mode-desc"></span>
                </div>

                <div class="hege-menu-item danger" id="hege-clear-db-item">
                    <span>清除所有歷史</span>
                </div>
                
                <div class="hege-menu-item danger" id="hege-stop-btn-item" style="border-top:1px solid #333; display:none;">
                    <span>停止執行</span>
                </div>
            </div>
        `;
        Utils.setHTML(panel, htmlContent);
        document.body.appendChild(panel);

        // Bind Events
        const bindClick = (id, handler) => {
            if (!handler) return;
            const el = document.getElementById(id);
            if (!el) return;
            // The UI panel uses standard click events securely because it floats at the body level
            // away from any <a> tags. Using touchend + preventDefault here breaks iOS window.open permissions.
            el.addEventListener('click', handler);
        };

        document.getElementById('hege-toggle').onclick = () => {
            const min = !panel.classList.contains('minimized');
            panel.classList.toggle('minimized', min);
            Storage.set(CONFIG.KEYS.STATE, min);
            document.getElementById('hege-toggle').textContent = min ? '▼' : '▲';
        };

        bindClick('hege-main-btn-item', callbacks.onMainClick);
        bindClick('hege-clear-sel-item', callbacks.onClearSel);
        bindClick('hege-clear-db-item', callbacks.onClearDB);
        bindClick('hege-import-item', callbacks.onImport);
        bindClick('hege-export-item', callbacks.onExport);
        bindClick('hege-retry-failed-item', callbacks.onRetryFailed);
        bindClick('hege-stop-btn-item', callbacks.onStop);
        bindClick('hege-mode-toggle-item', callbacks.onModeToggle);

        // Header click toggles too
        document.getElementById('hege-header').onclick = (e) => {
            if (e.target.id !== 'hege-toggle') document.getElementById('hege-toggle').click();
        };

        // Auto-collapse on outside click
        document.addEventListener('click', (e) => {
            const p = document.getElementById('hege-panel');
            if (p && !p.classList.contains('minimized') && !p.contains(e.target) && !e.target.closest('#hege-panel')) {
                p.classList.add('minimized');
                Storage.set(CONFIG.KEYS.STATE, 'true');
                const t = document.getElementById('hege-toggle');
                if (t) t.textContent = '▼';
            }
        });

        return panel;
    },

    showToast: (msg, duration = 2500) => {
        const exist = document.getElementById('hege-toast');
        if (exist) exist.remove();
        const toast = document.createElement('div');
        toast.id = 'hege-toast'; toast.textContent = msg;
        toast.style.cssText = `
            position: fixed; top: 10%; left: 50%; transform: translateX(-50%);
            background: rgba(0, 180, 0, 0.95); color: white; padding: 12px 24px;
            border-radius: 50px; font-size: 16px; font-weight: bold; z-index: 2147483647;
            box-shadow: 0 5px 20px rgba(0,0,0,0.5); pointer-events: none;
            transition: opacity 0.5s; font-family: system-ui; text-align: center;
        `;
        (document.body || document.documentElement).appendChild(toast);
        setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 500); }, duration);
    },

    updateDebugLog: (msg) => {
        // Console only requested
        console.log(`[HegeUI] ${msg}`);
    },

    anchorPanel: () => {
        const panel = document.getElementById('hege-panel');
        if (!panel) return;

        // Optimization: Try to find anchor in a more restricted scope first
        let anchor = null;
        const navSelectors = ['div[role="navigation"]', 'header', 'nav', 'div[style*="position: fixed"]'];

        for (const selector of navSelectors) {
            const container = document.querySelector(selector);
            if (!container) continue;

            const svgs = container.querySelectorAll('svg');
            for (let svg of svgs) {
                const label = (svg.getAttribute('aria-label') || '').trim();
                if (label === '功能表' || label === 'Menu' || label === 'Settings' || label === '設定' || label === '更多選項') {
                    anchor = svg.closest('div[role="button"]') || svg;
                    break;
                }
                const rects = svg.querySelectorAll('rect, line');
                if (rects.length === 2 && svg.getBoundingClientRect().top < 100) {
                    anchor = svg.closest('div[role="button"]') || svg;
                    break;
                }
            }
            if (anchor) break;
        }

        // Fallback to broader search only if needed and not recently checked
        if (!anchor) {
            const svgs = document.querySelectorAll('svg');
            for (let svg of svgs) {
                const label = (svg.getAttribute('aria-label') || '').trim();
                if (label === '功能表' || label === 'Menu' || label === 'Settings' || label === '設定' | label === '更多選項') {
                    anchor = svg.closest('div[role="button"]') || svg;
                    break;
                }
            }
        }

        if (anchor) {
            const rect = anchor.getBoundingClientRect();
            // Visibility Check: Ensure the anchor is actually visible
            if (rect.width > 0 && rect.height > 0 && rect.top >= 0) {
                panel.style.top = (rect.top) + 'px';
                let rightVal = window.innerWidth - rect.left + 5;
                rightVal = rightVal - 3;
                if (window.innerWidth < 450) {
                    if (rightVal < 0) rightVal = 0;
                    if (rightVal > window.innerWidth - 100) rightVal = 10;
                }
                panel.style.right = rightVal + 'px';
                panel.style.left = 'auto';
                if (CONFIG.DEBUG_MODE) console.log(`[留友封] Menu Anchored at ${rect.top}px`);
            }
        } else {
            // console.log('[留友封] No Anchor Found - Using Fallback Position');
            // Force visible on top
            if (!panel.style.top || parseInt(panel.style.top) > 200 || parseInt(panel.style.top) < 50) {
                panel.style.top = '85px';
                panel.style.right = '16px';
                panel.style.left = 'auto';
                panel.style.zIndex = '1000000';
                panel.style.display = 'block';

                // Visual Debugging: Force dimensions and color
                panel.style.minWidth = '50px';
                panel.style.minHeight = '20px';
                // panel.style.border = '2px solid red'; // Uncomment if needed, but 'Test' text below is better

                // Content Check
                if (panel.innerHTML.trim().length === 0) {
                    console.error('[留友封] Panel is empty! Re-injecting...');
                    panel.textContent = 'Err: Empty Panel';
                    panel.style.background = 'red';
                    panel.style.color = 'white';
                    panel.style.padding = '10px';
                }
            }
        }
    },

    showDisclaimer: (onConfirm) => {
        if (document.getElementById('hege-disclaimer-overlay')) return;

        const overlay = document.createElement('div');
        overlay.id = 'hege-disclaimer-overlay';
        overlay.innerHTML = `
            <div id="hege-disclaimer-box">
                <div id="hege-disclaimer-title">使用前說明</div>
                <div id="hege-disclaimer-text">
                    本擴充功能「留友封」僅供輔助過濾資訊，請依個人使用習慣斟酌，若因社群平台政策更動導致失效或異常，開發者不負相關責任。
                </div>
                <button id="hege-disclaimer-btn">我同意並繼續</button>
            </div>
        `;
        (document.body || document.documentElement).appendChild(overlay);

        document.getElementById('hege-disclaimer-btn').onclick = () => {
            overlay.remove();
            if (onConfirm) onConfirm();
        };
    }
};

// --- core.js ---





const Core = {
    blockQueue: new Set(),
    pendingUsers: new Set(),
    lastClickedBtn: null, // Track for shift-click
    lastClickedUsername: null, // Fallback if DOM node is lost
    lastClickedState: null, // null, 'checked', or 'unchecked'

    init: () => {
        Core.pendingUsers = new Set(Storage.getSessionJSON(CONFIG.KEYS.PENDING));

        const hasAgreed = Storage.get(CONFIG.KEYS.DISCLAIMER_AGREED);

        if (!hasAgreed) {
            UI.showDisclaimer(() => {
                Storage.set(CONFIG.KEYS.DISCLAIMER_AGREED, 'true');
                Core.startScanner();
            });
        } else {
            Core.startScanner();
        }
    },

    observer: null,
    startScanner: () => {
        // Optimization: Use MutationObserver instead of fixed interval for most cases
        if (Core.observer) Core.observer.disconnect();

        Core.observer = new MutationObserver((mutations) => {
            let shouldScan = false;
            let dialogChanged = false;
            for (const mutation of mutations) {
                if (mutation.addedNodes.length > 0) {
                    shouldScan = true;
                    dialogChanged = true;
                    break;
                }
            }
            if (shouldScan) Core.scanAndInject();
            if (dialogChanged) Core.injectDialogBlockAll();
        });

        Core.observer.observe(document.body, { childList: true, subtree: true });

        // Backup polling (much slower) just in case
        setInterval(Core.scanAndInject, 5000);
        Core.scanAndInject();

        // React often swallows events or stops propagation.
        // We now bind `addEventListener('click', Core.handleGlobalClick, true)` 
        // directly to the initialized containers instead of window to prevent click-through.
    },

    saveToDB: (username) => {
        if (!username) return;
        username = username.replace('@', '').trim();
        let dbArray = Storage.getJSON(CONFIG.KEYS.DB_KEY, []);
        let db = new Set(dbArray);
        if (!db.has(username)) {
            db.add(username);
            Storage.setJSON(CONFIG.KEYS.DB_KEY, [...db]);
        }
    },

    injectDialogBlockAll: () => {
        const headers = document.querySelectorAll('h1, h2');
        let header = null;
        let titleText = '';

        for (let h of headers) {
            const text = h.innerText.trim();

            // We want to lock onto these specific dialog keywords:
            // "貼文動態" (Post Activity), "讚" (Likes), "Likes"
            if (text.includes('貼文動態') || text.includes('讚') || text.includes('Likes')) {
                // Ignore the main page "Threads" header if somehow it matched
                if (text === 'Threads') continue;

                // Extra safety: make sure it's inside a dialog or at least not the main nav
                let isDialog = false;
                let p = h.parentElement;
                for (let i = 0; i < 6; i++) {
                    if (p && p.getAttribute('role') === 'dialog') { isDialog = true; break; }
                    if (p) p = p.parentElement;
                }

                // With specific keywords, we can be more confident, but let's enforce dialog
                // or just allow it if the text is exactly '貼文動態' since it's highly specific.
                if (isDialog || text === '貼文動態') {
                    header = h;
                    titleText = text;
                    break;
                }
            }
        }

        if (!header) return;

        const headerContainer = header.parentElement;
        if (!headerContainer) return;

        // Ensure we haven't already injected the button
        if (headerContainer.dataset.hegeDialogInjected) return;

        // Prevent multiple injections
        headerContainer.dataset.hegeDialogInjected = 'true';

        // Create the Block All Button
        const blockAllBtn = document.createElement('div');
        blockAllBtn.className = 'hege-block-all-btn';
        blockAllBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"></path></svg>
            <span>同列全封</span>
        `;

        const handleBlockAll = (e) => {
            e.stopPropagation();
            e.preventDefault();

            // Scope the search to the modal context (go up 8 levels)
            let ctx = header;
            for (let i = 0; i < 8; i++) {
                if (ctx.parentElement && ctx.parentElement.tagName !== 'BODY') {
                    ctx = ctx.parentElement;
                }
            }

            // Find all user links in the dialog context
            const links = ctx.querySelectorAll('a[href^="/@"]');
            let rawUsers = Array.from(links).map(a => {
                const href = a.getAttribute('href');
                return href.split('/@')[1].split('/')[0];
            });

            // Deduplicate internally
            rawUsers = [...new Set(rawUsers)];

            // Filter out existing DB, Queue, and Pending users
            const db = new Set(Storage.getJSON(CONFIG.KEYS.DB_KEY, []));
            let activeQueue = Storage.getJSON(CONFIG.KEYS.BG_QUEUE, []);
            const activeSet = new Set(activeQueue);

            const newUsers = rawUsers.filter(u => !db.has(u) && !activeSet.has(u) && !Core.pendingUsers.has(u));

            if (newUsers.length === 0) {
                UI.showToast('沒有新帳號可加入 (皆已在歷史或排除中)');
                return;
            }

            const status = Storage.getJSON(CONFIG.KEYS.BG_STATUS, {});
            const isRunning = (Date.now() - (status.lastUpdate || 0) < 10000 && status.state === 'running');

            // Directly add to pending without confirm dialog
            newUsers.forEach(u => Core.pendingUsers.add(u));
            Storage.setSessionJSON(CONFIG.KEYS.PENDING, [...Core.pendingUsers]);

            if (isRunning) {
                const combinedQueue = [...activeQueue, ...Core.pendingUsers];
                Storage.setJSON(CONFIG.KEYS.BG_QUEUE, [...new Set(combinedQueue)]);
                UI.showToast(`已將畫面上 ${newUsers.length} 筆帳號加入背景排隊`);
            } else {
                UI.showToast(`已加入「${Core.pendingUsers.size} 選取」，請至清單「開始封鎖」`);
            }

            // Sync checkbox visually on current page
            document.querySelectorAll('.hege-checkbox-container').forEach(box => {
                if (box.dataset.username && Core.pendingUsers.has(box.dataset.username)) {
                    box.classList.add('checked');
                }
            });

            // CRITICAL: Update floating panel count!
            Core.updateControllerUI();
        };

        if (Utils.isMobile()) {
            blockAllBtn.addEventListener('touchstart', (e) => {
                e.stopPropagation();
            }, { passive: false });

            blockAllBtn.addEventListener('touchend', (e) => {
                // preventDefault stops iOS Safari from firing the synthetic click which triggers Universal Links
                e.stopPropagation();
                e.preventDefault();
                handleBlockAll(e);
            }, { passive: false });
        } else {
            blockAllBtn.addEventListener('click', handleBlockAll);
        }

        headerContainer.style.display = 'flex';
        headerContainer.style.alignItems = 'center';

        // Insert after the h1 so it is placed nicely
        if (header.nextSibling) {
            headerContainer.insertBefore(blockAllBtn, header.nextSibling);
        } else {
            headerContainer.appendChild(blockAllBtn);
        }
    },


    scanAndInject: () => {
        // Performance: Only run if window is active/visible to save CPU
        if (document.hidden) return;

        const moreSvgs = document.querySelectorAll(CONFIG.SELECTORS.MORE_SVG);
        if (moreSvgs.length === 0) return;

        // Optimization: Cache DB lookup
        const db = new Set(Storage.getJSON(CONFIG.KEYS.DB_KEY));

        moreSvgs.forEach(svg => {
            const btn = svg.closest('div[role="button"]');
            if (!btn || !btn.parentElement) return;

            // Check if already processed
            if (btn.getAttribute('data-hege-checked') === 'true') return;
            if (btn.parentElement.querySelector('.hege-checkbox-container')) {
                btn.setAttribute('data-hege-checked', 'true');
                return;
            }

            // SVG filtering
            if (!svg.querySelector('circle') && !svg.querySelector('path')) return;
            const viewBox = svg.getAttribute('viewBox');
            if (viewBox === '0 0 12 12' || viewBox === '0 0 13 12') return;
            const width = svg.style.width ? parseInt(svg.style.width) : 24;
            if (width < 16 && svg.clientWidth < 16) return;

            let username = null;
            try {
                let p = btn.parentElement; let foundLink = null;
                for (let i = 0; i < 5; i++) {
                    if (!p) break;
                    foundLink = p.querySelector('a[href^="/@"]');
                    if (foundLink) break;
                    p = p.parentElement;
                }
                if (foundLink) {
                    username = foundLink.getAttribute('href').split('/@')[1].split('/')[0];
                }
            } catch (e) { }

            if (username && username === Utils.getMyUsername()) {
                // Checkbox should not appear for the user's own account
                btn.setAttribute('data-hege-checked', 'true');
                return;
            }

            btn.setAttribute('data-hege-checked', 'true');
            btn.style.transition = 'transform 0.2s';
            btn.style.transform = 'translateX(-45px)';

            const container = document.createElement('div');
            container.className = 'hege-checkbox-container';

            const svgIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
            svgIcon.setAttribute("viewBox", "0 0 24 24");
            svgIcon.classList.add("hege-svg-icon");

            const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
            rect.setAttribute("x", "2"); rect.setAttribute("y", "2");
            rect.setAttribute("width", "20"); rect.setAttribute("height", "20");
            rect.setAttribute("rx", "6"); rect.setAttribute("ry", "6");
            rect.setAttribute("stroke", "currentColor"); rect.setAttribute("stroke-width", "2.5");
            rect.setAttribute("fill", "none");

            const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
            path.classList.add("hege-checkmark");
            path.setAttribute("d", "M6 12 l4 4 l8 -8");
            path.setAttribute("fill", "none");

            svgIcon.appendChild(rect); svgIcon.appendChild(path);
            container.appendChild(svgIcon);

            if (username) {
                btn.dataset.username = username;
                container.dataset.username = username;
            }

            if (username) {
                if (db.has(username)) {
                    container.classList.add('finished');
                } else if (Core.pendingUsers.has(username)) {
                    container.classList.add('checked');
                    Core.blockQueue.add(btn);
                }
            }

            if (Utils.isMobile()) {
                container.addEventListener('touchstart', (e) => {
                    if (e.target.closest('.hege-checkbox-container')) {
                        e.stopPropagation();
                    }
                }, { passive: false });

                container.addEventListener('touchend', (e) => {
                    if (e.target.closest('.hege-checkbox-container')) {
                        e.stopPropagation();
                        e.preventDefault(); // CRITICAL: Stop iOS from firing synthetic click that triggers Universal Link

                        // Manually trigger handleGlobalClick since we prevented the default synthetic click
                        Core.handleGlobalClick(e);
                    }
                }, { passive: false });
            } else {
                container.ontouchend = (e) => {
                    if (e.target.closest('.hege-checkbox-container')) {
                        e.stopPropagation();
                    }
                };
            }

            container.onmousedown = (e) => {
                if (e.shiftKey) e.preventDefault();
            };

            // Bind directly to the element using a capture phase listener.
            // This is the most bulletproof way to intercept clicks before React or <a> tags steal them.
            container.addEventListener('click', Core.handleGlobalClick, true);

            try {
                const ps = window.getComputedStyle(btn.parentElement).position;
                if (ps === 'static') btn.parentElement.style.position = 'relative';
                btn.parentElement.insertBefore(container, btn);
            } catch (e) { }
        });
    },

    handleGlobalClick: (e) => {
        const container = e.target.closest('.hege-checkbox-container');
        if (!container) return;

        // Stop propagation IMMEDIATELY to prevent opening user profile or React intercepting
        e.stopPropagation();
        e.preventDefault();

        if (CONFIG.DEBUG_MODE) {
            console.log(`[Shift - Click] Container Matched! ShiftKey: ${e.shiftKey}, anchorUsername: ${Core.lastClickedUsername}`);
        }

        // --- Shift-Click Multi-Select Logic ---
        let targetBoxes = [container];
        if (e.shiftKey && (Core.lastClickedBtn || Core.lastClickedUsername)) {
            const allBoxes = Array.from(document.querySelectorAll('.hege-checkbox-container'));
            let lastIdx = allBoxes.indexOf(Core.lastClickedBtn);

            // Fallback: If DOM node was recreated by React, find by username
            if (lastIdx === -1 && Core.lastClickedUsername) {
                lastIdx = allBoxes.findIndex(box => box.dataset.username === Core.lastClickedUsername);
            }

            const currIdx = allBoxes.indexOf(container);

            if (lastIdx !== -1 && currIdx !== -1) {
                const min = Math.min(lastIdx, currIdx);
                const max = Math.max(lastIdx, currIdx);
                targetBoxes = allBoxes.slice(min, max + 1);
                if (CONFIG.DEBUG_MODE) console.log(`[Shift - Click] Processing ${targetBoxes.length} items from index ${min} to ${max}`);
            } else {
                if (CONFIG.DEBUG_MODE) console.log(`[Shift - Click] Failed to establish range.lastIdx: ${lastIdx}, currIdx: ${currIdx}`);
            }
        }

        // Determine intended state based on current container
        const isCurrentlyChecked = container.classList.contains('checked');
        const isCurrentlyFinished = container.classList.contains('finished');

        let targetAction = 'check'; // Check by default
        if (isCurrentlyFinished) {
            targetAction = 'reset';
        } else if (isCurrentlyChecked) {
            targetAction = 'uncheck';
        }

        const currentDB = new Set(Storage.getJSON(CONFIG.KEYS.DB_KEY));

        targetBoxes.forEach(box => {
            const u = box.dataset.username;
            const btnElement = box.parentElement; // Used for blockQueue

            if (targetAction === 'reset' && box.classList.contains('finished')) {
                if (u) {
                    currentDB.delete(u);
                    box.classList.remove('finished');
                    box.classList.add('checked');
                    if (btnElement) btnElement.dataset.username = u; // Ensure dataset exists safely
                    if (btnElement) Core.blockQueue.add(btnElement);
                    Core.pendingUsers.add(u);
                }
            } else if (targetAction === 'uncheck' && box.classList.contains('checked')) {
                box.classList.remove('checked');
                // Remove from queue where username matches
                Array.from(Core.blockQueue).forEach(b => {
                    if (b.dataset && b.dataset.username === u) Core.blockQueue.delete(b);
                });
                if (u) Core.pendingUsers.delete(u);
            } else if (targetAction === 'check' && !box.classList.contains('checked') && !box.classList.contains('finished')) {
                box.classList.add('checked');
                if (btnElement) btnElement.dataset.username = u;
                if (btnElement) Core.blockQueue.add(btnElement);
                if (u) Core.pendingUsers.add(u);
            }
        });

        if (targetAction === 'reset') {
            Storage.setJSON(CONFIG.KEYS.DB_KEY, [...currentDB]);
            UI.showToast('已重置並重新加入排程');
        }

        Storage.setSessionJSON(CONFIG.KEYS.PENDING, [...Core.pendingUsers]);

        Core.lastClickedBtn = container;
        Core.lastClickedUsername = container.dataset.username;
        Core.lastClickedState = targetAction;

        if (CONFIG.DEBUG_MODE) {
            console.log(`[Shift - Click] State saved.next anchorUsername: ${Core.lastClickedUsername}`);
        }

        Core.updateControllerUI();
    },

    updateControllerUI: () => {
        // Throttled UI update logic (proper deferral to prevent missed updates)
        if (Core._uiUpdatePending) return;

        const now = Date.now();
        const timeSinceLast = now - (Core._lastUIUpdate || 0);

        if (timeSinceLast < 500) {
            Core._uiUpdatePending = setTimeout(() => {
                Core._uiUpdatePending = null;
                Core.updateControllerUI();
            }, 500 - timeSinceLast);
            return;
        }

        Core._lastUIUpdate = now;
        Core._uiUpdatePending = null;

        const db = new Set(Storage.getJSON(CONFIG.KEYS.DB_KEY));

        // Global cleanup
        let pendingChanged = false;
        for (const u of Core.pendingUsers) {
            if (db.has(u)) {
                Core.pendingUsers.delete(u);
                pendingChanged = true;
            }
        }
        if (pendingChanged) Storage.setSessionJSON(CONFIG.KEYS.PENDING, [...Core.pendingUsers]);

        // Only update visible elements or those that need state change
        document.querySelectorAll('.hege-checkbox-container').forEach(el => {
            const u = el.dataset.username;
            if (u && db.has(u)) {
                if (!el.classList.contains('finished')) {
                    el.classList.add('finished');
                    el.classList.remove('checked');
                }
            } else if (u && !db.has(u) && el.classList.contains('finished')) {
                el.classList.remove('finished');
            }
        });

        const selCount = document.getElementById('hege-sel-count');
        if (selCount) selCount.textContent = `${Core.pendingUsers.size} 選取`;

        const panel = document.getElementById('hege-panel');
        if (!panel) return;

        const failedQueue = Storage.getJSON(CONFIG.KEYS.FAILED_QUEUE, []);
        const retryItem = document.getElementById('hege-retry-failed-item');
        if (retryItem) {
            if (failedQueue.length > 0) {
                retryItem.style.display = 'flex';
                const countBadge = document.getElementById('hege-failed-count');
                if (countBadge) countBadge.textContent = `${failedQueue.length} 筆`;
            } else {
                retryItem.style.display = 'none';
            }
        }

        let badgeText = Core.pendingUsers.size > 0 ? `(${Core.pendingUsers.size})` : '';

        let shouldShowStop = false;
        let mainText = '開始封鎖';
        let headerColor = 'transparent'; // Use transparent or theme color

        const bgStatus = Storage.getJSON(CONFIG.KEYS.BG_STATUS, {});
        if (bgStatus.state === 'running' && (Date.now() - (bgStatus.lastUpdate || 0) < 10000)) {
            shouldShowStop = true;
            mainText = `背景執行中 剩餘 ${bgStatus.total}`;
            headerColor = '#4cd964';
            badgeText = `(${bgStatus.total}剩餘)`; // Show progress in header badge explicitly
        }

        const badge = document.getElementById('hege-queue-badge');
        if (badge) badge.textContent = badgeText;

        const stopBtn = document.getElementById('hege-stop-btn-item'); if (stopBtn) stopBtn.style.display = shouldShowStop ? 'flex' : 'none';
        const mainItem = document.getElementById('hege-main-btn-item');
        if (mainItem) { mainItem.querySelector('span').textContent = mainText; mainItem.style.color = shouldShowStop ? headerColor : '#f5f5f5'; }
        const header = document.getElementById('hege-header'); if (header) header.style.borderColor = headerColor;
    },

    runSameTabWorker: () => {
        const toAdd = Array.from(Core.pendingUsers);

        const q = Storage.getJSON(CONFIG.KEYS.BG_QUEUE, []);
        const newQ = [...new Set([...q, ...toAdd])];

        if (newQ.length === 0) {
            UI.showToast('沒有待處理的帳號');
            return;
        }

        Storage.setJSON(CONFIG.KEYS.BG_QUEUE, newQ);
        Storage.remove(CONFIG.KEYS.BG_CMD);

        if (toAdd.length > 0) {
            Core.pendingUsers.clear();
            Storage.setSessionJSON(CONFIG.KEYS.PENDING, []);
        }

        // Save current page URL (without hege_bg param) so the worker can navigate back when done
        const cleanUrl = new URL(window.location.href);
        cleanUrl.searchParams.delete('hege_bg');
        Storage.set('hege_return_url', cleanUrl.toString());

        // CRITICAL: Use history.replaceState + reload to avoid Universal Links entirely.
        // Since we're already on threads.net, we modify the URL in-place (no navigation event)
        // and reload. Safari sees this as a page refresh, NOT a navigation to a new URL,
        // so Universal Links cannot intercept it.
        const workerUrl = new URL(window.location.origin);
        workerUrl.searchParams.set('hege_bg', 'true');
        history.replaceState(null, '', workerUrl.toString());
        location.reload();
    },

    runForegroundBlock: async () => {
        if (Core.isRunning) return;
        Core.isRunning = true;
        document.body.classList.add('hege-ghost-mode');

        const targets = Array.from(Core.blockQueue);
        const total = targets.length;
        let successCount = 0;
        let failCount = 0;

        UI.showToast(`iOS模式啟動：處理 ${total} 筆`);
        Utils.log(`Starting iOS Block: ${total} users`);

        for (let i = 0; i < total; i++) {
            const btn = targets[i];
            const count = i;

            // Update Status in UI if possible
            const mainItem = document.getElementById('hege-main-btn-item');
            if (mainItem) mainItem.querySelector('span').textContent = `處理中 ${count + 1}/${total}`;

            try {
                // Ensure element is in view/interactable
                btn.scrollIntoView({ block: "center", inline: "center" });
                await Utils.sleep(500);

                btn.style.transform = 'none';
                Utils.log(`[DEBUG] Click More Button #${count + 1}`);
                Utils.simClick(btn);
                await Utils.sleep(800);

                // 1. Click Menu Item "Block"
                let menuClicked = false;
                let alreadyBlocked = false;
                // Select all menu items (including divs that act as buttons)
                const menuItems = document.querySelectorAll('div[role="menuitem"], div[role="button"]');

                for (let j = menuItems.length - 1; j >= 0; j--) {
                    const text = menuItems[j].innerText.trim();

                    // "Already Blocked" Detection
                    if (text.includes('解除封鎖') || text.includes('Unblock')) {
                        Utils.log(`[DEBUG] Found 'Unblock' -> Already Blocked. Marking success.`);
                        alreadyBlocked = true;
                        document.body.click(); // Close menu
                        break;
                    }

                    if (text.includes('封鎖') || text.includes('Block')) {
                        Utils.log(`[DEBUG] Click Block Item: ${text}`);
                        Utils.simClick(menuItems[j]);
                        // Some menus have nested span, click that too just in case
                        if (menuItems[j].querySelector('span')) Utils.simClick(menuItems[j].querySelector('span'));
                        menuClicked = true;
                        break;
                    }
                }

                if (alreadyBlocked) {
                    if (btn.dataset.username) {
                        const u = btn.dataset.username;
                        Core.saveToDB(u);
                        if (Core.pendingUsers.has(u)) {
                            Core.pendingUsers.delete(u);
                            Storage.setSessionJSON(CONFIG.KEYS.PENDING, [...Core.pendingUsers]);
                        }
                    }
                    successCount++;
                    Core.blockQueue.delete(btn);
                    Utils.log(`Blocked #${count + 1} Success (Already Blocked)`);

                    // Hide Parent Post
                    let c = btn.parentElement;
                    for (let k = 0; k < 6; k++) { if (c?.parentElement) c = c.parentElement; }
                    if (c) c.style.display = 'none';

                    Core.updateControllerUI();
                    await Utils.sleep(500);
                    continue;
                }

                if (!menuClicked) {
                    Utils.log(`Err: Menu 'Block' not found for #${count + 1}`);
                    document.body.click(); // Close menu
                    failCount++;
                    continue;
                }

                await Utils.sleep(1000);

                // 2. Confirm Block (Dialog)
                let confirmClicked = false;
                const allButtons = document.querySelectorAll('div[role="button"]');
                for (let j = allButtons.length - 1; j >= 0; j--) {
                    const b = allButtons[j];
                    const text = b.innerText.trim();
                    const style = window.getComputedStyle(b);
                    // Look for Red buttons or "Block" text in dialog
                    if ((text.includes('封鎖') || text.includes('Block') || style.color === 'rgb(255, 59, 48)') && b.offsetParent !== null) {
                        Utils.simClick(b);
                        confirmClicked = true;
                        break;
                    }
                }

                if (!confirmClicked) {
                    // Fallback: Try last button in dialog
                    const dialog = document.querySelector('div[role="dialog"]');
                    if (dialog) {
                        const dialogBtns = dialog.querySelectorAll('div[role="button"]');
                        if (dialogBtns.length > 0) {
                            Utils.simClick(dialogBtns[dialogBtns.length - 1]);
                            confirmClicked = true;
                        }
                    }
                }

                if (confirmClicked) {
                    await Utils.sleep(2000);

                    // Stuck Dialog Check
                    if (document.querySelector('div[role="dialog"]')) {
                        Utils.log('Dialog stuck, trying close...');
                        document.body.click(); // Try close
                        await Utils.sleep(500);
                        if (document.querySelector('div[role="dialog"]')) {
                            Utils.log(`Err: Stuck dialog #${count + 1}`);
                            failCount++;
                            continue;
                        }
                    }

                    if (btn.dataset.username) {
                        const u = btn.dataset.username;
                        Core.saveToDB(u);
                        if (Core.pendingUsers.has(u)) {
                            Core.pendingUsers.delete(u);
                            Storage.setSessionJSON(CONFIG.KEYS.PENDING, [...Core.pendingUsers]);
                        }
                    }
                    successCount++;
                    Core.blockQueue.delete(btn);
                    Utils.log(`Blocked #${count + 1} Success`);

                    // Hide Parent Post
                    let c = btn.parentElement; for (let k = 0; k < 6; k++) { if (c?.parentElement) c = c.parentElement; }
                    if (c) c.style.display = 'none';

                    Core.updateControllerUI();
                } else {
                    Utils.log(`Err: Confirm btn not found #${count + 1}`);
                    document.body.click();
                    failCount++;
                }

            } catch (e) {
                Utils.log(`Err Exception: ${e.message}`);
                console.error(e);
                failCount++;
            }
            await Utils.sleep(500);
        }

        UI.showToast(`執行完成。成功: ${successCount}, 失敗: ${failCount}`);
        Utils.log(`Done. Success: ${successCount}, Fail: ${failCount}`);

        Core.isRunning = false;
        document.body.classList.remove('hege-ghost-mode');

        const mainItem = document.getElementById('hege-main-btn-item');
        if (mainItem) {
            mainItem.style.pointerEvents = 'auto';
            mainItem.style.opacity = '1';
            mainItem.querySelector('span').textContent = '開始封鎖';
        }
        Core.updateControllerUI();

        if (failCount > 0) alert(`完成。\n成功: ${successCount}\n失效: ${failCount}`);
    },

    exportHistory: () => {
        const db = Storage.getJSON(CONFIG.KEYS.DB_KEY, []);
        if (db.length === 0) { UI.showToast('歷史資料庫是空的'); return; }
        const list = db.join('\n');
        navigator.clipboard.writeText(list).then(() => { UI.showToast(`已複製 ${db.length} 人名單`); }).catch(() => { prompt("請手動複製總名單：", list); });
    },

    retryFailedQueue: () => {
        const failedUsers = Storage.getJSON(CONFIG.KEYS.FAILED_QUEUE, []);
        if (failedUsers.length === 0) {
            UI.showToast('沒有失敗紀錄可重試');
            return;
        }

        if (confirm(`發現 ${failedUsers.length} 筆過去封鎖失敗或找不到人的帳號。\n確定要重新將他們加入排隊列重試嗎？`)) {
            let activeQueue = Storage.getJSON(CONFIG.KEYS.BG_QUEUE, []);
            const combinedQueue = [...new Set([...activeQueue, ...failedUsers])];
            Storage.setJSON(CONFIG.KEYS.BG_QUEUE, combinedQueue);
            Storage.setJSON(CONFIG.KEYS.FAILED_QUEUE, []); // Clear it out
            UI.showToast(`已將 ${failedUsers.length} 筆名單重送至背景排隊`);

            Core.updateControllerUI();

            const status = Storage.getJSON(CONFIG.KEYS.BG_STATUS, {});
            const isRunning = (Date.now() - (status.lastUpdate || 0) < 10000 && status.state === 'running');
            if (!isRunning) {
                if (Utils.isMobile()) {
                    Core.runSameTabWorker();
                } else {
                    window.open('https://www.threads.net/?hege_bg=true', 'HegeBlockWorker', 'width=800,height=600');
                }
            }
        }
    },

    importList: () => {
        const input = prompt("請貼上 ID 名單："); if (!input) return;
        let rawUsers = input.split(/[\s,，\n]+/).map(u => u.trim()).filter(u => u.length > 0).map(u => {
            u = u.split('?')[0]; // 去除網址帶有的 tracking parameters
            if (u.includes('/@')) return u.split('/@')[1].split('/')[0];
            if (u.startsWith('@')) return u.substring(1);
            return u.split('/')[0];
        });

        // 名單內部自身去重
        rawUsers = [...new Set(rawUsers)];

        const db = new Set(Storage.getJSON(CONFIG.KEYS.DB_KEY, []));
        let activeQueue = Storage.getJSON(CONFIG.KEYS.BG_QUEUE, []);
        const activeSet = new Set(activeQueue);

        // 雙重過濾：不在歷史紀錄中，且不在當前的排隊佇列中
        const newUsers = rawUsers.filter(u => !db.has(u) && !activeSet.has(u));

        if (newUsers.length === 0) { UI.showToast('沒有新名單可匯入 (皆已在歷史庫或等待佇列中)'); return; }

        const combinedQueue = [...activeQueue, ...newUsers];
        Storage.setJSON(CONFIG.KEYS.BG_QUEUE, combinedQueue);

        UI.showToast(`已匯入 ${newUsers.length} 筆至背景佇列`);

        const status = Storage.getJSON(CONFIG.KEYS.BG_STATUS, {});
        const isRunning = (Date.now() - (status.lastUpdate || 0) < 10000 && status.state === 'running');

        if (!isRunning && confirm(`已匯入 ${newUsers.length} 筆名單。\n是否立即開始背景執行？`)) {
            if (Utils.isMobile()) {
                Core.runSameTabWorker();
            } else {
                window.open('https://www.threads.net/?hege_bg=true', 'HegeBlockWorker', 'width=800,height=600');
            }
        } else if (isRunning) {
            UI.showToast('已合併至正在運行的背景任務');
        }
    }
};

// --- worker.js ---




const Worker = {
    init: () => {
        document.title = "🛡️ 留友封-背景執行中";
        // Enforce maximum safe desktop window size if the browser opens it too large
        try {
            if (window.outerWidth > 800 || window.outerHeight > 600) {
                window.resizeTo(800, 600);
            }
        } catch (e) { }

        const cover = document.createElement('div');
        const channel = new BroadcastChannel('hege_debug_channel');
        window.hegeLog = (msg) => {
            if (CONFIG.DEBUG_MODE) {
                console.log(`[BG-LOG] ${msg}`);
                channel.postMessage({ type: 'log', msg: `[BG] ${msg}` });

                // Append to UI Log
                const logEl = document.getElementById('hege-worker-log');
                if (logEl) {
                    const line = document.createElement('div');
                    line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
                    line.style.borderBottom = '1px solid #333';
                    logEl.prepend(line); // Newest on top
                }
            }
        };
        window.hegeLog('[BG-INIT] Worker Started');

        Worker.createStatusUI();
        setTimeout(Worker.runStep, 1000);
    },

    createStatusUI: () => {
        const cover = document.createElement('div');
        cover.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:#111;color:#4cd964;z-index:999999;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;font-family:system-ui, -apple-system, sans-serif;font-size:14px;padding:20px;box-sizing:border-box;overflow:hidden;';

        Utils.setHTML(cover, `
            <div id="bg-status" style="font-size:18px;font-weight:bold;margin-bottom:10px;">等待指令...</div>
            <div style="font-size:12px;color:#666;margin-bottom:20px;">請勿離開此頁面，封鎖完成後會自動返回</div>
            <div id="hege-worker-log" style="width:100%;flex:1;overflow-y:auto;border:1px solid #333;padding:10px;text-align:left;font-family:monospace;font-size:12px;color:#aaa;background:#000;"></div>
        `);
        document.body.appendChild(cover);
    },

    updateStatus: (state, current = '', progress = 0, total = 0) => {
        const s = { state, current, progress, total, lastUpdate: Date.now() };
        Storage.setJSON(CONFIG.KEYS.BG_STATUS, s);
        const el = document.getElementById('bg-status');
        if (el) el.textContent = `[${state.toUpperCase()}] ${current} (${progress}/${total})`;
        document.title = state === 'running' ? `🛡️ ${progress}/${total}` : '🛡️ 留友封';
    },

    navigateBack: () => {
        setTimeout(() => {
            const returnUrl = Storage.get('hege_return_url');
            if (returnUrl) {
                Storage.remove('hege_return_url');
                // Use history.replaceState + reload to avoid Universal Links on iOS
                const url = new URL(returnUrl);
                history.replaceState(null, '', url.pathname + url.search);
                location.reload();
            } else {
                // Desktop popup fallback
                window.close();
            }
        }, 2000);
    },

    runStep: async () => {
        if (Storage.get(CONFIG.KEYS.BG_CMD) === 'stop') {
            Storage.remove(CONFIG.KEYS.BG_CMD);
            Worker.updateStatus('stopped', '已停止');
            Worker.navigateBack();
            return;
        }

        let queue = Storage.getJSON(CONFIG.KEYS.BG_QUEUE, []);
        if (queue.length === 0) {
            Worker.updateStatus('idle', '完成', 0, 0);
            Worker.navigateBack();
            return;
        }

        const targetUser = queue[0];
        const currentTotal = queue.length;

        let db = new Set(Storage.getJSON(CONFIG.KEYS.DB_KEY, []));
        if (db.has(targetUser)) {
            Worker.updateStatus('running', `略過: ${targetUser}`, 0, currentTotal);
            queue.shift();
            Storage.setJSON(CONFIG.KEYS.BG_QUEUE, queue);
            setTimeout(Worker.runStep, 100);
            return;
        }

        const onTargetPage = location.pathname.includes(`/@${targetUser}`);
        if (!onTargetPage) {
            Worker.updateStatus('running', `前往: ${targetUser}`, 0, currentTotal);
            await Utils.sleep(500 + Math.random() * 500);
            // Use history.replaceState + reload to avoid Universal Links on iOS
            history.replaceState(null, '', `/@${targetUser}?hege_bg=true`);
            location.reload();
        } else {
            Worker.updateStatus('running', `封鎖中: ${targetUser}`, 0, currentTotal);
            const result = await Worker.autoBlock(targetUser);

            if (result === 'success' || result === 'already_blocked') {
                let q = Storage.getJSON(CONFIG.KEYS.BG_QUEUE, []);
                if (q.length > 0 && q[0] === targetUser) {
                    q.shift();
                    Storage.setJSON(CONFIG.KEYS.BG_QUEUE, q);
                }

                db = new Set(Storage.getJSON(CONFIG.KEYS.DB_KEY, []));
                db.add(targetUser);
                Storage.setJSON(CONFIG.KEYS.DB_KEY, [...db]); // Fix Sync

                Worker.runStep();
            } else if (result === 'failed') {
                // Remove from active queue
                let q = Storage.getJSON(CONFIG.KEYS.BG_QUEUE, []);
                if (q.length > 0 && q[0] === targetUser) {
                    q.shift();
                    Storage.setJSON(CONFIG.KEYS.BG_QUEUE, q);
                }

                // Add to failed queue (DO NOT add to history DB)
                let fq = new Set(Storage.getJSON(CONFIG.KEYS.FAILED_QUEUE, []));
                fq.add(targetUser);
                Storage.setJSON(CONFIG.KEYS.FAILED_QUEUE, [...fq]);

                Worker.runStep();
            } else if (result === 'cooldown') {
                Worker.updateStatus('error', '冷卻觸發');
                alert('冷卻觸發');
            }
        }
    },

    autoBlock: async (user) => {
        // Updated with Robust Polling and STRICT SVG Check
        function setStep(msg) {
            const s = Storage.getJSON(CONFIG.KEYS.BG_STATUS, {});
            s.current = `${user}: ${msg}`;
            s.lastUpdate = Date.now();
            Storage.setJSON(CONFIG.KEYS.BG_STATUS, s);
            if (window.hegeLog) window.hegeLog(msg);
        }

        function checkForError() {
            const errorPhrases = ['稍後再試', 'Try again later', '為了保護', 'protect our community', '受到限制', 'restrict certain activity'];
            const dialogs = document.querySelectorAll('div[role="dialog"]');
            for (let dialog of dialogs) {
                if (errorPhrases.some(p => dialog.innerText.includes(p))) {
                    console.log(`[留友封] 偵測到限制訊息`);
                    return true;
                }
            }
            return false;
        }

        try {
            setStep('載入中...');
            await Utils.sleep(2500);

            // 1. Wait for "More" button (Polling up to 12s)
            let profileBtn = null;

            for (let i = 0; i < 25; i++) {
                const moreSvgs = document.querySelectorAll('svg[aria-label="更多"], svg[aria-label="More"]');
                for (let svg of moreSvgs) {
                    // Check structure to distinguish from other "More" icons
                    if (svg.querySelector('circle') && svg.querySelectorAll('path').length >= 3) {
                        profileBtn = svg.closest('div[role="button"]');
                        if (profileBtn) break;
                    }
                }

                // Fallback
                if (!profileBtn && moreSvgs.length > 0) {
                    profileBtn = moreSvgs[0].closest('div[role="button"]');
                }

                if (profileBtn) break;
                await Utils.sleep(500);
            }

            if (!profileBtn) {
                console.log('找不到更多按鈕');
                return 'failed';
            }

            setStep('開啟選單...');
            await Utils.sleep(500);
            profileBtn.scrollIntoView({ block: 'center', inline: 'center' }); // v1.1.3-beta3 Layout Fix
            await Utils.sleep(500);
            // v1.1.3-beta45: Use simClick instead of .click() for reliability
            Utils.simClick(profileBtn);

            // 2. Wait for Menu (Polling up to 8s)
            let blockBtn = null;
            for (let i = 0; i < 16; i++) {
                await Utils.sleep(500);
                const menuItems = document.querySelectorAll('div[role="menuitem"], div[role="button"]');
                for (let item of menuItems) {
                    const t = item.innerText;
                    // v1.1.3-beta31: More robust check for "Already Blocked"
                    if (t.includes('解除封鎖') || t.includes('Unblock')) {
                        setStep('已封鎖 (略過)');
                        return 'already_blocked'; // Found Unblock button -> Already blocked
                    }

                    // Check for "Block"/"封鎖" but NOT "Unblock"/"解除"
                    if ((t.includes('封鎖') && !t.includes('解除')) || (t.includes('Block') && !t.includes('Un'))) {
                        blockBtn = item;
                        break;
                    }
                }
                if (blockBtn) break;
            }

            if (!blockBtn) {
                // Double check if actually "Unblock" exists (in case loop missed it)
                const menuItems = document.querySelectorAll('div[role="menuitem"], div[role="button"]');
                for (let item of menuItems) {
                    if (item.innerText.includes('解除封鎖') || item.innerText.includes('Unblock')) {
                        setStep('已封鎖 (略過)');
                        return 'already_blocked'; // Already blocked
                    }
                }
                setStep('錯誤: 找不到封鎖鈕');
                return 'failed';
            }

            setStep('點擊封鎖...');
            await Utils.sleep(800);
            blockBtn.click();

            // 3. Wait for Confirm Dialog (Polling up to 5s)
            let confirmBtn = null;
            for (let i = 0; i < 10; i++) {
                await Utils.sleep(500);

                if (checkForError()) { return 'cooldown'; }

                const allBtns = document.querySelectorAll('div[role="button"]');
                for (let j = allBtns.length - 1; j >= 0; j--) {
                    const b = allBtns[j];
                    const text = b.innerText;
                    const style = window.getComputedStyle(b);
                    if ((text.includes('封鎖') || text.includes('Block') || style.color === 'rgb(255, 59, 48)') && b.offsetParent !== null) {
                        confirmBtn = b;
                        break;
                    }
                }
                if (confirmBtn) break;
            }

            if (!confirmBtn) {
                // Check dialog buttons fallback safely
                const dialog = document.querySelector('div[role="dialog"]');
                if (dialog) {
                    const dialogBtns = dialog.querySelectorAll('div[role="button"]');
                    for (let j = dialogBtns.length - 1; j >= 0; j--) {
                        const style = window.getComputedStyle(dialogBtns[j]);
                        if (style.color === 'rgb(255, 59, 48)' || dialogBtns[j].innerText.includes('封鎖') || dialogBtns[j].innerText.includes('Block')) {
                            confirmBtn = dialogBtns[j];
                            break;
                        }
                    }
                }
            }

            if (!confirmBtn) return 'failed';

            setStep('確認執行...');
            await Utils.sleep(800);
            confirmBtn.click();

            // 4. Wait for completion
            for (let i = 0; i < 10; i++) {
                await Utils.sleep(800);
                if (!document.querySelector('div[role="dialog"]')) {
                    return 'success';
                }
            }

            if (document.querySelector('div[role="dialog"]')) return 'failed';

            return 'success';

        } catch (e) {
            console.error(e);
            return 'failed';
        }
    }
};

// --- main.js ---







(function () {
    'use strict';
    console.log('[留友封] Extension Script Initializing...');

    if (Storage.get(CONFIG.KEYS.VERSION_CHECK) !== CONFIG.VERSION) {
        // Cleanup old keys if needed
        Storage.remove(CONFIG.KEYS.IOS_MODE);

        // Aggressively clear all temporary selection and operational queues to prevent ghost data
        Storage.setSessionJSON(CONFIG.KEYS.PENDING, []);
        Storage.setJSON(CONFIG.KEYS.BG_QUEUE, []);
        Storage.setJSON(CONFIG.KEYS.FAILED_QUEUE, []);
        Storage.setJSON(CONFIG.KEYS.BG_STATUS, {});

        Storage.set(CONFIG.KEYS.VERSION_CHECK, CONFIG.VERSION);
        console.log(`[留友封] Updated to v${CONFIG.VERSION}. Cleared all temporary queues.`);
    }

    const isBgPage = new URLSearchParams(window.location.search).get('hege_bg') === 'true';

    // Initialize
    function main() {
        if (isBgPage) {
            Worker.init();
        } else {
            // Prevent running in iframes for Controller (Beta46 logic)
            if (window.top !== window.self) return;

            UI.injectStyles();

            const handleMainButton = () => {
                const pending = Core.pendingUsers;
                if (pending.size === 0) { UI.showToast('請先勾選用戶！'); return; }

                const isMobile = Utils.isMobile();
                const deskMode = Storage.get(CONFIG.KEYS.MAC_MODE) || 'background';

                if (isMobile) {
                    Core.runSameTabWorker();
                } else if (deskMode === 'foreground') {
                    Core.runForegroundBlock();
                } else {
                    // Add to queue
                    const q = Storage.getJSON(CONFIG.KEYS.BG_QUEUE, []);
                    const toAdd = Array.from(pending);
                    const newQ = [...new Set([...q, ...toAdd])];
                    Storage.setJSON(CONFIG.KEYS.BG_QUEUE, newQ);
                    UI.showToast(`已提交 ${toAdd.length} 筆至背景佇列`);

                    // Check if running
                    const status = Storage.getJSON(CONFIG.KEYS.BG_STATUS, {});
                    const running = (Date.now() - (status.lastUpdate || 0) < 10000 && status.state === 'running');
                    if (!running) {
                        Storage.remove(CONFIG.KEYS.BG_CMD);
                        window.open('https://www.threads.net/?hege_bg=true', 'HegeBlockWorker', 'width=800,height=600');
                    }
                }
            };

            const updateModeUI = () => {
                const currentMode = Storage.get(CONFIG.KEYS.MAC_MODE) || 'background';
                const modeText = document.getElementById('hege-mode-text');
                const modeDesc = document.getElementById('hege-mode-desc');
                if (!modeText || !modeDesc) return;

                if (currentMode === 'foreground') {
                    modeText.textContent = '前景模式 (iOS模擬)';
                    modeText.style.color = '#ff9f0a';
                    modeDesc.textContent = '當前分頁執行';
                } else {
                    modeText.textContent = '背景模式 (預設)';
                    modeText.style.color = '#4cd964';
                    modeDesc.textContent = '新分頁執行';
                }
            };

            const callbacks = {
                onMainClick: handleMainButton,
                onClearSel: () => {
                    if (confirm('確定要清除目前的「選取清單」與所有「背景排隊」的帳號嗎？\n(這不會影響已完成的封鎖歷史紀錄)')) {
                        Core.pendingUsers.clear();
                        Storage.setSessionJSON(CONFIG.KEYS.PENDING, []);
                        Storage.setJSON(CONFIG.KEYS.BG_QUEUE, []);
                        Storage.setJSON(CONFIG.KEYS.FAILED_QUEUE, []);
                        Storage.setJSON(CONFIG.KEYS.BG_STATUS, {});
                        Core.blockQueue.forEach(b => {
                            b.style.transform = 'none';
                            b.parentElement.querySelector('.hege-checkbox-container')?.classList.remove('checked');
                        });
                        Core.blockQueue.clear();
                        Core.updateControllerUI();
                        UI.showToast('待封鎖清單與背景佇列已全數清除');
                    }
                },
                onClearDB: () => { if (confirm('清空歷史?')) { Storage.setJSON(CONFIG.KEYS.DB_KEY, []); Core.updateControllerUI(); } },
                onImport: () => Core.importList(),
                onExport: () => Core.exportHistory(),
                onRetryFailed: () => Core.retryFailedQueue(),
                onStop: () => { if (confirm('停止?')) Storage.set(CONFIG.KEYS.BG_CMD, 'stop'); },
                onModeToggle: () => {
                    const cur = Storage.get(CONFIG.KEYS.MAC_MODE) || 'background';
                    const next = cur === 'background' ? 'foreground' : 'background';
                    Storage.set(CONFIG.KEYS.MAC_MODE, next);
                    updateModeUI();
                    UI.showToast(`已切換模式`);
                }
            };

            const panel = UI.createPanel(callbacks);
            updateModeUI();

            // Sync Logic (Restored from beta46)
            window.addEventListener('storage', (e) => {
                if (e.key === CONFIG.KEYS.BG_STATUS || e.key === CONFIG.KEYS.DB_KEY || e.key === CONFIG.KEYS.BG_QUEUE) {
                    Storage.invalidate(e.key); // Force cache clear so getJSON fetches fresh data
                    Core.updateControllerUI();
                }
            });
            setInterval(() => {
                Storage.invalidate(CONFIG.KEYS.DB_KEY);
                Storage.invalidate(CONFIG.KEYS.BG_STATUS);
                Storage.invalidate(CONFIG.KEYS.BG_QUEUE);
                Core.updateControllerUI();
            }, 2000); // Polling backup

            // Env Log
            const isIPad = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
            const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || isIPad;
            Utils.log(`Env: ${navigator.platform}, TP:${navigator.maxTouchPoints}\nDevice: ${isIOS ? 'iOS/iPad' : 'Desktop'}\nUA: ${navigator.userAgent.substring(0, 50)}...`);

            // Anchor Loop
            UI.anchorPanel();
            setInterval(() => {
                if (!document.getElementById('hege-panel')) {
                    console.warn('[留友封] Panel missing from DOM! Attempting re-inject?');
                }
                UI.anchorPanel();
            }, 1500);

            Core.init();

            // Log Sync
            if (CONFIG.DEBUG_MODE) {
                // Console only
            }
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', main);
    } else {
        main();
    }
})();

})();
