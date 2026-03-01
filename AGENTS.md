# Project Guidelines

## 🚨 封鎖機制修改規範

在修改以下任何檔案之前，**必須先閱讀** [`BLOCKING_ARCHITECTURE.md`](./BLOCKING_ARCHITECTURE.md)：

- `src/core.js`
- `src/worker.js`
- `src/main.js`
- `src/ui.js`（事件綁定相關）

該文件記錄了：
- 三種封鎖路徑（Mobile 同分頁 / Desktop 背景 / Desktop 前景）的完整架構
- iOS Universal Links 安全限制與唯一合法的導航方式
- 觸控事件綁定策略差異（面板 vs Checkbox vs 同列全封）
- 資料儲存結構

**違反文件中記載的限制（如在 iOS 上使用 `window.location.href` 導航）將導致嚴重的功能破壞。**

## 📦 版本與建置規範

- 每一次程式碼修改後，都必須在 `src/config.js` 中 **遞增 beta 版號**（例如 `2.0.7-beta22` → `2.0.7-beta23`）。
- 使用 `./build.sh --no-bump` 進行建置（避免 build script 自行跳號）。
- **禁止自行發布正式版**。只有當使用者明確說「可以發布正式版」時，才執行以下流程：
  1. 使用 `./build.sh --release` 去除 beta 標籤
  2. 更新 `README.md` 中的版本號與功能說明
  3. 更新 `CHANGELOG.md`，以第一句話作為 TL;DR 摘要（Convention over Configuration 原則）
  4. 確認建置成功後，依使用者指示進行 commit / push
