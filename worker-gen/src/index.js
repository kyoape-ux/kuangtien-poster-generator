// 美編小助手 AI 生圖代理：Workers AI (FLUX.1 schnell) + KV 限速
// POST /api/gen { prompt, style, w, h, seed? } → { ok, image:"data:image/jpeg;base64,..." }
// GET  /api/quota → 目前額度

const MODEL = '@cf/black-forest-labs/flux-1-schnell';

// 風格範本：前端只送 style key，英文提示詞在這裡組，同仁不用自己寫英文
const STYLES = {
  flat:   'clean flat vector illustration, minimal, soft pastel colors, white background, hospital healthcare theme, friendly, high quality',
  photo:  'warm natural light photograph, soft focus background, modern clean hospital interior, calm, professional, high resolution',
  grad:   'smooth abstract gradient background, soft light, subtle geometric shapes, clean, modern, no objects, no text',
  paper:  'soft watercolor illustration, gentle brush texture, light background, warm and caring mood, healthcare theme',
  icon:   'single flat icon, simple geometric shape, solid color on plain white background, centered, no shadow, no text',
  none:   '',
};
const NEG_HINT = ', no text, no letters, no watermark, no logo';

// 尺寸白名單（避免超大圖吃額度）
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
  return {
    perDay: +env.LIMIT_PER_DAY, usedDay: d,
    perMin: +env.LIMIT_PER_MIN, usedMin: m,
    globalDay: +env.LIMIT_GLOBAL_DAY, usedGlobal: g,
  };
}

function b64(buf) {
  let s = '', b = new Uint8Array(buf);
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(s);
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

      const q = await quota(env, ip);
      if (q.usedGlobal >= q.globalDay) return json({ ok: false, error: '今日全院生圖額度已用完，明天再試' }, 429, c.headers);
      if (q.usedDay >= q.perDay) return json({ ok: false, error: `今日額度已用完（每人 ${q.perDay} 張／天）` }, 429, c.headers);
      if (q.usedMin >= q.perMin) return json({ ok: false, error: '太頻繁了，請等一分鐘再試' }, 429, c.headers);

      const full = (prompt + ', ' + STYLES[style] + NEG_HINT).replace(/,\s*,/g, ',');
      const seed = Number.isFinite(+body.seed) ? (+body.seed >>> 0) : Math.floor(Math.random() * 1e9);

      // FLUX schnell 固定輸出 1024×1024；把想要的比例寫進提示詞，實際裁切由前端依 w/h 完成
      const ratioHint = w === h ? '' : (w > h ? ', wide horizontal composition, landscape framing' : ', tall vertical composition, portrait framing');
      let out;
      try {
        out = await env.AI.run(MODEL, { prompt: full + ratioHint, steps: 4 }); // 線上 schema 不收 seed
      } catch (e) {
        return json({ ok: false, error: '生圖服務暫時無法使用：' + (e && e.message || e) }, 502, c.headers);
      }

      // 成功才計數
      await Promise.all([
        bump(env, `d:${dayKey()}:${ip}`, 60 * 60 * 26),
        bump(env, `m:${minKey()}:${ip}`, 120),
        bump(env, `g:${dayKey()}`, 60 * 60 * 26),
      ]);

      // FLUX schnell 回 { image: base64 jpeg }；其他模型回二進位串流
      let dataUrl;
      if (out && typeof out.image === 'string') dataUrl = 'data:image/jpeg;base64,' + out.image;
      else if (out instanceof ReadableStream || out instanceof ArrayBuffer) {
        const buf = out instanceof ArrayBuffer ? out : await new Response(out).arrayBuffer();
        dataUrl = 'data:image/png;base64,' + b64(buf);
      } else return json({ ok: false, error: 'unexpected model output' }, 502, c.headers);

      return json({ ok: true, image: dataUrl, w, h, seed, model: MODEL, quota: { usedDay: q.usedDay + 1, perDay: q.perDay } }, 200, c.headers);
    }

    return json({ ok: false, error: 'not found' }, 404, c.headers);
  },
};
