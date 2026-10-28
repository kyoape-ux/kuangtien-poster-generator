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

- 首頁卡片／下載列按鈕 `confOpen()` 開啟 `#conf-overlay`，三個頁籤：1 規格、2 內容與照片（內容模型 `CC`，localStorage `ktgh_conf_content_v1`：title/subtitle/authors/email/qr、sections 2–6、stats 0–4、photos 0–6 含 caption；「AI 自動填表」打 Worker `/api/outline`）、3 產生與匯出。產生時 `confContentForBuild` 整理內容、`confAttachMedia` 把照片 cover 裁進槽位、QR 由 api.qrserver 取圖；每個區塊帶 `groupId`（標題區、作者卡、各段落卡、照片列、頁尾）可整組拖曳。規格表單：常用尺寸 `CONF_PRESETS`（只有尺寸：9:16、16:9、A4–A0、展板、自訂；**不可放任何學會名稱或預填容量／字級／檔名**，使用者要求）、頁面公分、直↔橫、匯出 DPI、容量上限、最小字級、標籤、檔名、活動名、單位；存 localStorage `ktgh_conf_spec_v1`。
- 風格模板 `CONF_STYLES`（card 卡片式／gov 公版 A0／blue 寬廣藍／green 清新綠曲線／orange 橙色幾何／dark 深色紫／simple 簡潔式）：每款定義配色（c1/c2/dark/tint/tint2/accent/txt）、header（band/bar/light/curve）、section（badge/pill/label）、deco（circles/none/poly/glow）、footer、cardFill、watermark；`usesTheme` 的才吃「配色」下拉。來源：公版＝~/Downloads/學會海報範本/論文海報公版格式_A0.pptx（#1F2875 色條、黃框標籤、院徽水印），其餘取自該資料夾歷年美編海報。**UI 與指南的風格名稱不可出現人名**（使用者要求）。
- 版型不在 templates.json，由 `confBuildTemplate(spec)` 依 `spec.style` 分派：`confBuildCard`（預設，卡片式專業版：底色＋裝飾圓、漸層標題區疊作者卡、超橢圓編號徽章卡片、成果數字磚、圖表／照片位置、結論強調卡、深色頁尾＋QR）或 `confBuildSimple`（簡潔式）；配色 `CONF_THEMES`（indigo/green/blue/warm/red，皆品牌色）。字級依頁寬 0.55 次方換算且 ≥ 最小字級，放不下自動縮字（內文到最小字級後標題／段標／數字仍維持倍率階層）、再逐步簡化（去圖表→短句→2 行→照片縮小→緊湊版面去副標題→去照片→去數字磚→標題 1 行）。經 `applyTemplateObj(tpl)` 套用（`applyTemplate(id)` 已拆成查找＋套用）。
- 使用者明確要求：成品要有設計感、不能陽春，否則無法給同事用；預設清單只能是尺寸、不可帶學會名稱。
- `_drawPolyCanvas` 補上 superellipse（匯出 PNG/PDF 之前會漏畫超橢圓，徽章會消失）。
- `S.pdfSpec={mm,name,maxMB,minPt,dpi,label}` 隨 pages／autosave 保存；畫布 px＝mm×3.7795（1 px＝0.75 pt）。
- `exportPDF()`：頁面用規格 mm、倍率 `_exportScaleFor()`（規格 dpi/96，否則長邊 ≥2880px，總像素上限 60M 自動降）、容量上限自動降 JPEG 品質、匯出前檢查小於 minPt 的文字、完成提示顯示 MB／px／dpi（<150 dpi 警告）。
- `dlPoster()` PNG 同樣用 `_exportScaleFor()` 高解析度並以 `pngSetDpi` 寫入 dpi、檔名用規格檔名；`downloadCanvasDpi()` 共用。
- `applyTemplate` 已支援 `shape` 物件。
- 同仁用可列印指南：`docs/conf-poster-guide.html`（桌面「學會壁報AI製作指南」資料夾有副本，改了請同步）。
- AI 設計（頁籤 3）：`confAiDesign()` 打既有 `/api/gen` 生主視覺 → `confBuildTemplate({...sp,onBg:true})` 產生半透明卡片版型 → `bgCoverCanvas` 鋪底圖；`confBananaOpen()` 開 `#banana-overlay`（z-index 10001）：`confBananaPrompt()` 自動寫中文提示詞、`confRenderThumb()` 拿目前畫布當草稿、`confBananaRun()` 打 Worker `/api/design`（需 GEMINI_API_KEY 秘密，模型 vars GEMINI_IMAGE_MODEL 預設 gemini-3.1-flash-image，每人 8／全院 60 張/天）、`confImportPosterDataUrl()` 把整張圖當底圖並清空物件。查證 2026-10：Gemini 影像 API 無免費額度、OpenAI 影像 API 無免費額度；免費可程式化只有 Workers AI。
- 匯出與編輯畫面一致：`_wrapCanvasLines()` 模擬 `.tinner` 的 pre-wrap＋break-word（CJK 逐字斷行、拉丁字詞斷行、收尾標點不放行首、行尾空白懸掛），dlPoster／exportPDF 都用它換行並裁切到文字框；`_txtLines()` 量行數，產生器用它決定標題／副標／作者／段落／頁尾的實際高度。付費 Nano Banana 一鍵路線 UI 已拿掉（使用者不採付費），Worker `/api/design` 留著但前端不呼叫。
- 群組選取：第一次點選整組；整組已選取時再點同一物件且沒拖曳 → 單選（可拉大小、單獨移動，onDown/onUp 的 deepSel）。產生器不砍重點：先縮字到學會字級、再簡化區塊、最後才允許低到 8pt 並提醒（tpl.belowMin/bodyPt）；表頭、作者列、頁尾已壓縮，頁尾一行放得下就一行、沒 QR 連結不留方塊。
