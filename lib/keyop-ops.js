// keyop — dev's side of the brokered keyed call (admin/PROD-KEYS-REMOVAL.md,
// Damon GO 2026-10-13). A prod POSTs {op, args} with its release token; this
// runs the op with the pocket's keys (this process is walled — okdun-run) and
// answers with the RESULT only. No op returns a key, and every op is a fixed
// shape: there is no generic "call anything" door.
const crypto = require('crypto');
const MODS = '/home/damon/platform/modules';

// Which sender domains each box may mail as (dev's SES keys, dev's daily brake).
const MAIL_FROM = {
  b2hashoid: ['hashoid.io'],
  b2prod: ['bitcoin2.ai'],
  w1: ['gamoid.io', 'lostgames.co', 'okdun.ai', 'okdun.io'],
  w1appoid: ['appoid.io'],
};
const GELATO_HOST = /^https:\/\/(order|product|ecommerce)\.gelatoapis\.com\//;

// A per-box value from the pocket: NAME_<BOX> (each prod's webhook endpoint has its own secret).
const boxEnv = (name, box) => process.env[name + '_' + String(box).toUpperCase().replace(/[^A-Z0-9]/g, '_')] || '';

function senderDomain(from) {
  const m = String(from || '').match(/@([a-z0-9.-]+)>?\s*$/i);
  return m ? m[1].toLowerCase() : '';
}

const ops = {
  'stripe.call': async (box, a) => {
    const lib = require(MODS + '/mod-billpay/lib/stripe-client.js');
    const r = String(a.resource || ''), m = String(a.method || '');
    if (!(lib.KEYOP_CALLS[r] || []).includes(m)) throw new Error('stripe call not allowed: ' + r + '.' + m);
    const args = Array.isArray(a.args) ? a.args : [];
    if (r === 'accounts' && args.length) throw new Error('accounts.retrieve takes no arguments here');
    const stripe = lib.directClient();
    if (!stripe) throw new Error('Stripe not configured on dev');
    return stripe[r][m](...args);
  },
  'stripe.verifyWebhook': async (box, a) => {
    const secret = boxEnv('STRIPE_WEBHOOK_SECRET', box);
    if (!secret) throw new Error('no Stripe webhook secret for ' + box + ' in the pocket');
    const stripe = require(MODS + '/mod-billpay/lib/stripe-client.js').directClient();
    if (!stripe) throw new Error('Stripe not configured on dev');
    return stripe.webhooks.constructEvent(Buffer.from(String(a.rawB64 || ''), 'base64'), String(a.sig || ''), secret);
  },
  'gelato.request': async (box, a) => {
    const method = String(a.method || 'GET').toUpperCase();
    if (!['GET', 'POST', 'DELETE'].includes(method)) throw new Error('gelato method not allowed');
    let url = String(a.url || '');
    if (!GELATO_HOST.test(url)) throw new Error('not a Gelato API url');
    const key = process.env.GELATO_API_KEY;
    if (!key) throw new Error('Gelato not configured on dev');
    url = url.replace(/\/stores\/keyop(?=\/|$)/, '/stores/' + encodeURIComponent(process.env.GELATO_STORE_ID || ''));
    return require(MODS + '/mod-store/lib/gelato-client.js').direct(method, url, key, a.body || undefined);
  },
  'gelato.verifyWebhook': async (box, a) => {
    const secret = boxEnv('GELATO_WEBHOOK_SECRET', box) || process.env.GELATO_WEBHOOK_SECRET || '';
    if (!secret) return { valid: true, unsigned: true };   // parity: no secret set = accepted unsigned, as before
    const exp = Buffer.from(crypto.createHmac('sha256', secret).update(String(a.raw || '')).digest('hex'), 'hex');
    let sig; try { sig = Buffer.from(String(a.sig || ''), 'hex'); } catch (e) { return { valid: false }; }
    return { valid: sig.length === exp.length && crypto.timingSafeEqual(sig, exp) };
  },
  'mail.send': async (box, a) => {
    const dom = senderDomain(a.from);
    if (!(MAIL_FROM[box] || []).includes(dom)) throw new Error('box ' + box + ' may not send as ' + (dom || '(none)'));
    if (!a.to) throw new Error('to required');
    const attachments = Array.isArray(a.attachments) ? a.attachments.map(x => ({
      name: x.name, contentType: x.contentType, data: Buffer.from(String(x.dataB64 || ''), 'base64'),
    })) : undefined;
    const r = await require('/home/damon/okdunio/lib/ses').sendEmail({
      from: a.from, to: a.to, subject: a.subject, html: a.html, replyTo: a.replyTo || undefined, attachments, _noRelay: true,
    });
    return { messageId: (r && r.messageId) || null };
  },
};

async function run(box, op, args) {
  const fn = ops[op];
  if (!fn) throw new Error('unknown op ' + op);
  return fn(box, args || {});
}

module.exports = { run, ops: Object.keys(ops), MAIL_FROM };
