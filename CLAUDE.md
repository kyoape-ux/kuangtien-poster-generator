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

## 學會壁報助手（2026-10-27 新增，同日改為規格可自訂）

- 首頁卡片／下載列按鈕 `confOpen()` 開啟 `#conf-overlay`。步驟 0 是規格表單：常用尺寸 `CONF_PRESETS`（只有尺寸：9:16、16:9、A4–A0、展板、自訂；**不可放任何學會名稱或預填容量／字級／檔名**，使用者要求）、頁面公分、直↔橫、匯出 DPI、容量上限、最小字級、標籤、檔名、活動名、單位；存 localStorage `ktgh_conf_spec_v1`。
- 版型不在 templates.json，由 `confBuildTemplate(spec)` 依 `spec.style` 分派：`confBuildCard`（預設，卡片式專業版：底色＋裝飾圓、漸層標題區疊作者卡、超橢圓編號徽章卡片、成果數字磚、圖表／照片位置、結論強調卡、深色頁尾＋QR）或 `confBuildSimple`（簡潔式）；配色 `CONF_THEMES`（indigo/green/blue/warm/red，皆品牌色）。字級依頁寬 0.55 次方換算且 ≥ 最小字級，放不下自動縮字、再逐步簡化（去圖表→去照片→短句→2 行→去數字磚→標題 1 行）。經 `applyTemplateObj(tpl)` 套用（`applyTemplate(id)` 已拆成查找＋套用）。
- 使用者明確要求：成品要有設計感、不能陽春，否則無法給同事用；預設清單只能是尺寸、不可帶學會名稱。
- `_drawPolyCanvas` 補上 superellipse（匯出 PNG/PDF 之前會漏畫超橢圓，徽章會消失）。
- `S.pdfSpec={mm,name,maxMB,minPt,dpi,label}` 隨 pages／autosave 保存；畫布 px＝mm×3.7795（1 px＝0.75 pt）。
- `exportPDF()`：頁面用規格 mm、倍率 `_exportScaleFor()`（規格 dpi/96，否則長邊 ≥2880px，總像素上限 60M 自動降）、容量上限自動降 JPEG 品質、匯出前檢查小於 minPt 的文字、完成提示顯示 MB／px／dpi（<150 dpi 警告）。
- `dlPoster()` PNG 同樣用 `_exportScaleFor()` 高解析度並以 `pngSetDpi` 寫入 dpi、檔名用規格檔名；`downloadCanvasDpi()` 共用。
- `applyTemplate` 已支援 `shape` 物件。
- 同仁用可列印指南：`docs/conf-poster-guide.html`（桌面「學會壁報AI製作指南」資料夾有副本，改了請同步）。
