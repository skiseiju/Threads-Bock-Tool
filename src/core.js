import { CONFIG } from './config.js';
import { Utils } from './utils.js';
import { Storage } from './storage.js';
import { UI } from './ui.js';

export const Core = {
    blockQueue: new Set(),
    pendingUsers: new Set(),

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
            for (const mutation of mutations) {
                if (mutation.addedNodes.length > 0) {
                    shouldScan = true; break;
                }
            }
            if (shouldScan) Core.scanAndInject();
        });

        Core.observer.observe(document.body, { childList: true, subtree: true });

        // Backup polling (much slower) just in case
        setInterval(Core.scanAndInject, 5000);
        Core.scanAndInject();
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
                let p = btn.parentElement; let foundLink = null;
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

            if (username) {
                if (db.has(username)) {
                    container.classList.add('finished');
                } else if (Core.pendingUsers.has(username)) {
                    container.classList.add('checked');
                    Core.blockQueue.add(btn);
                }
            }

            container.ontouchend = (e) => e.stopPropagation();
            container.onclick = (e) => {
                e.stopPropagation();
                const currentDB = new Set(Storage.getJSON(CONFIG.KEYS.DB_KEY));
                if (container.classList.contains('finished')) {
                    if (username) {
                        currentDB.delete(username);
                        Storage.setJSON(CONFIG.KEYS.DB_KEY, [...currentDB]);
                        container.classList.remove('finished');
                        container.classList.add('checked');
                        Core.blockQueue.add(btn);
                        Core.pendingUsers.add(username);
                        Storage.setSessionJSON(CONFIG.KEYS.PENDING, [...Core.pendingUsers]);
                        UI.showToast('已重置並重新加入排程');
                    }
                    Core.updateControllerUI(); return;
                }
                if (container.classList.contains('checked')) {
                    container.classList.remove('checked');
                    Core.blockQueue.delete(btn);
                    if (username) {
                        Core.pendingUsers.delete(username);
                        Storage.setSessionJSON(CONFIG.KEYS.PENDING, [...Core.pendingUsers]);
                    }
                }
                else {
                    container.classList.add('checked');
                    Core.blockQueue.add(btn);
                    if (username) {
                        Core.pendingUsers.add(username);
                        Storage.setSessionJSON(CONFIG.KEYS.PENDING, [...Core.pendingUsers]);
                    }
                }
                Core.updateControllerUI();
            };

            try {
                const ps = window.getComputedStyle(btn.parentElement).position;
                if (ps === 'static') btn.parentElement.style.position = 'relative';
                btn.parentElement.insertBefore(container, btn);
            } catch (e) { }
        });
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

        // Only update visible elements or those that need state change
        document.querySelectorAll('.hege-checkbox-container').forEach(el => {
            const u = el.dataset.username;
            if (u && db.has(u)) {
                if (!el.classList.contains('finished')) {
                    el.classList.add('finished');
                    el.classList.remove('checked');
                    if (Core.pendingUsers.has(u)) {
                        Core.pendingUsers.delete(u);
                        Storage.setSessionJSON(CONFIG.KEYS.PENDING, [...Core.pendingUsers]);
                    }
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
            mainText = `背景執行中 ${bgStatus.progress}/${bgStatus.total}`;
            headerColor = '#4cd964';
            badgeText = `(${bgStatus.progress}/${bgStatus.total})`; // Show progress in header badge explicitly
        }

        const badge = document.getElementById('hege-queue-badge');
        if (badge) badge.textContent = badgeText;

        const stopBtn = document.getElementById('hege-stop-btn-item'); if (stopBtn) stopBtn.style.display = shouldShowStop ? 'flex' : 'none';
        const mainItem = document.getElementById('hege-main-btn-item');
        if (mainItem) { mainItem.querySelector('span').textContent = mainText; mainItem.style.color = shouldShowStop ? headerColor : '#f5f5f5'; }
        const header = document.getElementById('hege-header'); if (header) header.style.borderColor = headerColor;
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
                window.open('https://www.threads.net/?hege_bg=true', 'HegeBlockWorker', 'width=800,height=600');
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
            window.open('https://www.threads.net/?hege_bg=true', 'HegeBlockWorker', 'width=800,height=600');
        } else if (isRunning) {
            UI.showToast('已合併至正在運行的背景任務');
        }
    }
};
