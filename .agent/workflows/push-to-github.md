---
description: Push codebase and release tags to GitHub
---

如果你還沒有綁定 GitHub 儲存庫，請**先在終端機執行第一步**；如果已經綁定過，則只要執行後續步驟即可。

1. **[首次設定]** 綁定你的 GitHub 遠端儲存庫網址 (請將網址替換成你的專案位置)
```bash
git remote add origin https://github.com/skiseiju/Threads-Block-Tool
```

// turbo-all
2. 將本地端的 main 分支推送到 GitHub
```bash
git push -u origin main
```

3. 將所有的發行版號 (標籤 Tags) 推送到 GitHub
```bash
git push --tags
```