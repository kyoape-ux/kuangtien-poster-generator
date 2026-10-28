// 美編小助手 AI 生圖代理：Workers AI + KV 限速
// POST /api/gen { prompt, style, ratio, quality? } → { ok, image:"data:image/jpeg;base64,...", w, h, prompt_en }
// GET  /api/quota → 目前額度
// GET  /api/templates → 共用範本（公開讀）；POST /api/templates（X-Admin-Token＝秘密 ADMIN_TOKEN）寫入 KV tpl:shared；GET /api/admin-check 驗證 token
// POST /api/design  { prompt, aspect, images[] } → { ok, image }（Nano Banana，需 GEMINI_API_KEY）
// POST /api/outline { text, sections? } → { ok, title, subtitle, sections:[{title,bullets[]}], stats:[{value,label}] }
//
// 品質策略：
//  1. 先用 LLM 把中文主題改寫成細緻的英文提示詞（FLUX 的文字編碼器對中文理解很差，這步影響最大）
//  2. 預設走 FLUX.2 [klein] 4B（品質明顯高於 FLUX.1 schnell，且原生支援任意尺寸不用裁）
//  3. schnell 當備援（klein 失敗或額度吃緊時），steps 拉到 8

const MODELS = {
  klein:   '@cf/black-forest-labs/flux-2-klein-4b',
  schnell: '@cf/black-forest-labs/flux-1-schnell',
};
// 中文理解好、便宜（$0.05/M tokens）；qwen3 會吐 <think>，取回後剝掉
const LLM = '@cf/qwen/qwen3-30b-a3b-fp8';
const LLM_FALLBACK = '@cf/google/gemma-4-26b-a4b-it';
// Nano Banana（Gemini 影像模型）：無免費 API 額度，需在 Cloudflare 設定秘密 GEMINI_API_KEY（wrangler secret put）；模型可用 vars GEMINI_IMAGE_MODEL 覆寫
const GEMINI_IMAGE_MODEL = 'gemini-3.1-flash-image';


// 風格範本（英文後綴）
const STYLES = {
  flat:   'clean flat vector illustration, minimal shapes, soft pastel palette, white or very light background, friendly healthcare mood',
  photo:  'realistic photograph, natural soft light, shallow depth of field, clean modern hospital setting, calm and professional, high detail',
  grad:   'smooth abstract gradient background, soft light bloom, subtle geometric shapes, clean and modern, no objects',
  paper:  'gentle watercolor illustration, soft brush texture, light paper background, warm and caring mood',
  icon:   'single flat icon, simple geometric shape, one solid color on plain white background, centered, no shadow',
  none:   '',
};
const NEG = 'no text, no letters, no typography, no watermark, no logo, no signature';

const STYLE_HINT_ZH = {
  flat: '扁平向量插畫', photo: '寫實攝影', grad: '抽象漸層背景', paper: '水彩插畫', icon: '單一扁平圖示', none: '',
};

// 尺寸白名單（klein 原生支援；schnell 固定 1024² 由前端裁）
const SIZES = {
  '1:1':  [1024, 1024],
  '4:3':  [1024, 768],
  '3:4':  [768, 1024],
  '16:9': [1024, 576],
  '9:16': [576, 1024],
  '3:2':  [1024, 680],
  '2:3':  [680, 1024],
};

function cors(req, env) {
  const origin = req.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const ok = allowed.includes(origin);
  return {
    ok,
    headers: {
      'Access-Control-Allow-Origin': ok ? origin : 'null',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin',
    },
  };
}
const json = (obj, status, headers) => new Response(JSON.stringify(obj), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
});

function dayKey() { return new Date().toISOString().slice(0, 10); }
function minKey() { return Math.floor(Date.now() / 60000); }
function adminOk(req, env) {
  const t = req.headers.get('X-Admin-Token') || '';
  const k = env.ADMIN_TOKEN || '';
  if (!k || t.length !== k.length) return false;
  let d = 0; for (let i = 0; i < k.length; i++) d |= t.charCodeAt(i) ^ k.charCodeAt(i);
  return d === 0;
}
async function readCount(env, key) { return +(await env.RL.get(key)) || 0; }
async function bump(env, key, ttl) {
  const n = (await readCount(env, key)) + 1;
  await env.RL.put(key, String(n), { expirationTtl: ttl });
  return n;
}
async function quota(env, ip) {
  const [d, m, g] = await Promise.all([
    readCount(env, `d:${dayKey()}:${ip}`),
    readCount(env, `m:${minKey()}:${ip}`),
    readCount(env, `g:${dayKey()}`),
  ]);
  return { perDay: +env.LIMIT_PER_DAY, usedDay: d, perMin: +env.LIMIT_PER_MIN, usedMin: m, globalDay: +env.LIMIT_GLOBAL_DAY, usedGlobal: g };
}

function b64(buf) {
  let s = '', b = new Uint8Array(buf);
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(s);
}

// ── 1) 中文主題 → 英文提示詞（LLM 改寫；失敗就退回原文＋風格後綴）──
async function enhancePrompt(env, zh, style) {
  const sys = `You write prompts for a text-to-image model (FLUX). Rewrite the user's subject (may be Chinese) into ONE vivid English image prompt of 50-90 words.
Cover: main subject, setting, composition/camera angle, lighting, color palette, mood, and the requested art style (${STYLE_HINT_ZH[style] || 'as described'} → ${STYLES[style] || 'style as described'}).
Rules: output ONLY the prompt text, no quotes, no preamble, no lists. Never ask for text, letters, signs, or logos in the image. Avoid real people's names. Keep it suitable for a hospital's public health posters.`;
  for (const model of [LLM, LLM_FALLBACK]) {
    try {
      const r = await env.AI.run(model, {
        messages: [{ role: 'system', content: sys }, { role: 'user', content: zh + ' /no_think' }],
        max_tokens: 400, temperature: 0.6,
      });
      let t = (r && (r.response || r.result?.response) || '');
      t = t.replace(/<think>[\s\S]*?<\/think>/g, '').trim().replace(/^["'“”]+|["'“”]+$/g, '').replace(/\s+/g, ' ');
      if (t.length > 20 && t.length < 900) return t;
    } catch (e) { /* try next */ }
  }
  return null;
}

// ── 2) 生圖：klein（multipart）優先，失敗退 schnell ──
async function runKlein(env, prompt, w, h) {
  const fd = new FormData();
  fd.append('prompt', prompt);
  fd.append('width', String(w));
  fd.append('height', String(h));
  // 官方範例：Response(FormData) 取得帶 boundary 的串流；一定要 returnRawResponse，
  // 綁定內建的回應解析會對這個模型丟 8001 Invalid input
  const r = new Response(fd);
  const resp = await env.AI.run(MODELS.klein, { multipart: { body: r.body, contentType: r.headers.get('content-type') } }, { returnRawResponse: true });
  const text = await resp.text();
  if (!resp.ok) throw new Error('klein HTTP ' + resp.status + ': ' + text.slice(0, 160));
  let out; try { out = JSON.parse(text); } catch { throw new Error('klein: non-JSON output'); }
  const img = out && (out.image || (out.result && out.result.image));
  if (typeof img === 'string' && img.length > 1000) return { dataUrl: 'data:image/jpeg;base64,' + img, w, h, model: 'klein' };
  throw new Error('klein: unexpected output ' + text.slice(0, 120));
}
async function runSchnell(env, prompt, w, h) {
  const ratioHint = w === h ? '' : (w > h ? ', wide horizontal composition, landscape framing' : ', tall vertical composition, portrait framing');
  const out = await env.AI.run(MODELS.schnell, { prompt: prompt + ratioHint, steps: 8 });
  if (out && typeof out.image === 'string') return { dataUrl: 'data:image/jpeg;base64,' + out.image, w: 1024, h: 1024, cropTo: [w, h], model: 'schnell' };
  throw new Error('schnell: unexpected output');
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const c = cors(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: c.headers });
    if (!c.ok) return json({ ok: false, error: 'origin not allowed' }, 403, c.headers);

    const ip = req.headers.get('CF-Connecting-IP') || '0.0.0.0';

    // ── 共用範本（取代 Firestore）：讀取公開；寫入需 X-Admin-Token 等於秘密 ADMIN_TOKEN ──
    if (url.pathname === '/api/templates' && req.method === 'GET') {
      const raw = await env.RL.get('tpl:shared');
      return new Response(raw || '{"custom_templates":[],"builtin_overrides":{},"builtin_deleted":[],"last_updated":null}', { status: 200, headers: { ...c.headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    }
    if (url.pathname === '/api/admin-check' && req.method === 'GET') {
      return json({ ok: adminOk(req, env) }, 200, c.headers);
    }
    if (url.pathname === '/api/templates' && req.method === 'POST') {
      if (!env.ADMIN_TOKEN) return json({ ok: false, error: '尚未設定 ADMIN_TOKEN 秘密' }, 503, c.headers);
      if (!adminOk(req, env)) return json({ ok: false, error: '管理員驗證失敗' }, 403, c.headers);
      const am = await readCount(env, `am:${minKey()}:${ip}`); if (am >= 10) return json({ ok: false, error: '太頻繁' }, 429, c.headers);
      let body;
      try { body = await req.json(); } catch { return json({ ok: false, error: 'bad json' }, 400, c.headers); }
      const data = {
        custom_templates: Array.isArray(body.custom_templates) ? body.custom_templates : [],
        builtin_overrides: (body.builtin_overrides && typeof body.builtin_overrides === 'object') ? body.builtin_overrides : {},
        builtin_deleted: Array.isArray(body.builtin_deleted) ? body.builtin_deleted : [],
        last_updated: new Date().toISOString(),
      };
      const raw = JSON.stringify(data);
      if (raw.length > 20 * 1024 * 1024) return json({ ok: false, error: '範本資料超過 20 MB，請移除大圖' }, 413, c.headers);
      await env.RL.put('tpl:shared', raw);
      await bump(env, `am:${minKey()}:${ip}`, 120);
      return json({ ok: true, last_updated: data.last_updated, bytes: raw.length }, 200, c.headers);
    }

    if (url.pathname === '/api/quota' && req.method === 'GET') {
      const bd = await readCount(env, `bd:${dayKey()}:${ip}`), bg = await readCount(env, `bg:${dayKey()}`);
      return json({ ok: true, ...(await quota(env, ip)), gemini: !!env.GEMINI_API_KEY, geminiModel: env.GEMINI_IMAGE_MODEL || GEMINI_IMAGE_MODEL, bananaUsedDay: bd, bananaPerDay: +env.BANANA_PER_DAY || 8, bananaGlobalUsed: bg, bananaGlobalDay: +env.BANANA_GLOBAL_DAY || 60 }, 200, c.headers);
    }

    // ── 4) Nano Banana 整張海報：內容＋照片＋院徽 → Gemini 影像模型（需 GEMINI_API_KEY 秘密；付費模型，額度另計）──
    if (url.pathname === '/api/design' && req.method === 'POST') {
      if (!env.GEMINI_API_KEY) return json({ ok: false, needKey: true, error: '院內尚未設定 Gemini API 金鑰，請改用「Gemini App 免費路線」或「AI 主視覺＋自動排版」' }, 400, c.headers);
      let body;
      try { body = await req.json(); } catch { return json({ ok: false, error: 'bad json' }, 400, c.headers); }
      const prompt = String(body.prompt || '').trim().slice(0, 6000);
      if (prompt.length < 20) return json({ ok: false, error: '提示詞太短' }, 400, c.headers);
      const perDay = +env.BANANA_PER_DAY || 8, globalDay = +env.BANANA_GLOBAL_DAY || 60;
      const bd = await readCount(env, `bd:${dayKey()}:${ip}`), bg = await readCount(env, `bg:${dayKey()}`);
      if (bg >= globalDay) return json({ ok: false, error: '今日全院 Nano Banana 額度已用完，明天再試' }, 429, c.headers);
      if (bd >= perDay) return json({ ok: false, error: `今日 Nano Banana 額度已用完（每人 ${perDay} 張／天）` }, 429, c.headers);
      const images = (Array.isArray(body.images) ? body.images : []).slice(0, 5);
      const parts = [{ text: prompt }];
      for (const im of images) {
        const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(im || ''));
        if (m && m[2].length < 6_000_000) parts.push({ inlineData: { mimeType: m[1], data: m[2] } });
      }
      const model = env.GEMINI_IMAGE_MODEL || GEMINI_IMAGE_MODEL;
      const ar = String(body.aspect || '9:16');
      const gen = { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: ['1:1','2:3','3:2','3:4','4:3','4:5','5:4','9:16','16:9','21:9'].includes(ar) ? ar : '9:16' } };
      if (body.size === '2K' || body.size === '4K') gen.imageConfig.imageSize = body.size;
      let resp, txt;
      try {
        resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
          body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: gen }),
        });
        txt = await resp.text();
      } catch (e) { return json({ ok: false, error: 'Gemini 連線失敗：' + (e.message || e) }, 502, c.headers); }
      if (!resp.ok) return json({ ok: false, error: `Gemini ${resp.status}：` + txt.slice(0, 300) }, 502, c.headers);
      let out; try { out = JSON.parse(txt); } catch { return json({ ok: false, error: 'Gemini 回應非 JSON' }, 502, c.headers); }
      const cand = out.candidates && out.candidates[0];
      const imgPart = cand && cand.content && cand.content.parts && cand.content.parts.find(p => p.inlineData && p.inlineData.data);
      if (!imgPart) {
        const reason = (cand && cand.finishReason) || (out.promptFeedback && out.promptFeedback.blockReason) || '沒有產生圖片';
        return json({ ok: false, error: 'Gemini 未回傳圖片：' + reason }, 502, c.headers);
      }
      await Promise.all([bump(env, `bd:${dayKey()}:${ip}`, 60 * 60 * 26), bump(env, `bg:${dayKey()}`, 60 * 60 * 26)]);
      const textPart = cand.content.parts.find(p => p.text);
      return json({ ok: true, image: `data:${imgPart.inlineData.mimeType || 'image/png'};base64,${imgPart.inlineData.data}`, model, note: textPart ? String(textPart.text).slice(0, 300) : undefined, quota: { usedDay: bd + 1, perDay } }, 200, c.headers);
    }

    if (url.pathname === '/api/gen' && req.method === 'POST') {
      let body;
      try { body = await req.json(); } catch { return json({ ok: false, error: 'bad json' }, 400, c.headers); }
      const prompt = String(body.prompt || '').trim().slice(0, 500);
      if (prompt.length < 2) return json({ ok: false, error: '請輸入主題描述' }, 400, c.headers);
      const style = STYLES[body.style] !== undefined ? body.style : 'flat';
      const [w, h] = SIZES[body.ratio] || SIZES['1:1'];
      const wantModel = body.model === 'schnell' ? 'schnell' : 'klein';

      const q = await quota(env, ip);
      if (q.usedGlobal >= q.globalDay) return json({ ok: false, error: '今日全院生圖額度已用完，明天再試' }, 429, c.headers);
      if (q.usedDay >= q.perDay) return json({ ok: false, error: `今日額度已用完（每人 ${q.perDay} 張／天）` }, 429, c.headers);
      if (q.usedMin >= q.perMin) return json({ ok: false, error: '太頻繁了，請等一分鐘再試' }, 429, c.headers);

      // 提示詞：LLM 改寫 → 加風格後綴與負面提示
      const en = body.enhance === false ? null : await enhancePrompt(env, prompt, style);
      const base = en || (prompt + (STYLES[style] ? ', ' + STYLES[style] : ''));
      const full = `${base}. ${NEG}.`;

      let res, errs = [];
      if (wantModel === 'klein') { try { res = await runKlein(env, full, w, h); } catch (e) { errs.push('klein: ' + (e.message || e)); } }
      if (!res) { try { res = await runSchnell(env, full, w, h); } catch (e) { errs.push('schnell: ' + (e.message || e)); } }
      if (!res) return json({ ok: false, error: '生圖服務暫時無法使用：' + errs.join(' | ') }, 502, c.headers);

      await Promise.all([
        bump(env, `d:${dayKey()}:${ip}`, 60 * 60 * 26),
        bump(env, `m:${minKey()}:${ip}`, 120),
        bump(env, `g:${dayKey()}`, 60 * 60 * 26),
      ]);

      return json({
        ok: true, image: res.dataUrl, w: res.w, h: res.h, cropTo: res.cropTo || null,
        model: res.model, prompt_en: base, enhanced: !!en, errs: errs.length ? errs : undefined,
        quota: { usedDay: q.usedDay + 1, perDay: q.perDay },
      }, 200, c.headers);
    }

    // ── 3) 學會壁報：貼上簡報／報告文字 → 海報內容 JSON（標題、段落、亮點數字）──
    if (url.pathname === '/api/outline' && req.method === 'POST') {
      let body;
      try { body = await req.json(); } catch { return json({ ok: false, error: 'bad json' }, 400, c.headers); }
      const text = String(body.text || '').trim().slice(0, 12000);
      if (text.length < 20) return json({ ok: false, error: '請貼上至少 20 字的成果資料' }, 400, c.headers);
      const nSec = Math.min(6, Math.max(2, +body.sections || 4));
      const om = await readCount(env, `om:${minKey()}:${ip}`), od = await readCount(env, `od:${dayKey()}:${ip}`);
      if (om >= 6) return json({ ok: false, error: '太頻繁了，請等一分鐘再試' }, 429, c.headers);
      if (od >= 60) return json({ ok: false, error: '今日 AI 整理額度已用完（每人 60 次／天）' }, 429, c.headers);
      const out = await outlineText(env, text, nSec);
      if (!out || out._fail) return json({ ok: false, error: 'AI 整理失敗，請縮短文字再試或手動填寫', detail: out && out._fail }, 502, c.headers);
      await Promise.all([bump(env, `om:${minKey()}:${ip}`, 120), bump(env, `od:${dayKey()}:${ip}`, 60 * 60 * 26)]);
      return json({ ok: true, ...out }, 200, c.headers);
    }

    return json({ ok: false, error: 'not found' }, 404, c.headers);
  },
};

// 文字 → 海報內容。讓模型輸出簡單的逐行格式（比 JSON 穩定，不會因括號出錯），由程式解析。
//   標題：xxx / 副標題：xxx / 段落：標題 然後以「- 」開頭的重點 / 數字：4,053｜說明
async function outlineText(env, text, nSec) {
  const sys = `你是醫院品質與衛教海報的文案編輯。把使用者提供的成果資料整理成學會壁報海報內容，嚴格依下列純文字格式輸出，不要任何其他說明、不要 markdown、不要編號：
標題：主標題（15字內）
副標題：一句話說明核心做法與效益（22字內）
段落：背景與目的
- 重點（22字內）
- 重點
- 重點
段落：執行方法
- 重點
- 重點
（依序輸出 ${nSec} 個段落，順序為 背景與目的、執行方法、成果與數據、結論與未來${nSec > 4 ? '，可再加「團隊與資源」「病人回饋」等' : nSec < 4 ? '，內容不足時合併相鄰段落' : ''}）
數字：4,053｜CKD 照護人次
數字：1,421｜Pre-ESRD 照護人次
規則：全部繁體中文；每段 2–3 個重點，每個重點不超過 22 字、不用句號結尾；「數字」給 2–3 行，只能是資料裡真的有的數字（數字或百分比，｜後是 8 字內說明），沒有就不寫；每個重點都必須能在使用者提供的資料裡找到依據，不可加入資料沒有的統計、趨勢、原因或結論（例如「逐年增加」「滿意度提升」）；資料沒提到的段落只寫一個重點「（待補）」；不要表情符號。`;
  const fails = [];
  for (const model of [LLM, LLM_FALLBACK]) {
    try {
      const r = await env.AI.run(model, {
        messages: [{ role: 'system', content: sys }, { role: 'user', content: text + ' /no_think' }],
        max_tokens: 2000, temperature: 0.3,
      });
      let t = '';
      if (typeof r === 'string') t = r;
      else if (r) {
        t = r.response || (r.result && r.result.response) || '';
        if (!t && r.choices && r.choices[0]) { const ch = r.choices[0], mm = ch.message || {}; t = mm.content || ch.text || ''; if (!t) fails.push(`${model}: choices 無內容 finish=${ch.finish_reason} msgKeys=${Object.keys(mm).join(',')}`); }
      }
      if (typeof t !== 'string') t = JSON.stringify(t);
      t = t.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      const out = parseOutline(t);
      if (out) {
        // 保底：有數字卻沒有「成果」段時補上，位置在第 3 段（或最後一段之前）
        if (out.stats.length && !out.sections.some(sc => /成果|數據|結果|成效/.test(sc.title)) && out.sections.length < 6) {
          out.sections.splice(Math.min(2, out.sections.length), 0, { title: '成果與數據', bullets: ['關鍵成果數字見下方亮點'] });
        }
        return { ...out, model };
      }
      fails.push(`${model}: 解析不出段落（${t.slice(0, 100).replace(/\n/g, ' / ')}）`);
    } catch (e) { fails.push(`${model}: ${String(e && e.message || e).slice(0, 160)}`); }
  }
  return { _fail: fails };
}
function parseOutline(t) {
  const clean = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const strip = s => clean(s).replace(/^[*#\s]+|[*\s]+$/g, '');
  const out = { title: '', subtitle: '', sections: [], stats: [] };
  let cur = null;
  for (const raw of t.split(/\r?\n/)) {
    const line = raw.trim(); if (!line) continue;
    let m;
    if ((m = line.match(/^[*#\s]*標題\s*[:：]\s*(.+)$/))) { out.title = strip(m[1]).slice(0, 30); cur = null; }
    else if ((m = line.match(/^[*#\s]*副標題\s*[:：]\s*(.+)$/))) { out.subtitle = strip(m[1]).slice(0, 50); cur = null; }
    else if ((m = line.match(/^[*#\s]*段落\s*[:：]\s*(.+)$/))) { cur = { title: strip(m[1]).replace(/^[一二三四五六七八九十\d]+[、.．\s]+/, '').slice(0, 12), bullets: [] }; out.sections.push(cur); }
    else if ((m = line.match(/^[*#\s]*數字\s*[:：]\s*(.+)$/))) { const parts = m[1].split(/[｜|]/); const v = strip(parts[0]).slice(0, 12); if (v) out.stats.push({ value: v, label: strip(parts.slice(1).join(' ')).slice(0, 16) }); cur = null; }
    else if (cur && /^[-•·*]\s*/.test(line)) {
      const b = strip(line.replace(/^[-•·*]\s*/, '')).replace(/[。．.]$/, '').slice(0, 40);
      const nm = b.match(/^([\d][\d,.]*\s*[%％]?)\s*[｜|]\s*(.+)$/);       // 數字被寫進重點：搬到亮點數字
      if (nm) { out.stats.push({ value: nm[1].replace(/\s+/g, '').slice(0, 12), label: clean(nm[2]).slice(0, 16) }); cur.moved = true; }
      else if (b && cur.bullets.length < 4) cur.bullets.push(b);
    }
  }
  out.sections.forEach(sc => { if (!sc.bullets.length && sc.moved) sc.bullets.push('關鍵成果數字見下方亮點'); });
  out.sections = out.sections.filter(sc => sc.title && sc.bullets.length).map(sc => ({ title: sc.title, bullets: sc.bullets })).slice(0, 6);
  out.stats = out.stats.slice(0, 4);
  return out.sections.length >= 2 ? out : null;
}
