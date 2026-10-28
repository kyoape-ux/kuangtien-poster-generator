# 美編小助手（海報產生器 Pro）｜開發規範

> 本檔為專案層規範，全域 CI／技術規範詳見 `~/.claude/CLAUDE.md`。

## 專案基本資訊

| 欄位         | 內容                                                              |
|--------------|-------------------------------------------------------------------|
| 工具名稱     | 美編小助手（光田醫院｜海報產生器 Pro）                            |
| GitHub Repo  | `kyoape-ux/kuangtien-poster-generator`                            |
| GitHub Pages | `https://kyoape-ux.github.io/kuangtien-poster-generator/`        |
| 本機路徑     | `/Users/jyunhao/dev/poster-generator-deploy`（**勿放桌面**，見下）|
| 唯一主程式   | `docs/index.html`（線上實際發佈的就是它）                         |
| localStorage | `ktgh_poster_v1`                                                  |
| 目前版本     | v3.0（updated 2026/06/12）                                        |

## ⚠️ 正確檔案 / 目錄結構（改錯檔會白做工）

```
poster-generator-deploy/
├── docs/                ← GitHub Pages 發佈來源，只有這裡會上線
│   ├── index.html       ← ★唯一要改的主程式（約 396 KB, v3.0）
│   ├── templates.json   版型定義
│   ├── assets.json / assets/   素材設定與資源
│   └── logos/           Logo 圖檔
├── src-assets/          設計原始檔（.ai / Logo / 公版範本 / 測試 svg）— 不發佈
├── archive/             封存：舊原型 poster-generator.html（22KB, 2026-03 已過時）+ 交接文件
├── CLAUDE.md / README.md
└── .git/
```

- **要改的永遠是 `docs/index.html`。** `archive/poster-generator.html` 是 2026-03 的舊原型（只有 22KB），**絕對不要改它**，跟線上版差 18 倍、毫無關聯。
- `src-assets/` 與 `archive/` 在 repo 根目錄、不在 `docs/`，所以**不會上線**到 GitHub Pages。
- 桌面上的「光田海報產生器-專案」是替身（symlink），指向本機路徑，**不要把專案實體搬進 `~/Desktop`** — 桌面是 macOS 受保護資料夾，會導致本機預覽伺服器讀不到檔案（全部 404）。

## 本機開發 / 預覽

- 預覽伺服器設定於工作目錄的 `.claude/launch.json`（名稱 `poster-generator`，port 3464，服務 `docs/`）。
- 用 preview_start 啟動後開 `http://localhost:3464/`；改完 `docs/index.html` 重新整理即見效。
- 部署：改 `docs/` → `git commit` → `git push`，GitHub Pages 自動上線。部署只看 push，與本機資料夾位置無關。

## 工具功能簡述

供光田行銷部門美編人員快速產生院內海報草稿。
支援多種版型（直式/橫式）、科別色票套用，可匯出 PNG 或列印。
純前端，無需安裝，用瀏覽器直接開啟。

## 受保護檔案

| 檔案 | 說明 |
|------|------|
| `docs/index.html` | 主程式，含所有版型與產生邏輯（唯一發佈版）|

## 開發原則

- 版型新增時，以現有版型程式碼為範本複製修改，不要重寫整個版型引擎
- 色票套用使用全域 CI 色票，不另外定義科別顏色
- 匯出優先用 `html2canvas` → PNG，不強求 PDF

## 待辦

- [ ] 盤點現有版型，建立 ROADMAP.md
- [ ] 補充橫式版型

## 資安現況（2026-10-28 決議）

- 使用者決議：網站維持 GitHub Pages 公開網址、**不加登入**（生產力工具，不想增加同仁負擔）。曾試做 Cloudflare Workers 靜態資產＋Access，已刪除臨時網站 `ktgh-poster`。
- 前端已移除 Firebase SDK 與寫死的管理員密碼；共用範本走 Worker：`GET /api/templates`（公開讀，KV `tpl:shared`）、`POST /api/templates`（需 `X-Admin-Token` ＝ Worker 秘密 `ADMIN_TOKEN`）、`GET /api/admin-check`。管理員金鑰只存 sessionStorage。金鑰檔 `.admin-token.txt`（git 忽略），重設用 `setup-admin-token.sh`。
- QR 碼全部本地產生（cdnjs qrcode-generator 1.4.4）。
- 已移除未使用的付費 Nano Banana 端點 `/api/design`。Worker 部署與秘密寫入需使用者自己跑（自動模式會擋）：`npx wrangler deploy --config /Users/jyunhao/dev/poster-generator-deploy/worker-gen/wrangler.toml`。
- 待辦（建議使用者處理）：刪除 Firebase 專案 kuangtien-poster；第三方腳本加 SRI 或自行託管；repo 歷史仍含舊密碼與 Firebase apiKey（專案刪除後即失效）。

## 學會壁報助手已移除（2026-10-28）

- 使用者判斷：一年申請學會海報很少、自動排版贏不了 PPT／Canva／美編，整個功能拿掉（首頁卡片、海報編輯按鈕、734＋行程式、Worker `/api/outline`、說明頁）。
- 完整程式保留在 git 標籤 `conf-assistant-v1`，要還原可 `git checkout conf-assistant-v1 -- docs/index.html docs/conf-poster-guide.html`。
- 保留的通用改進：匯出自動換行與裁切（`_wrapCanvasLines`）、`applyTemplateObj`、`applyTemplate` 支援 shape、本地 QR（`qrDataUrl`）、匯出 DPI 與 PNG 寫入 dpi（`_exportScaleFor`、`downloadCanvasDpi`）、群組內再點一次單選、共用範本走 Worker。
- 給美編的公版需求清單與歷年範本分析在桌面「學會壁報AI製作指南」資料夾。

## AI 生圖已移除（2026-10-28）

- 使用者判斷「沒用、不好看」，海報編輯的「AI 生成底圖」、圖片編輯的「AI 生成圖片」、院內 Workers AI（FLUX／Qwen）全部移除，也決定不做使用計數。完整舊程式見 git 標籤 `ai-gen-v1`。
- Worker `ktgh-poster-gen` 現在只剩共用範本：`GET/POST /api/templates`、`GET /api/admin-check`（78 行，無 AI 綁定）。前端常數改名 `WORKER_API`。
- 素材資源頁仍有外部 AI 工具的連結（只是連結）。

## 海報編輯過渡期（2026-10-28 起，至 2026-11-28）

- 使用者決議：海報改引導到 Canva（協作方便），海報編輯先過渡一個月再決定是否下架。已加：海報編輯頂端黃色提示條（可關，sessionStorage `kt_canva_note_off`）、首頁「用 Canva 做海報」卡片、`canvaGuideOpen()` 起手式視窗（品牌色可複製、院徽下載、常用尺寸、輸出提醒、院內輔助工具捷徑）。
- 美編上架 Canva 公版後，到 `docs/index.html` 的 `CANVA_TEMPLATES` 陣列加 `{name,url,note}`；期限改 `CANVA_DEADLINE`。
- 到期若沒人反對：移除海報編輯（約 5,000 行：物件系統、版面、屬性面板、範本、素材庫、專案存取、表格），保留圖片編輯／批次浮水印／QR／拼貼；舊程式留在 git 標籤（下架前先打標籤）。
- 先決條件：美編把電視圖卡、社群貼文、衛教海報、邀請卡等常用公版做到 Canva；確認 Canva 免費版能否鎖定品牌色字型、是否申請非營利版。
