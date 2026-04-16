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
  var THEMES = {
    dark:       { '--bg':'#0b0b14','--bg2':'#12121f','--bg3':'#1a1a2e','--text':'#e4e4f0','--text-mid':'#a0aab0','--text-dim':'#5a6a70','--border':'#252540','--border2':'#353555' },
    grey:       { '--bg':'#1a1a24','--bg2':'#22222f','--bg3':'#2a2a3e','--text':'#e4e4f0','--text-mid':'#a0aab0','--text-dim':'#6a7a80','--border':'#353550','--border2':'#454565' },
    'light-grey':{ '--bg':'#2e2e3e','--bg2':'#363648','--bg3':'#404058','--text':'#eeeef4','--text-mid':'#b0bac0','--text-dim':'#808a90','--border':'#505068','--border2':'#606078' },
    light:      { '--bg':'#e8e8f0','--bg2':'#dcdce8','--bg3':'#d0d0e0','--text':'#1a1a2e','--text-mid':'#4a4a60','--text-dim':'#7a7a90','--border':'#c0c0d4','--border2':'#b0b0c8' },
    white:      { '--bg':'#ffffff','--bg2':'#f4f4f8','--bg3':'#eaeaf0','--text':'#111118','--text-mid':'#444450','--text-dim':'#888898','--border':'#d8d8e4','--border2':'#c8c8d8' },
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

  // ── Revenue / Stripe Connect ───────────────────────────────
  var TIER_NAMES = { free: 'Free', lite: 'OK Lite', standard: 'OK Standard', pro: 'OK Pro' };
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
  function applyPrefs() {
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
    // plan info
    if (prefs.plan) {
      var planEl = document.getElementById('planInfo');
      if (planEl) planEl.textContent = prefs.plan.charAt(0).toUpperCase() + prefs.plan.slice(1);
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

  // ── Init ────────────────────────────────────────────────────
  window.platform.module.init = async function() {
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
    loadServerInfo();
    loadEmails();
    initEmails();
    initTeam();
    if (_userRole === 'owner' || _userRole === 'admin') loadTeam();
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
