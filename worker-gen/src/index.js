// 美編小助手 AI 生圖代理：Workers AI + KV 限速
// POST /api/gen { prompt, style, ratio, quality? } → { ok, image:"data:image/jpeg;base64,...", w, h, prompt_en }
// GET  /api/quota → 目前額度
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

    if (url.pathname === '/api/quota' && req.method === 'GET') {
      return json({ ok: true, ...(await quota(env, ip)) }, 200, c.headers);
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

    return json({ ok: false, error: 'not found' }, 404, c.headers);
  },
};
