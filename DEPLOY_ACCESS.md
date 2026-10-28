# 美編小助手 存取控管（P0）

現況（2026-10-28 已由 Claude 部署）：
- Worker `ktgh-poster-gen`：已含 /api/templates、/api/admin-check、/api/outline。
- 網站 `https://ktgh-poster.ktghvideo.workers.dev`（Workers 靜態資產，內容取自 docs/）。重新部署：`bash deploy-pages.sh`。

## 待你本人完成

### 1. 管理員金鑰（寫入 Worker 秘密，自動模式不允許代為寫入）

```bash
bash /Users/jyunhao/dev/poster-generator-deploy/setup-admin-token.sh
```

金鑰存到 `.admin-token.txt`（不進 git），在美編小助手左側「管理員模式」輸入。

### 2. Cloudflare Access（Zero Trust 主控台，屬安全設定）

1. Zero Trust → Access → Applications → Add an application → Self-hosted。
2. Application domain：`ktgh-poster.ktghvideo.workers.dev`。
3. Policy：Allow，Include 選與影音企劃中心相同的 Emails 或群組。
4. 開無痕視窗測試：未登入應出現 Cloudflare Access 登入頁。

### 3. 收尾

- Access 確認可用後，把 GitHub Pages 的 `docs/index.html` 換成導向頁，或關閉 Pages。
- Firebase 主控台把專案 `kuangtien-poster` 的 Firestore 規則改為全部拒絕，或刪除專案。
