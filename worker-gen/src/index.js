// 美編小助手 雲端範本代理（Cloudflare Worker + KV）
// 只做一件事：同仁共用的「公版範本」雲端同步。
//   GET  /api/templates     → 共用範本（公開讀）
//   POST /api/templates     → 寫入（需 X-Admin-Token ＝ Worker 秘密 ADMIN_TOKEN）
//   GET  /api/admin-check   → 驗證管理員金鑰
// 來源白名單 ALLOWED_ORIGINS；寫入每 IP 每分鐘 10 次。
// （AI 生圖、AI 填表已於 2026-10-28 移除；舊版程式見 git 標籤 ai-gen-v1）

function cors(req, env) {
  const origin = req.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const ok = allowed.includes(origin);
  return {
    ok,
    headers: {
      'Access-Control-Allow-Origin': ok ? origin : 'null',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,X-Admin-Token',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin',
    },
  };
}
const json = (obj, status, headers) => new Response(JSON.stringify(obj), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
});

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

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const c = cors(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: c.headers });
    if (!c.ok) return json({ ok: false, error: 'origin not allowed' }, 403, c.headers);
    const ip = req.headers.get('CF-Connecting-IP') || '0.0.0.0';

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
    return json({ ok: false, error: 'not found' }, 404, c.headers);
  },
};
