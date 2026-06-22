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
