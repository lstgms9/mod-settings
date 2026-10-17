// BRING YOUR OWN AI (Damon 2026-10-17): a 3x3 grid of the top nine AI companies in Settings. LOGIN where the company
// allows it (OpenRouter now — OAuth PKCE; ChatGPT + Gemini behind flags until OpenAI / Google approve us), KEY where it
// doesn't. A person's key — pasted, or the one OpenRouter hands back after login — goes straight to the VAULT
// (ukey.put), bound to that company's API (ukey.call attaches it only there), never stored on this box or in tenant
// storage, never shown back. Here we keep nothing but what the vault answers: which companies are linked.
'use strict';
const crypto = require('crypto');
const keyop = (() => { try { return require('/home/damon/okdunio/lib/keyop'); } catch (e) { return null; } })();

// id = the vault's vendor name. login: 'now' | 'flag:<config key>' (coming soon until the flag is on). key: paste allowed.
const AI_NINE = [
  { id: 'openai', name: 'ChatGPT', sub: 'OpenAI', login: 'flag:chatgptLogin', key: true },
  { id: 'gemini', name: 'Gemini', sub: 'Google', login: 'flag:geminiLogin', key: true },
  { id: 'anthropic', name: 'Claude', sub: 'Anthropic', key: true },
  { id: 'xai', name: 'Grok', sub: 'xAI', key: true },
  { id: 'deepseek', name: 'DeepSeek', sub: 'DeepSeek', key: true },
  { id: 'qwen', name: 'Qwen', sub: 'Alibaba', key: true },
  { id: 'moonshot', name: 'Kimi', sub: 'Moonshot', key: true },
  { id: 'openrouter', name: 'OpenRouter', sub: 'every model', login: 'now' },
  { id: 'meshy', name: 'Meshy', sub: '3D models', key: true },
];
const byId = Object.fromEntries(AI_NINE.map((p) => [p.id, p]));
const KEY_RE = /^[\x21-\x7e]{16,400}$/;   // printable, no spaces — the company itself is the real check

// the person a link belongs to: this site + their account (the vault adds the box)
const ownerOf = (req) => (req.instanceSlug || 'site') + ':' + (req.user && (req.user.studio || req.user.slug || req.user.userId));

// OpenRouter PKCE: the verifier never leaves this process; one pending login per state, 10 minutes
const pending = new Map();
const b64u = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

module.exports = function registerAiLinks(router, ctx) {
  const flags = (req) => { try { const c = ctx.config && (typeof ctx.config === 'function' ? ctx.config(req) : ctx.config); return (c && c.byoAi) || {}; } catch (e) { return {}; } };
  const loginState = (p, req) => !p.login ? null : p.login === 'now' ? 'now' : (flags(req)[p.login.slice(5)] ? 'now' : 'soon');
  const vault = async (op, args) => { if (!keyop || !keyop.on()) throw new Error('no vault on this box'); return keyop.call(op, args); };
  const raw = (res) => res._res || res;
  const back = (res, q) => { raw(res).writeHead(302, { Location: '/settings?ai=' + q }); raw(res).end(); };

  // the grid: the nine, how each connects, and which are linked (the vault says; null = the vault can't hold keys yet)
  router.get('/ai-links', async (req, res) => {
    if (!req.user) return res.error(401, 'Not logged in');
    let linked = null;
    try { linked = ((await vault('ukey.list', { owner: ownerOf(req) })) || {}).vendors || []; } catch (e) { linked = null; }
    res.json({ available: linked !== null, tiles: AI_NINE.map((p) => ({ id: p.id, name: p.name, sub: p.sub, login: loginState(p, req), key: !!p.key,
      linked: !!(linked && linked.includes(p.id)) })) });
  });

  // paste a key: straight to the vault, bound to that company; nothing kept here
  router.post('/ai-links/:id/key', async (req, res) => {
    if (!req.user) return res.error(401, 'Not logged in');
    const p = byId[req.params.id];
    if (!p || !p.key) return res.error(400, 'that company connects by login, not key');
    const key = String((req.body || {}).key || '').trim();
    if (!KEY_RE.test(key)) return res.error(400, 'that does not look like an API key');
    try { await vault('ukey.put', { owner: ownerOf(req), vendor: p.id, key }); }
    catch (e) { return res.error(503, 'could not save it to the vault: ' + e.message); }
    res.json({ ok: true, linked: p.id });
  });

  router.delete('/ai-links/:id', async (req, res) => {
    if (!req.user) return res.error(401, 'Not logged in');
    if (!byId[req.params.id]) return res.error(404, 'unknown');
    try { await vault('ukey.del', { owner: ownerOf(req), vendor: req.params.id }); }
    catch (e) { return res.error(503, 'could not reach the vault: ' + e.message); }
    res.json({ ok: true });
  });

  // OPENROUTER LOGIN (OAuth PKCE, no approval needed): out to openrouter.ai, back with a code, the code + our verifier
  // buy the person's key, the key goes to the vault
  router.get('/ai-links/openrouter/start', async (req, res) => {
    if (!req.user) return back(res, 'login-first');
    const verifier = b64u(crypto.randomBytes(48)), state = b64u(crypto.randomBytes(18));
    for (const [k, v] of pending) if (Date.now() - v.at > 600000) pending.delete(k);
    pending.set(state, { verifier, owner: ownerOf(req), at: Date.now() });
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const cb = 'https://' + host + '/api/settings/ai-links/openrouter/callback?state=' + state;
    const challenge = b64u(crypto.createHash('sha256').update(verifier).digest());
    raw(res).writeHead(302, { Location: 'https://openrouter.ai/auth?callback_url=' + encodeURIComponent(cb) + '&code_challenge=' + challenge + '&code_challenge_method=S256' });
    raw(res).end();
  });
  router.get('/ai-links/openrouter/callback', async (req, res) => {
    const q = req.query || {}, st = pending.get(String(q.state || ''));
    if (!st || !req.user || st.owner !== ownerOf(req)) return back(res, 'openrouter-expired');
    pending.delete(String(q.state));
    if (!q.code) return back(res, 'openrouter-cancelled');
    let key = null;
    try {
      const r = await fetch('https://openrouter.ai/api/v1/auth/keys', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: String(q.code), code_verifier: st.verifier, code_challenge_method: 'S256' }) });
      key = r.ok ? ((await r.json()) || {}).key : null;
    } catch (e) { key = null; }
    if (!key) return back(res, 'openrouter-failed');
    try { await vault('ukey.put', { owner: st.owner, vendor: 'openrouter', key }); } catch (e) { return back(res, 'vault-unavailable'); }
    back(res, 'openrouter-connected');
  });
};
module.exports.AI_NINE = AI_NINE;
module.exports.ownerOf = ownerOf;
