# 美編小助手 存取控管搬遷（P0）

目標：工具改由 Cloudflare Pages 提供，前面加 Cloudflare Access（允許名單與影音企劃中心、行銷整合分析中心共用），GitHub Pages 只留導向頁。

## 一、Worker 秘密與部署（共用範本寫入、AI 自動填表）

```bash
# 1. 產生一組管理員金鑰（自己保管，之後在工具的「管理員模式」輸入）
openssl rand -base64 24

# 2. 存成 Worker 秘密（貼上剛才的金鑰）
npx wrangler secret put ADMIN_TOKEN --config /Users/jyunhao/dev/poster-generator-deploy/worker-gen/wrangler.toml

# 3. 部署 Worker（含 /api/templates、/api/outline）
npx wrangler deploy --config /Users/jyunhao/dev/poster-generator-deploy/worker-gen/wrangler.toml
```

## 二、Cloudflare Pages

```bash
cd /Users/jyunhao/dev/poster-generator-deploy
npx wrangler pages project create ktgh-poster --production-branch main
bash deploy-pages.sh
```

完成後網址：https://ktgh-poster.pages.dev（wrangler.toml 的 ALLOWED_ORIGINS 已包含）。

## 三、Cloudflare Access（Zero Trust 主控台）

1. Zero Trust → Access → Applications → Add an application → Self-hosted。
2. Application domain：`ktgh-poster.pages.dev`。
3. Policy：Allow，Include → Emails 或既有的允許名單群組（與影音企劃中心相同）。
4. 儲存後開無痕視窗測試：未登入應看到 Cloudflare Access 登入頁。

## 四、GitHub Pages 收尾

Access 確認可用後，把 `docs/index.html` 換成導向頁（或在 repo 設定關閉 Pages），避免兩個入口並存。

## 五、Firebase 收尾

前端已不再使用 Firebase。到 Firebase 主控台把專案 `kuangtien-poster` 的 Firestore 規則改為全部拒絕，或直接刪除專案。
