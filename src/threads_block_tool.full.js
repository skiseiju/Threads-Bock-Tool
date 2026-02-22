// ==UserScript==
// @name         留友封 (Threads 封鎖工具 beta)
// @namespace    http://tampermonkey.net/
// @version      1.1.3-beta46
// @description  (v1.1.3-beta46) 修正iOS跳轉App問題 (Fix iOS App Jump)
// @author       海哥
// @match        https://www.threads.net/*
// @match        https://threads.net/*
// @match        https://www.threads.com/*
// @match        https://threads.com/*
// @include      *://*.threads.net/*
// @include      *://*.threads.com/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // --- 0. 核心變數與鍵值 ---
    const CURRENT_VERSION = '1.1.3-beta46'; // Fix iOS App Opening (Force Foreground)
    const DEBUG_MODE = true; // Set to false to disable verbose logs
    const DB_KEY = 'hege_block_db_v1';

    // Page A (Controller) State
    const PENDING_KEY = 'hege_pending_users'; // session: Page A selection

    // Page B (Worker) State - Shared via LocalStorage
    const BG_STATUS_KEY = 'hege_bg_status'; // { state: 'idle'|'running'|'paused', progress: 0, total: 0, current: '' }
    const BG_QUEUE_KEY = 'hege_active_queue'; // Shared: Active processing list
    const BG_CMD_KEY = 'hege_bg_command'; // Channel: 'start'|'stop'

    // v1.1.3-beta38: Broadcast Channel for Log Sync
    const logChannel = new BroadcastChannel('hege_debug_channel');

    // v1.1.3-beta14: iOS Single Window Mode (REMOVED in beta15 to fix stuck state)
    const IOS_MODE_KEY = 'hege_ios_active';
    const MAC_MODE_KEY = 'hege_mac_mode'; // 'background' (default) | 'foreground'

    // Common
    const COOLDOWN_KEY = 'hege_rate_limit_until';
    const VERSION_KEY = 'hege_version_check';
    const POS_KEY = 'hege_panel_pos';
    const STATE_KEY = 'hege_panel_state';

    // Session State (Local)
    let blockQueue = new Set(); // Actual DOM elements for Page A visual feedback
    let pendingUsers = new Set(JSON.parse(sessionStorage.getItem(PENDING_KEY) || '[]')); // List of usernames on Page A
    let historyDB = new Set(JSON.parse(localStorage.getItem(DB_KEY) || '[]'));
    let isMinimized = localStorage.getItem(STATE_KEY) === 'true';
    let cooldownUntil = parseInt(localStorage.getItem(COOLDOWN_KEY) || '0');
    let isRunning = false; // Global execution flag

    // Utility
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    // v1.1.3-beta15 FIX: isBgPage MUST only check URL param.
    // iOS mode should be local to the function execution, NOT a global persistent state that affects page load.
    const isBgPage = new URLSearchParams(window.location.search).get('hege_bg') === 'true';

    // --- 1. 初始化檢查 ---
    if (localStorage.getItem(VERSION_KEY) !== CURRENT_VERSION) {

        localStorage.removeItem(COOLDOWN_KEY); // Clean old locks on update

        // v1.1.3-beta15: Clean up any stuck iOS state
        localStorage.removeItem(IOS_MODE_KEY);
        localStorage.removeItem(BG_STATUS_KEY);

        // v1.1.3-beta16/17: Force Reset Position/State for UI overhaul
        localStorage.removeItem(POS_KEY);
        localStorage.setItem(STATE_KEY, 'true'); // Force minimize
        isMinimized = true;

        localStorage.setItem(VERSION_KEY, CURRENT_VERSION);
        console.log(`[留友封] 版本更新至 v${CURRENT_VERSION}`);
    }

    // --- 2. 共用邏輯 ---
    function saveToDB(username) {
        if (!username) return;
        username = username.replace('@', '').trim();
        historyDB.add(username);
        localStorage.setItem(DB_KEY, JSON.stringify([...historyDB]));
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

    function triggerSafetyStop() {
        cooldownUntil = Date.now() + 12 * 60 * 60 * 1000;
        localStorage.setItem(COOLDOWN_KEY, cooldownUntil);
        alert(`⚠️ 嚴重警示：\n\n系統偵測到「稍後再試」等限制訊息。\n背景執行已停止。`);
    }

    function simClick(element) {
        if (!element) return;
        const opts = { bubbles: true, cancelable: true, view: window };

        // v1.1.3-beta33: Check if TouchEvent exists (Fix macOS Foreground Crash)
        if (typeof TouchEvent !== 'undefined') {
            element.dispatchEvent(new TouchEvent('touchstart', opts));
            element.dispatchEvent(new TouchEvent('touchend', opts));
        }

        element.dispatchEvent(new MouseEvent('mousedown', opts));
        element.dispatchEvent(new MouseEvent('mouseup', opts));
        element.click();
    }

    function showToast(msg, duration = 2500, color = 'rgba(0, 180, 0, 0.95)') {
        const exist = document.getElementById('hege-toast');
        if (exist) exist.remove();
        const toast = document.createElement('div');
        toast.id = 'hege-toast'; toast.textContent = msg;
        toast.style.cssText = `
            position: fixed; top: 10%; left: 50%; transform: translateX(-50%);
            background: ${color}; color: white; padding: 12px 24px;
            border-radius: 50px; font-size: 16px; font-weight: bold; z-index: 2147483647;
            box-shadow: 0 5px 20px rgba(0,0,0,0.5); pointer-events: none;
            transition: opacity 0.5s; font-family: system-ui; text-align: center;
        `;
        (document.body || document.documentElement).appendChild(toast);
        setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 500); }, duration);
    }

    // --- 3. 背景執行邏輯 (Page B) ---
    async function initWorker() {
        if (!isBgPage) return;

        console.log('[留友封] 背景工作線程啟動');
        document.title = "🛡️ 留友封-背景執行中";

        // v1.1.3-beta44: Immediate Log Definition to fix Sync
        window.hegeLog = (msg) => {
            if (DEBUG_MODE) {
                console.log(`[BG-LOG] ${msg}`);
                // Ensure Channel is ready (Global Scope)
                logChannel.postMessage({ type: 'log', msg: `[BG] ${msg}` });
            }
        };

        // Send initial log immediately
        window.hegeLog(`[BG-INIT] Worker Started. Sync Active.`);

        // Visual indicator for background page
        const cover = document.createElement('div');
        cover.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:#000;color:#0f0;z-index:999999;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:monospace;font-size:24px;";
        cover.innerHTML = `<div id="bg-status">等待指令...</div><div style="font-size:14px;color:#666;margin-top:20px">請勿關閉此分頁，完成後會自動關閉</div>`;
        document.body.appendChild(cover);
        const statusEl = document.getElementById('bg-status');

        function updateStatus(state, current = '', progress = 0, total = 0) {
            const statusObj = { state, current, progress, total, lastUpdate: Date.now() };
            localStorage.setItem(BG_STATUS_KEY, JSON.stringify(statusObj));
            statusEl.textContent = `[${state.toUpperCase()}] ${current} (${progress}/${total})`;
            document.title = state === 'running' ? `🛡️ ${progress}/${total}` : "🛡️ 留友封";
        }

        // Single Step Logic for "Worker State" persistence across page loads
        async function runWorkerStep() {
            // 0. Check Stop
            if (localStorage.getItem(BG_CMD_KEY) === 'stop') {
                localStorage.removeItem(BG_CMD_KEY);
                updateStatus('stopped', '已停止');
                // Don't close, let user see.
                return;
            }

            // 1. Read Shared Queue
            let queue = JSON.parse(localStorage.getItem(BG_QUEUE_KEY) || '[]');

            // 2. If Queue Empty -> Idle / Close
            if (queue.length === 0) {
                updateStatus('idle', '完成', 0, 0);
                setTimeout(() => window.close(), 1000); // Close tab when done
                return;
            }

            const targetUser = queue[0];
            const currentTotal = queue.length; // Approximation

            // v1.1.3-beta31 FIX: Check if already in history BEFORE navigation
            // Reload history to be sure
            historyDB = new Set(JSON.parse(localStorage.getItem(DB_KEY) || '[]'));
            if (historyDB.has(targetUser)) {
                updateStatus('running', `略過已封鎖: ${targetUser}`, 0, currentTotal);
                queue.shift();
                localStorage.setItem(BG_QUEUE_KEY, JSON.stringify(queue));
                // Next
                setTimeout(runWorkerStep, 100);
                return;
            }

            // 3. Are we on the right page?
            const onTargetPage = location.pathname.includes(`/@${targetUser}`);

            if (!onTargetPage) {
                updateStatus('running', `前往: ${targetUser}`, 0, currentTotal);
                await sleep(500 + Math.random() * 500);
                window.location.href = `https://www.threads.net/@${targetUser}?hege_bg=true`;
            } else {
                updateStatus('running', `封鎖中: ${targetUser}`, 0, currentTotal);
                const result = await autoBlockCurrentProfile(targetUser);

                if (result === 'success' || result === 'skipped') {
                    // 4. Remove from queue ONLY after success/skip
                    let currentQueue = JSON.parse(localStorage.getItem(BG_QUEUE_KEY) || '[]');
                    if (currentQueue.length > 0 && currentQueue[0] === targetUser) {
                        currentQueue.shift();
                        localStorage.setItem(BG_QUEUE_KEY, JSON.stringify(currentQueue));
                    }

                    // *** Fix v1.1.3-beta3: Mark skipped users as completed to sync Controller Button ***
                    if (result === 'success' || result === 'skipped') saveToDB(targetUser);

                    // 5. Next
                    runWorkerStep();
                } else if (result === 'cooldown') {
                    updateStatus('error', '冷卻觸發');
                    alert('冷卻觸發，停止運行');
                }
            }
        }

        // Start the step
        setTimeout(runWorkerStep, 1000);
    }

    async function autoBlockCurrentProfile(user) {
        // Updated with Robust Polling and STRICT SVG Check
        function setStep(msg) {
            const s = JSON.parse(localStorage.getItem(BG_STATUS_KEY) || '{}');
            s.current = `${user}: ${msg}`;
            s.lastUpdate = Date.now();
            localStorage.setItem(BG_STATUS_KEY, JSON.stringify(s));
            if (window.hegeLog) window.hegeLog(msg); // Log Sync
        }

        try {
            setStep('載入中...');
            await sleep(2500);

            // 1. Wait for "More" button (Polling up to 12s)
            let profileBtn = null;
            for (let i = 0; i < 25; i++) {
                // Focus: User provided specific SVG.
                // Structure: <circle> + 3 <path>s.
                // Aria: "更多" or "More"
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
                await sleep(500);
            }

            if (!profileBtn) {
                console.log('找不到更多按鈕');
                return 'skipped';
            }

            setStep('開啟選單...');
            await sleep(500);
            profileBtn.scrollIntoView({ block: 'center', inline: 'center' }); // v1.1.3-beta3 Layout Fix
            await sleep(500);
            // v1.1.3-beta45: Use simClick instead of .click() for reliability
            simClick(profileBtn);

            // 2. Wait for Menu (Polling up to 8s)
            let blockBtn = null;
            for (let i = 0; i < 16; i++) {
                await sleep(500);
                const menuItems = document.querySelectorAll('div[role="menuitem"], div[role="button"]');
                for (let item of menuItems) {
                    const t = item.innerText;
                    // v1.1.3-beta31: More robust check for "Already Blocked"
                    if (t.includes('解除封鎖') || t.includes('Unblock')) {
                        setStep('已封鎖 (略過)');
                        return 'skipped'; // Found Unblock button -> Already blocked
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
                        return 'skipped'; // Already blocked
                    }
                }
                setStep('錯誤: 找不到封鎖鈕');
                return 'skipped';
            }

            setStep('點擊封鎖...');
            await sleep(800);
            blockBtn.click();

            // 3. Wait for Confirm Dialog (Polling up to 5s)
            let confirmBtn = null;
            for (let i = 0; i < 10; i++) {
                await sleep(500);

                if (checkForError()) { triggerSafetyStop(); return 'cooldown'; }

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
                // Check dialog buttons fallback
                const dialog = document.querySelector('div[role="dialog"]');
                if (dialog) {
                    const dialogBtns = dialog.querySelectorAll('div[role="button"]');
                    if (dialogBtns.length > 0) confirmBtn = dialogBtns[dialogBtns.length - 1];
                }
            }

            if (!confirmBtn) return 'skipped';

            setStep('確認執行...');
            await sleep(800);
            confirmBtn.click();

            // 4. Wait for completion
            for (let i = 0; i < 10; i++) {
                await sleep(800);
                if (!document.querySelector('div[role="dialog"]')) {
                    return 'success';
                }
            }

            if (document.querySelector('div[role="dialog"]')) return 'skipped';

            return 'success';

        } catch (e) {
            console.error(e);
            return 'skipped';
        }
    }

    // --- 4. 控制端邏輯 (Page A) ---
    function initController() {
        if (isBgPage) return;

        // v1.1.3-beta38: Restored local definition (if applicable) or rely on what matches
        const isIPad = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || isIPad;

        injectStyles();
        createPanel();

        // Listen for Storage changes to update UI (Background Status)
        window.addEventListener('storage', (e) => {
            if (e.key === BG_STATUS_KEY || e.key === DB_KEY || e.key === BG_QUEUE_KEY) {
                updateControllerUI();
            }
        });

        setInterval(updateControllerUI, 2000); // Polling backup
        updateControllerUI();

        // Scanner
        if (!localStorage.getItem(BG_QUEUE_KEY)) {
            setInterval(scanAndInject, 1500); // Simple scanner loop 
        } else {
            // Even if queue exists, we want to allow adding more
            setInterval(scanAndInject, 1500);
        }

        // v1.1.3-beta38: Listen to BroadcastChannel for Logs
        if (DEBUG_MODE) {
            const debugEl = document.getElementById('hege-debug-sys');
            logChannel.onmessage = (event) => {
                if (event.data && event.data.type === 'log') {
                    console.log(`[HegeSync] ${event.data.msg}`);
                    // Access window.hegeLog if available, or manually prepend
                    if (debugEl) {
                        debugEl.textContent = `[${new Date().toLocaleTimeString()}] ${event.data.msg}\n` + debugEl.textContent;
                    }
                }
            };
        }
    }

    function injectStyles() {
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

            /* v1.1.3-beta29: Unlock History for Re-check */
            .hege-checkbox-container.finished { opacity: 0.6; }
            .hege-checkbox-container.finished .hege-svg-icon { color: #555; }
            .hege-checkbox-container:active { transform: translateY(-50%) scale(0.9); }
            
            /* v1.1.3-beta12 Fix: Restrict flex growing, enforce Fixed Width for desktop, max-width for mobile */
            /* v1.2.2 Fix: Default position to Top Left (74px, 20px) */
            /* v1.1.3-beta17: Native Menu Style */
            #hege-panel {
                position: fixed; z-index: 10000;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                user-select: none;
                /* Reset standard panel styles, we will control via js/anchoring mostly */
            }

            /* Header / Mini Mode - Needs to look like a button or pills */
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

            /* Dropdown Content - Native Menu Look */
            /* Hidden when minimized */
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

            /* Menu Items */
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
            /* Ghost Mode */
            body.hege-ghost-mode div[role="menu"], body.hege-ghost-mode div[role="dialog"] { opacity: 0 !important; pointer-events: auto !important; }
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    // v1.1.3-beta38: Ensure createPanel has access to isIOS or it is defined safely?
    // In beta38, createPanel uses isIOS for logs.
    // We need to define isIOS inside initController (above) but createPanel is a separate function if defined outside.
    // If it's defined inside initController, then it's fine.
    // BUT createPanel was often top-level helper.
    // Let's check structure. createPanel is defined *inside* IIFE but outside initController?
    // If so, it needs isIOS global or passed in.
    // Beta38 likely had it defined inside createPanel (causing the beta40 bug? NO beta40 bug was "isIOS is not defined" in createPanel).
    // So in beta40 we moved it to top of createPanel.
    // In beta38 it might have been missing or defined in initController and not reachable.
    // To make a *functional* beta38, I will define `isIOS` inside `createPanel` as well to prevent the crash, but keep version 38?
    // Or just make it global but claim it is beta38?
    // User wants "Rollback". I will stick to what creates a WORKING beta38. 
    // I will put `isIOS` safely in `createPanel`.

    function createPanel() {
        const panel = document.createElement('div');
        panel.id = 'hege-panel';
        panel.className = isMinimized ? 'minimized' : '';

        // Define Menu Items HTML
        // ... items ...

        // Use local check for now to ensure no ReferenceError
        const isIPad = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || isIPad;
        // v1.1.3-beta44: Simple Mobile Check for UI Hiding
        const isMobile = isIOS || /Android|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

        panel.innerHTML = `
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
                
                <!-- v1.1.3-beta44: Hide if Mobile -->
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
                
                <!-- v1.1.3-beta25: Debug Console -->
                <div id="hege-debug-sys" style="padding:5px;font-size:10px;color:#aaa;border-top:1px solid #333;white-space:pre-wrap;line-height:1.2;max-height:100px;overflow-y:auto;user-select:text;display:${DEBUG_MODE ? 'block' : 'none'};">初始化...</div>
            </div>
        `; document.body.appendChild(panel);

        // Helper Log
        window.hegeLog = (msg) => {
            if (!DEBUG_MODE) return;
            const el = document.getElementById('hege-debug-sys');
            if (el) el.textContent = `[${new Date().toLocaleTimeString()}] ${msg}\n` + el.textContent;
            console.log(`[HegeDebug] ${msg}`);
        };

        // v1.1.3-beta25: Log specific Env Info
        window.hegeLog(`Env: ${navigator.platform}, TP:${navigator.maxTouchPoints}\nDevice: ${isIOS ? 'iOS/iPad' : 'Desktop'}\nUA: ${navigator.userAgent.substring(0, 50)}...`);

        // Update Mini Button Visibility
        function updateMiniButton() {
            const btn = document.getElementById('hege-mini-run');
            if (btn) btn.style.display = isMinimized ? 'inline-block' : 'none';
        }
        updateMiniButton();

        // Events
        document.getElementById('hege-toggle').onclick = () => {
            isMinimized = !isMinimized;
            localStorage.setItem(STATE_KEY, isMinimized);
            panel.classList.toggle('minimized', isMinimized);
            document.getElementById('hege-toggle').textContent = isMinimized ? '▼' : '▲';
            updateMiniButton();
        };

        // Mini Button Event
        const miniBtn = document.getElementById('hege-mini-run');
        if (miniBtn) {
            miniBtn.onclick = (e) => {
                e.stopPropagation();
                if (!miniBtn.disabled) handleMainButton();
            };
        }

        // v1.1.3-beta18: Anchor Logic (Aligned to Main Menu / Hamburger)
        function anchorPanel() {
            // Target the Main Menu (Hamburger - 2 lines)
            // It usually has aria-label="功能表", "Menu", "Settings", or "更多選項" in some contexts.
            // We look for SVGs in the generic header area.
            const svgs = document.querySelectorAll('svg');
            let anchor = null;

            for (let svg of svgs) {
                const label = (svg.getAttribute('aria-label') || '').trim();
                // Match common labels for the main menu
                if (label === '功能表' || label === 'Menu' || label === 'Settings' || label === '設定' || label === '更多選項') {
                    anchor = svg.closest('div[role="button"]') || svg;
                    break;
                }

                // Fallback: visual check for 2 lines (rects) IF it is in the top bar (clientY < 100)
                // Threads hamburger usually: <line> or <rect> elements.
                const rects = svg.querySelectorAll('rect, line');
                if (rects.length === 2 && svg.getBoundingClientRect().top < 100) {
                    // Check specific spacing/attributes if needed, but top-right 2-lines is almost surely it
                    anchor = svg.closest('div[role="button"]') || svg;
                    break;
                }
            }

            if (anchor) {
                const rect = anchor.getBoundingClientRect();
                if (rect.top >= 0) {
                    // v1.1.3-beta18: Position LEFT of the icon
                    panel.style.top = (rect.top) + 'px'; // Align top

                    // v1.1.3-beta19 Fix: iPad wants 3px more to right (smaller value)
                    let rightVal = window.innerWidth - rect.left + 5;

                    // iPad refinement (-3px to the value => shift right effectively? No, subtract 3 from Gap)
                    // User said "Right 3px" -> move panel to right -> reduce 'right' property.
                    rightVal = rightVal - 3;

                    // iPhone Safety: If effectively offscreen or weird, clamp it
                    if (window.innerWidth < 450) {
                        // Force safe zone
                        if (rightVal < 0) rightVal = 0;
                        if (rightVal > window.innerWidth - 100) rightVal = 10;
                    }

                    panel.style.right = rightVal + 'px';
                    panel.style.left = 'auto'; // Reset left
                }
            } else {
                // Fallback if no icon found (e.g. slight layout change)
                if (!panel.style.top || parseInt(panel.style.top) > 200) {
                    panel.style.top = '16px';
                    panel.style.right = '16px';
                    panel.style.left = 'auto';
                }
            }
        }

        anchorPanel();
        setInterval(anchorPanel, 1500);

        // Event Binding for List Items
        document.getElementById('hege-main-btn-item').onclick = handleMainButton;

        document.getElementById('hege-stop-btn-item').onclick = () => {
            if (confirm('確定要停止背景執行嗎？')) {
                localStorage.setItem(BG_CMD_KEY, 'stop');
                showToast('已發送停止指令');
            }
        };

        document.getElementById('hege-clear-sel-item').onclick = clearSelection;
        document.getElementById('hege-clear-db-item').onclick = () => {
            if (confirm('清空歷史?')) { historyDB.clear(); localStorage.setItem(DB_KEY, '[]'); updateControllerUI(); }
        };
        document.getElementById('hege-export-item').onclick = exportHistory;
        document.getElementById('hege-import-item').onclick = importList;

        // v1.1.3-beta32: Mode Toggle Logic
        const modeToggle = document.getElementById('hege-mode-toggle-item');
        const modeText = document.getElementById('hege-mode-text');
        const modeDesc = document.getElementById('hege-mode-desc');

        function updateModeUI() {
            const currentMode = localStorage.getItem(MAC_MODE_KEY) || 'background';
            if (currentMode === 'foreground') {
                modeText.textContent = '前景模式 (iOS模擬)';
                modeText.style.color = '#ff9f0a';
                modeDesc.textContent = '當前分頁執行';
            } else {
                modeText.textContent = '背景模式 (預設)';
                modeText.style.color = '#4cd964';
                modeDesc.textContent = '新分頁執行';
            }
        }
        updateModeUI();

        modeToggle.onclick = () => {
            const current = localStorage.getItem(MAC_MODE_KEY) || 'background';
            const next = current === 'background' ? 'foreground' : 'background';
            localStorage.setItem(MAC_MODE_KEY, next);
            updateModeUI();
            showToast(`已切換至: ${next === 'foreground' ? '前景模式' : '背景模式'}`);
        };

        // Header click toggles too
        document.getElementById('hege-header').onclick = (e) => {
            if (e.target.id !== 'hege-toggle') document.getElementById('hege-toggle').click();
        };

        // v1.1.3-beta22: Start the scanner! (Missing in beta21)
        setInterval(scanAndInject, 1200);
        scanAndInject(); // Run immediately

        // v1.1.3-beta24: UI Polling for Background Status Sync
        setInterval(updateControllerUI, 2000);
    }

    function updateControllerUI() {
        if (isBgPage) return;

        cleanDeadElements();

        // 1. Sync DB from Storage (Crucial for Page A to know what Page B finished)
        historyDB = new Set(JSON.parse(localStorage.getItem(DB_KEY) || '[]'));

        // v1.1.3-beta7: Update checkbox visual state for finished users
        document.querySelectorAll('.hege-checkbox-container').forEach(el => {
            const u = el.dataset.username;
            if (u && historyDB.has(u)) {
                if (!el.classList.contains('finished')) {
                    el.classList.add('finished');
                    el.classList.remove('checked');
                    // Also auto-remove from pending set
                    if (pendingUsers.has(u)) {
                        pendingUsers.delete(u);
                        sessionStorage.setItem(PENDING_KEY, JSON.stringify([...pendingUsers]));
                    }
                }
            }
        });

        // 2. Calculate Effective Queue (Exclude already blocked)
        const effectiveQueue = Array.from(pendingUsers).filter(u => !historyDB.has(u));
        const effectiveQSize = effectiveQueue.length;

        document.getElementById('hege-sel-count').textContent = `${pendingUsers.size} 選取`;
        // Badge in header
        const badge = document.getElementById('hege-queue-badge');
        if (pendingUsers.size > 0) badge.textContent = `(${pendingUsers.size})`;
        else badge.textContent = '';

        // Check Background Status
        const bgStatusRaw = localStorage.getItem(BG_STATUS_KEY);
        if (bgStatusRaw) {
            const s = JSON.parse(bgStatusRaw);
            const isRunning = (Date.now() - s.lastUpdate < 10000 && s.state === 'running');
            const stopBtn = document.getElementById('hege-stop-btn-item');
            if (stopBtn) stopBtn.style.display = isRunning ? 'flex' : 'none';

            if (isRunning) {
                document.getElementById('hege-header').style.borderColor = '#4cd964';
                document.getElementById('hege-main-btn-item').style.color = '#4cd964';
                document.querySelector('#hege-main-btn-item span').textContent = `背景執行中 ${s.progress}/${s.total}`;
            } else {
                document.getElementById('hege-header').style.borderColor = '#333';
                document.getElementById('hege-main-btn-item').style.color = '#f5f5f5';
                document.querySelector('#hege-main-btn-item span').textContent = '開始封鎖';
            }
        }
    }


    // v1.1.3-beta26: Foreground Blocking Logic (Moved UP for safety)
    async function runForegroundBlock() {
        const typeInfo = typeof runForegroundBlock;
        const ctrName = runForegroundBlock.constructor.name;
        window.hegeLog(`[DEBUG-START] runForegroundBlock (v${CURRENT_VERSION})`);
        window.hegeLog(`[DEBUG-SCOPE] Type:${typeInfo}, Ctr:${ctrName}, isRunning:${isRunning}, Cooldown:${cooldownUntil > Date.now()}`);
        window.hegeLog(`[DEBUG-DATA] Queue:${blockQueue.size}, Pending:${pendingUsers.size}`);
        if (isRunning || cooldownUntil > Date.now()) {
            window.hegeLog(`[DEBUG] Aborting: isRunning=${isRunning}, Cooldown=${cooldownUntil > Date.now()}`);
            return;
        }

        isRunning = true;

        try {
            // UI Updates
            const mainItem = document.getElementById('hege-main-btn-item');
            if (mainItem) {
                mainItem.style.pointerEvents = 'none';
                mainItem.style.opacity = '0.5';
                mainItem.querySelector('span').textContent = '啟動中...';
            }

            document.body.classList.add('hege-ghost-mode');

            let count = 0;
            const targets = Array.from(blockQueue);
            const total = targets.length;
            let successCount = 0;
            let failCount = 0;

            showToast(`iOS模式啟動：處理 ${total} 筆`);
            window.hegeLog(`Starting iOS Block: ${total} users`);

            for (let btn of targets) {
                if (cooldownUntil > Date.now()) { window.hegeLog('[DEBUG] Cooldown hit during loop'); break; }

                if (mainItem) mainItem.querySelector('span').textContent = `處理中 ${count + 1}/${total}`;

                // Ensure element is in view/interactable
                btn.scrollIntoView({ block: "center", inline: "center" });
                await sleep(500);

                try {
                    btn.style.transform = 'none';
                    window.hegeLog(`[DEBUG] Click More Button #${count + 1}`);
                    simClick(btn); // v1.1.3-beta29: simClick
                    await sleep(800);

                    // 1. Click Menu Item "Block"
                    let menuClicked = false;
                    let alreadyBlocked = false;
                    const menuItems = document.querySelectorAll('div[role="menuitem"], div[role="button"]');

                    if (DEBUG_MODE) {
                        const menuTexts = Array.from(menuItems).map(i => i.innerText.trim().substring(0, 10));
                        window.hegeLog(`[DEBUG] Menu Items Found: ${menuItems.length} -> [${menuTexts.join(', ')}]`);
                    }

                    for (let i = menuItems.length - 1; i >= 0; i--) {
                        const text = menuItems[i].innerText.trim();

                        // v1.1.3-beta34: "Already Blocked" Detection in Foreground Mode
                        if (text.includes('解除封鎖') || text.includes('Unblock')) {
                            window.hegeLog(`[DEBUG] Found 'Unblock' -> Already Blocked. Marking success.`);
                            alreadyBlocked = true;
                            // Close menu
                            document.body.click();
                            break;
                        }

                        if (text.includes('封鎖') || text.includes('Block')) {
                            window.hegeLog(`[DEBUG] Click Block Item: ${text}`);
                            simClick(menuItems[i]); // v1.1.3-beta29: simClick
                            // Some menus have nested span
                            if (menuItems[i].querySelector('span')) simClick(menuItems[i].querySelector('span'));
                            menuClicked = true; break;
                        }
                    }

                    if (alreadyBlocked) {
                        // Mark as success and continue to next
                        if (btn.dataset.username) {
                            const u = btn.dataset.username;
                            saveToDB(u);
                            if (pendingUsers.has(u)) {
                                pendingUsers.delete(u);
                                sessionStorage.setItem(PENDING_KEY, JSON.stringify([...pendingUsers]));
                            }
                        }
                        successCount++;
                        blockQueue.delete(btn);
                        window.hegeLog(`Blocked #${count + 1} Success (Already Blocked)`);
                        // Hide Parent Post
                        let c = btn.parentElement; for (let i = 0; i < 6; i++) { if (c?.parentElement) c = c.parentElement; }
                        if (c) c.style.display = 'none';
                        updateControllerUI();
                        await sleep(500); count++;
                        continue;
                    }

                    if (!menuClicked) {
                        window.hegeLog(`Err: Menu 'Block' not found for #${count + 1}`);
                        // Dump menu again for clarity if failed
                        if (DEBUG_MODE) {
                            const retryItems = document.querySelectorAll('div[role="menuitem"], div[role="button"]');
                            const retryTexts = Array.from(retryItems).map(i => i.innerText.trim().substring(0, 20));
                            window.hegeLog(`[DEBUG-FAIL-DUMP] Menu Items: ${retryTexts.join(' | ')}`);
                        }
                        document.body.click(); failCount++; continue;
                    }
                    await sleep(1000);

                    // 2. Check for Error
                    if (checkForError()) { window.hegeLog('Err: Safety Limit Triggered'); triggerSafetyStop(); break; }

                    // 3. Confirm Block
                    let confirmClicked = false;
                    const allButtons = document.querySelectorAll('div[role="button"]');
                    for (let i = allButtons.length - 1; i >= 0; i--) {
                        const b = allButtons[i];
                        const text = b.innerText.trim();
                        const style = window.getComputedStyle(b);
                        if ((text.includes('封鎖') || text.includes('Block') || style.color === 'rgb(255, 59, 48)') && b.offsetParent !== null) {
                            simClick(b); // v1.1.3-beta29: simClick
                            confirmClicked = true; break;
                        }
                    }

                    if (!confirmClicked) {
                        const dialog = document.querySelector('div[role="dialog"]');
                        if (dialog) {
                            const dialogBtns = dialog.querySelectorAll('div[role="button"]');
                            if (dialogBtns.length > 0) {
                                simClick(dialogBtns[dialogBtns.length - 1]); // v1.1.3-beta29: simClick
                                confirmClicked = true;
                            }
                        }
                    }

                    if (confirmClicked) {
                        await sleep(2000);

                        // Stuck Dialog Check
                        if (document.querySelector('div[role="dialog"]')) {
                            window.hegeLog('Dialog stuck, trying close...');
                            document.body.click(); // Try close
                            await sleep(500);
                            if (document.querySelector('div[role="dialog"]')) { window.hegeLog(`Err: Stuck dialog #${count + 1}`); failCount++; continue; }
                        }

                        if (btn.dataset.username) {
                            const u = btn.dataset.username;
                            saveToDB(u);
                            // v1.1.3-beta30: Explicitly remove from pendingUsers
                            if (pendingUsers.has(u)) {
                                pendingUsers.delete(u);
                                sessionStorage.setItem(PENDING_KEY, JSON.stringify([...pendingUsers]));
                            }
                        }
                        successCount++;
                        blockQueue.delete(btn);
                        window.hegeLog(`Blocked #${count + 1} Success`);

                        // Hide Parent Post
                        let c = btn.parentElement; for (let i = 0; i < 6; i++) { if (c?.parentElement) c = c.parentElement; }
                        if (c) c.style.display = 'none';

                        updateControllerUI();
                    } else {
                        window.hegeLog(`Err: Confirm btn not found #${count + 1}`);
                        document.body.click(); failCount++;
                    }
                } catch (e) { window.hegeLog(`Err Exception: ${e.message}`); console.error(e); failCount++; }
                await sleep(500); count++;
            }

            showToast(`iOS 執行完成。成功: ${successCount}, 失敗: ${failCount}`);
            window.hegeLog(`Done. Success: ${successCount}, Fail: ${failCount}`);

            if (failCount > 0) alert(`完成。\n成功: ${successCount}\n失效: ${failCount}`);
        } catch (e) {
            window.hegeLog(`[FATAL] Error in runForegroundBlock: ${e.message}`);
            console.error(e);
        } finally {
            isRunning = false;
            document.body.classList.remove('hege-ghost-mode');
            const mainItem = document.getElementById('hege-main-btn-item');
            if (mainItem) {
                mainItem.style.pointerEvents = 'auto';
                mainItem.style.opacity = '1';
                mainItem.querySelector('span').textContent = '開始封鎖';
            }
            updateControllerUI();
        }
    }

    // --- 4. 主按鈕邏輯 ---
    async function handleMainButton() {
        if (pendingUsers.size === 0) { showToast('請先勾選用戶！'); return; }

        // v1.1.3-beta24: Robust iOS Detection
        // iPad often reports "Macintosh" with maxTouchPoints > 0
        const isIPad = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || isIPad;
        // v1.1.3-beta46: Broaden check to isMobile to prevent App opening on Android too
        const isMobile = isIOS || /Android|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

        window.hegeLog(`Btn Clicked. Ver: ${CURRENT_VERSION} Mode: ${isMobile ? 'Mobile(FG)' : 'Desktop'} Time: ${new Date().toISOString()}`);

        // v1.1.3-beta32: Desktop Mode Check
        const desktopMode = localStorage.getItem(MAC_MODE_KEY) || 'background';

        if (isMobile || desktopMode === 'foreground') {
            // iOS OR Desktop Foreground Mode
            window.hegeLog(`[DEBUG] Starting Foreground Block (Reason: ${isIOS ? 'iOS' : 'Desktop-FG-Mode'})...`);

            if (typeof runForegroundBlock !== 'function') {
                window.hegeLog('[FATAL] runForegroundBlock is NOT a function!');
                alert('Fatal Error: runForegroundBlock missing');
                return;
            }

            try {
                await runForegroundBlock();
                window.hegeLog('[DEBUG] runForegroundBlock returned.');
            } catch (e) {
                window.hegeLog(`[FATAL] Call Failed: ${e.message}`);
            }
        } else {
            // Desktop: Background Mode (Default)
            // Sync DB first
            historyDB = new Set(JSON.parse(localStorage.getItem(DB_KEY) || '[]'));
            const usersToAdd = Array.from(pendingUsers).filter(u => !historyDB.has(u));
            if (usersToAdd.length === 0) return;
            let activeQueue = JSON.parse(localStorage.getItem(BG_QUEUE_KEY) || '[]');
            const newQueue = [...new Set([...activeQueue, ...usersToAdd])];
            localStorage.setItem(BG_QUEUE_KEY, JSON.stringify(newQueue));
            showToast(`已提交 ${usersToAdd.length} 筆至背景佇列`);
            const bgStatusRaw = localStorage.getItem(BG_STATUS_KEY);
            let isBgRunning = false;
            if (bgStatusRaw) {
                const s = JSON.parse(bgStatusRaw);
                if (Date.now() - s.lastUpdate < 10000 && s.state === 'running') isBgRunning = true;
            }
            if (!isBgRunning) {
                localStorage.removeItem(BG_CMD_KEY);
                window.open('https://www.threads.net/?hege_bg=true', 'HegeBlockWorker', 'width=350,height=450,left=0,top=0,menubar=no,toolbar=no,location=no,status=no');
            } else {
                showToast('已合併至正在運行的背景任務');
            }
        }
    }




    // v1.1.3-beta23: Foreground Blocking Logic (Ported from v1.1.2)

    // --- 5. 掃描與注入 (Reverted to v1.1.2 Logic) ---
    function scanAndInject() {
        // v1.1.2 Logic
        // if (isSelfProfile()) return; // Included in beta logic? Let's check. Beta doesn't have isSelfProfile helper yet, skipping for now as it wasn't requested explicitly, but v1.1.2 code has it.
        // User only asked to refer to v1.1.2 checkbox logic.

        const moreSvgs = document.querySelectorAll('svg[aria-label="更多"], svg[aria-label="More"]');
        moreSvgs.forEach(svg => {
            const btn = svg.closest('div[role="button"]');
            if (!btn || !btn.parentElement) return;
            // v1.1.3-beta22: Removed innerText check to avoid false negatives if hidden text exists
            // if (btn.innerText.trim().length > 0) return;

            // v1.1.2 filters (Relaxed for beta22)
            // if (svg.querySelector('rect')) return; // Allow rects if they match "More"

            // Basic SVG integrity check
            if (!svg.querySelector('circle') && !svg.querySelector('path')) return;

            const viewBox = svg.getAttribute('viewBox');
            if (viewBox === '0 0 12 12' || viewBox === '0 0 13 12') return;
            const width = svg.style.width ? parseInt(svg.style.width) : 24; // v1.1.2 used this
            if (width < 16 && svg.clientWidth < 16) return; // Hybrid check

            if (btn.parentElement.querySelector('.hege-checkbox-container')) return;
            if (btn.getAttribute('data-hege-checked') === 'true') return;

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

            let username = null;
            try {
                // Beta logic for username extraction is robust, let's mix it with v1.1.2 structure?
                // v1.1.2 used: closest('div[data-pressable-container="true"]') ...
                // Let's use the Beta extraction which covers more cases, or stick to v1.1.2 if user insists?
                // User said "refer to v1.1.2 checkbox". I should probably stick to v1.1.2 extraction if possible,
                // but Beta logic was improved. I'll stick to Beta extraction for better compatibility, 
                // but use v1.1.2 UI structure.

                // Heuristic to find closest link (Beta)
                let p = btn.parentElement;
                let foundLink = null;
                for (let i = 0; i < 5; i++) {
                    if (!p) break;
                    foundLink = p.querySelector('a[href^="/@"]');
                    if (foundLink) break;
                    p = p.parentElement;
                }
                if (foundLink) {
                    username = foundLink.getAttribute('href').split('/@')[1].split('/')[0];
                    if (username) {
                        btn.dataset.username = username;
                        container.dataset.username = username;
                    }
                }
            } catch (e) { }

            // v1.1.2 Event Binding
            if (username && pendingUsers.has(username)) {
                container.classList.add('checked');
                blockQueue.add(btn);
            }

            container.ontouchend = (e) => e.stopPropagation();
            container.onclick = (e) => {
                e.stopPropagation();

                // v1.1.3-beta29: Unlock History (Re-queue)
                if (container.classList.contains('finished')) {
                    if (username) {
                        historyDB.delete(username);
                        localStorage.setItem(DB_KEY, JSON.stringify([...historyDB]));

                        container.classList.remove('finished');
                        container.classList.add('checked');
                        blockQueue.add(btn);
                        pendingUsers.add(username);
                        sessionStorage.setItem(PENDING_KEY, JSON.stringify([...pendingUsers]));
                        showToast('已重置並重新加入排程');
                    }
                    updateControllerUI();
                    return;
                }

                if (container.classList.contains('checked')) {
                    container.classList.remove('checked');
                    blockQueue.delete(btn);
                    if (username) {
                        pendingUsers.delete(username);
                        sessionStorage.setItem(PENDING_KEY, JSON.stringify([...pendingUsers]));
                    }
                } else {
                    container.classList.add('checked');
                    blockQueue.add(btn);
                    if (username) {
                        pendingUsers.add(username);
                        sessionStorage.setItem(PENDING_KEY, JSON.stringify([...pendingUsers]));
                    }
                }
                updateControllerUI();
            };
            try {
                const ps = window.getComputedStyle(btn.parentElement).position;
                if (ps === 'static') btn.parentElement.style.position = 'relative';
                btn.parentElement.insertBefore(container, btn);
            } catch (e) { }
        });
    }

    function cleanDeadElements() {
        for (let btn of blockQueue) {
            if (!btn.isConnected) blockQueue.delete(btn);
        }
    }

    function clearSelection() {
        blockQueue.forEach(btn => {
            btn.style.transform = 'none';
            const c = btn.parentElement.querySelector('.hege-checkbox-container');
            if (c) c.classList.remove('checked');
        });
        blockQueue.clear();
        pendingUsers.clear();
        sessionStorage.setItem(PENDING_KEY, '[]');
        updateControllerUI();
        showToast('已清除勾選狀態 (不影響背景任務)');
    }

    function exportHistory() {
        if (historyDB.size === 0) { showToast('歷史資料庫是空的', 2000, '#ff3b30'); return; }
        const list = [...historyDB].join('\n');
        navigator.clipboard.writeText(list).then(() => { showToast(`已複製 ${historyDB.size} 人名單`, 2000); }).catch(() => { prompt("請手動複製總名單：", list); });
    }

    function importList() {
        const input = prompt("請貼上 ID 名單："); if (!input) return;
        let rawUsers = input.split(/[\s,，\n]+/).map(u => u.trim()).filter(u => u.length > 0).map(u => {
            if (u.includes('/@')) return u.split('/@')[1].split('/')[0];
            if (u.startsWith('@')) return u.substring(1);
            return u.split('/')[0];
        });

        // Filter out those already blocking or blocked
        const newUsers = rawUsers.filter(u => !historyDB.has(u));

        if (newUsers.length === 0) { showToast('名單全數已在歷史紀錄中', 3000, '#ff3b30'); return; }

        // Add to Active Queue directly
        let activeQueue = JSON.parse(localStorage.getItem(BG_QUEUE_KEY) || '[]');
        const combinedQueue = [...new Set([...activeQueue, ...newUsers])];
        localStorage.setItem(BG_QUEUE_KEY, JSON.stringify(combinedQueue));

        showToast(`已匯入 ${newUsers.length} 筆至背景佇列`);

        // Auto-start if not running
        const bgStatusRaw = localStorage.getItem(BG_STATUS_KEY);
        let isRunning = false;
        if (bgStatusRaw) {
            const s = JSON.parse(bgStatusRaw);
            if (Date.now() - s.lastUpdate < 10000 && s.state === 'running') isRunning = true;
        }

        if (!isRunning && confirm(`已匯入 ${newUsers.length} 筆名單。\n是否立即開始背景執行？`)) {
            // v1.1.3-beta6: Use Popup Window
            window.open('https://www.threads.net/?hege_bg=true', 'HegeBlockWorker', 'width=350,height=450,left=0,top=0,menubar=no,toolbar=no,location=no,status=no');
        } else if (isRunning) {
            showToast('已合併至正在運行的背景任務');
        }
        alert(`⚠️ 嚴重警示：\n\n系統偵測到「稍後再試」等限制訊息。\n背景執行已停止。`);
    }

    function makeDraggable(element, handle) {
        let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
        handle.onmousedown = dragMouseDown;
        function dragMouseDown(e) {
            if (e.target.id === 'hege-mini-run' || e.target.id === 'hege-toggle') return;
            e = e || window.event; e.preventDefault(); pos3 = e.clientX; pos4 = e.clientY; document.onmouseup = closeDragElement; document.onmousemove = elementDrag;
        }
        function elementDrag(e) {
            e = e || window.event; e.preventDefault();
            pos1 = pos3 - e.clientX; pos2 = pos4 - e.clientY; pos3 = e.clientX; pos4 = e.clientY;
            element.style.top = (element.offsetTop - pos2) + "px";
            element.style.left = (element.offsetLeft - pos1) + "px";
            element.style.right = 'auto'; // Fix sticky right
        }
        function closeDragElement() { document.onmouseup = null; document.onmousemove = null; localStorage.setItem(POS_KEY, JSON.stringify({ top: element.style.top, left: element.style.left })); }
    }

    // --- 6. 啟動入口 ---
    function main() {
        if (isBgPage) {
            initWorker();
        } else {
            // Prevent running in iframes for Controller
            if (window.top !== window.self) return;
            initController();
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', main);
    } else {
        main();
    }

})();
