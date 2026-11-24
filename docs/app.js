/* UG 營運工作台 — 手機版前端。
 * 沒有任何金鑰：只知道後端網址（config.js），登入後拿到的憑證存在這支手機的瀏覽器裡。
 * 所有來自伺服器或使用者輸入的文字，放進畫面前一律經過 esc()。 */
(function () {
  'use strict';
  var API = (window.UG_CONFIG && window.UG_CONFIG.API_URL) || '';
  var KEY = 'ug-ops-token';
  var WD = ['日', '一', '二', '三', '四', '五', '六'];
  var S = { token: null, me: null, today: '', tab: '', as: '', home: null, sched: { from: '', scope: 'mine' }, jweek: '', data: {} };
  var SP = null;                       // 目前開著的門市頁狀態
  var app = document.getElementById('app'), sheetsEl = document.getElementById('sheets'), toastEl = document.getElementById('toast');
  try { S.token = localStorage.getItem(KEY); } catch (e) { /* 無痕模式可能讀不到，改成每次都要登入 */ }

  /* ---------- 小工具 ---------- */
  function esc(v) { return String(v === null || v === undefined ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(n) { return n === null || n === undefined ? '—' : Math.round(n).toLocaleString('en-US'); }
  function ms(d) { return Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)); }
  function addDays(d, n) { return new Date(ms(d) + n * 864e5).toISOString().slice(0, 10); }
  function dow(d) { return new Date(ms(d)).getUTCDay(); }
  function monday(d) { return addDays(d, -((dow(d) + 6) % 7)); }
  function md(d) { return (+d.slice(5, 7)) + '/' + (+d.slice(8, 10)); }
  function mdw(d) { return md(d) + '（' + WD[dow(d)] + '）'; }
  function pct(v, unit) {
    if (v === null || v === undefined) return '<span class="muted">—</span>';
    var r = Math.round(v * 10) / 10;
    if (r > 0) return '<span class="up num">▲ +' + r + (unit || '%') + '</span>';
    if (r < 0) return '<span class="down num">▼ ' + r + (unit || '%') + '</span>';
    return '<span class="muted num">─ 0' + (unit || '%') + '</span>';
  }
  var toastTimer;
  function toast(msg) { toastEl.textContent = msg; toastEl.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2600); }

  function api(action, data) {
    if (!API) return Promise.reject(new Error('尚未設定後端網址（config.js）'));
    // 用 text/plain 送出，瀏覽器不會先發預檢請求，Apps Script 才收得到
    return fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: action, token: S.token, data: data || {} }), redirect: 'follow', credentials: 'omit' })
      .then(function (r) { return r.json(); }, function () { throw new Error('連線失敗，請確認網路後再試'); })
      .then(function (j) {
        if (j && j.ok) return j.data;
        var e = new Error((j && j.error) || '系統發生錯誤'); e.code = j && j.code;
        if (e.code === 'auth') { setToken(null); S.me = null; closeAllSheets(); renderLogin(); }
        if (e.code === 'must_change') renderMustChange();
        throw e;
      });
  }
  function setToken(t) { S.token = t; try { if (t) localStorage.setItem(KEY, t); else localStorage.removeItem(KEY); } catch (e) { /* 忽略 */ } }
  function oops(e) { toast(e && e.message ? e.message : '發生錯誤'); }
  function busy(btn, p) { if (btn) btn.disabled = true; return p.then(function (v) { if (btn) btn.disabled = false; return v; }, function (e) { if (btn) btn.disabled = false; throw e; }); }

  /* ---------- 疊層頁面 ---------- */
  var stack = [];
  function openSheet(title, html, onClose) {
    var el = document.createElement('div');
    el.className = 'sheet'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', title);
    el.innerHTML = '<div class="sheet-top"><div class="wrap"><button class="back" data-act="back" aria-label="返回">←</button><h2>' + esc(title) + '</h2></div></div><div class="sheet-body"><div class="wrap body">' + html + '</div></div>';
    sheetsEl.appendChild(el); stack.push({ el: el, onClose: onClose });
    return el.querySelector('.body');
  }
  function closeSheet(skipHook) { var s = stack.pop(); if (!s) return; s.el.remove(); if (s.onClose && !skipHook) s.onClose(); }
  function closeAllSheets() { while (stack.length) closeSheet(true); SP = null; }
  function topBody() { return stack.length ? stack[stack.length - 1].el.querySelector('.body') : null; }

  /* ---------- 登入 ---------- */
  function renderLogin(msg) {
    app.innerHTML = '<div class="login"><div class="mark">UG</div><h1>營運工作台</h1><p class="muted small">請用公司發給你的帳號登入</p>' +
      '<label class="f">帳號<input type="text" id="lg-a" autocomplete="username" autocapitalize="none" spellcheck="false"></label>' +
      '<label class="f">密碼<input type="password" id="lg-p" autocomplete="current-password"></label>' +
      (msg ? '<div class="note bad">' + esc(msg) + '</div>' : '') +
      '<div class="btns"><button class="btn primary block" data-act="login">登入</button></div>' +
      '<p class="muted small note">忘記密碼請找營運總監重設。請不要把密碼告訴別人，也不要在共用的手機上登入。</p></div>';
  }
  function renderMustChange() {
    closeAllSheets();
    app.innerHTML = '<div class="login"><div class="mark">UG</div><h1>設定你的密碼</h1><p class="muted small">第一次登入，請把初始密碼換成自己的密碼（至少 8 個字元）。</p>' + pwForm() + '</div>';
  }
  function pwForm() {
    return '<label class="f">目前的密碼<input type="password" id="pw-o" autocomplete="current-password"></label>' +
      '<label class="f">新密碼<input type="password" id="pw-n" autocomplete="new-password"></label>' +
      '<label class="f">再輸入一次新密碼<input type="password" id="pw-n2" autocomplete="new-password"></label>' +
      '<div class="btns"><button class="btn primary block" data-act="pw-save">變更密碼</button></div>';
  }
  function boot() {
    if (!S.token) return renderLogin();
    app.innerHTML = '<div class="empty">載入中…</div>';
    api('me').then(function (d) { S.me = d.me; S.today = d.today; if (S.me.mustChange) return renderMustChange(); start(); })
      .catch(function (e) { if (e.code !== 'auth' && e.code !== 'must_change') renderLogin(e.message); });
  }
  function tabsFor() {
    if (S.me.role === 'director') return [['brief', '晨報'], ['home', '督導'], ['sched', '行程'], ['journal', '週誌'], ['todos', '待辦']];
    if (S.me.role === 'supervisor') return [['home', '我的門市'], ['sched', '行程'], ['journal', '週誌'], ['todos', '待辦']];
    return [['todos', '待辦'], ['sched', '行程']];
  }
  function start() {
    S.sched.from = monday(S.today); S.jweek = monday(S.today);
    var tabs = tabsFor();
    app.innerHTML = '<header class="top"><div class="wrap top-row"><div class="mark">UG</div><h1>營運工作台</h1><button class="who" data-act="account">' + esc(S.me.name) + '</button></div></header>' +
      '<main class="wrap" id="view"></main><nav class="tabs" aria-label="主選單"><div class="wrap">' +
      tabs.map(function (t) { return '<button data-act="tab" data-tab="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div></nav>';
    go(tabs[0][0]);
  }
  function go(tab) {
    S.tab = tab;
    Array.prototype.forEach.call(document.querySelectorAll('nav.tabs button'), function (b) { if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    window.scrollTo(0, 0);
    VIEWS[tab]();
  }
  function view() { return document.getElementById('view'); }
  function loading() { view().innerHTML = '<div class="empty">載入中…</div>'; }
  function failView(e) { if (e.code === 'auth' || e.code === 'must_change') return; view().innerHTML = '<div class="empty">' + esc(e.message) + '<div class="btns"><button class="btn block" data-act="tab" data-tab="' + S.tab + '">重新載入</button></div></div>'; }

  /* ---------- 我的門市 ---------- */
  function metricLine(m) {
    if (!m) return '<span class="muted small">尚無營收資料</span>';
    return '<span class="num">昨日 ' + money(m.y) + '</span><span class="small">' + pct(m.ch) + '</span>' + (m.ach !== null ? '<span class="small muted num">目標 ' + m.ach + '%</span>' : '');
  }
  function camDots(cam) { return '<span class="dots">' + ['開班', '營業中', '閉店'].map(function (k) { return '<span class="dot' + (cam.indexOf(k) >= 0 ? ' on' : '') + '">' + k + '</span>'; }).join('') + '</span>'; }
  function renderHome() {
    var d = S.home, w = d.week, mine = S.me.role === 'supervisor';
    var cards = d.cards.slice().sort(function (a, b) { return (b.today - a.today) || (b.score - a.score); });
    var h = '';
    if (!mine) h += '<label class="f">檢視督導<select id="as-sel">' + (S.data.sups || []).map(function (p) { return '<option value="' + esc(p.account) + '"' + (p.account === S.as ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') + '</select></label>';
    h += '<div class="sec"><h2>今天 ' + esc(mdw(d.today)) + '</h2></div><div class="card">' +
      (d.event ? '<div class="title">' + esc(d.event.type) + '・' + esc(d.event.place) + '</div>' : '<div class="title">內勤（遠端）</div>') +
      '<div class="small muted">營收資料' + (d.asOf ? '更新到 ' + esc(md(d.asOf)) : '：' + esc(d.metricsNote || '尚未更新')) + '</div></div>';
    h += '<div class="kpis"><div class="kpi"><div class="k">本週現場</div><div class="v num">' + w.site + '</div></div><div class="kpi"><div class="k">本週遠端</div><div class="v num">' + w.remote + '</div></div>' +
      '<div class="kpi"><div class="k">抽查完成</div><div class="v num">' + w.camDone + '<span class="s"> / ' + w.stores + ' 店</span></div></div><div class="kpi"><div class="k">催辦・回報</div><div class="v num">' + (w.nudges + w.todos) + '</div></div></div>';
    h += '<div class="sec"><h2>門市（需要處理的排前面）</h2></div>';
    if (!cards.length) h += '<div class="empty">還沒有分配門市。請營運總監在 stores 分頁填上負責督導。</div>';
    cards.forEach(function (c) {
      h += '<button class="card" data-act="store" data-store="' + esc(c.store) + '" data-today="' + (c.today ? 1 : 0) + '"><div class="row"><span class="title">' + esc(c.store) + '</span>' + (c.today ? '<span class="chip today">今日行程</span>' : '') + '</div>' +
        '<div class="row">' + metricLine(c.m) + '</div><div class="row">' + camDots(c.cam) + '</div>' +
        (c.reasons.length ? '<div class="chips">' + c.reasons.map(function (r) { return '<span class="chip ' + (r[0] === 'bad' ? 'bad' : 'warn') + '">' + esc(r[1]) + '</span>'; }).join('') + '</div>' : '<div class="chips"><span class="chip good">目前沒有待處理</span></div>') + '</button>';
    });
    view().innerHTML = h;
  }
  function loadHome() {
    loading();
    var p = Promise.resolve();
    if (S.me.role === 'director' && !S.data.sups) p = api('brief').then(function (b) { S.data.sups = b.supervisors; if (!S.as && b.supervisors.length) S.as = b.supervisors[0].account; });
    p.then(function () { return api('home', S.me.role === 'director' ? { as: S.as } : {}); }).then(function (d) { S.home = d; renderHome(); }).catch(failView);
  }

  /* ---------- 門市頁 ---------- */
  function openStore(name, onsite) {
    if (stack.length && SP) return;
    var body = openSheet(name, '<div class="empty">載入中…</div>', storeClosed);
    SP = { store: name, d: null, mode: onsite ? '現場' : '遠端', kind: '監視器抽查', slot: '', shotTime: '', shotDate: '', shotSrc: '', checks: {}, note: '', talk: '', fb: '', nudges: [], todos: [], body: body };
    reloadStore();
  }
  function reloadStore() {
    var sp = SP;
    return api('store', { store: sp.store }).then(function (d) {
      if (SP !== sp) return;
      sp.d = d;
      if (!sp.slot) sp.slot = ['開班', '營業中', '閉店'].filter(function (k) { return d.cam.indexOf(k) < 0; })[0] || '開班';
      renderStore();
    }).catch(function (e) { if (SP === sp) sp.body.innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
  }
  function todoHtml(t, ctx) {
    var h = '<div class="item"><div class="row"><b>' + (ctx === 'list' ? esc(t.store) + '・' : '') + esc(t.text) + '</b></div>' +
      '<div class="chips"><span class="chip">' + esc(t.source) + ' → ' + esc(t.dept) + '</span><span class="chip">' + esc(t.status) + '</span><span class="chip ' + (t.late ? 'bad' : '') + '">' + (t.late ? '逾期・' : '') + '已 ' + t.days + ' 天</span>' + (t.hasPhoto ? '<span class="chip">有照片</span>' : '') + '</div>';
    if (t.notes.length) h += '<div class="small muted pre">' + t.notes.slice(-3).map(function (n) { return esc(n.at.slice(5, 16)) + ' ' + esc(n.by) + '：' + esc(n.text); }).join('\n') + '</div>';
    h += '<div class="btns">';
    var id = ' data-id="' + esc(t.id) + '"';
    if (S.me.role === 'dept') {
      if (t.status === '待受理') h += '<button class="btn sm" data-act="t-status" data-status="處理中"' + id + '>受理</button>';
      if (t.status !== '已完成') h += '<button class="btn sm primary" data-act="t-done"' + id + '>完成</button>';
      h += '<button class="btn sm" data-act="t-append"' + id + '>回覆</button>';
    } else if (t.status !== '已完成') {
      h += '<button class="btn sm"' + (t.nudgedToday ? ' disabled' : '') + ' data-act="t-nudge"' + id + '>' + (t.nudgedToday ? '今天已催' : '催辦') + '</button><button class="btn sm" data-act="t-append"' + id + '>補充</button>';
      if (S.me.role === 'director') h += '<button class="btn sm" data-act="t-done"' + id + '>結案</button>';
    }
    if (t.hasPhoto) h += '<button class="btn sm" data-act="t-photo"' + id + '>看照片</button>';
    return h + '</div></div>';
  }
  function seg(name, opts, cur) { return '<div class="seg" role="group">' + opts.map(function (o) { var v = Array.isArray(o) ? o[0] : o, l = Array.isArray(o) ? o[1] : o; return '<button type="button" data-act="seg" data-name="' + name + '" data-v="' + esc(v) + '" aria-pressed="' + (v === cur) + '">' + esc(l) + '</button>'; }).join('') + '</div>'; }
  function visitForm() {
    var sp = SP, d = sp.d, cam = sp.mode === '遠端' && sp.kind === '監視器抽查';
    var h = '<div class="card"><div class="small muted">這次怎麼關心這間店</div>' + seg('mode', ['現場', '遠端'], sp.mode);
    if (sp.mode === '遠端') h += seg('kind', [['監視器抽查', '監視器抽查'], ['電話', '電話'], ['LINE@ 訊息', 'LINE@']], sp.kind);
    if (cam) {
      h += '<label class="f">抽查時段（每週各一次）</label>' + seg('slot', ['開班', '營業中', '閉店'].map(function (k) { return [k, k + (d.cam.indexOf(k) >= 0 ? ' ✓' : '')]; }), sp.slot) +
        '<div class="small muted">' + esc(sp.slot) + '需要 ' + esc(d.slotRule[sp.slot]) + ' 的畫面</div>' +
        '<label class="f">上傳監視器截圖（自動帶入影像時間）<input type="file" id="shot" accept="image/*"></label>' +
        '<div class="row"><label class="f grow">影像日期<input type="date" data-f="shotDate" value="' + esc(sp.shotDate) + '" max="' + esc(d.today) + '"></label><label class="f grow">影像時間<input type="time" data-f="shotTime" value="' + esc(sp.shotTime) + '"></label></div>' + shotNote() +
        '<label class="f">檢查項目</label><div>' + d.slots[sp.slot].map(function (k) {
          var v = sp.checks[k];
          return '<div class="checkrow"><span>' + esc(k) + '</span><button type="button" class="ok" data-act="chk" data-k="' + esc(k) + '" data-v="ok" aria-pressed="' + (v === 'ok') + '">正常</button><button type="button" class="ng" data-act="chk" data-k="' + esc(k) + '" data-v="ng" aria-pressed="' + (v === 'ng') + '">異常</button></div>';
        }).join('') + '</div>';
      if (Object.keys(sp.checks).some(function (k) { return sp.checks[k] === 'ng' && d.slots[sp.slot].indexOf(k) >= 0; })) h += '<label class="f">異常說明<input type="text" data-f="note" maxlength="300" value="' + esc(sp.note) + '"></label>';
    }
    h += '<label class="f">' + (cam ? '溝通重點（選填）' : '溝通重點') + '<textarea data-f="talk" maxlength="1000" placeholder="一兩句話就好，會自動整理進週誌">' + esc(sp.talk) + '</textarea></label>' +
      '<label class="f">店家反饋（選填）<textarea data-f="fb" maxlength="1000">' + esc(sp.fb) + '</textarea></label>';
    if (sp.nudges.length || sp.todos.length) h += '<div class="note">這次已催辦 ' + sp.nudges.length + ' 筆、回報 ' + sp.todos.length + ' 筆，會一起記錄。</div>';
    return h + '<div class="btns"><button class="btn primary block" data-act="visit-save">儲存紀錄</button></div></div>';
  }
  function shotNote() {
    var sp = SP;
    if (!sp.shotTime || !sp.shotDate) return '<div class="note" id="shot-note">沒有截圖也可以存，但不會計入本週抽查。</div>';
    var okSlot = sp.slot === '開班' ? sp.shotTime < '11:00' : sp.slot === '營業中' ? (sp.shotTime >= '10:00' && sp.shotTime <= '21:00') : sp.shotTime >= '20:00';
    var okWeek = sp.shotDate >= monday(sp.d.today) && sp.shotDate <= sp.d.today;
    var src = sp.shotSrc ? '（' + sp.shotSrc + '）' : '';
    if (okSlot && okWeek) return '<div class="note good" id="shot-note">' + esc(md(sp.shotDate) + ' ' + sp.shotTime) + ' 符合「' + esc(sp.slot) + '」時段，會計入本週抽查' + esc(src) + '</div>';
    return '<div class="note bad" id="shot-note">' + esc(md(sp.shotDate) + ' ' + sp.shotTime) + (okWeek ? ' 不在「' + esc(sp.slot) + '」時段' : ' 不是本週的畫面') + '，不會計入本週抽查' + esc(src) + '</div>';
  }
  function renderStore() {
    var sp = SP, d = sp.d, m = d.m, h = '';
    h += '<div class="small muted">' + esc(d.zone) + '・督導 ' + esc(d.supervisor) + (d.last ? '・上次關心 ' + esc(md(d.last.date)) + '（' + esc(d.last.mode) + '）' : '・尚無關心紀錄') + '</div>';
    if (m) {
      h += '<div class="sec"><h2>營收（' + esc(md(d.asOf)) + '）</h2></div><div class="kpis"><div class="kpi"><div class="k">昨日營收</div><div class="v num">' + money(m.y) + '</div><div class="s">' + pct(m.ch) + ' 比近 4 週同星期</div></div>' +
        '<div class="kpi"><div class="k">相對區域</div><div class="v">' + pct(m.rel, ' 點') + '</div><div class="s">' + (m.down2 ? '<span class="down">連續兩週下滑</span>' : '週營收未連降') + '</div></div>' +
        '<div class="kpi"><div class="k">月累計達成</div><div class="v num">' + (m.mtdAch === null ? '—' : m.mtdAch + '%') + '</div><div class="s num">' + money(m.mtd) + ' / ' + money(m.mtdTarget) + '</div></div></div>';
      if (m.need) h += '<div class="note bad">需要關注：' + (m.rel !== null && m.rel <= -10 ? '落後區域平均 10% 以上' : '') + (m.rel !== null && m.rel <= -10 && m.down2 ? '，且' : '') + (m.down2 ? '連續兩週下滑' : '') + '。建議這次了解原因並寫進溝通重點。</div>';
    }
    h += '<div class="sec"><h2>本週遠端抽查</h2><span class="right">' + camDots(d.cam) + '</span></div>';
    if (d.qsc) h += '<div class="sec"><h2>QSC（iService）</h2></div><div class="card"><div class="row"><span class="title num">' + d.qsc.score + ' 分</span><span class="small muted">' + esc(md(d.qsc.date)) + '・' + esc(d.qsc.by) + '</span></div>' +
      (d.qsc.fails.length ? '<div class="small muted">上次未達標，這次順便確認：</div><div class="chips">' + d.qsc.fails.map(function (f) { return '<span class="chip warn">' + esc(f) + '</span>'; }).join('') + '</div>' : '') + '</div>';
    h += '<div class="sec"><h2>待辦（' + d.todos.length + '）</h2><button class="btn sm right" data-act="report">＋ 拍照回報</button></div><div class="card">' +
      (d.todos.length ? d.todos.map(function (t) { return todoHtml(t, 'store'); }).join('') : '<div class="empty">沒有未結案的待辦</div>') + '</div>';
    h += '<div class="sec"><h2>訪店紀錄</h2></div><div id="vform">' + visitForm() + '</div>';
    if (d.visits.length) h += '<div class="sec"><h2>最近紀錄</h2></div><div class="card">' + d.visits.map(visitHtml).join('') + '</div>';
    sp.body.innerHTML = h;
  }
  function visitHtml(v) {
    var ng = Object.keys(v.checks).filter(function (k) { return v.checks[k] === 'ng'; });
    return '<div class="item"><div class="row small muted"><span>' + esc(md(v.date)) + ' ' + esc(v.time) + '</span><span>' + esc(v.who) + '</span><span class="chip">' + esc(v.mode === '現場' ? '現場' : v.kind) + (v.slot ? '・' + esc(v.slot) + (v.pass ? ' ✓' : '（未計入）') : '') + '</span></div>' +
      (v.talk ? '<div class="pre">' + esc(v.talk) + '</div>' : '') + (ng.length ? '<div class="down small">異常：' + esc(ng.join('、')) + (v.note ? '（' + esc(v.note) + '）' : '') + '</div>' : '') + (v.fb ? '<div class="small muted pre">店家反饋：' + esc(v.fb) + '</div>' : '') +
      (v.nudges || v.todos ? '<div class="small muted">催辦 ' + v.nudges + '・回報 ' + v.todos + '</div>' : '') + '</div>';
  }
  function refreshForm() { var el = SP && SP.body.querySelector('#vform'); if (el) el.innerHTML = visitForm(); }
  function storeClosed() {
    var sp = SP; SP = null;
    if (!sp) return;
    // 只催辦或回報、沒寫訪店紀錄就離開：自動記一筆「處理待辦」，週誌才不會漏
    var p = sp.nudges.length || sp.todos.length ? api('visit.add', { store: sp.store, mode: '遠端', kind: '處理待辦', nudges: sp.nudges, todos: sp.todos }).then(function () { toast('已自動記錄這次的催辦與回報'); }) : Promise.resolve();
    p.catch(oops).then(function () { if (S.tab === 'home') loadHome(); });
  }

  /* 讀照片的拍攝時間：JPEG 讀 EXIF，讀不到（例如螢幕截圖）就用檔案時間。 */
  function exifTime(buf) {
    try {
      var v = new DataView(buf); if (v.getUint16(0) !== 0xFFD8) return null;
      var o = 2;
      while (o + 4 < v.byteLength) {
        var mk = v.getUint16(o), len = v.getUint16(o + 2);
        if (mk === 0xFFE1 && v.getUint32(o + 4) === 0x45786966) {
          var t = o + 10, le = v.getUint16(t) === 0x4949, u16 = function (p) { return v.getUint16(p, le); }, u32 = function (p) { return v.getUint32(p, le); };
          var find = function (ifd, tag) { var n = u16(ifd); for (var i = 0; i < n; i++) { var e = ifd + 2 + i * 12; if (u16(e) === tag) return e; } return 0; };
          var read = function (e) { var p = t + u32(e + 8), s = ''; for (var i = 0; i < 19; i++) s += String.fromCharCode(v.getUint8(p + i)); return s; };
          var ifd0 = t + u32(t + 4), sub = find(ifd0, 0x8769), e = sub ? find(t + u32(sub + 8), 0x9003) : 0;
          if (!e) e = find(ifd0, 0x0132);
          var m = e ? read(e).match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2})/) : null;
          return m ? { date: m[1] + '-' + m[2] + '-' + m[3], time: m[4] + ':' + m[5] } : null;
        }
        if ((mk & 0xFF00) !== 0xFF00) break;
        o += 2 + len;
      }
    } catch (e) { /* 讀不到就算了 */ }
    return null;
  }
  function onShot(file) {
    if (!file || !SP) return;
    var pad = function (n) { return ('0' + n).slice(-2); };
    file.slice(0, 262144).arrayBuffer().then(exifTime, function () { return null; }).then(function (x) {
      if (!SP) return;
      if (x) SP.shotSrc = '照片拍攝時間';
      else { var t = new Date(file.lastModified); x = { date: t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate()), time: pad(t.getHours()) + ':' + pad(t.getMinutes()) }; SP.shotSrc = '檔案時間，請核對畫面上的時間'; }
      SP.shotDate = x.date; SP.shotTime = x.time; refreshForm();
    });
  }
  function shrink(file) {   // 照片縮到長邊 1280、JPEG，手機上傳才快
    return new Promise(function (res, rej) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var k = Math.min(1, 1280 / Math.max(img.width, img.height)), c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        res({ type: 'image/jpeg', data: c.toDataURL('image/jpeg', 0.72).split(',')[1] });
      };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error('這張照片讀不到，請重拍')); };
      img.src = url;
    });
  }

  /* ---------- 回報 ---------- */
  function openReport() {
    openSheet('拍照回報・' + SP.store, '<p class="muted small">一句話說明狀況。系統會自動判斷要給哪個單位，並檢查是不是已經有人報過。</p>' +
      '<label class="f">照片（選填）<input type="file" id="rp-photo" accept="image/*" capture="environment"></label>' +
      '<label class="f">狀況<textarea id="rp-text" maxlength="500" placeholder="例：製冰機出冰量不足"></textarea></label>' +
      '<label class="f">類別<select id="rp-src"><option value="">自動判斷</option><option value="修繕">修繕（工務）</option><option value="物料異常">物料／到貨異常（採購）</option><option value="文宣">文宣（行銷）</option><option value="其他">其他（營運後勤）</option></select></label>' +
      '<div id="rp-dupes"></div><div class="btns"><button class="btn primary block" data-act="report-send">送出回報</button></div>');
  }
  function sendReport(btn, force) {
    var b = topBody(), text = b.querySelector('#rp-text').value.trim(), f = b.querySelector('#rp-photo').files[0];
    if (!text) return toast('請用一句話說明狀況');
    var sp = SP;
    busy(btn, (f ? shrink(f) : Promise.resolve(null)).then(function (photo) { return api('todo.add', { store: sp.store, text: text, source: b.querySelector('#rp-src').value, photo: photo, force: !!force }); }))
      .then(function (r) {
        if (r.dupes) {
          b.querySelector('#rp-dupes').innerHTML = '<div class="note bad">這間店最近已經有 ' + r.dupes.length + ' 筆「' + esc(r.source) + '」還沒結案，可能是同一件事：</div><div class="card">' +
            r.dupes.map(function (t) { return '<div class="item"><b>' + esc(t.text) + '</b><div class="small muted">' + esc(t.createdAt) + '・' + esc(t.by) + '・' + esc(t.status) + '</div><div class="btns"><button class="btn sm primary" data-act="report-merge" data-id="' + esc(t.id) + '">是同一件，補充到這張單</button></div></div>'; }).join('') +
            '</div><div class="btns"><button class="btn block" data-act="report-force">不是同一件，另開新單</button></div>';
          return;
        }
        sp.todos.push(r.todo.id); closeSheet(); toast('已回報給' + r.todo.dept); reloadStore();
      }).catch(oops);
  }

  /* ---------- 待辦清單 ---------- */
  function loadTodos() {
    loading();
    api('todo.list').then(function (d) {
      S.data.todos = d.todos;
      var late = d.todos.filter(function (t) { return t.late; }).length;
      view().innerHTML = '<div class="sec"><h2>' + (S.me.role === 'dept' ? esc(S.me.dept) + '的待辦' : '未結案待辦') + '（' + d.todos.length + '）</h2>' + (late ? '<span class="chip bad right">逾期 ' + late + '</span>' : '') + '</div>' +
        (d.todos.length ? '<div class="card">' + d.todos.map(function (t) { return todoHtml(t, 'list'); }).join('') + '</div>' : '<div class="empty">目前沒有未結案的待辦</div>');
    }).catch(failView);
  }
  function afterTodo() { if (SP) return reloadStore(); if (S.tab === 'todos') loadTodos(); if (S.tab === 'brief') loadBrief(); }
  function textSheet(title, label, act, id, optional) {
    openSheet(title, '<label class="f">' + esc(label) + '<textarea id="tx" maxlength="500"></textarea></label><div class="btns"><button class="btn primary block" data-act="' + act + '" data-id="' + esc(id) + '"' + (optional ? ' data-optional="1"' : '') + '>送出</button></div>');
  }

  /* ---------- 行程 ---------- */
  function loadSched() {
    loading();
    var from = S.sched.from, to = addDays(from, 6);
    api('events.list', { from: from, to: to }).then(function (d) {
      S.data.people = d.people; S.data.types = d.types; S.data.events = d.events;
      var evs = d.events.filter(function (e) { return S.sched.scope === 'all' || e.who === S.me.account; });
      var h = '<div class="row"><button class="btn sm" data-act="wk" data-n="-7" aria-label="上一週">←</button><b class="num">' + esc(md(from)) + ' – ' + esc(md(to)) + '</b><button class="btn sm" data-act="wk" data-n="7" aria-label="下一週">→</button>' +
        (from !== monday(S.today) ? '<button class="btn sm" data-act="wk" data-n="0">回本週</button>' : '') + '</div>' +
        seg('scope', [['mine', '我的行程'], ['all', S.me.role === 'director' ? '全部同仁' : '同組同仁']], S.sched.scope) + '<div class="card">';
      for (var i = 0; i < 7; i++) {
        var day = addDays(from, i), list = evs.filter(function (e) { return e.start <= day && e.end >= day; });
        h += '<div class="day' + (day === S.today ? ' today' : '') + '"><div class="d num">' + esc(md(day)) + ' ' + WD[dow(day)] + '</div><div class="evs">' +
          (list.length ? list.map(function (e) {
            var can = S.me.role === 'director' || e.who === S.me.account, txt = (S.sched.scope === 'all' ? esc(e.name) + '｜' : '') + esc(e.type) + '・' + esc(e.place);
            return can ? '<button class="ev" data-act="ev-edit" data-id="' + esc(e.id) + '">' + txt + '</button>' : '<span class="ev">' + txt + '</span>';
          }).join('') : '<span class="ev muted">' + (S.sched.scope === 'mine' ? '內勤' : '—') + '</span>') + '</div></div>';
      }
      h += '</div><div class="btns"><button class="btn primary grow" data-act="ev-new">＋ 新增行程</button><button class="btn grow" data-act="cal">加到手機行事曆</button></div>';
      view().innerHTML = h;
    }).catch(failView);
  }
  function eventForm(e) {
    var isNew = !e, dir = S.me.role === 'director';
    e = e || { type: S.me.role === 'supervisor' ? '巡店' : '外出', place: '', start: S.today > S.sched.from ? S.today : S.sched.from, end: '' };
    var stores = S.home ? S.home.cards.map(function (c) { return c.store; }) : [];
    var h = '<label class="f">類型<select id="ev-type">' + S.data.types.map(function (t) { return '<option' + (t === e.type ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join('') + '</select></label>' +
      '<label class="f">地點或說明<input type="text" id="ev-place" maxlength="100" list="ev-stores" value="' + esc(e.place) + '" placeholder="例：台北信義店"></label><datalist id="ev-stores">' + stores.map(function (s) { return '<option value="' + esc(s) + '">'; }).join('') + '</datalist>' +
      '<div class="row"><label class="f grow">開始<input type="date" id="ev-start" value="' + esc(e.start) + '"></label><label class="f grow">結束（單日免填）<input type="date" id="ev-end" value="' + esc(e.end && e.end !== e.start ? e.end : '') + '"></label></div>';
    if (isNew) {
      h += '<label class="f">只排這幾天（不選＝期間內每天）</label><div class="pick">' + [1, 2, 3, 4, 5, 6, 0].map(function (w) { return '<label><input type="checkbox" name="ev-wd" value="' + w + '">週' + WD[w] + '</label>'; }).join('') + '</div>';
      if (dir) h += '<label class="f">排給誰（可複選）</label><div class="pick">' + S.data.people.map(function (p) { return '<label><input type="checkbox" name="ev-who" value="' + esc(p.account) + '"' + (p.account === S.me.account ? ' checked' : '') + '>' + esc(p.name) + '</label>'; }).join('') + '</div>';
      h += '<div class="btns"><button class="btn primary block" data-act="ev-add">新增</button></div>';
    } else h += '<div class="btns"><button class="btn primary grow" data-act="ev-save" data-id="' + esc(e.id) + '">儲存</button><button class="btn danger" data-act="ev-del" data-id="' + esc(e.id) + '">刪除</button></div>';
    openSheet(isNew ? '新增行程' : '修改行程' + (e.name && e.who !== S.me.account ? '・' + e.name : ''), h);
  }
  function eventFields() { var b = topBody(); return { type: b.querySelector('#ev-type').value, place: b.querySelector('#ev-place').value.trim(), start: b.querySelector('#ev-start').value, end: b.querySelector('#ev-end').value }; }
  function vals(name) { return Array.prototype.map.call(topBody().querySelectorAll('input[name="' + name + '"]:checked'), function (x) { return x.value; }); }
  function openCal() {
    var body = openSheet('加到手機行事曆', '<div class="empty">載入中…</div>');
    api('cal.url').then(function (d) { calBody(body, d.url); }).catch(function (e) { body.innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
  }
  function calBody(body, url) {
    if (!/^https:\/\/|^http:\/\/localhost[:\/]/.test(url)) { body.innerHTML = '<div class="empty">訂閱網址格式不正確</div>'; return; }
    var webcal = url.replace(/^https?:/, 'webcal:');
    body.innerHTML = '<p>訂閱後，你在這裡的行程會自動出現在手機行事曆，之後改行程也會跟著更新，不用再匯出。</p>' +
      '<div class="btns"><a class="btn primary block" href="' + esc(webcal) + '">iPhone／Mac：訂閱行事曆</a><a class="btn block" target="_blank" rel="noopener noreferrer" href="https://calendar.google.com/calendar/r?cid=' + encodeURIComponent(webcal) + '">Google 日曆：加入</a><button class="btn block" data-act="cal-copy">複製訂閱網址</button></div>' +
      '<div class="url" id="cal-url">' + esc(url) + '</div>' +
      '<div class="note">・單向同步：行事曆上只能看，要改請回工作台改。<br>・更新不是即時的：iPhone 約每小時，Google 日曆可能要半天到一天。<br>・這個網址等於你行程的鑰匙，請不要轉給別人。如果外流了，按下面重設，舊網址就會失效。</div>' +
      '<div class="btns"><button class="btn danger block" data-act="cal-reset">重設訂閱網址</button></div>';
  }

  /* ---------- 週誌 ---------- */
  function weekNav() {
    var wk = S.jweek, cur = monday(S.today);
    return '<div class="row"><button class="btn sm" data-act="jwk" data-n="-7" aria-label="上一週">←</button><b class="num">' + esc(md(wk)) + ' – ' + esc(md(addDays(wk, 6))) + '</b>' + (wk < cur ? '<button class="btn sm" data-act="jwk" data-n="7" aria-label="下一週">→</button><button class="btn sm" data-act="jwk" data-n="0">回本週</button>' : '') + '</div>';
  }
  function autoBlock(d) { return '<div class="sec"><h2>系統自動帶入</h2></div><div class="card small">' + d.auto.lines.map(function (l) { return '<div>・' + esc(l) + '</div>'; }).join('') + '</div>'; }
  function loadJournal() {
    loading();
    if (S.me.role === 'director') return api('journal.board', { week: S.jweek }).then(function (d) {
      view().innerHTML = weekNav() + '<div class="sec"><h2>督導週誌（' + esc(md(d.due)) + ' 前交）</h2></div>' + d.rows.map(function (r) {
        return '<button class="card" data-act="j-open" data-who="' + esc(r.account) + '"><div class="row"><span class="title">' + esc(r.name) + '</span><span class="chip ' + (r.state === '已送出' ? (r.read ? 'good' : 'warn') : '') + '">' + esc(r.state === '已送出' ? (r.read ? '已讀' : '待閱') : r.state) + '</span></div>' +
          '<div class="small muted num">現場 ' + r.site + '・遠端 ' + r.remote + '・抽查 ' + r.camDone + '/' + r.stores + (r.late ? '・<span class="down">逾期 ' + r.late + '</span>' : '') + '</div>' + (r.needs ? '<div class="small pre">需要協助：' + esc(r.needs) + '</div>' : '') + '</button>';
      }).join('');
    }).catch(failView);
    api('journal.get', { week: S.jweek }).then(function (d) {
      S.data.journal = d;
      var s = d.saved, v = s || d.draft, sent = s && s.state === '已送出';
      var ta = function (k, label, ph) { return '<label class="f">' + label + '<textarea data-j="' + k + '" maxlength="4000" placeholder="' + esc(ph) + '">' + esc(v[k]) + '</textarea></label>'; };
      view().innerHTML = weekNav() + (sent ? '<div class="note good">已於 ' + esc(s.sentAt.slice(5, 16)) + ' 送出' + (s.readAt ? '，總監已讀' : '') + '</div>' : '<div class="note">' + (s ? '草稿已儲存。' : '以下由本週 ' + d.draft.n + ' 筆訪店紀錄自動整理，確認、補充後送出即可。') + '請在 ' + esc(mdw(d.due)) + ' 前送出。</div>') +
        (s && s.reply ? '<div class="sec"><h2>總監回覆</h2></div><div class="card pre">' + esc(s.reply) + '</div>' : '') + autoBlock(d) +
        '<div class="sec"><h2>我的補充</h2><button class="btn sm right" data-act="j-refill">重新帶入紀錄</button></div><div class="card">' +
        ta('found', '本週重點發現', '門市狀況、異常、店家反饋') + ta('issue', '處理中的事項', '已回報、已催辦的事') + ta('plan', '下週計畫', '預計巡哪些店、要追什麼') + ta('needs', '需要總監或其他部門協助（選填）', '') +
        '<div class="btns"><button class="btn grow" data-act="j-save">存草稿</button><button class="btn primary grow" data-act="j-send">' + (sent ? '更新並重新送出' : '送出週誌') + '</button></div></div>';
    }).catch(failView);
  }
  function jFields() { var o = {}; Array.prototype.forEach.call(view().querySelectorAll('[data-j]'), function (t) { o[t.dataset.j] = t.value.trim(); }); o.week = S.jweek; return o; }
  function openJournal(who) {
    var body = openSheet('週誌', '<div class="empty">載入中…</div>');
    api('journal.get', { week: S.jweek, who: who }).then(function (d) {
      var s = d.saved, sent = s && s.state === '已送出';
      var blk = function (t, x) { return '<div class="sec"><h2>' + t + '</h2></div><div class="card pre">' + (x ? esc(x) : '<span class="muted">（未填）</span>') + '</div>'; };
      body.innerHTML = '<div class="title">' + esc(d.who.name) + '・' + esc(md(d.week)) + ' – ' + esc(md(d.weekEnd)) + '</div>' + autoBlock(d) +
        (sent ? blk('本週重點發現', s.found) + blk('處理中的事項', s.issue) + blk('下週計畫', s.plan) + blk('需要協助', s.needs) +
          '<label class="f">回覆（選填）<textarea id="j-reply" maxlength="2000">' + esc(s.reply) + '</textarea></label><div class="btns"><button class="btn primary block" data-act="j-ack" data-who="' + esc(who) + '">' + (s.readAt ? '更新回覆' : '標為已讀並回覆') + '</button></div>'
          : '<div class="note">這位督導還沒送出本週週誌。</div>') +
        (d.visits.length ? '<div class="sec"><h2>本週訪店紀錄（' + d.visits.length + '）</h2></div><div class="card">' + d.visits.map(function (v) { return '<div class="small"><b>' + esc(v.store || '') + '</b></div>' + visitHtml(v); }).join('') + '</div>' : '');
    }).catch(function (e) { body.innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
  }

  /* ---------- 總監晨報 ---------- */
  function loadBrief() {
    loading();
    api('brief').then(function (d) {
      S.data.sups = d.supervisors; if (!S.as && d.supervisors.length) S.as = d.supervisors[0].account;
      var k = d.kpi, h = '<div class="sec"><h2>晨報 ' + esc(mdw(d.today)) + '</h2><span class="small muted right">營收' + (d.asOf ? '到 ' + esc(md(d.asOf)) : '：' + esc(d.metricsNote)) + '</span></div>' +
        '<div class="kpis"><div class="kpi"><div class="k">昨日營收</div><div class="v num">' + money(k.y) + '</div><div class="s">' + pct(k.ch) + (k.ach !== null ? '・目標 ' + k.ach + '%' : '') + '</div></div>' +
        '<div class="kpi"><div class="k">需關注門市</div><div class="v num">' + d.need.length + '<span class="s"> / ' + k.stores + '</span></div></div>' +
        '<div class="kpi"><div class="k">逾期待辦</div><div class="v num">' + k.late + '<span class="s"> / ' + k.open + ' 未結</span></div></div>' +
        '<div class="kpi"><div class="k">今日外出</div><div class="v num">' + k.out + '</div><div class="s">請假 ' + k.leave + '</div></div>' +
        '<div class="kpi"><div class="k">本週週誌</div><div class="v num">' + k.jSent + '<span class="s"> / ' + k.jTotal + '</span></div><div class="s">待閱 ' + k.jUnread + '</div></div></div>';
      h += '<div class="sec"><h2>需關注門市</h2></div>' + (d.need.length ? d.need.map(function (x) {
        return '<button class="card" data-act="store" data-store="' + esc(x.store) + '" data-today="0"><div class="row"><span class="title">' + esc(x.store) + '</span><span class="small muted">' + esc(x.supervisor) + '</span></div><div class="row small"><span>相對區域 ' + pct(x.m.rel, ' 點') + '</span>' + (x.m.down2 ? '<span class="chip bad">連兩週下滑</span>' : '') + (x.open ? '<span class="chip warn">待辦 ' + x.open + '</span>' : '') + '</div></button>';
      }).join('') : '<div class="empty">沒有需要關注的門市</div>');
      h += '<div class="sec"><h2>逾期待辦</h2></div>' + (d.late.length ? '<div class="card">' + d.late.map(function (t) { return todoHtml(t, 'list'); }).join('') + '</div>' : '<div class="empty">沒有逾期的待辦</div>');
      h += '<div class="sec"><h2>超過 7 天沒關心的門市</h2></div>' + (d.gap.length ? '<div class="card">' + d.gap.map(function (g) { return '<div class="item row"><b>' + esc(g.store) + '</b><span class="small muted">' + esc(g.supervisor) + '</span><span class="chip ' + (g.days === null || g.days >= 14 ? 'bad' : 'warn') + ' right">' + (g.days === null ? '尚無紀錄' : g.days + ' 天') + '</span></div>'; }).join('') + '</div>' : '<div class="empty">每間店這週都有人關心</div>');
      h += '<div class="sec"><h2>今日動態</h2></div><div class="card">' + d.people.map(function (p) { return '<div class="item row"><b>' + esc(p.name) + '</b><span class="small muted">' + esc(p.dept) + '</span><span class="right small">' + esc(p.type) + (p.place ? '・' + esc(p.place) : '') + '</span></div>'; }).join('') + '</div>';
      view().innerHTML = h;
    }).catch(failView);
  }
  var VIEWS = { home: loadHome, sched: loadSched, journal: loadJournal, todos: loadTodos, brief: loadBrief };

  /* ---------- 事件 ---------- */
  var A = {
    login: function (btn) {
      var a = document.getElementById('lg-a').value.trim(), p = document.getElementById('lg-p').value;
      if (!a || !p) return toast('請輸入帳號與密碼');
      busy(btn, api('login', { account: a, password: p })).then(function (d) { setToken(d.token); boot(); }).catch(function (e) { renderLogin(e.message); });
    },
    'pw-save': function (btn) {
      var root = topBody() || app, o = root.querySelector('#pw-o').value, n = root.querySelector('#pw-n').value;
      if (n !== root.querySelector('#pw-n2').value) return toast('兩次輸入的新密碼不一樣');
      if (n.length < 8) return toast('新密碼至少 8 個字元');
      busy(btn, api('password.change', { oldPassword: o, newPassword: n })).then(function () { toast('密碼已變更'); closeAllSheets(); boot(); }).catch(oops);
    },
    account: function () {
      openSheet('我的帳號', '<div class="card"><div class="title">' + esc(S.me.name) + '</div><div class="small muted">' + esc(S.me.account) + '・' + esc(S.me.dept) + '</div></div><div class="sec"><h2>變更密碼</h2></div>' + pwForm() + '<div class="btns"><button class="btn danger block" data-act="logout">登出</button></div>');
    },
    logout: function () { api('logout').catch(function () {}).then(function () { setToken(null); S.me = null; S.home = null; S.data = {}; S.as = ''; closeAllSheets(); renderLogin(); }); },
    back: function () { closeSheet(); },
    tab: function (b) { go(b.dataset.tab); },
    store: function (b) { openStore(b.dataset.store, b.dataset.today === '1'); },
    seg: function (b) {
      var n = b.dataset.name, v = b.dataset.v;
      if (n === 'scope') { S.sched.scope = v; return loadSched(); }
      if (!SP) return;
      SP[n] = v; refreshForm();
    },
    chk: function (b) { if (!SP) return; var k = b.dataset.k; if (SP.checks[k] === b.dataset.v) delete SP.checks[k]; else SP.checks[k] = b.dataset.v; refreshForm(); },
    'visit-save': function (btn) {
      var sp = SP, cam = sp.mode === '遠端' && sp.kind === '監視器抽查';
      var d = { store: sp.store, mode: sp.mode, kind: sp.kind, talk: sp.talk, fb: sp.fb, nudges: sp.nudges, todos: sp.todos };
      if (cam) { d.slot = sp.slot; d.shotTime = sp.shotTime; d.shotDate = sp.shotDate; d.note = sp.note; d.checks = {}; sp.d.slots[sp.slot].forEach(function (k) { if (sp.checks[k]) d.checks[k] = sp.checks[k]; }); }
      busy(btn, api('visit.add', d)).then(function (r) {
        toast(cam ? (r.pass ? '已儲存，計入本週「' + sp.slot + '」抽查' : '已儲存，但未計入抽查：' + r.reason) : '已儲存，會自動整理進週誌');
        sp.talk = sp.fb = sp.note = sp.shotTime = sp.shotDate = sp.shotSrc = ''; sp.checks = {}; sp.nudges = []; sp.todos = []; sp.slot = '';
        reloadStore();
      }).catch(oops);
    },
    report: function () { openReport(); },
    'report-send': function (b) { sendReport(b, false); },
    'report-force': function (b) { sendReport(b, true); },
    'report-merge': function (b) {
      var text = topBody().querySelector('#rp-text').value.trim(), sp = SP, id = b.dataset.id;
      busy(b, api('todo.append', { id: id, text: text })).then(function () { sp.nudges.push(id); closeSheet(); toast('已補充到原本的單，並提醒處理單位'); reloadStore(); }).catch(oops);
    },
    't-nudge': function (b) { var id = b.dataset.id; busy(b, api('todo.nudge', { id: id })).then(function () { if (SP && SP.nudges.indexOf(id) < 0) SP.nudges.push(id); toast('已催辦'); afterTodo(); }).catch(oops); },
    't-append': function (b) { textSheet(S.me.role === 'dept' ? '回覆' : '補充說明', '內容', 't-append-send', b.dataset.id); },
    't-append-send': function (b) {
      var id = b.dataset.id, text = topBody().querySelector('#tx').value.trim();
      if (!text) return toast('請輸入內容');
      busy(b, api('todo.append', { id: id, text: text })).then(function () { if (SP && S.me.role !== 'dept' && SP.nudges.indexOf(id) < 0) SP.nudges.push(id); closeSheet(); toast('已送出'); afterTodo(); }).catch(oops);
    },
    't-status': function (b) { busy(b, api('todo.status', { id: b.dataset.id, status: b.dataset.status })).then(function () { toast('已更新'); afterTodo(); }).catch(oops); },
    't-done': function (b) { textSheet('結案', '處理結果（選填）', 't-done-send', b.dataset.id, true); },
    't-done-send': function (b) { busy(b, api('todo.status', { id: b.dataset.id, status: '已完成', note: topBody().querySelector('#tx').value.trim() })).then(function () { closeSheet(); toast('已結案'); afterTodo(); }).catch(oops); },
    't-photo': function (b) {
      var body = openSheet('照片', '<div class="empty">載入中…</div>');
      api('photo.get', { id: b.dataset.id }).then(function (p) {
        if (['image/jpeg', 'image/png', 'image/webp'].indexOf(p.type) < 0 || !/^[A-Za-z0-9+/=]+$/.test(p.data)) throw new Error('照片格式不正確');
        var img = document.createElement('img'); img.className = 'photo'; img.alt = '回報照片'; img.src = 'data:' + p.type + ';base64,' + p.data;
        body.innerHTML = ''; body.appendChild(img);
      }).catch(function (e) { body.innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
    },
    wk: function (b) { var n = +b.dataset.n; S.sched.from = n ? addDays(S.sched.from, n) : monday(S.today); loadSched(); },
    'ev-new': function () { eventForm(null); },
    'ev-edit': function (b) { var e = (S.data.events || []).filter(function (x) { return x.id === b.dataset.id; })[0]; if (e) eventForm(e); },
    'ev-add': function (b) {
      var f = eventFields(); if (!f.place) return toast('請填寫地點或說明'); if (!f.start) return toast('請選擇日期');
      f.weekdays = vals('ev-wd').map(Number); if (S.me.role === 'director') { f.whos = vals('ev-who'); if (!f.whos.length) return toast('請至少選一位'); }
      busy(b, api('events.add', f)).then(function (r) { closeSheet(); toast('已新增 ' + r.added + ' 筆行程'); S.sched.from = monday(f.start); loadSched(); }).catch(oops);
    },
    'ev-save': function (b) { var f = eventFields(); f.id = b.dataset.id; busy(b, api('events.update', f)).then(function () { closeSheet(); toast('已儲存'); loadSched(); }).catch(oops); },
    'ev-del': function (b) {
      if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = '再按一次確認刪除'; return; }
      busy(b, api('events.delete', { id: b.dataset.id })).then(function () { closeSheet(); toast('已刪除'); loadSched(); }).catch(oops);
    },
    cal: function () { openCal(); },
    'cal-copy': function () {
      var url = topBody().querySelector('#cal-url').textContent;
      (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function () { toast('已複製'); }, function () { toast('請長按上方網址手動複製'); });
    },
    'cal-reset': function (b) {
      if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = '再按一次：舊網址會失效，需要重新訂閱'; return; }
      var body = topBody(); busy(b, api('cal.reset')).then(function (d) { calBody(body, d.url); toast('已重設，請重新訂閱'); }).catch(oops);
    },
    jwk: function (b) { var n = +b.dataset.n; S.jweek = n ? addDays(S.jweek, n) : monday(S.today); loadJournal(); },
    'j-refill': function () { var d = S.data.journal.draft; ['found', 'issue', 'plan'].forEach(function (k) { view().querySelector('[data-j="' + k + '"]').value = d[k]; }); toast('已用本週紀錄重新帶入'); },
    'j-save': function (b) { busy(b, api('journal.save', jFields())).then(function () { toast('草稿已儲存'); }).catch(oops); },
    'j-send': function (b) { var f = jFields(); f.send = true; busy(b, api('journal.save', f)).then(function () { toast('週誌已送出'); loadJournal(); }).catch(oops); },
    'j-open': function (b) { openJournal(b.dataset.who); },
    'j-ack': function (b) { busy(b, api('journal.ack', { week: S.jweek, who: b.dataset.who, reply: topBody().querySelector('#j-reply').value.trim() })).then(function () { closeSheet(); toast('已回覆'); loadJournal(); }).catch(oops); }
  };
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-act]');
    if (!b || b.disabled) return;
    var fn = Object.prototype.hasOwnProperty.call(A, b.dataset.act) ? A[b.dataset.act] : null;
    if (fn) fn(b, ev);
  });
  document.addEventListener('input', function (ev) {
    var t = ev.target;
    if (SP && t.dataset && t.dataset.f) {
      SP[t.dataset.f] = t.value;
      if (t.dataset.f === 'shotTime' || t.dataset.f === 'shotDate') { SP.shotSrc = '手動輸入'; var n = SP.body.querySelector('#shot-note'); if (n) n.outerHTML = shotNote(); }
    }
  });
  document.addEventListener('change', function (ev) {
    var t = ev.target;
    if (t.id === 'shot') onShot(t.files[0]);
    if (t.id === 'as-sel') { S.as = t.value; loadHome(); }
  });
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' && (ev.target.id === 'lg-p' || ev.target.id === 'lg-a')) { var b = document.querySelector('[data-act="login"]'); if (b) b.click(); } });

  boot();
})();
