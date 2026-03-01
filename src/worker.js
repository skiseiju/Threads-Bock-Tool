import { CONFIG } from './config.js';
import { Utils } from './utils.js';
import { Storage } from './storage.js';

export const Worker = {
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
