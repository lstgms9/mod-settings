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
    var d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    var parts = [];
    if (d) parts.push(d + 'd');
    if (h) parts.push(h + 'h');
    parts.push(m + 'm');
    return parts.join(' ');
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
    if (sizeEl) sizeEl.textContent = fmtBytes(info.storageBytes);
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

  // ── Init ────────────────────────────────────────────────────
  window.platform.module.init = async function() {
    var data = await API.get('/prefs');
    if (data && !data.error) {
      // separate AI keys from prefs
      connectedAIs = data.aiKeys || {};
      delete data.aiKeys;
      prefs = data;
    }

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
    initExport();
    initCacheClear();
    loadServerInfo();
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
