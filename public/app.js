(function() {
  const API = window.platform.api;
  let prefs = {};
  let connectedAIs = {};
  let saveTimer = null;
  let lastToast = null;

  const AI_PROVIDERS = [
    { id:'claude', name:'Claude', provider:'Anthropic', color:'#d4a574', icon:'\u25C8', placeholder:'sk-ant-... or OAuth token', models:['Opus 4','Sonnet 4','Haiku 3.5'] },
    { id:'openai', name:'ChatGPT', provider:'OpenAI', color:'#10a37f', icon:'\u25C6', placeholder:'sk-...', models:['GPT-4o','GPT-4 Turbo','o1','o3-mini'] },
    { id:'gemini', name:'Gemini', provider:'Google', color:'#4285f4', icon:'\u2726', placeholder:'AIza...', models:['Gemini 2.5 Pro','Gemini 2.5 Flash'] },
    { id:'grok', name:'Grok', provider:'xAI', color:'#e4e4e4', icon:'X', placeholder:'xai-...', models:['Grok-3','Grok-3 Mini'] },
    { id:'deepseek', name:'DeepSeek', provider:'DeepSeek', color:'#5b7ff5', icon:'\u25CE', placeholder:'sk-...', models:['DeepSeek-V3','DeepSeek-R1'] },
    { id:'mistral', name:'Mistral', provider:'Mistral AI', color:'#ff7000', icon:'M', placeholder:'api-key...', models:['Mistral Large','Codestral','Mistral Medium'] },
    { id:'llama', name:'Llama', provider:'Meta (via Groq/Together)', color:'#0668e1', icon:'\uD83E\uDD99', placeholder:'API key from Groq or Together', models:['Llama 4 Scout','Llama 4 Maverick'] },
    { id:'stability', name:'Stable Diffusion', provider:'Stability AI', color:'#a855f7', icon:'\uD83C\uDFA8', placeholder:'sk-...', models:['SD3.5','SDXL'] },
    { id:'midjourney', name:'Midjourney', provider:'Midjourney', color:'#ffffff', icon:'\u2B21', placeholder:'Session token or API key', models:['v6.1','v7'] },
  ];

  const FONTS = [
    { id:'bungee', name:'Bungee', family:"'Bungee', cursive", sz:18 },
    { id:'nunito', name:'Nunito Black \u00b7 International', family:"'Nunito', sans-serif", weight:900, sz:20 },
    { id:'noto-sans', name:'Noto Sans Display \u00b7 International', family:"'Noto Sans Display', sans-serif", weight:800, sz:18 },
    { id:'orbitron', name:'Orbitron', family:"'Orbitron', sans-serif", weight:900, sz:16 },
    { id:'audiowide', name:'Audiowide', family:"'Audiowide', cursive", sz:18 },
    { id:'righteous', name:'Righteous', family:"'Righteous', cursive", sz:20 },
    { id:'caveat', name:'Caveat \u00b7 International', family:"'Caveat', cursive", weight:700, sz:26 },
    { id:'press-start', name:'Press Start 2P', family:"'Press Start 2P', cursive", sz:11 },
    { id:'playfair', name:'Playfair Display \u00b7 International', family:"'Playfair Display', serif", weight:900, sz:18 },
    { id:'lora', name:'Lora \u00b7 International', family:"'Lora', serif", weight:700, sz:20 },
    { id:'merriweather', name:'Merriweather \u00b7 International', family:"'Merriweather', serif", weight:900, sz:18 },
  ];

  function esc(s) { return platform.ui ? platform.ui.esc(s) : s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function toast(msg) {
    if (!platform.ui) return;
    if (lastToast && lastToast.parentNode) lastToast.parentNode.removeChild(lastToast);
    lastToast = platform.ui.toast(msg || 'Settings saved', { duration: 2000 });
  }

  // ── Apply visual changes to page ─────────────────────────────
  // Each theme drives BOTH module-content vars (--bg/--bg2/--bg3/
  // --text/--border) AND the shell vars (--pub-bg/--pub-bg2/--pub-
  // text/--pub-text-mid/--pub-text-dim/--pub-border). publicShellHTML
  // uses --pub-*; without these the shell stayed locked to its
  // hardcoded defaults and you got split rendering — dark header
  // floating over a light theme card (or vice versa).
  var THEMES = {
    dark:        { '--bg':'#0b0b14','--bg2':'#12121f','--bg3':'#1a1a2e','--text':'#e4e4f0','--text-mid':'#a0aab0','--text-dim':'#5a6a70','--border':'#252540','--border2':'#353555',
                   '--pub-bg':'#0b0b14','--pub-bg2':'#181828','--pub-text':'#e4e4f0','--pub-text-mid':'#a8a8c0','--pub-text-dim':'#7a7a9a','--pub-border':'#252540' },
    grey:        { '--bg':'#1a1a24','--bg2':'#22222f','--bg3':'#2a2a3e','--text':'#e4e4f0','--text-mid':'#a0aab0','--text-dim':'#6a7a80','--border':'#353550','--border2':'#454565',
                   '--pub-bg':'#1a1a24','--pub-bg2':'#22222f','--pub-text':'#e4e4f0','--pub-text-mid':'#a8b0c0','--pub-text-dim':'#7a849a','--pub-border':'#353550' },
    'light-grey':{ '--bg':'#2e2e3e','--bg2':'#363648','--bg3':'#404058','--text':'#eeeef4','--text-mid':'#b0bac0','--text-dim':'#808a90','--border':'#505068','--border2':'#606078',
                   '--pub-bg':'#2e2e3e','--pub-bg2':'#363648','--pub-text':'#eeeef4','--pub-text-mid':'#b8c0d0','--pub-text-dim':'#909aa8','--pub-border':'#505068' },
    light:       { '--bg':'#e8e8f0','--bg2':'#dcdce8','--bg3':'#d0d0e0','--text':'#1a1a2e','--text-mid':'#4a4a60','--text-dim':'#7a7a90','--border':'#c0c0d4','--border2':'#b0b0c8',
                   '--pub-bg':'#f4f4f8','--pub-bg2':'#e8e8f0','--pub-text':'#1a1a2e','--pub-text-mid':'#555570','--pub-text-dim':'#8e8ea0','--pub-border':'#c0c0d4' },
    white:       { '--bg':'#ffffff','--bg2':'#f4f4f8','--bg3':'#eaeaf0','--text':'#111118','--text-mid':'#444450','--text-dim':'#888898','--border':'#d8d8e4','--border2':'#c8c8d8',
                   '--pub-bg':'#ffffff','--pub-bg2':'#f8f9fa','--pub-text':'#111118','--pub-text-mid':'#444450','--pub-text-dim':'#888898','--pub-border':'#e8e8f0' },
  };
  var ACCENTS = {
    cyan: '#00e6d2', pink: '#ff3997', green: '#39ff7f', yellow: '#ffd700', orange: '#ff6b35'
  };
  var FONT_MAP = {};
  FONTS.forEach(function(f) { FONT_MAP[f.id] = f.family; });
  var SIZES = { small: '14px', medium: '15px', large: '17px' };

  function applyVisual() {
    var r = document.documentElement.style;
    // theme
    var t = THEMES[prefs.theme];
    if (t) { for (var k in t) r.setProperty(k, t[k]); }
    // accent
    var a = ACCENTS[prefs.accent];
    if (a) { r.setProperty('--primary', a); r.setProperty('--accent', a); }
    // heading font
    var font = FONT_MAP[prefs.headingFont];
    if (font) r.setProperty('--font-head', font);
    // font size — apply to body and module content so it cascades
    var sz = SIZES[prefs.fontSize];
    if (sz) {
      document.body.style.fontSize = sz;
      var mc = document.getElementById('module-content');
      if (mc) mc.style.fontSize = sz;
    }
    // persist to localStorage for shell to pick up on reload
    try { localStorage.setItem('okdun-user-prefs', JSON.stringify({ theme: prefs.theme, accent: prefs.accent, headingFont: prefs.headingFont, fontSize: prefs.fontSize })); } catch(e) {}
  }

  // ── Save prefs (debounced) ──────────────────────────────────
  function schedSave() {
    clearTimeout(saveTimer);
    applyVisual();
    saveTimer = setTimeout(async () => {
      await API.put('/prefs', prefs);
      toast();
    }, 600);
  }

  // ── Section nav ─────────────────────────────────────────────
  function initNav() {
    var sidebar = document.getElementById('stgSidebar');
    if (!sidebar) return;
    sidebar.addEventListener('click', function(e) {
      var item = e.target.closest('.stg-nav-item');
      if (!item) return;
      var sec = item.dataset.section;
      sidebar.querySelectorAll('.stg-nav-item').forEach(function(n) { n.classList.remove('active'); });
      item.classList.add('active');
      document.querySelectorAll('#stgMain .stg-section').forEach(function(s) { s.classList.remove('active'); });
      var el = document.getElementById('sec-' + sec);
      if (el) el.classList.add('active');
      if (sec === 'revenue') loadConnectStatus();
    });
    // Tier-gate sidebar items via data-min-tier. Hide entries whose
    // required tier exceeds the viewer's. Player=0, Dev=1, Studio=2,
    // Studio_Pro=3. Tenant owner / super_owner sees everything.
    (async function() {
      try {
        var s = await platform.user.current();
        if (!s) return;
        if (s.role === 'owner' || s.superOwner) return;
        var levels = { player: 0, dev: 1, studio: 2, studio_pro: 3 };
        var tier = (typeof s.tier === 'number') ? s.tier : (levels[s.tier] || 0);
        sidebar.querySelectorAll('.stg-nav-item[data-min-tier]').forEach(function(el) {
          var req = Number(el.dataset.minTier || 0);
          if (tier < req) el.style.display = 'none';
        });
      } catch (e) {}
    })();
  }

  // ── Segmented controls ──────────────────────────────────────
  function initSegs() {
    document.getElementById('settings-app').addEventListener('click', function(e) {
      var btn = e.target.closest('.stg-seg-btn');
      if (!btn) return;
      var seg = btn.closest('.stg-seg');
      var key = seg.dataset.key;
      seg.querySelectorAll('.stg-seg-btn').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      prefs[key] = btn.dataset.val;
      schedSave();
    });
  }

  // ── Toggles ─────────────────────────────────────────────────
  function initToggles() {
    document.getElementById('settings-app').addEventListener('click', function(e) {
      var toggle = e.target.closest('.stg-toggle');
      if (!toggle || toggle.id === 'tfaToggle') return;
      toggle.classList.toggle('on');
      var lbl = toggle.nextElementSibling;
      if (lbl) lbl.textContent = toggle.classList.contains('on') ? 'ON' : 'OFF';
      var key = toggle.dataset.key;
      if (key) { prefs[key] = toggle.classList.contains('on'); schedSave(); }
    });
  }

  // ── Range inputs ────────────────────────────────────────────
  function initRanges() {
    document.querySelectorAll('#settings-app .stg-range-row input[type="range"]').forEach(function(inp) {
      inp.addEventListener('input', function() {
        var valEl = inp.nextElementSibling;
        var key = inp.dataset.key;
        if (key === 'editorFontSize') { valEl.textContent = inp.value + 'px'; }
        else if (key === 'soundVolume') { valEl.textContent = inp.value + '%'; }
        else { valEl.textContent = inp.value; }
        if (key) { prefs[key] = parseInt(inp.value); schedSave(); }
      });
    });
  }

  // ── Select dropdowns ────────────────────────────────────────
  function initSelects() {
    document.querySelectorAll('#settings-app .stg-select').forEach(function(sel) {
      sel.addEventListener('change', function() {
        var key = sel.dataset.key;
        if (key) { prefs[key] = sel.value; schedSave(); }
      });
    });
  }

  // ── Time inputs ─────────────────────────────────────────────
  function initTimeInputs() {
    document.querySelectorAll('#settings-app .stg-time-input').forEach(function(inp) {
      inp.addEventListener('change', function() {
        var key = inp.dataset.key;
        if (key) { prefs[key] = inp.value; schedSave(); }
      });
    });
  }

  // ── Font grid ───────────────────────────────────────────────
  function renderFontGrid() {
    var grid = document.getElementById('fontGrid');
    if (!grid) return;
    var activeFont = prefs.headingFont || 'bungee';
    grid.innerHTML = FONTS.map(function(f) {
      return '<div class="stg-font-card ' + (f.id === activeFont ? 'active' : '') + '" data-font="' + f.id + '">' +
        '<div class="stg-font-preview" style="font-family:' + f.family + ';font-size:' + f.sz + 'px;' + (f.weight ? 'font-weight:' + f.weight + ';' : '') + '">okdun</div>' +
        '<div class="stg-font-name">' + esc(f.name) + '</div></div>';
    }).join('');
    grid.addEventListener('click', function(e) {
      var card = e.target.closest('.stg-font-card');
      if (!card) return;
      prefs.headingFont = card.dataset.font;
      renderFontGrid();
      schedSave();
    });
  }

  // ── AI cards ────────────────────────────────────────────────
  function renderAICards() {
    var grid = document.getElementById('aiGrid');
    if (!grid) return;
    var defaultAI = prefs.defaultAI || 'none';
    grid.innerHTML = AI_PROVIDERS.map(function(ai) {
      var masked = connectedAIs[ai.id];
      var c = !!masked;
      var html = '<div class="stg-ai-card ' + (c ? 'connected' : '') + '" data-provider="' + ai.id + '">';
      if (c && defaultAI === ai.id) html += '<div class="stg-ai-default-badge">DEFAULT</div>';
      html += '<div class="stg-ai-card-head">' +
        '<div class="stg-ai-logo" style="background:' + ai.color + '22;color:' + ai.color + ';border:1px solid ' + ai.color + '33;">' + ai.icon + '</div>' +
        '<div><div class="stg-ai-name">' + esc(ai.name) + '</div><div class="stg-ai-provider">' + esc(ai.provider) + '</div></div></div>';
      html += '<div class="stg-ai-status"><span class="stg-ai-dot"></span>' + (c ? 'Connected' : 'Not connected') + '</div>';
      if (!c) {
        html += '<input type="password" class="stg-ai-key-input" data-provider="' + ai.id + '" placeholder="' + esc(ai.placeholder) + '">';
        html += '<button class="stg-ai-btn stg-ai-connect" data-action="connect" data-provider="' + ai.id + '">Connect</button>';
      } else {
        html += '<div class="stg-ai-masked">' + esc(masked) + '</div>';
        html += '<button class="stg-ai-btn stg-ai-disconnect" data-action="disconnect" data-provider="' + ai.id + '">Disconnect</button>';
        if (defaultAI !== ai.id) html += '<div class="stg-ai-set-default" data-action="set-default" data-provider="' + ai.id + '">&#9733; Set as default</div>';
      }
      html += '<div class="stg-ai-models">' + ai.models.map(function(m) { return '<span>' + esc(m) + '</span>'; }).join('') + '</div>';
      html += '</div>';
      return html;
    }).join('');
  }

  function initAIGrid() {
    var grid = document.getElementById('aiGrid');
    if (!grid) return;
    grid.addEventListener('click', async function(e) {
      var btn = e.target.closest('[data-action]');
      if (!btn) return;
      var action = btn.dataset.action;
      var provider = btn.dataset.provider;
      if (action === 'connect') {
        var inp = grid.querySelector('input[data-provider="' + provider + '"]');
        var key = inp ? inp.value.trim() : '';
        if (!key) { if (inp) { inp.style.borderColor = 'var(--red)'; inp.focus(); setTimeout(function() { inp.style.borderColor = ''; }, 1500); } return; }
        var r = await API.put('/ai-key/' + provider, { key: key });
        if (r.ok) { connectedAIs[provider] = r.masked; if (prefs.defaultAI === 'none') prefs.defaultAI = provider; renderAICards(); toast('Connected ' + provider); }
      } else if (action === 'disconnect') {
        var r2 = await API.delete('/ai-key/' + provider);
        if (r2.ok) { delete connectedAIs[provider]; if (prefs.defaultAI === provider) prefs.defaultAI = 'none'; renderAICards(); toast('Disconnected'); }
      } else if (action === 'set-default') {
        prefs.defaultAI = provider;
        var defSel = document.getElementById('defaultAI');
        if (defSel) defSel.value = provider;
        renderAICards();
        schedSave();
        toast('Default AI: ' + provider);
      }
    });
  }

  // ── 2FA ─────────────────────────────────────────────────────
  function buildCodeInputs(container, count) {
    container.innerHTML = '';
    for (var i = 0; i < count; i++) {
      var inp = document.createElement('input');
      inp.className = 'stg-tfa-code-digit';
      inp.maxLength = 1;
      inp.type = 'text';
      inp.inputMode = 'numeric';
      container.appendChild(inp);
    }
    container.addEventListener('input', function(e) {
      if (e.target.value && e.target.nextElementSibling) e.target.nextElementSibling.focus();
    });
    container.addEventListener('keydown', function(e) {
      if (e.key === 'Backspace' && !e.target.value && e.target.previousElementSibling) e.target.previousElementSibling.focus();
    });
  }

  function getCode(container) {
    return Array.from(container.querySelectorAll('.stg-tfa-code-digit')).map(function(i) { return i.value; }).join('');
  }

  function init2FA() {
    var toggle = document.getElementById('tfaToggle');
    var label = document.getElementById('tfaLabel');
    var panel = document.getElementById('tfaPanel');
    if (!toggle) return;

    buildCodeInputs(document.getElementById('totpCodeRow'), 6);
    buildCodeInputs(document.getElementById('emailCodeRow'), 6);

    toggle.addEventListener('click', async function() {
      if (prefs._tfaEnabled) {
        // disable 2FA
        var ok = platform.ui ? await platform.ui.confirm('Disable two-factor authentication?') : confirm('Disable 2FA?');
        if (!ok) return;
        await API.delete('/2fa');
        prefs._tfaEnabled = false;
        toggle.classList.remove('on');
        label.textContent = 'OFF';
        label.style.color = '';
        panel.classList.remove('visible');
        toast('2FA disabled');
        return;
      }
      // start setup
      toggle.classList.add('on');
      label.textContent = 'SETUP...';
      label.style.color = 'var(--yellow)';
      panel.classList.add('visible');
      // reset state
      panel.querySelectorAll('.stg-tfa-method').forEach(function(m) { m.classList.remove('selected'); });
      panel.querySelectorAll('.stg-tfa-setup').forEach(function(s) { s.classList.remove('visible'); });
    });

    // method selection
    panel.querySelectorAll('.stg-tfa-method').forEach(function(m) {
      m.addEventListener('click', async function() {
        var method = m.dataset.method;
        panel.querySelectorAll('.stg-tfa-method').forEach(function(x) { x.classList.remove('selected'); });
        m.classList.add('selected');
        panel.querySelectorAll('.stg-tfa-setup').forEach(function(s) { s.classList.remove('visible'); });
        var setupEl = document.getElementById('setup-' + method);
        if (setupEl) setupEl.classList.add('visible');

        if (method === 'totp') {
          var r = await API.post('/2fa/setup-totp', {});
          if (r.qr) {
            document.getElementById('tfaQr').innerHTML = '<img src="' + r.qr + '" alt="QR Code">';
            document.getElementById('tfaSecret').textContent = r.secret;
          }
          setTimeout(function() { var first = document.querySelector('#totpCodeRow .stg-tfa-code-digit'); if (first) first.focus(); }, 200);
        }
      });
    });

    // TOTP verify
    document.getElementById('totpVerifyBtn').addEventListener('click', async function() {
      var code = getCode(document.getElementById('totpCodeRow'));
      if (code.length !== 6) return;
      var r = await API.post('/2fa/verify-totp', { code: code });
      if (r.ok) {
        prefs._tfaEnabled = true;
        label.textContent = 'ON';
        label.style.color = '#39ff7f';
        panel.classList.remove('visible');
        toast('2FA enabled via Authenticator App');
      } else {
        toast(r.error || 'Invalid code');
      }
    });

    // Email send code
    document.getElementById('sendEmailCodeBtn').addEventListener('click', async function() {
      var r = await API.post('/2fa/setup-email', {});
      if (r.ok) {
        document.getElementById('emailCodeArea').style.display = 'block';
        setTimeout(function() { var first = document.querySelector('#emailCodeRow .stg-tfa-code-digit'); if (first) first.focus(); }, 200);
      }
    });

    // Email verify
    document.getElementById('emailVerifyBtn').addEventListener('click', async function() {
      var code = getCode(document.getElementById('emailCodeRow'));
      if (code.length !== 6) return;
      var r = await API.post('/2fa/verify-email', { code: code });
      if (r.ok) {
        prefs._tfaEnabled = true;
        label.textContent = 'ON';
        label.style.color = '#39ff7f';
        panel.classList.remove('visible');
        toast('2FA enabled via Email Code');
      } else {
        toast(r.error || 'Invalid code');
      }
    });
  }

  // ── Server info ────────────────────────────────────────────
  function fmtBytes(b) {
    if (b > 1e9) return (b / 1e9).toFixed(1) + ' GB';
    if (b > 1e6) return (b / 1e6).toFixed(1) + ' MB';
    if (b > 1e3) return (b / 1e3).toFixed(1) + ' KB';
    return b + ' B';
  }
  function fmtUptime(s) {
    // show as percentage — 100% unless rebooted very recently
    var totalDay = 86400;
    if (s >= totalDay) return '100%';
    return Math.floor((s / totalDay) * 100) + '%';
  }
  async function loadServerInfo() {
    var info = await API.get('/server-info');
    if (info.error) return;
    var ipEl = document.getElementById('serverIp');
    var dotEl = document.getElementById('serverDot');
    var statusEl = document.getElementById('serverStatusText');
    var cpuEl = document.getElementById('serverCpu');
    var memEl = document.getElementById('serverMem');
    var uptimeEl = document.getElementById('serverUptime');
    var sizeEl = document.getElementById('storageSize');
    if (ipEl) ipEl.textContent = info.ip;
    if (dotEl) {
      dotEl.className = 'stg-server-dot ' + (info.status === 'busy' ? 'red' : info.status === 'bit busy' ? 'yellow' : 'green');
    }
    if (statusEl) {
      statusEl.textContent = info.status;
      statusEl.style.color = info.status === 'busy' ? 'var(--red)' : info.status === 'bit busy' ? 'var(--yellow)' : '#39ff7f';
    }
    if (cpuEl) cpuEl.textContent = info.loadPct + '% (' + info.cpus + ' cores)';
    if (memEl) memEl.textContent = fmtBytes(info.memUsed) + ' / ' + fmtBytes(info.memTotal);
    if (uptimeEl) uptimeEl.textContent = fmtUptime(info.uptime);
    var limitGB = 20;
    var usedGB = info.storageBytes / 1e9;
    if (sizeEl) sizeEl.textContent = usedGB.toFixed(1) + ' of ' + limitGB + ' GB';
    var fillEl = document.getElementById('storageFill');
    if (fillEl) fillEl.style.width = Math.min(100, (usedGB / limitGB) * 100).toFixed(1) + '%';
  }

  // ── Export ──────────────────────────────────────────────────
  function initExport() {
    var btn = document.getElementById('exportBtn');
    if (!btn) return;
    btn.addEventListener('click', function() {
      var basePath = platform.basePath || '';
      window.location.href = basePath + '/api/settings/export';
    });
  }

  // ── Cache clear ─────────────────────────────────────────────
  function initCacheClear() {
    var btn = document.getElementById('clearCacheBtn');
    if (!btn) return;
    btn.addEventListener('click', function() {
      try { localStorage.clear(); } catch(e) {}
      toast('Cache cleared');
    });
  }

  // ── Email addresses ────────────────────────────────────────
  var emailDomains = [];
  var emailAddresses = [];

  async function loadEmails() {
    var container = document.getElementById('emailContent');
    if (!container) return;
    var data = await API.get('/email-addresses');
    if (data.error) return;
    emailDomains = data.domains || [];
    emailAddresses = data.emails || [];
    renderEmails();
  }

  function renderEmails() {
    var container = document.getElementById('emailContent');
    if (!container) return;
    if (!emailDomains.length) {
      container.innerHTML = '<div class="stg-info-box">Set up a custom domain with email first.</div>';
      return;
    }
    var defaultEmail = prefs.defaultEmail || '';
    var html = '';
    // address list
    if (emailAddresses.length) {
      html += '<div class="stg-email-list">';
      for (var i = 0; i < emailAddresses.length; i++) {
        var em = emailAddresses[i];
        var isDefault = em.fullAddress === defaultEmail;
        html += '<div class="stg-email-row">' +
          '<div class="stg-email-addr">' + esc(em.fullAddress) + (isDefault ? ' <span class="stg-email-default-tag">DEFAULT</span>' : '') + '</div>' +
          '<div class="stg-email-actions">';
        if (!isDefault) html += '<span class="stg-email-action" data-action="set-default" data-email="' + esc(em.fullAddress) + '">Set default</span>';
        html += '<span class="stg-email-action stg-email-delete" data-action="delete" data-id="' + em.id + '" data-domain-id="' + em.domainRecordId + '">Delete</span>';
        html += '</div></div>';
      }
      html += '</div>';
    }
    // add form
    html += '<div class="stg-email-add-form">' +
      '<input type="text" class="stg-email-local-input" id="emailLocalInput" placeholder="name">' +
      '<span class="stg-email-at">@</span>' +
      '<select class="stg-select stg-email-domain-select" id="emailDomainSelect">';
    for (var j = 0; j < emailDomains.length; j++) {
      html += '<option value="' + esc(emailDomains[j].id) + '">' + esc(emailDomains[j].domain) + '</option>';
    }
    html += '</select>' +
      '<button class="stg-ai-btn stg-ai-connect stg-email-add-btn" id="addEmailBtn">Add</button>' +
      '</div>';
    container.innerHTML = html;
  }

  function initEmails() {
    var container = document.getElementById('emailContent');
    if (!container) return;
    container.addEventListener('click', async function(e) {
      var el = e.target.closest('[data-action]');
      if (el) {
        var action = el.dataset.action;
        if (action === 'set-default') {
          prefs.defaultEmail = el.dataset.email;
          schedSave();
          renderEmails();
        } else if (action === 'delete') {
          var ok = platform.ui ? await platform.ui.confirm('Delete this email address?') : confirm('Delete?');
          if (!ok) return;
          var basePath = platform.basePath || '';
          var resp = await fetch(basePath + '/api/domain/domains/' + el.dataset.domainId + '/emails/' + el.dataset.id, {
            method: 'DELETE', credentials: 'same-origin'
          });
          if (resp.ok) { toast('Email deleted'); loadEmails(); }
          else { toast('Delete failed'); }
        }
        return;
      }
      if (!e.target.closest('#addEmailBtn')) return;
      var localInput = document.getElementById('emailLocalInput');
      var domainSelect = document.getElementById('emailDomainSelect');
      if (!localInput || !domainSelect) return;
      var local = localInput.value.trim().toLowerCase();
      if (!local) { localInput.style.borderColor = 'var(--red)'; localInput.focus(); setTimeout(function() { localInput.style.borderColor = ''; }, 1500); return; }
      var domainId = domainSelect.value;
      var basePath = platform.basePath || '';
      var resp = await fetch(basePath + '/api/domain/domains/' + domainId + '/emails', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: local })
      });
      var result = await resp.json();
      if (result.id) {
        toast('Email address added');
        if (!prefs.defaultEmail) { prefs.defaultEmail = result.data.fullAddress; schedSave(); }
        loadEmails();
      } else {
        toast(result.error || 'Failed to add');
      }
    });
  }

  // ── My Email Addresses (member self-service) ──────────────
  async function loadMyEmails() {
    var container = document.getElementById('myEmailsContent');
    if (!container) return;
    var basePath = platform.basePath || '';
    try {
      var r = await fetch(basePath + '/api/mail/my-addresses', { credentials: 'same-origin' });
      var addrs = await r.json();
      if (!addrs.length) {
        container.innerHTML = '<div class="stg-sublabel">No email addresses assigned to you yet.</div>';
        return;
      }
      var html = '<div class="stg-email-list">';
      for (var i = 0; i < addrs.length; i++) {
        html += '<div class="stg-email-row"><div class="stg-email-addr">' + esc(addrs[i].address) + '</div></div>';
      }
      html += '</div>';
      container.innerHTML = html;
    } catch(e) {
      container.innerHTML = '<div class="stg-sublabel">Unable to load email addresses.</div>';
    }
  }

  // ── Password Change ──────────────────────────────────────
  function initPasswordChange() {
    var btn = document.getElementById('changePwBtn');
    if (!btn) return;
    btn.addEventListener('click', async function() {
      var cur = document.getElementById('currentPwInput');
      var nw = document.getElementById('newPwInput');
      if (!cur || !nw) return;
      var currentPw = cur.value.trim();
      var newPw = nw.value.trim();
      if (!currentPw) { cur.style.borderColor = 'var(--red)'; cur.focus(); setTimeout(function() { cur.style.borderColor = ''; }, 1500); return; }
      if (newPw.length < 8) { nw.style.borderColor = 'var(--red)'; nw.focus(); toast('Password must be 8+ characters'); setTimeout(function() { nw.style.borderColor = ''; }, 1500); return; }
      var basePath = platform.basePath || '';
      try {
        var r = await fetch(basePath + '/api/auth/change-password', {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw })
        });
        var data = await r.json();
        if (data.ok) { toast('Password updated'); cur.value = ''; nw.value = ''; }
        else toast(data.error || 'Failed to update password');
      } catch(e) { toast('Connection error'); }
    });
  }

  // ── Revenue / Stripe Connect ───────────────────────────────
  var TIER_NAMES = {
    free: 'Free', lite: 'OK Lite', standard: 'OK Standard', pro: 'OK Pro',
    player: 'Player', dev: 'Dev', studio: 'Studio', studio_pro: 'Studio Pro',
  };
  var TIER_PRICES = { free: '$0', lite: '$3/mo', standard: '$7/mo', pro: '$10/mo' };

  async function loadConnectStatus() {
    var el = document.getElementById('connectStatus');
    if (!el) return;
    var basePath = platform.basePath || '';
    try {
      var r = await fetch(basePath + '/api/connect/status');
      var data = await r.json();
      renderRevenue(data, el);
    } catch(e) {
      el.innerHTML = '<div class="stg-sublabel">Unable to load payment status.</div>';
    }
  }

  function renderRevenue(data, el) {
    var tier = data.tier || prefs.plan || 'free';
    var tierName = TIER_NAMES[tier] || tier;
    var rate = data.commissionRate || 0;
    var ratePct = Math.round(rate * 100);

    // Commission info
    var commEl = document.getElementById('commissionInfo');
    if (commEl) {
      if (tier === 'free') commEl.textContent = 'Upgrade to accept payments';
      else commEl.textContent = 'Your tier: ' + tierName + ' \u2014 ' + ratePct + '% platform fee';
    }

    if (tier === 'free') {
      el.innerHTML = '<div class="stg-upgrade-prompt">' +
        '<div style="font-size:14px;font-weight:600;color:var(--text);margin-bottom:6px;">Upgrade to accept payments</div>' +
        '<div style="font-size:13px;color:var(--text-dim);margin-bottom:12px;">Start with OK Lite (' + TIER_PRICES.lite + ') to accept payments from your customers with just a 5% platform fee.</div>' +
        '<button class="stg-ai-btn stg-ai-connect" style="width:auto;padding:8px 20px;" onclick="platform.nav.goto(\'/bill-pay\')">Upgrade Plan</button>' +
        '</div>';
      return;
    }

    if (!data.status || data.status === 'none') {
      el.innerHTML = '<div class="stg-row">' +
        '<div><div class="stg-label">Payment processing</div><div class="stg-sublabel">Connect a Stripe account to accept payments from your customers.</div></div>' +
        '<button class="stg-ai-btn stg-ai-connect" id="startConnectBtn" style="width:auto;padding:8px 20px;">Start accepting payments</button>' +
        '</div>';
      return;
    }

    var statusBadge = '';
    if (data.status === 'active' && data.chargesEnabled) {
      statusBadge = '<span class="stg-connect-badge active">Active</span>';
    } else if (data.status === 'needs_info') {
      statusBadge = '<span class="stg-connect-badge pending">Needs info</span>';
    } else {
      statusBadge = '<span class="stg-connect-badge pending">Pending</span>';
    }

    var html = '<div class="stg-row">' +
      '<div><div class="stg-label">Payment processing</div><div class="stg-sublabel">Stripe Express account</div></div>' +
      statusBadge +
      '</div>';

    if (data.chargesEnabled) {
      html += '<div class="stg-row">' +
        '<div><div class="stg-label">Commission rate</div><div class="stg-sublabel">' + tierName + ' tier</div></div>' +
        '<div class="stg-connect-rate">' + ratePct + '%</div>' +
        '</div>';
      html += '<div class="stg-row">' +
        '<div><div class="stg-label">Stripe Dashboard</div><div class="stg-sublabel">View your payouts, transactions, and settings</div></div>' +
        '<button class="stg-ai-btn stg-ai-connect" id="openDashboardBtn" style="width:auto;padding:8px 20px;">Open Dashboard</button>' +
        '</div>';
    } else {
      html += '<div class="stg-row">' +
        '<div><div class="stg-label">Complete setup</div><div class="stg-sublabel">Finish Stripe onboarding to start accepting payments.</div></div>' +
        '<button class="stg-ai-btn stg-ai-connect" id="refreshConnectBtn" style="width:auto;padding:8px 20px;">Continue Setup</button>' +
        '</div>';
    }

    el.innerHTML = html;
  }

  async function startConnect() {
    var basePath = platform.basePath || '';
    try {
      var r = await fetch(basePath + '/api/connect/create', { method: 'POST' });
      var data = await r.json();
      if (data.url) window.location.href = data.url;
      else toast(data.error || 'Failed to start');
    } catch(e) { toast('Connection error'); }
  }

  async function refreshConnect() {
    var basePath = platform.basePath || '';
    try {
      var r = await fetch(basePath + '/api/connect/refresh', { method: 'POST' });
      var data = await r.json();
      if (data.url) window.location.href = data.url;
      else toast(data.error || 'Failed');
    } catch(e) { toast('Connection error'); }
  }

  async function openStripeDashboard() {
    var basePath = platform.basePath || '';
    try {
      var r = await fetch(basePath + '/api/connect/dashboard');
      var data = await r.json();
      if (data.url) window.open(data.url, '_blank');
      else toast(data.error || 'Failed');
    } catch(e) { toast('Connection error'); }
  }

  function initRevenue() {
    var container = document.getElementById('revenueContent');
    if (!container) return;
    container.addEventListener('click', function(e) {
      if (e.target.closest('#startConnectBtn')) startConnect();
      else if (e.target.closest('#refreshConnectBtn')) refreshConnect();
      else if (e.target.closest('#openDashboardBtn')) openStripeDashboard();
    });
  }

  // ── Apply loaded prefs to UI ────────────────────────────────
  async function applyPrefs() {
    // seg controls
    document.querySelectorAll('#settings-app .stg-seg').forEach(function(seg) {
      var key = seg.dataset.key;
      var val = prefs[key];
      if (val) {
        seg.querySelectorAll('.stg-seg-btn').forEach(function(b) { b.classList.remove('active'); });
        var match = seg.querySelector('[data-val="' + val + '"]');
        if (match) match.classList.add('active');
      }
    });
    // toggles
    document.querySelectorAll('#settings-app .stg-toggle[data-key]').forEach(function(t) {
      if (t.id === 'tfaToggle') return;
      var key = t.dataset.key;
      if (prefs[key] !== undefined) {
        t.classList.toggle('on', !!prefs[key]);
        var lbl = t.nextElementSibling;
        if (lbl) lbl.textContent = prefs[key] ? 'ON' : 'OFF';
      }
    });
    // ranges
    document.querySelectorAll('#settings-app input[type="range"][data-key]').forEach(function(inp) {
      var key = inp.dataset.key;
      if (prefs[key] !== undefined) {
        inp.value = prefs[key];
        var valEl = inp.nextElementSibling;
        if (key === 'editorFontSize') valEl.textContent = prefs[key] + 'px';
        else if (key === 'soundVolume') valEl.textContent = prefs[key] + '%';
      }
    });
    // selects
    document.querySelectorAll('#settings-app .stg-select[data-key]').forEach(function(sel) {
      var key = sel.dataset.key;
      if (prefs[key] !== undefined) sel.value = prefs[key];
    });
    // time inputs
    document.querySelectorAll('#settings-app .stg-time-input[data-key]').forEach(function(inp) {
      var key = inp.dataset.key;
      if (prefs[key] !== undefined) inp.value = prefs[key];
    });
    // 2FA state
    if (prefs.tfa && prefs.tfa.enabled) {
      prefs._tfaEnabled = true;
      var toggle = document.getElementById('tfaToggle');
      var label = document.getElementById('tfaLabel');
      if (toggle) { toggle.classList.add('on'); }
      if (label) { label.textContent = 'ON'; label.style.color = '#39ff7f'; }
    }
    // identity (display name + email) at the top of Account. prefs
    // route returns these for both user-level and client-level
    // accounts; falls back to session if prefs is missing them.
    var idName = prefs.displayName;
    var idEmail = prefs.email;
    if (!idName || !idEmail) {
      try {
        var ses = await platform.user.current();
        if (ses) {
          idName = idName || ses.displayName || ses.username || ses.email || ses.slug;
          idEmail = idEmail || ses.email;
        }
      } catch (_) {}
    }
    // Populate Details box. Username + Display name are editable; email
    // is read-only (changing it requires re-verification, future work).
    var dn = document.getElementById('profileDisplayName');
    if (dn && idName && !dn.value) dn.value = idName;
    var unEl = document.getElementById('accountUsername');
    if (unEl) {
      var unVal = prefs.username || (await (async function(){
        try { var s = await platform.user.current(); return s && (s.username || s.handle); } catch(_) { return null; }
      })());
      if (unVal) {
        // Username is mutable (1 rename / 30 days). The input is the
        // canonical editor; the Save button + hint live next to it.
        if (unEl.tagName === 'INPUT') unEl.value = unVal;
        else unEl.textContent = unVal;
        unEl.dataset.original = unVal;
      }
      // Pre-load cooldown state from prefs.usernameChangedAt (if any)
      // so the hint shows "next eligible: <date>" before the user even
      // touches the field.
      var changedAt = prefs.usernameChangedAt;
      var hintEl = document.getElementById('usernameHint');
      var saveBtn = document.getElementById('usernameSaveBtn');
      var asideEl = document.getElementById('usernameAside');
      if (hintEl && changedAt) {
        var ms = Date.parse(changedAt) + 30 * 24 * 60 * 60 * 1000 - Date.now();
        if (ms > 0) {
          var days = Math.ceil(ms / (24 * 60 * 60 * 1000));
          hintEl.textContent = 'Next change in ' + days + ' day' + (days === 1 ? '' : 's');
          hintEl.className = 'stg-acct-username-hint bad';
          if (unEl && unEl.tagName === 'INPUT') unEl.readOnly = true;
          if (saveBtn) saveBtn.disabled = true;
          // The cooldown message replaces the standing aside copy.
          if (asideEl) asideEl.style.display = 'none';
        }
      }
    }
    // EMAIL = username@<studioSlug>.gamoids.com (studio-tier accounts).
    // Studio name rendered as a highlighted chip. Pre-studio users see
    // their plain signup email instead.
    var emailEl = document.getElementById('accountEmail');
    if (emailEl) {
      var sesObj = null;
      try { sesObj = await platform.user.current(); } catch (_) {}
      var studioSlug = sesObj && sesObj.studioSlug;
      var unameForEmail = (unEl && unEl.value) || (sesObj && (sesObj.username || sesObj.handle)) || '';
      if (studioSlug && unameForEmail) {
        // Plain text composite — the slug used to render in a red
        // highlight box but that drew the eye to a field the user
        // can't edit (slug is locked) and added visible margins on
        // either side. Same content, no decoration.
        emailEl.textContent = unameForEmail + '@' + studioSlug + '.gamoids.com';
      } else if (idEmail) {
        emailEl.textContent = idEmail;
      }
    }
    // RECOVERY EMAIL = the original signup address (read-only).
    var recEl = document.getElementById('accountRecoveryEmail');
    if (recEl && idEmail) recEl.value = idEmail;

    // STUDIO row — only rendered for studio-tier viewers. Slug is locked
    // (subdomain + mailbox + DNS + DKIM all keyed off it); name is the
    // only studio identity field a user can edit post-signup.
    try {
      var stRow = document.getElementById('accountStudioRow');
      var stNameRow = document.getElementById('accountStudioNameRow');
      var sesObj3 = await platform.user.current();
      var isStudioTier3 = sesObj3 && (sesObj3.tier === 'studio' || sesObj3.tier === 'studio_pro' || sesObj3.plan === 'studio' || sesObj3.plan === 'studio_pro');
      if (stRow && isStudioTier3 && sesObj3.studioSlug) {
        stRow.style.display = '';
        if (stNameRow) stNameRow.style.display = '';
        var slugEl = document.getElementById('accountStudioSlug');
        if (slugEl) slugEl.textContent = sesObj3.studioSlug;
        var snEl = document.getElementById('accountStudioName');
        if (snEl) {
          var things2 = await fetch('/_api/storage/list?type=thing').then(function(r){ return r.json(); }).catch(function(){ return []; });
          var myStudio2 = Array.isArray(things2) ? things2.find(function(t) {
            return t.kind === 'studio' && (t.slug === sesObj3.studioSlug || t.owner_user_id === sesObj3.slug);
          }) : null;
          if (myStudio2 && (myStudio2.name || myStudio2.studioName)) snEl.value = myStudio2.name || myStudio2.studioName;
        }
      }
    } catch (e) {}

    // plan info — show "<TierName> plan" + colored tier badge.
    var planVal = prefs.plan;
    if (!planVal) {
      try {
        var ses2 = await platform.user.current();
        planVal = ses2 && ses2.tier;
      } catch (_) {}
    }
    if (planVal) {
      var planEl = document.getElementById('planInfo');
      var label = (TIER_NAMES[planVal] || (planVal.charAt(0).toUpperCase() + planVal.slice(1))) + ' plan';
      if (planEl) planEl.textContent = label;
      var badge = document.getElementById('accountTierBadge');
      if (badge) {
        badge.setAttribute('data-tier', planVal);
        badge.textContent = (TIER_NAMES[planVal] || planVal).toUpperCase();
      }
    }
    // Studio identity chip — name or logo. Renders to the LEFT of the
    // tier badge for studio-tier viewers. Logo wins when uploaded;
    // otherwise the studio name (or slug if no name).
    try {
      var chip = document.getElementById('accountStudioChip');
      var sesObj = await platform.user.current();
      var isStudioTier = sesObj && (sesObj.tier === 'studio' || sesObj.tier === 'studio_pro' || sesObj.plan === 'studio' || sesObj.plan === 'studio_pro');
      if (chip && isStudioTier && sesObj.studioSlug) {
        var things = await fetch('/_api/storage/list?type=thing').then(function(r){ return r.json(); }).catch(function(){ return []; });
        var st = Array.isArray(things) ? things.find(function(t){
          return t.kind === 'studio' && (t.slug === sesObj.studioSlug || t.owner_user_id === sesObj.slug);
        }) : null;
        var name = (st && (st.name || st.slug)) || sesObj.studioSlug;
        var logo = st && st.meta && st.meta.logoFileId;
        if (!logo) logo = st && st.studioLogoFileId;
        var html = '';
        if (logo) html += '<img src="/_instance/files/' + esc(logo) + '" alt="' + esc(name) + '">';
        html += '<span class="stg-acct-studio-chip-name">' + esc(name) + '</span>';
        chip.innerHTML = html;
        chip.href = '/explore/thingi';
        chip.title = name;
        chip.style.display = 'inline-flex';
      } else if (chip) {
        chip.style.display = 'none';
      }
    } catch (e) {}
  }

  // ── Profile (Account → editable per-user data) ─────────────
  // Country list — short and covers gamoid's likely audience. Edit
  // freely; ISO 3166-1 alpha-2 codes are the source of truth (flag
  // unicode renders from the code, not from a sprite).
  var COUNTRIES = [
    ['US','United States'],['CA','Canada'],['MX','Mexico'],['BR','Brazil'],['AR','Argentina'],
    ['GB','United Kingdom'],['IE','Ireland'],['DE','Germany'],['FR','France'],['ES','Spain'],
    ['IT','Italy'],['NL','Netherlands'],['SE','Sweden'],['NO','Norway'],['DK','Denmark'],
    ['FI','Finland'],['PL','Poland'],['CZ','Czechia'],['UA','Ukraine'],['RU','Russia'],
    ['TR','Türkiye'],['GR','Greece'],['PT','Portugal'],['CH','Switzerland'],['AT','Austria'],
    ['BE','Belgium'],['RO','Romania'],['HU','Hungary'],
    ['JP','Japan'],['KR','South Korea'],['CN','China'],['TW','Taiwan'],['HK','Hong Kong'],
    ['SG','Singapore'],['MY','Malaysia'],['ID','Indonesia'],['TH','Thailand'],['VN','Vietnam'],
    ['PH','Philippines'],['IN','India'],['PK','Pakistan'],['BD','Bangladesh'],
    ['AU','Australia'],['NZ','New Zealand'],
    ['ZA','South Africa'],['NG','Nigeria'],['EG','Egypt'],['MA','Morocco'],['KE','Kenya'],
    ['AE','United Arab Emirates'],['SA','Saudi Arabia'],['IL','Israel'],
    ['CL','Chile'],['CO','Colombia'],['PE','Peru'],['UY','Uruguay'],
  ];
  // Region presets — coarse-grained on purpose. Damon's spec: just the
  // 3 macro regions, not a city-by-city picker.
  var TIMEZONES = [
    ['Americas','Americas'],
    ['Europe','Europe'],
    ['Asia','Asia'],
  ];
  function flagEmoji(cc) {
    if (!cc) return '';
    var s = String(cc).trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(s)) return '';
    return String.fromCodePoint(0x1F1E6 + s.charCodeAt(0) - 65) +
           String.fromCodePoint(0x1F1E6 + s.charCodeAt(1) - 65);
  }
  // Recognised platforms — keep in sync with mod-list's PLAT_GLYPH so
  // both the Settings picker and the Explore Social column show the
  // same icons.
  var PLATFORMS = [
    ['x',         '𝕏 X / Twitter'],
    ['instagram', '📷 Instagram'],
    ['youtube',   '▶ YouTube'],
    ['tiktok',    '♪ TikTok'],
    ['twitch',    '🎮 Twitch'],
    ['facebook',  'f Facebook'],
    ['threads',   '@ Threads'],
    ['linkedin',  'in LinkedIn'],
  ];
  // In-memory state for the picker. Mirrored into the POST body on save.
  var _platformState = {};
  function _platLabel(k) {
    for (var i = 0; i < PLATFORMS.length; i++) if (PLATFORMS[i][0] === k) return PLATFORMS[i][1];
    return k;
  }
  function renderPlatformRows() {
    var host = document.getElementById('profilePlatformsList');
    if (!host) return;
    var keys = Object.keys(_platformState);
    if (!keys.length) {
      host.innerHTML = '<div class="stg-sublabel" style="opacity:.7">No networks added yet.</div>';
      return;
    }
    host.innerHTML = keys.map(function(k) {
      var handle = _platformState[k];
      return '<div class="stg-row" style="padding:6px 10px;background:var(--bg-card,#12121f);border:1px solid var(--border,#252540);border-radius:6px;gap:8px;">' +
        '<span style="min-width:140px;font-size:13px">' + _platLabel(k) + '</span>' +
        '<input type="text" class="stg-input plat-row-input" data-key="' + k + '" value="' + String(handle || '').replace(/"/g,'&quot;') + '" placeholder="handle / URL" style="flex:1">' +
        '<button class="stg-ai-btn" data-rm="' + k + '" style="width:auto;padding:6px 12px;background:transparent;border:1px solid var(--red,#ff3997);color:var(--red,#ff3997)">×</button>' +
      '</div>';
    }).join('');
    Array.from(host.querySelectorAll('.plat-row-input')).forEach(function(inp) {
      inp.addEventListener('input', function() { _platformState[inp.dataset.key] = inp.value; });
    });
    Array.from(host.querySelectorAll('button[data-rm]')).forEach(function(btn) {
      btn.addEventListener('click', function() {
        delete _platformState[btn.dataset.rm];
        renderPlatformRows();
        refreshAddSelect();
      });
    });
  }
  function refreshAddSelect() {
    var sel = document.getElementById('platformAddSelect');
    if (!sel) return;
    var remaining = PLATFORMS.filter(function(p) { return !(p[0] in _platformState); });
    if (!remaining.length) {
      sel.innerHTML = '<option value="">All added</option>';
      sel.disabled = true;
    } else {
      sel.disabled = false;
      sel.innerHTML = remaining.map(function(p) { return '<option value="' + p[0] + '">' + p[1] + '</option>'; }).join('');
    }
  }
  function initProfile() {
    var cSel = document.getElementById('profileCountry');
    var tSel = document.getElementById('profileTimezone');
    var flagEl = document.getElementById('profileCountryFlag');
    if (cSel) {
      // Country option text is just the country name. The flag emoji
      // lives in the preview span next to the select — native option
      // text doesn't render colour emoji reliably on Linux/Chromium.
      cSel.innerHTML = '<option value="">— Select country —</option>' +
        COUNTRIES.map(function(c){ return '<option value="' + c[0] + '">' + c[1] + '</option>'; }).join('');
      cSel.addEventListener('change', function() {
        if (flagEl) flagEl.textContent = flagEmoji(cSel.value) || '\uD83C\uDF0D';  // 🌍 fallback
      });
    }
    if (tSel) {
      tSel.innerHTML = '<option value="">— Select region —</option>' +
        TIMEZONES.map(function(t){ return '<option value="' + t[0] + '">' + t[1] + '</option>'; }).join('');
    }
    // Pre-fill from /api/auth/session (carries displayName, country,
    // timezone, bio, platforms when the user record / client.data has them).
    fetch('/api/auth/session').then(function(r){ return r.json(); }).then(function(s){
      if (!s || !s.loggedIn) return;
      var dn = document.getElementById('profileDisplayName');
      var bio = document.getElementById('profileBio');
      if (dn) dn.value = s.displayName || s.username || '';
      if (cSel && s.country) {
        cSel.value = s.country;
        if (flagEl) flagEl.textContent = flagEmoji(s.country) || '\uD83C\uDF0D';
      }
      if (tSel && s.timezone) tSel.value = s.timezone;
      if (bio) bio.value = s.bio || '';
      _platformState = (s.platforms && typeof s.platforms === 'object') ? Object.assign({}, s.platforms) : {};
      renderPlatformRows();
      refreshAddSelect();
    }).catch(function(){ renderPlatformRows(); refreshAddSelect(); });
    var btn = document.getElementById('profileSaveBtn');
    if (btn) btn.addEventListener('click', saveProfile);
    var addBtn = document.getElementById('platformAddBtn');
    if (addBtn) addBtn.addEventListener('click', function() {
      var sel = document.getElementById('platformAddSelect');
      var inp = document.getElementById('platformAddHandle');
      if (!sel || !sel.value) return;
      _platformState[sel.value] = (inp && inp.value.trim()) || '';
      if (inp) inp.value = '';
      renderPlatformRows();
      refreshAddSelect();
    });
    // Press outlets — local-state only for now. Backend storage TBD;
    // we render the rows so the layout is complete and saves don't
    // crash. State persists for the session and is included in the
    // saveProfile payload (server currently ignores unknown fields).
    renderPressRows();
    var pAddBtn = document.getElementById('pressAddBtn');
    if (pAddBtn) pAddBtn.addEventListener('click', function() {
      var nameI = document.getElementById('pressAddName');
      var urlI = document.getElementById('pressAddUrl');
      var name = nameI && nameI.value.trim();
      var url = urlI && urlI.value.trim();
      if (!name) return;
      _pressState.push({ name: name, url: url || '' });
      if (nameI) nameI.value = '';
      if (urlI) urlI.value = '';
      renderPressRows();
    });
  }

  var _pressState = [];
  function renderPressRows() {
    var host = document.getElementById('profilePressList');
    if (!host) return;
    if (!_pressState.length) {
      host.innerHTML = '<div class="stg-sublabel" style="opacity:.7">No press outlets added yet.</div>';
      return;
    }
    host.innerHTML = _pressState.map(function(r, i) {
      return '<div class="stg-row" style="padding:6px 10px;background:var(--bg-card,#12121f);border:1px solid var(--border,#252540);border-radius:6px;gap:8px;">' +
        '<span style="min-width:140px;font-size:13px">' + (r.name || '').replace(/</g,'&lt;') + '</span>' +
        '<a href="' + (r.url || '#').replace(/"/g,'&quot;') + '" target="_blank" rel="noopener" style="flex:1;font-size:12px;color:var(--primary);text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + (r.url || '').replace(/</g,'&lt;') + '</a>' +
        '<button class="stg-ai-btn" data-press-rm="' + i + '" style="width:auto;padding:6px 12px;background:transparent;border:1px solid var(--red,#ff3997);color:var(--red,#ff3997)">×</button>' +
      '</div>';
    }).join('');
    Array.from(host.querySelectorAll('[data-press-rm]')).forEach(function(btn) {
      btn.addEventListener('click', function() {
        _pressState.splice(Number(btn.dataset.pressRm), 1);
        renderPressRows();
      });
    });
  }
  async function saveProfile() {
    var dn = document.getElementById('profileDisplayName');
    var cSel = document.getElementById('profileCountry');
    var tSel = document.getElementById('profileTimezone');
    var bio = document.getElementById('profileBio');
    var btn = document.getElementById('profileSaveBtn');
    var payload = {
      displayName: dn ? dn.value.trim() : null,
      country:     cSel ? cSel.value || null : null,
      timezone:    tSel ? tSel.value || null : null,
      bio:         bio ? bio.value.trim() : null,
      platforms:   _platformState,
    };
    if (btn) { btn.disabled = true; btn.dataset.orig = btn.textContent; btn.textContent = 'Saving…'; }
    try {
      var r = await fetch('/api/auth/profile', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (r.ok) {
        if (btn) { btn.textContent = 'Saved ✓'; setTimeout(function(){ btn.disabled = false; btn.textContent = btn.dataset.orig || 'Save profile'; }, 1200); }
      } else if (btn) {
        btn.textContent = 'Failed'; btn.disabled = false;
        setTimeout(function(){ btn.textContent = btn.dataset.orig || 'Save profile'; }, 1500);
      }
    } catch (e) {
      if (btn) { btn.textContent = 'Network error'; btn.disabled = false; }
    }
  }

  // ── Team Management ────────────────────────────────────────
  var teamMembers = [];
  var teamInvites = [];
  var teamEmails = [];
  var _userRole = 'owner';

  async function loadTeam() {
    try {
      var data = await API.get('/team');
      if (data.error) return;
      teamMembers = data;
      renderTeamMembers();
    } catch {}
    try {
      var inv = await API.get('/team/invites');
      if (!inv.error) { teamInvites = inv; renderTeamInvites(); }
    } catch {}
    try {
      var emails = await API.get('/team/emails');
      if (!emails.error) teamEmails = emails;
    } catch {}
  }

  function roleBadgeClass(role) {
    if (role === 'owner') return 'stg-role-owner';
    if (role === 'admin') return 'stg-role-admin';
    return 'stg-role-member';
  }

  function renderTeamMembers() {
    var el = document.getElementById('teamMembers');
    if (!el) return;
    if (!teamMembers.length) { el.innerHTML = '<div class="stg-sublabel">No team members yet</div>'; return; }
    var html = '';
    for (var i = 0; i < teamMembers.length; i++) {
      var m = teamMembers[i];
      if (!m.role) m.role = 'member';
      html += '<div class="stg-team-row" data-userid="' + m.id + '">' +
        '<div class="stg-team-avatar">' + esc(m.avatar || '??') + '</div>' +
        '<div class="stg-team-info">' +
          '<div class="stg-team-name">' + esc(m.displayName || m.email) + '</div>' +
          '<div class="stg-team-email">' + esc(m.email) + '</div>' +
        '</div>' +
        '<span class="stg-role-badge ' + roleBadgeClass(m.role) + '">' + m.role + '</span>';
      if (m.role !== 'owner' && _userRole === 'owner') {
        html += '<button class="stg-team-action" data-action="edit-access" data-userid="' + m.id + '">Edit</button>';
        html += '<button class="stg-team-action stg-team-remove" data-action="remove" data-userid="' + m.id + '">Remove</button>';
      } else if (m.role !== 'owner' && _userRole === 'admin') {
        html += '<button class="stg-team-action" data-action="edit-access" data-userid="' + m.id + '">Edit</button>';
        html += '<button class="stg-team-action stg-team-remove" data-action="remove" data-userid="' + m.id + '">Remove</button>';
      }
      html += '</div>';
      // Inline edit panel (hidden by default)
      html += '<div class="stg-team-edit-panel" id="edit-' + m.id + '" style="display:none;">';
      if (_userRole === 'owner' && m.role !== 'owner') {
        html += '<div class="stg-team-edit-section"><span class="stg-label">Role:</span> ';
        html += '<button class="stg-seg-btn' + (m.role === 'admin' ? ' active' : '') + '" data-setrole="admin" data-userid="' + m.id + '">Admin</button>';
        html += '<button class="stg-seg-btn' + (m.role === 'member' ? ' active' : '') + '" data-setrole="member" data-userid="' + m.id + '">Member</button>';
        html += '</div>';
      }
      if (m.role !== 'owner') {
        html += '<div class="stg-team-edit-section"><span class="stg-label">Module access:</span>';
        html += '<div class="stg-team-mod-grid" id="modgrid-' + m.id + '"></div>';
        html += '</div>';
      }
      html += '<div class="stg-team-edit-section"><span class="stg-label">Email addresses:</span>';
      html += '<div class="stg-team-mod-grid" id="emailgrid-' + m.id + '"></div>';
      html += '</div>';
      html += '</div>';
    }
    el.innerHTML = html;
  }

  function renderTeamInvites() {
    var el = document.getElementById('teamInvites');
    if (!el) return;
    if (!teamInvites.length) { el.innerHTML = '<div class="stg-sublabel">No pending invites</div>'; return; }
    var html = '';
    for (var i = 0; i < teamInvites.length; i++) {
      var inv = teamInvites[i];
      html += '<div class="stg-team-row">' +
        '<div class="stg-team-avatar" style="opacity:0.5">' + esc((inv.displayName || inv.email).slice(0,2).toUpperCase()) + '</div>' +
        '<div class="stg-team-info">' +
          '<div class="stg-team-name">' + esc(inv.displayName || inv.email) + '</div>' +
          '<div class="stg-team-email">' + esc(inv.email) + ' <span class="stg-connect-badge pending">Pending</span></div>' +
        '</div>' +
        '<button class="stg-team-action stg-team-remove" data-action="cancel-invite" data-inviteid="' + inv.id + '">Cancel</button>' +
        '</div>';
    }
    el.innerHTML = html;
  }

  // System infra mods — not toggleable, every account has them
  var INFRA_MODS = ['bill-pay', 'comms', 'settings', 'setup', 'signup', 'mods'];

  function getDefaultVis(role) {
    // admin = all on, member = build on + system off
    var modules = platform.index.getModules();
    var vis = {};
    for (var i = 0; i < modules.length; i++) {
      var mod = modules[i];
      var group = mod.group || 'system';
      if (group === 'public' || INFRA_MODS.indexOf(mod.module) >= 0) continue;
      vis[mod.module] = (role === 'admin') ? true : (group === 'build');
    }
    return vis;
  }

  function buildModGrid(userId) {
    var gridEl = document.getElementById('modgrid-' + userId);
    if (!gridEl) return;
    var member = teamMembers.find(function(m) { return m.id === userId; });
    if (!member) return;
    var modules = platform.index.getModules();
    var vis = member.modVisibility || {};
    var defaults = getDefaultVis(member.role);
    var html = '';
    for (var i = 0; i < modules.length; i++) {
      var mod = modules[i];
      var group = mod.group || 'system';
      if (group === 'public') continue;
      if (INFRA_MODS.indexOf(mod.module) >= 0) continue;
      var defaultOn = defaults[mod.module] !== undefined ? defaults[mod.module] : (group === 'build');
      var isOn = vis[mod.module] !== undefined ? vis[mod.module] : defaultOn;
      html += '<label class="stg-team-mod-check">' +
        '<input type="checkbox" data-mod="' + mod.module + '"' + (isOn ? ' checked' : '') + '>' +
        '<span>' + esc(mod.label || mod.module) + '</span>' +
        '<span class="stg-team-mod-group">' + group + '</span>' +
        '</label>';
    }
    gridEl.innerHTML = html;
    gridEl.addEventListener('change', async function(e) {
      var cb = e.target.closest('input[type="checkbox"]');
      if (!cb) return;
      var modVis = {};
      gridEl.querySelectorAll('input[type="checkbox"]').forEach(function(inp) {
        modVis[inp.dataset.mod] = inp.checked;
      });
      await API.put('/team/' + userId + '/visibility', { modVisibility: modVis });
      member.modVisibility = modVis;
      toast('Access updated');
    });
  }

  function buildEmailGrid(userId) {
    var gridEl = document.getElementById('emailgrid-' + userId);
    if (!gridEl) return;
    if (!teamEmails.length) {
      gridEl.innerHTML = '<span class="stg-sublabel">No domain emails — create them in Domain module</span>';
      return;
    }
    var html = '';
    for (var i = 0; i < teamEmails.length; i++) {
      var em = teamEmails[i];
      var assigned = (em.assignedTo || []).indexOf(userId) >= 0;
      html += '<label class="stg-team-mod-check">' +
        '<input type="checkbox" data-emailid="' + em.id + '"' + (assigned ? ' checked' : '') + '>' +
        '<span>' + esc(em.address) + '</span>' +
        '</label>';
    }
    gridEl.innerHTML = html;
    gridEl.addEventListener('change', async function(e) {
      var cb = e.target.closest('input[type="checkbox"]');
      if (!cb) return;
      var ids = [];
      gridEl.querySelectorAll('input[type="checkbox"]:checked').forEach(function(inp) {
        ids.push(inp.dataset.emailid);
      });
      await API.put('/team/' + userId + '/emails', { emailIds: ids });
      // Update local state
      for (var j = 0; j < teamEmails.length; j++) {
        var arr = teamEmails[j].assignedTo || [];
        if (ids.indexOf(teamEmails[j].id) >= 0) {
          if (arr.indexOf(userId) < 0) arr.push(userId);
        } else {
          arr = arr.filter(function(x) { return x !== userId; });
        }
        teamEmails[j].assignedTo = arr;
      }
      toast('Emails updated');
    });
  }

  function initTeam() {
    var container = document.getElementById('sec-team');
    if (!container) return;

    // Invite button
    var invBtn = document.getElementById('inviteBtn');
    if (invBtn) {
      invBtn.addEventListener('click', async function() {
        var email = prompt('Email address to invite:');
        if (!email || !email.includes('@')) return;
        var name = prompt('Display name (optional):') || '';
        var r = await API.post('/team/invite', { email: email, displayName: name });
        if (r.ok) { toast('Invite sent'); loadTeam(); }
        else toast(r.error || 'Failed to invite');
      });
    }

    // Delegated click handler for team actions
    container.addEventListener('click', async function(e) {
      var btn = e.target.closest('[data-action]');
      if (!btn) return;
      var action = btn.dataset.action;
      if (action === 'edit-access') {
        var userId = btn.dataset.userid;
        var panel = document.getElementById('edit-' + userId);
        if (panel) {
          var visible = panel.style.display !== 'none';
          panel.style.display = visible ? 'none' : 'block';
          if (!visible) { buildModGrid(userId); buildEmailGrid(userId); }
        }
      } else if (action === 'remove') {
        var ok = platform.ui ? await platform.ui.confirm('Remove this team member?') : confirm('Remove?');
        if (!ok) return;
        var r = await API.delete('/team/' + btn.dataset.userid);
        if (r.ok) { toast('Member removed'); loadTeam(); }
        else toast(r.error || 'Failed');
      } else if (action === 'cancel-invite') {
        var ok2 = platform.ui ? await platform.ui.confirm('Cancel this invite?') : confirm('Cancel?');
        if (!ok2) return;
        var r2 = await API.delete('/team/invites/' + btn.dataset.inviteid);
        if (r2.ok) { toast('Invite cancelled'); loadTeam(); }
        else toast(r2.error || 'Failed');
      }
    });

    // Role change buttons — also set default visibility for the new role
    container.addEventListener('click', async function(e) {
      var btn = e.target.closest('[data-setrole]');
      if (!btn) return;
      var role = btn.dataset.setrole;
      var userId = btn.dataset.userid;
      var r = await API.put('/team/' + userId + '/role', { role: role });
      if (!r.ok) { toast(r.error || 'Failed'); return; }
      // Auto-set default mod visibility for the new role
      var defaultVis = getDefaultVis(role);
      await API.put('/team/' + userId + '/visibility', { modVisibility: defaultVis });
      // Update local state without re-rendering (keeps edit panel open)
      var member = teamMembers.find(function(m) { return m.id === userId; });
      if (member) { member.role = role; member.modVisibility = defaultVis; }
      // Update seg button active states
      var panel = document.getElementById('edit-' + userId);
      if (panel) {
        panel.querySelectorAll('[data-setrole]').forEach(function(b) {
          b.classList.toggle('active', b.dataset.setrole === role);
        });
      }
      // Update role badge on the team row
      var row = container.querySelector('.stg-team-row[data-userid="' + userId + '"]');
      if (row) {
        var badge = row.querySelector('.stg-role-badge');
        if (badge) { badge.className = 'stg-role-badge ' + roleBadgeClass(role); badge.textContent = role; }
      }
      // Refresh mod grid to reflect new role defaults
      buildModGrid(userId);
      toast('Role updated');
    });
  }

  // ── Manage Plan ─────────────────────────────────────────────
  // Click "Manage Plan" → modal showing the user's current tier +
  // upgrade options pulled from the instance's SIGNUP_CONFIG (same
  // tier data signup uses, so marketing copy stays consistent).
  // Picking a paid tier sets the bill-pay handoff and lands on /bill-pay
  // exactly like the signup flow does for paid tiers — reuses existing
  // Stripe checkout instead of inventing a parallel path.
  async function loadTiers() {
    // Prefer inline SIGNUP_CONFIG (set by the public shell). Fall back
    // to /api/signup/config if the embed isn't present.
    if (window.SIGNUP_CONFIG && Array.isArray(window.SIGNUP_CONFIG.tiers)) return window.SIGNUP_CONFIG.tiers;
    try {
      var r = await fetch('/api/signup/config');
      if (r.ok) { var c = await r.json(); if (c && Array.isArray(c.tiers)) return c.tiers; }
    } catch (e) {}
    return [];
  }
  function currentTierKey() {
    // Map session.role → tier id used in SIGNUP_CONFIG.
    if (_userRole === 'studio') return 'studio';
    if (_userRole === 'dev')    return 'dev';
    return 'player'; // free / unknown
  }
  function openPlanModal() {
    var existing = document.getElementById('stgPlanModal');
    if (existing) existing.remove();
    loadTiers().then(function(tiers) {
      var cur = currentTierKey();
      var rows = tiers.map(function(t) {
        var isCur = t.id === cur;
        var isPaid = (t.monthly || t.price || 0) > 0;
        var priceLabel = isPaid ? ('$' + (t.monthly || t.price) + '/mo') : 'Free';
        var btn = isCur
          ? '<button class="stg-ai-btn" disabled style="opacity:.5;cursor:default">CURRENT</button>'
          : '<button class="stg-ai-btn stg-ai-connect" data-tier="' + t.id + '">' + (isPaid ? 'UPGRADE' : 'SWITCH') + '</button>';
        var color = t.color || 'var(--primary)';
        return '<div class="stg-plan-row" style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;background:var(--bg2,#12121f);border:1px solid var(--border,#252540);border-radius:8px;margin-bottom:10px">' +
          '<div style="flex:1">' +
            '<div style="font-family:var(--font-head,Bungee);color:' + color + ';font-size:16px">' + (t.name || t.id).toUpperCase() + '</div>' +
            '<div style="font-size:13px;color:var(--text-mid,#a0aab0);margin-top:4px">' + (t.tagline || t.description || '') + '</div>' +
          '</div>' +
          '<div style="text-align:right;margin-left:18px">' +
            '<div style="font-family:var(--font-mono,monospace);color:var(--text,#e4e4f0);font-size:18px;margin-bottom:6px">' + priceLabel + '</div>' +
            btn +
          '</div>' +
        '</div>';
      }).join('');
      var html =
        '<div id="stgPlanModalBg" style="position:fixed;inset:0;background:rgba(0,0,0,.6);backdrop-filter:blur(4px);z-index:2000;display:flex;align-items:center;justify-content:center;padding:20px">' +
          '<div style="background:var(--bg,#0b0b14);border:1px solid var(--border,#252540);border-radius:14px;padding:28px;width:520px;max-width:90vw;max-height:85vh;overflow:auto;position:relative">' +
            '<button id="stgPlanClose" style="position:absolute;top:10px;right:14px;background:none;border:0;color:var(--text-mid,#a0aab0);font-size:22px;cursor:pointer">&times;</button>' +
            '<h2 style="font-family:var(--font-head,Bungee);margin:0 0 6px;color:var(--text,#e4e4f0);font-size:20px">Manage Plan</h2>' +
            '<p style="margin:0 0 18px;font-size:13px;color:var(--text-mid,#a0aab0)">Current: <strong style="color:var(--text,#e4e4f0)">' + cur.toUpperCase() + '</strong>. Upgrades route through Stripe.</p>' +
            (tiers.length ? rows : '<div style="color:var(--text-mid,#a0aab0);font-size:14px">No tier config available.</div>') +
          '</div>' +
        '</div>';
      var wrap = document.createElement('div');
      wrap.id = 'stgPlanModal';
      wrap.innerHTML = html;
      document.body.appendChild(wrap);
      var bg = document.getElementById('stgPlanModalBg');
      var closeBtn = document.getElementById('stgPlanClose');
      function shut() { wrap.remove(); }
      closeBtn.addEventListener('click', shut);
      bg.addEventListener('click', function(e) { if (e.target === bg) shut(); });
      wrap.querySelectorAll('button[data-tier]').forEach(function(b) {
        b.addEventListener('click', async function() {
          var tierId = b.dataset.tier;
          var t = tiers.find(function(x) { return x.id === tierId; });
          if (!t) return;
          // First-time studio upgrade needs a subdomain slug — open
          // the slug-picker modal, validate live, then post upgrade.
          var isStudio = (tierId === 'studio' || tierId === 'studio_pro');
          if (isStudio) {
            // Probe whether the user already has a locked slug — if so
            // we can upgrade straight without re-prompting.
            try {
              var sesRes = await fetch('/api/auth/session');
              var ses = await sesRes.json();
              // If session reveals an existing studio thing slug, skip
              // the picker. Otherwise show it.
              var hasLockedSlug = !!(ses && ses.studioSlug);
              if (!hasLockedSlug) {
                openStudioSlugPicker(tierId, t, b);
                return;
              }
            } catch (e) {}
          }
          await doUpgradeTier(tierId, t, b, null);
        });
      });
    });
  }
  function initPlanManage() {
    var btn = document.getElementById('planManageBtn');
    if (btn) btn.addEventListener('click', openPlanModal);
    // Tier badge in the Account header acts as a secondary affordance —
    // clicking it also opens the same plan modal so the colored chip
    // doubles as a "manage" trigger.
    var badge = document.getElementById('accountTierBadge');
    if (badge) badge.addEventListener('click', openPlanModal);
    // Username Save button — debounced availability check on input,
    // POST to /api/auth/change-username on click. Server enforces
    // the 30-day rate limit; UI surfaces the cooldown message.
    var unInp = document.getElementById('accountUsername');
    var unSave = document.getElementById('usernameSaveBtn');
    var unHint = document.getElementById('usernameHint');
    if (unInp && unSave && unInp.tagName === 'INPUT' && !unInp.readOnly) {
      var unCheckTimer = null;
      // Aside (label-row cooldown copy) provides the standing notice;
      // the hint span carries live availability + post-save messages.
      unInp.addEventListener('input', function() {
        var v = unInp.value.trim().toLowerCase();
        if (v !== unInp.value) unInp.value = v;
        var orig = unInp.dataset.original || '';
        unSave.disabled = true;
        unHint.textContent = '';
        unHint.className = 'stg-acct-username-hint';
        if (!v || v === orig) return;
        if (!/^[a-z0-9_-]{3,20}$/.test(v)) {
          unHint.textContent = '3–20 chars, a–z, 0–9, _ -';
          unHint.className = 'stg-acct-username-hint bad';
          return;
        }
        unHint.textContent = 'Checking…';
        clearTimeout(unCheckTimer);
        unCheckTimer = setTimeout(async function() {
          try {
            var r = await fetch('/api/auth/check-username?name=' + encodeURIComponent(v));
            var d = await r.json();
            if (d.available) {
              unHint.textContent = '✓ available';
              unHint.className = 'stg-acct-username-hint ok';
              unSave.disabled = false;
            } else {
              unHint.textContent = '✗ ' + (d.reason || 'taken');
              unHint.className = 'stg-acct-username-hint bad';
            }
          } catch (e) {
            unHint.textContent = 'Network error';
            unHint.className = 'stg-acct-username-hint bad';
          }
        }, 300);
      });
      unSave.addEventListener('click', async function() {
        var v = unInp.value.trim().toLowerCase();
        // Confirm the 30-day lock BEFORE firing the rename. In-app
        // modal — no native window.confirm chrome.
        var ok = await showConfirmModal({
          title: 'Change username?',
          bodyHtml:
            'New username: <strong>@' + v.replace(/[<>&]/g, function(c) { return ({ '<':'&lt;', '>':'&gt;', '&':'&amp;' })[c]; }) + '</strong><br><br>' +
            'You can only change your username <strong>once every 30 days</strong>. After saving, you won\'t be able to change it again until then.',
          confirmText: 'Change',
          cancelText: 'Cancel',
        });
        if (!ok) return;
        unSave.disabled = true;
        unSave.textContent = 'Saving…';
        try {
          var r = await fetch('/api/auth/change-username', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: v }),
          });
          var d = await r.json();
          if (r.ok && d.ok) {
            unInp.dataset.original = d.username;
            unInp.value = d.username;
            unInp.readOnly = true;
            unHint.textContent = 'Saved. Next change in 30 days.';
            unHint.className = 'stg-acct-username-hint ok';
            var aside1 = document.getElementById('usernameAside');
            if (aside1) aside1.style.display = 'none';
          } else if (r.status === 429 && d.daysRemaining) {
            unHint.textContent = 'Already changed recently. ' + d.daysRemaining + ' day' + (d.daysRemaining === 1 ? '' : 's') + ' until next change.';
            unHint.className = 'stg-acct-username-hint bad';
            unInp.readOnly = true;
          } else {
            unHint.textContent = (d && d.error) || 'Save failed';
            unHint.className = 'stg-acct-username-hint bad';
          }
        } catch (e) {
          unHint.textContent = 'Network error';
          unHint.className = 'stg-acct-username-hint bad';
        }
        unSave.textContent = 'Save';
      });
    }

    // Delete account — single confirm() prompt then POST to
    // /api/auth/delete-account (server wipes the client + studio
    // thing and clears the session). Bare for now; long-term policy
    // is a 90-day grace period with reminder emails instead of
    // self-serve delete.
    var del = document.getElementById('deleteBtn');
    if (del) del.addEventListener('click', async function() {
      var ok = await showConfirmModal({
        title: 'Delete account?',
        bodyHtml:
          'This removes your <strong>client record</strong> and <strong>studio thing</strong> from the server. ' +
          'The action <strong>cannot be undone</strong>.',
        confirmText: 'Delete',
        cancelText: 'Cancel',
        danger: true,
      });
      if (!ok) return;
      del.disabled = true; del.textContent = 'Deleting…';
      try {
        var r = await fetch('/api/auth/delete-account', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirm: true }),
        });
        var j = await r.json().catch(function() { return null; });
        if (r.ok && j && j.ok) {
          // Account is gone — bounce to /signup so the now-stale
          // session can't render any more authenticated views.
          location.href = '/signup';
        } else {
          del.disabled = false; del.textContent = 'Delete Account';
          alert('Delete failed: ' + ((j && j.error) || 'unknown'));
        }
      } catch (e) {
        del.disabled = false; del.textContent = 'Delete Account';
        alert('Delete failed: ' + (e && e.message || e));
      }
    });
  }

  // ── Mailboxes ───────────────────────────────────────────────
  // Two parallel surfaces:
  //   - Studio tier viewer  → manages <slug>.gamoids.com mailboxes
  //                            (their studio's client-facing emails).
  //   - super_owner / gamoidEmployee → manages @gamoid.io mailboxes
  //                            (Gamoid Ltd company emails). Super-
  //                            owner auto-gets <slug>@gamoid.io minted
  //                            on first Mailboxes load.
  // Both can be true (super_owner who also has a test studio); we
  // show whichever applies — but the more common case is one of the
  // two. The nav item is visible if either applies.
  var _mbxSlug = null, _mbxDomain = null, _mbxList = [], _mbxTeam = [], _mbxMode = null;
  async function initMailboxes() {
    var ses;
    try { ses = await (await fetch('/api/auth/session')).json(); } catch (e) { ses = {}; }
    var plan = (ses && ses.plan) || 'free';
    var isStudio = (plan === 'studio' || plan === 'studio_pro');
    // Company mailboxes: tenant owner (damon for gamoid.io) gets them
    // automatically; super_owner + flagged employees also qualify.
    var tenantSlug = window.INSTANCE_SLUG || null;
    var isTenantOwner = !!(ses && tenantSlug && ses.slug === tenantSlug);
    var isCompany = isTenantOwner || !!(ses && (ses.superOwner || ses.role === 'super_owner' || ses.gamoidEmployee));
    var nav = document.getElementById('stgMailboxesNav');
    if (nav) nav.style.display = (isStudio || isCompany) ? '' : 'none';
    if (!isStudio && !isCompany) return;

    // Company takes priority for super_owner — gamoid employees see
    // their @gamoid.io mailboxes, not whatever studio they may have
    // created for testing. Studio-only users see studio mailboxes.
    var companyDomain = (window.INSTANCE_MAIL && window.INSTANCE_MAIL.companyMailDomain) || 'gamoid.io';
    var studioParent  = (window.INSTANCE_MAIL && window.INSTANCE_MAIL.studioMailDomain)  || 'gamoids.com';
    if (isCompany) {
      _mbxMode = 'company';
      _mbxDomain = companyDomain;
      _mbxSlug = null;
      // Auto-mint the super-owner's own @gamoid.io mailbox so the
      // Mailboxes pane shows them an actual address on first load
      // (instead of an empty list). One-shot; subsequent loads find
      // the existing record.
      // Auto-mint the viewer's own @<companyDomain> mailbox. Pick
      // the most identity-stable local-part:
      //   - tenant owner (damon, with slug=tenant-slug='gamoid' and
      //     studio='damon'): use studio so we get damon@gamoid.io,
      //     not gamoid@gamoid.io;
      //   - everyone else (lstgms9, employees): use slug — that's
      //     their permanent identifier on the platform. (`username`
      //     can be a vanity name like "dgb" and shifts with renames.)
      try {
        var localPart = (ses.studio && ses.studio !== ses.slug)
          ? ses.studio
          : (ses.slug || ses.studio);
        await fetch('/api/auth/company-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ local: localPart }),
        });
      } catch (e) {}
    } else {
      _mbxMode = 'studio';
      _mbxSlug = (ses && ses.studioSlug) || null;
      _mbxDomain = _mbxSlug ? (_mbxSlug + '.' + studioParent) : studioParent;
    }
    var hint = document.getElementById('mbxDomainHint');
    if (hint) hint.textContent = 'e.g. marketing → marketing@' + _mbxDomain;
    var header = document.querySelector('#sec-mailboxes .stg-section-header');
    var sub = document.querySelector('#sec-mailboxes .stg-section-desc');
    if (header) header.textContent = (_mbxMode === 'company') ? 'Company Mailboxes' : 'Studio Mailboxes';
    if (sub) sub.textContent = (_mbxMode === 'company')
      ? 'Email addresses under your gamoid.io company domain. Assign mailboxes to Gamoid employees.'
      : "Email addresses under your studio's subdomain. Assign a mailbox to a dev to give them mail access.";

    // Load existing mailboxes + team members in parallel.
    try {
      var [addrRes, teamRes] = await Promise.all([
        fetch('/api/chat/my-addresses'),
        fetch('/api/chat/external/team-members'),
      ]);
      _mbxList = await addrRes.json().catch(function(){ return []; });
      _mbxTeam = await teamRes.json().catch(function(){ return []; });
    } catch (e) { _mbxList = []; _mbxTeam = []; }
    // Filter to mailboxes under THIS surface's domain only — never
    // mix gamoid.io and gamoids.com on the same screen.
    _mbxList = (_mbxList || []).filter(function(a) {
      var d = a.domain || (a.data && a.data.domain) || '';
      if (a.address && a.address.indexOf('@') !== -1) d = a.address.split('@')[1];
      return d === _mbxDomain;
    });
    renderMailboxList();
    populateTeamPicker(document.getElementById('mbxNewAssign'));
    var add = document.getElementById('mbxAddBtn');
    if (add) {
      var clone = add.cloneNode(true);  // strip any stale listener
      add.parentNode.replaceChild(clone, add);
      clone.addEventListener('click', onMailboxCreate);
    }
  }
  function renderMailboxList() {
    var host = document.getElementById('mbxList');
    var empty = document.getElementById('mbxListEmpty');
    if (!host) return;
    host.innerHTML = '';
    if (!_mbxList.length) {
      if (empty) empty.style.display = '';
      return;
    }
    if (empty) empty.style.display = 'none';
    _mbxList.forEach(function(addr) {
      var row = document.createElement('div');
      row.className = 'stg-mbx-row';
      // Full email gets a full row of its own. The pulldown + delete
      // sit on a secondary row below so the email never gets truncated.
      row.style.cssText = 'display:flex;flex-direction:column;gap:8px;padding:10px 14px;background:var(--bg2,#12121f);border:1px solid var(--border,#252540);border-radius:8px;';
      var full = addr.address || ((addr.data && addr.data.fullAddress) || '');
      if (full.indexOf('@') === -1 && addr.domain) full = full + '@' + addr.domain;
      var assigned = (addr.data && addr.data.assignedTo) || addr.assignedTo || [];
      row.innerHTML =
        '<div style="font-family:var(--font-mono,monospace);color:var(--text,#e4e4f0);font-size:14px;word-break:break-all;line-height:1.3;">' + escapeHTML(full) + '</div>' +
        '<div style="display:flex;gap:8px;align-items:center;">' +
          '<select class="stg-input mbx-reassign" data-id="' + addr.id + '" style="flex:1;min-width:0;">' +
            '<option value="">— Owner only —</option>' +
          '</select>' +
          '<button class="stg-ai-btn mbx-del" data-id="' + addr.id + '" style="background:transparent;color:var(--red,#ff3997);border:1px solid var(--border,#252540);padding:6px 14px;border-radius:8px;cursor:pointer;white-space:nowrap;">Delete</button>' +
        '</div>';
      host.appendChild(row);
      var sel = row.querySelector('select.mbx-reassign');
      populateTeamPicker(sel, assigned[0] || '');
      sel.addEventListener('change', function() { onMailboxReassign(addr.id, sel.value ? [sel.value] : []); });
      row.querySelector('.mbx-del').addEventListener('click', function() { onMailboxDelete(addr.id); });
    });
  }
  function populateTeamPicker(sel, selectedUserId) {
    if (!sel) return;
    sel.innerHTML = '<option value="">— Owner only —</option>';
    _mbxTeam.forEach(function(t) {
      var opt = document.createElement('option');
      opt.value = t.userId || t.id;
      opt.textContent = t.name || t.id;
      if (selectedUserId && (t.userId === selectedUserId || t.id === selectedUserId)) opt.selected = true;
      sel.appendChild(opt);
    });
  }
  function escapeHTML(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]; }); }
  function showMbxErr(msg) {
    var el = document.getElementById('mbxErr');
    if (!el) return;
    if (!msg) { el.style.display = 'none'; el.textContent = ''; return; }
    el.style.display = '';
    el.textContent = msg;
    setTimeout(function() { if (el.textContent === msg) showMbxErr(''); }, 4500);
  }
  async function onMailboxCreate() {
    var input = document.getElementById('mbxNewLocal');
    var sel = document.getElementById('mbxNewAssign');
    var btn = document.getElementById('mbxAddBtn');
    var local = (input.value || '').toLowerCase().replace(/[^a-z0-9._-]/g, '');
    if (!local) { showMbxErr('Local part required.'); return; }
    if (local.length > 20) { showMbxErr('Max 20 chars.'); return; }
    if (!_mbxDomain) { showMbxErr('Domain unresolved.'); return; }
    var assignedTo = sel.value ? [sel.value] : [];
    btn.disabled = true;
    var oldText = btn.textContent;
    btn.textContent = 'Creating…';
    try {
      var url, payload;
      if (_mbxMode === 'company') {
        // Company mailboxes go through the super-owner-only admin route
        // so the CF rule + storage record are written together with the
        // correct ownerId='gamoid' tag.
        url = '/api/auth/company-email';
        payload = { local: local, userId: assignedTo[0] || null };
      } else {
        url = '/api/chat/external/addresses';
        payload = { address: local, domain: _mbxDomain, assignedTo: assignedTo };
      }
      var r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      var j = await r.json();
      if (!r.ok || j.ok === false) throw new Error((j && j.error) || 'Create failed');
      input.value = '';
      sel.value = '';
      // Refresh by re-reading — the company endpoint returns a slim
      // {ok,address,id} so we can't just unshift the record directly.
      await refreshMailboxList();
    } catch (e) {
      showMbxErr(e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = oldText;
    }
  }
  async function refreshMailboxList() {
    try {
      var addrRes = await fetch('/api/chat/my-addresses');
      var rows = await addrRes.json();
      _mbxList = (rows || []).filter(function(a) {
        var d = a.domain || (a.data && a.data.domain) || '';
        if (a.address && a.address.indexOf('@') !== -1) d = a.address.split('@')[1];
        return d === _mbxDomain;
      });
      renderMailboxList();
    } catch (e) {}
  }
  async function onMailboxReassign(id, assignedTo) {
    try {
      var r = await fetch('/api/chat/external/addresses/' + encodeURIComponent(id), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignedTo: assignedTo }),
      });
      var j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Reassign failed');
      // Patch local cache then re-render so label updates.
      var idx = _mbxList.findIndex(function(a) { return a.id === id; });
      if (idx !== -1) {
        if (_mbxList[idx].data) _mbxList[idx].data.assignedTo = assignedTo;
        else _mbxList[idx].assignedTo = assignedTo;
      }
      renderMailboxList();
    } catch (e) { showMbxErr(e.message); }
  }
  async function onMailboxDelete(id) {
    if (!confirm('Delete this mailbox? This cannot be undone.')) return;
    try {
      var r = await fetch('/api/chat/external/addresses/' + encodeURIComponent(id), { method: 'DELETE' });
      var j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Delete failed');
      _mbxList = _mbxList.filter(function(a) { return a.id !== id; });
      renderMailboxList();
    } catch (e) { showMbxErr(e.message); }
  }

  // Studio slug picker — modal that opens when the user clicks a paid
  // studio tier for the first time. Live URL preview, debounced
  // availability check against /api/auth/check-studio-slug, hard
  // warning that the slug is permanent.
  async function doUpgradeTier(tierId, t, srcBtn, studioSlug) {
    if (srcBtn) { srcBtn.disabled = true; srcBtn.textContent = 'UPDATING...'; }
    try {
      var body = { tier: tierId };
      if (studioSlug) body.studioSlug = studioSlug;
      var r = await fetch('/api/auth/upgrade-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      var j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || 'Upgrade failed');
      toast('Plan updated to ' + (t.name || tierId).toUpperCase());
      var planEl = document.getElementById('planInfo');
      if (planEl) planEl.textContent = (t.name || tierId).charAt(0).toUpperCase() + (t.name || tierId).slice(1).toLowerCase();
      var planModal = document.getElementById('stgPlanModal');
      if (planModal) planModal.remove();
      var slugModal = document.getElementById('stgSlugModal');
      if (slugModal) slugModal.remove();
      setTimeout(function() { location.reload(); }, 600);
    } catch (e) {
      if (srcBtn) { srcBtn.disabled = false; srcBtn.textContent = 'RETRY'; }
      toast('Upgrade failed: ' + e.message);
      throw e;
    }
  }
  function openStudioSlugPicker(tierId, t, srcBtn) {
    var existing = document.getElementById('stgSlugModal');
    if (existing) existing.remove();
    // Read parent mail domain from inlined SIGNUP_CONFIG if available;
    // fall back to gamoid.io.
    var mailDomain = (window.INSTANCE_MAIL_DOMAIN || 'gamoids.com');
    var html =
      '<div id="stgSlugModalBg" style="position:fixed;inset:0;background:rgba(0,0,0,.7);backdrop-filter:blur(4px);z-index:3000;display:flex;align-items:center;justify-content:center;padding:20px">' +
        '<div style="background:var(--bg,#0b0b14);border:1px solid var(--border,#252540);border-radius:14px;padding:28px;width:500px;max-width:90vw;position:relative">' +
          '<button id="stgSlugClose" style="position:absolute;top:10px;right:14px;background:none;border:0;color:var(--text-mid,#a0aab0);font-size:22px;cursor:pointer">&times;</button>' +
          '<h2 style="font-family:var(--font-head,Bungee);margin:0 0 6px;color:var(--text,#e4e4f0);font-size:20px">Choose your studio URL</h2>' +
          '<p style="margin:0 0 14px;font-size:13px;color:var(--text-mid,#a0aab0);line-height:1.45">Pick the subdomain for your studio. This becomes your website AND your email domain. <strong style="color:var(--red,#ff3997)">It can&rsquo;t be changed later</strong> — choose carefully.</p>' +
          '<div style="display:flex;align-items:center;background:var(--bg2,#12121f);border:1px solid var(--border,#252540);border-radius:8px;padding:4px 4px 4px 12px;margin-bottom:8px">' +
            '<input id="stgSlugIn" type="text" placeholder="gamebolina" maxlength="30" autocapitalize="off" spellcheck="false" autocomplete="off" style="flex:1;background:transparent;border:none;color:var(--text,#e4e4f0);font-family:var(--font-mono,monospace);font-size:15px;outline:none;padding:8px 0">' +
            '<span style="font-family:var(--font-mono,monospace);font-size:15px;color:var(--text-mid,#a0aab0);padding:8px 12px 8px 4px">.' + mailDomain + '</span>' +
          '</div>' +
          '<div id="stgSlugStatus" style="font-size:12px;min-height:18px;font-family:var(--font-mono,monospace);color:var(--text-mid,#a0aab0)">3-30 chars, lowercase letters, numbers, hyphens.</div>' +
          '<div style="background:rgba(255,57,151,0.08);border:1px solid rgba(255,57,151,0.3);border-radius:8px;padding:10px 12px;margin:14px 0;font-size:13px;color:var(--text,#e4e4f0);line-height:1.4">' +
            '<strong style="color:var(--red,#ff3997)">Heads up:</strong> Your studio website (<span id="stgSlugPreview1" style="color:var(--primary)">…</span>) and emails (<span id="stgSlugPreview2" style="color:var(--primary)">…@…</span>) will use this URL forever.' +
          '</div>' +
          '<div style="display:flex;gap:8px;justify-content:flex-end">' +
            '<button id="stgSlugCancel" class="stg-ai-btn" style="background:transparent;color:var(--text-mid,#a0aab0);border:1px solid var(--border,#252540);padding:10px 18px;border-radius:8px;cursor:pointer">Cancel</button>' +
            '<button id="stgSlugConfirm" class="stg-ai-btn stg-ai-connect" disabled style="padding:10px 22px;opacity:.5">Confirm &amp; Upgrade</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    var wrap = document.createElement('div');
    wrap.id = 'stgSlugModal';
    wrap.innerHTML = html;
    document.body.appendChild(wrap);
    var bg = document.getElementById('stgSlugModalBg');
    var input = document.getElementById('stgSlugIn');
    var status = document.getElementById('stgSlugStatus');
    var preview1 = document.getElementById('stgSlugPreview1');
    var preview2 = document.getElementById('stgSlugPreview2');
    var confirm = document.getElementById('stgSlugConfirm');
    function shut() { wrap.remove(); }
    document.getElementById('stgSlugClose').addEventListener('click', shut);
    document.getElementById('stgSlugCancel').addEventListener('click', shut);
    bg.addEventListener('click', function(e) { if (e.target === bg) shut(); });
    input.focus();
    var checkTimer = null, lastChecked = '', okStr = false;
    function setStatus(text, color) {
      status.textContent = text;
      status.style.color = color || 'var(--text-mid,#a0aab0)';
    }
    function setConfirmEnabled(en) {
      confirm.disabled = !en;
      confirm.style.opacity = en ? '1' : '.5';
      confirm.style.cursor = en ? 'pointer' : 'default';
    }
    function refreshPreview() {
      var v = (input.value || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
      if (v !== input.value) input.value = v;
      preview1.textContent = (v || '<slug>') + '.' + mailDomain;
      preview2.textContent = 'you@' + (v || '<slug>') + '.' + mailDomain;
      if (!v) { setStatus('3-30 chars, lowercase letters, numbers, hyphens.'); setConfirmEnabled(false); return; }
      if (v.length < 3) { setStatus('Too short (3 chars min).', 'var(--red,#ff3997)'); setConfirmEnabled(false); return; }
      setStatus('Checking availability…');
      setConfirmEnabled(false);
      clearTimeout(checkTimer);
      checkTimer = setTimeout(async function() {
        try {
          var r = await fetch('/api/auth/check-studio-slug?slug=' + encodeURIComponent(v));
          var j = await r.json();
          if (input.value !== v) return; // user kept typing
          lastChecked = v;
          if (j && j.ok) {
            setStatus('✓ available', '#39ff7f');
            okStr = true;
            setConfirmEnabled(true);
          } else {
            var reasons = { reserved: 'Reserved name — pick another.', taken: 'Taken — pick another.', format: 'Invalid format.', empty: 'Required.' };
            setStatus('✗ ' + (reasons[j && j.reason] || 'Not available'), 'var(--red,#ff3997)');
            okStr = false;
            setConfirmEnabled(false);
          }
        } catch (e) {
          setStatus('Network error — try again', 'var(--red,#ff3997)');
        }
      }, 300);
    }
    input.addEventListener('input', refreshPreview);
    refreshPreview();
    confirm.addEventListener('click', async function() {
      var v = (input.value || '').toLowerCase();
      if (!v || !okStr || v !== lastChecked) return;
      confirm.disabled = true;
      confirm.textContent = 'UPGRADING…';
      try { await doUpgradeTier(tierId, t, srcBtn, v); }
      catch (e) {
        confirm.disabled = false;
        confirm.textContent = 'Confirm & Upgrade';
      }
    });
  }

  // ── Init ────────────────────────────────────────────────────
  // Promise-based confirm modal — replaces window.confirm() so
  // dialogs match the rest of the app's chrome. Returns a Promise
  // that resolves to true (confirm) or false (cancel / backdrop /
  // Escape). Supports a `danger` flag that switches the confirm
  // button to red for destructive actions.
  function showConfirmModal(opts) {
    opts = opts || {};
    return new Promise(function(resolve) {
      var bg = document.getElementById('stgConfirmBg');
      var title = document.getElementById('stgConfirmTitle');
      var body = document.getElementById('stgConfirmBody');
      var okBtn = document.getElementById('stgConfirmOk');
      var cancelBtn = document.getElementById('stgConfirmCancel');
      var closeX = document.getElementById('stgConfirmCloseX');
      if (!bg || !okBtn || !cancelBtn) { resolve(window.confirm(opts.body || 'Confirm?')); return; }
      title.textContent = opts.title || 'Confirm';
      // body can be plain text or HTML — accept the riskier opt-in.
      if (opts.bodyHtml) body.innerHTML = opts.bodyHtml; else body.textContent = opts.body || '';
      okBtn.textContent = opts.confirmText || 'OK';
      cancelBtn.textContent = opts.cancelText || 'Cancel';
      okBtn.classList.toggle('danger', !!opts.danger);
      function cleanup() {
        bg.classList.remove('open');
        bg.removeEventListener('mousedown', backdropDown);
        bg.removeEventListener('mouseup', backdropUp);
        document.removeEventListener('keydown', onKey);
        okBtn.onclick = null; cancelBtn.onclick = null; closeX.onclick = null;
      }
      function close(v) { cleanup(); resolve(v); }
      okBtn.onclick = function() { close(true); };
      cancelBtn.onclick = function() { close(false); };
      closeX.onclick = function() { close(false); };
      var _md = false;
      function backdropDown(e) { _md = (e.target === bg); }
      function backdropUp(e) { if (_md && e.target === bg) close(false); _md = false; }
      bg.addEventListener('mousedown', backdropDown);
      bg.addEventListener('mouseup', backdropUp);
      function onKey(e) { if (e.key === 'Escape') close(false); }
      document.addEventListener('keydown', onKey);
      bg.classList.add('open');
      setTimeout(function() { okBtn.focus(); }, 30);
    });
  }
  window._stgConfirm = showConfirmModal;

  window.platform.module.init = async function() {
    // Fill any [data-tenant-brand] placeholders with the current
    // tenant's display name. mod-settings is multi-tenant, so we read
    // from window.SIGNUP_CONFIG.heroTitle when present, otherwise
    // capitalize INSTANCE_SLUG, otherwise leave the placeholder
    // ("this site") in place.
    try {
      var brand = (window.SIGNUP_CONFIG && (window.SIGNUP_CONFIG.heroTitle || '').trim())
        || (window.INSTANCE_SLUG && window.INSTANCE_SLUG.charAt(0).toUpperCase() + window.INSTANCE_SLUG.slice(1))
        || '';
      if (brand) {
        document.querySelectorAll('[data-tenant-brand]').forEach(function(el) {
          el.textContent = brand;
        });
      }
    } catch (_) {}

    var data = await API.get('/prefs');
    if (data && !data.error) {
      // separate AI keys from prefs
      connectedAIs = data.aiKeys || {};
      delete data.aiKeys;
      prefs = data;
    }

    // Check role for team tab visibility
    try {
      var session = await platform.user.current();
      if (session && session.role) _userRole = session.role;
      if (_userRole === 'owner' || _userRole === 'admin') {
        var teamNav = document.getElementById('stgTeamNav');
        if (teamNav) teamNav.style.display = '';
      }
    } catch {}

    initNav();
    initSegs();
    initToggles();
    initRanges();
    initSelects();
    initTimeInputs();
    renderFontGrid();
    renderAICards();
    initAIGrid();
    init2FA();
    initRevenue();
    initExport();
    initCacheClear();
    initPasswordChange();
    loadServerInfo();
    loadEmails();
    initEmails();
    initProfile();
    initPlanManage();
    initMailboxes();
    initTeam();
    if (_userRole === 'owner' || _userRole === 'admin') loadTeam();
    // Show assigned emails for all users
    var myEmailsGroup = document.getElementById('myEmailsGroup');
    if (myEmailsGroup) { myEmailsGroup.style.display = ''; loadMyEmails(); }
    applyPrefs();
    applyVisual();
  };

  // ── Destroy ─────────────────────────────────────────────────
  window.platform.module.destroy = function() {
    clearTimeout(saveTimer);
    prefs = {};
    connectedAIs = {};
  };

  // ── Early apply from localStorage (before module loads) ─────
  try {
    var saved = JSON.parse(localStorage.getItem('okdun-user-prefs'));
    if (saved) {
      var r = document.documentElement.style;
      var t = saved.theme && { dark:{},grey:{},['light-grey']:{},light:{},white:{} }[saved.theme] ? null : null;
      // full apply happens in init, this is just accent/font for instant feel
      if (saved.accent && ACCENTS[saved.accent]) { r.setProperty('--primary', ACCENTS[saved.accent]); r.setProperty('--accent', ACCENTS[saved.accent]); }
    }
  } catch(e) {}
})();
