/**
 * 業務邏輯：我的門市、門市頁、訪店紀錄、待辦（回報／催辦／去重）、週誌、行程、總監晨報。
 * 每個函式的第一個參數 me 是已通過驗證的登入者；權限檢查都在伺服器端做，不信任前端。
 */

/* ---------- 共用 ---------- */
function ctx_() {
  const today = today_();
  const all = allTodos_();
  return { today: today, wk: monday_(today), M: metrics_(), visits: Store.rows('visits'), events: Store.rows('events'),
    todos: all.filter(function (t) { return !isAnomNew_(t, today); }),     // 要追的待辦
    anom: all.filter(function (t) { return isAnomNew_(t, today); }) };     // 本月新增的物料異常：只是通報，不算待辦
}
/**
 * 物料異常的規則（2026-11 定案）：相關部門作業需要時間，所以當月新增的只當「通報」看，不算待辦、不算逾期；
 * 跨到下個月還沒處理完的，才列為逾期待辦。
 */
function isAnom_(t) { return yes_(t.ext) && t.source === '物料異常'; }
function isAnomNew_(t, today) { return isAnom_(t) && String(t.createdAt).slice(0, 7) >= today.slice(0, 7); }
/** 督導或處理單位寫給總監的補充說明（存在工作台，不寫回原系統）。 */
function caseNotes_(caseId) {
  return Store.rows('extnotes').filter(function (n) { return n.caseId === caseId; }).map(function (n) {
    return { noteId: n.id, at: n.at, by: nameOf_(n.by), text: n.text, help: yes_(n.help), done: !!n.doneAt, reply: n.reply || '', photo: !!n.photoId };
  });
}
function nameOf_(account) { const p = person_(account); return p ? p.name : account; }
function isOpenTodo_(t) { return t.status !== '已完成'; }
function todoDays_(t, today) { return Math.max(0, diffDays_(String(t.createdAt).slice(0, 10), today)); }
function todoLate_(t, today) {
  if (isAnom_(t)) return String(t.createdAt).slice(0, 7) < today.slice(0, 7);        // 物料異常：跨月未處理才算逾期
  return isOpenTodo_(t) && todoDays_(t, today) > ((SOURCES[t.source] || SOURCES['其他']).limit);
}
function todoView_(t, today) {
  const xn = yes_(t.ext) ? caseNotes_(t.id) : null;
  return { id: t.id, store: t.store, source: t.source, dept: t.dept, text: t.text, status: t.status, by: yes_(t.ext) ? '門市' : nameOf_(t.by),
    createdAt: String(t.createdAt).slice(0, 10), days: todoDays_(t, today), late: todoLate_(t, today),
    notes: xn || J_(t.notes, []), help: !!xn && xn.some(function (n) { return n.help && !n.done; }), nudgedToday: t.nudgedAt === today,
    hasPhoto: !!t.photoId || (!!xn && xn.some(function (n) { return n.photo; })),
    ext: yes_(t.ext), sys: yes_(t.ext) ? EXT_SYSTEMS[t.source].sys : '', url: yes_(t.ext) ? extUrl_(t) : '' };
}
function camSlots_(store, wk, visits) {
  const end = addDays_(wk, 6), seen = {};
  visits.forEach(function (v) { if (v.store === store && v.kind === '監視器抽查' && yes_(v.pass) && v.date >= wk && v.date <= end && SLOTS[v.slot]) seen[v.slot] = true; });
  return Object.keys(SLOTS).filter(function (k) { return seen[k]; });
}
function lastContact_(store, visits) {
  let best = null;
  visits.forEach(function (v) { if (v.store === store && (!best || v.date + v.time > best.date + best.time)) best = v; });
  return best;
}
function metricView_(m) {
  if (!m) return null;
  return { y: m.y, avg4: m.avg4, ch: m.ch, rel: m.rel, down2: m.down2, need: m.need, yTarget: m.yTarget,
    ach: m.yTarget ? Math.round(m.y / m.yTarget * 100) : null,
    mtd: m.mtd, mtdTarget: m.mtdTarget, monthTarget: m.monthTarget, mtdAch: m.mtdTarget ? Math.round(m.mtd / m.mtdTarget * 100) : null };
}
function eventsOn_(events, who, day) { return events.filter(function (e) { return e.who === who && e.start <= day && e.end >= day; }); }
function eventView_(e) { return { id: e.id, who: e.who, name: nameOf_(e.who), start: e.start, end: e.end, type: e.type, place: e.place }; }

/* ---------- 我的門市 ---------- */
function storeCard_(s, c, todayPlaces) {
  const m = mOf_(c.M, s.store);
  const open = c.todos.filter(function (t) { return t.store === s.store && isOpenTodo_(t); });
  const late = open.filter(function (t) { return todoLate_(t, c.today); }).length;
  const lc = lastContact_(s.store, c.visits);
  const days = lc ? diffDays_(lc.date, c.today) : null;
  const cam = camSlots_(s.store, c.wk, c.visits);
  const reasons = []; let score = 0;
  if (m && m.rel !== null && m.rel <= -10) { reasons.push(['bad', '落後區域 ' + Math.abs(Math.round(m.rel)) + '%']); score += 3; }
  if (m && m.down2) { reasons.push(['bad', '連兩週下滑']); score += 3; }
  if (late) { reasons.push(['bad', '逾期 ' + late]); score += 2 * late; }
  if (open.length - late > 0) { reasons.push(['warn', '待辦 ' + (open.length - late)]); score += open.length - late; }
  if (days === null) { reasons.push(['warn', '尚無關心紀錄']); score += 2; }
  else if (days >= 7) { reasons.push(['warn', days + ' 天未關心']); score += days >= 14 ? 3 : 2; }
  const bare = s.store.replace(/店$/, '');
  const anomNew = c.anom.filter(function (t) { return t.store === s.store; }).length;
  if (anomNew) reasons.push(['info', '本月物料異常 ' + anomNew]);
  return { store: s.store, zone: s.zone, m: metricView_(m), anomNew: anomNew, open: open.length, late: late, days: days, cam: cam, reasons: reasons, score: score,
    today: todayPlaces.some(function (p) { return p.indexOf(s.store) >= 0 || p.indexOf(bare) >= 0; }) };
}

function home_(me, d) {
  const who = isSupervisor_(me) ? me.account : str_(d.as, 60);
  if (!who) fail_('請指定要檢視的督導');
  if (!isSupervisor_(me) && !isDirector_(me)) fail_('沒有權限', 'forbidden');
  const p = person_(who);
  if (!p || !yes_(p.active) || (p.role !== 'supervisor' && p.role !== 'director')) fail_('找不到這位督導');
  const c = ctx_();
  const todayEv = eventsOn_(c.events, who, c.today);
  const places = todayEv.filter(function (e) { return e.type === '巡店' || e.type === '外出'; }).map(function (e) { return e.place; });
  const stores = activeStores_().filter(function (s) { return s.supervisor === who; });
  const cards = stores.map(function (s) { return storeCard_(s, c, places); });
  const end = addDays_(c.wk, 6);
  const wv = c.visits.filter(function (v) { return v.who === who && v.date >= c.wk && v.date <= end; });
  return {
    who: { account: p.account, name: p.name }, today: c.today, asOf: c.M.asOf, metricsNote: c.M.note,
    event: todayEv[0] ? eventView_(todayEv[0]) : null, cards: cards,
    week: { from: c.wk, to: end, site: wv.filter(function (v) { return v.mode === '現場'; }).length, remote: wv.filter(function (v) { return v.mode === '遠端'; }).length,
      nudges: wv.reduce(function (a, v) { return a + J_(v.nudges, []).length; }, 0), todos: wv.reduce(function (a, v) { return a + J_(v.todos, []).length; }, 0),
      camDone: cards.filter(function (x) { return x.cam.length === 3; }).length, stores: cards.length }
  };
}

/* ---------- 門市頁 ---------- */
function qscOf_(store) {
  const rows = Store.rows('qsc').filter(function (q) { return q.store === store && isDate_(q.date); }).sort(function (a, b) { return b.date.localeCompare(a.date); });
  if (!rows.length) return null;
  const q = rows[0];
  const fails = J_(q.fails, null) || String(q.fails || '').split(/[、,，]/).map(function (x) { return x.trim(); }).filter(String);
  return { date: q.date, score: Number(q.score) || 0, by: q.by, fails: fails };
}
function visitView_(v) {
  return { id: v.id, store: v.store, date: v.date, time: v.time, who: nameOf_(v.who), mode: v.mode, kind: v.kind, slot: v.slot, pass: yes_(v.pass),
    checks: J_(v.checks, {}), note: v.note, talk: v.talk, fb: v.fb, nudges: J_(v.nudges, []).length, todos: J_(v.todos, []).length };
}
function store_(me, d) {
  const name = str_(d.store, 60);
  assertStore_(me, name);
  const s = activeStores_().filter(function (x) { return x.store === name; })[0];
  const c = ctx_();
  const todos = c.todos.filter(function (t) { return t.store === name && isOpenTodo_(t); }).map(function (t) { return todoView_(t, c.today); })
    .sort(function (a, b) { return (b.late - a.late) || (b.days - a.days); });
  const visits = c.visits.filter(function (v) { return v.store === name; }).sort(function (a, b) { return (b.date + b.time).localeCompare(a.date + a.time); }).slice(0, 8).map(visitView_);
  const lc = lastContact_(name, c.visits);
  return { store: name, zone: s.zone, supervisor: s.supervisor ? nameOf_(s.supervisor) : (s.supName || '未指定'), today: c.today, asOf: c.M.asOf, m: metricView_(mOf_(c.M, name)), qsc: qscOf_(name),
    todos: todos, anomaly: c.anom.filter(function (t) { return t.store === name; }).map(function (t) { return todoView_(t, c.today); }), visits: visits, cam: camSlots_(name, c.wk, c.visits), last: lc ? { date: lc.date, mode: lc.mode } : null,
    slots: SLOTS, slotRule: SLOT_RULE };
}

/* ---------- 訪店紀錄（現場／遠端共用） ---------- */
function visitAdd_(me, d) {
  if (!isSupervisor_(me) && !isDirector_(me)) fail_('沒有權限', 'forbidden');
  const store = str_(d.store, 60);
  assertStore_(me, store);
  const today = today_();
  const mode = d.mode === '遠端' ? '遠端' : '現場';
  const kind = mode === '現場' ? '巡店' : (['監視器抽查', '電話', 'LINE@ 訊息', '處理待辦'].indexOf(d.kind) >= 0 ? d.kind : '電話');
  const cam = kind === '監視器抽查';
  const slot = cam && SLOTS[d.slot] ? d.slot : '';
  if (cam && !slot) fail_('請選擇抽查時段');
  const checks = {};
  if (cam && d.checks && typeof d.checks === 'object') SLOTS[slot].forEach(function (k) { if (d.checks[k] === 'ok' || d.checks[k] === 'ng') checks[k] = d.checks[k]; });
  const talk = str_(d.talk, 1000), fb = str_(d.fb, 1000), note = str_(d.note, 300);
  const idList = function (a, prefixTab) {
    if (!Array.isArray(a)) return [];
    const ids = allTodos_().map(function (t) { return t.id; });
    return a.map(String).filter(function (x, i, arr) { return ids.indexOf(x) >= 0 && arr.indexOf(x) === i; }).slice(0, 30);
  };
  const nudges = idList(d.nudges, 'todos'), todos = idList(d.todos, 'todos');
  const shotTime = cam && isHM_(d.shotTime) ? d.shotTime : '';
  const shotDate = cam && isDate_(d.shotDate) ? d.shotDate : '';
  if (!talk && !shotTime && !Object.keys(checks).length && !nudges.length && !todos.length) fail_(cam ? '請上傳截圖、勾選檢查項目，或寫一句溝通重點' : '請寫一句溝通重點');
  // 是否計入本週抽查：時段符合，且影像日期在本週內（不看上傳時間，因為截圖常是事後上傳）
  const pass = cam && !!shotTime && slotOk_(slot, shotTime) && !!shotDate && shotDate >= monday_(today) && shotDate <= today;
  const row = { id: uid_('V'), date: pass ? shotDate : today, time: shotTime || (isHM_(d.time) ? d.time : nowHM_()), who: me.account, store: store, mode: mode, kind: kind,
    slot: slot, shotTime: shotTime, pass: pass, checks: checks, note: note, talk: talk, fb: fb, nudges: nudges, todos: todos, createdAt: nowStamp_() };
  withLock_(function () { Store.append('visits', row); });
  audit_(me.account, 'visit.add', store + ' ' + mode + ' ' + kind + (slot ? ' ' + slot + (pass ? ' 通過' : ' 未計入') : ''));
  return { id: row.id, pass: pass, cam: camSlots_(store, monday_(today), Store.rows('visits')),
    reason: cam && !pass ? (!shotTime ? '沒有截圖時間' : !slotOk_(slot, shotTime) ? '影像時間不在「' + slot + '」時段（需 ' + SLOT_RULE[slot] + '）' : '影像日期不在本週') : '' };
}

/* ---------- 待辦：回報、去重、催辦 ---------- */
function guessSource_(text) {
  if (/少送|缺貨|到貨|晚到|配送|物流|鮮乳|鮮奶|效期|包材|杯蓋|原物料/.test(text)) return '物料異常';
  if (/機|冰箱|冷氣|冷藏|漏|燈|故障|維修|水管|壞|招牌/.test(text)) return '修繕';
  if (/海報|立牌|吊旗|文宣|貼紙|菜單板/.test(text)) return '文宣';
  return '其他';
}
function savePhoto_(photo, name) {
  const folderId = prop_('PHOTO_FOLDER_ID');
  if (!photo || !photo.data || !folderId) return '';
  const type = String(photo.type || '');
  if (['image/jpeg', 'image/png', 'image/webp'].indexOf(type) < 0) fail_('照片格式不支援，請用 JPG 或 PNG');
  if (String(photo.data).length > 2800000) fail_('照片太大，請重新拍攝或壓縮後再上傳');
  const blob = Utilities.newBlob(Utilities.base64Decode(photo.data), type, name);
  return DriveApp.getFolderById(folderId).createFile(blob).getId();   // 檔案預設只有擁有者可看
}
function notify_(dept, subject, body) {
  if (prop_('NOTIFY_EMAIL') !== 'on') return;
  try {
    const to = Store.rows('people').filter(function (p) { return p.dept === dept && yes_(p.active) && p.email; }).map(function (p) { return p.email; });
    if (to.length) MailApp.sendEmail(to.join(','), '[UG 營運工作台] ' + subject, body);
  } catch (e) { /* 通知失敗不影響主流程 */ }
}
function findTodo_(id) {
  const t = Store.rows('todos').filter(function (x) { return x.id === id; })[0];
  if (!t) fail_('找不到這筆待辦');
  return t;
}
function canSeeTodo_(me, t) {
  if (isDirector_(me)) return true;
  if (isSupervisor_(me)) return storesFor_(me).some(function (s) { return s.store === t.store; });
  return me.dept === t.dept;
}

function todoAdd_(me, d) {
  if (!isSupervisor_(me) && !isDirector_(me)) fail_('沒有權限', 'forbidden');
  const store = str_(d.store, 60);
  assertStore_(me, store);
  const text = str_(d.text, 500);
  if (!text) fail_('請用一句話說明狀況');
  const source = SOURCES[d.source] ? d.source : guessSource_(text);
  const today = today_();
  const dupes = allTodos_().filter(function (t) { return t.store === store && t.source === source && isOpenTodo_(t) && todoDays_(t, today) <= DEDUPE_DAYS; });
  if (dupes.length && !d.force) return { dupes: dupes.map(function (t) { return todoView_(t, today); }), source: source, dept: SOURCES[source].dept };
  if (writeBackOn_(source)) {                         // 直接開在原系統，工作台不另外留一份
    let xid = '';
    withLock_(function () { xid = writeBack_(me, source, store, text); });
    const pid = savePhoto_(d.photo, xid + '.jpg');
    if (pid) withLock_(function () { Store.append('extnotes', { id: uid_('N'), caseId: xid, store: store, at: nowStamp_(), by: me.account, text: '回報時拍的現場照片', help: false, doneAt: '', doneBy: '', reply: '', photoId: pid }); });
    audit_(me.account, 'todo.writeback', xid + ' ' + store + ' ' + source);
    const made = allTodos_().filter(function (t) { return yes_(t.ext) && t.id === xid; })[0];
    if (!made) fail_('已送出，但暫時讀不回這筆案件，請稍後重新整理');
    notify_(made.dept, store + ' 新回報：' + text, me.name + ' 從營運工作台回報，已開在' + EXT_SYSTEMS[source].sys + '。\n單號：' + xid);
    return { todo: todoView_(made, today), wroteTo: EXT_SYSTEMS[source].sys };
  }
  const prefix = { '修繕': 'RP', '物料異常': 'MA', '文宣': 'PR', '其他': 'TD' }[source];
  const id = uid_(prefix);
  const photoId = savePhoto_(d.photo, id + '.jpg');
  const row = { id: id, createdAt: nowStamp_(), store: store, source: source, dept: SOURCES[source].dept, text: text, status: '待受理', by: me.account, photoId: photoId, notes: [], nudgedAt: '', closedAt: '', closedBy: '' };
  withLock_(function () { Store.append('todos', row); });
  audit_(me.account, 'todo.add', id + ' ' + store + ' ' + source);
  notify_(row.dept, store + ' 新回報：' + text, me.name + ' 於 ' + row.createdAt + ' 回報。\n門市：' + store + '\n類別：' + source + '\n內容：' + text + '\n單號：' + id);
  return { todo: todoView_(row, today) };
}
function todoNote_(me, d, isNudge) {
  const t = findTodo_(str_(d.id, 40));
  if (!canSeeTodo_(me, t)) fail_('你沒有這筆待辦的權限', 'forbidden');
  if (!isOpenTodo_(t)) fail_('這筆待辦已經結案');
  const text = isNudge ? '催辦' : str_(d.text, 500);
  if (!text) fail_('請輸入補充內容');
  const today = today_();
  const notes = J_(t.notes, []);
  notes.push({ at: nowStamp_(), by: me.name, text: text });
  const patch = { notes: notes.slice(-50) };
  if (isSupervisor_(me) || isDirector_(me)) patch.nudgedAt = today;
  withLock_(function () { Store.update('todos', t._row, patch); });
  audit_(me.account, isNudge ? 'todo.nudge' : 'todo.append', t.id);
  if (isSupervisor_(me) || isDirector_(me)) notify_(t.dept, t.store + ' 催辦：' + t.text, me.name + '：' + text + '\n單號：' + t.id + '（已開啟 ' + todoDays_(t, today) + ' 天）');
  return { todo: todoView_(findTodo_(t.id), today) };
}
function todoStatus_(me, d) {
  const t = findTodo_(str_(d.id, 40));
  if (!(isDirector_(me) || (me.role === 'dept' && me.dept === t.dept))) fail_('只有處理單位或營運總監可以變更狀態', 'forbidden');
  if (['待受理', '處理中', '已完成'].indexOf(d.status) < 0) fail_('狀態不正確');
  const patch = { status: d.status, closedAt: d.status === '已完成' ? nowStamp_() : '', closedBy: d.status === '已完成' ? me.account : '' };
  const note = str_(d.note, 500);
  if (note) { const notes = J_(t.notes, []); notes.push({ at: nowStamp_(), by: me.name, text: note }); patch.notes = notes.slice(-50); }
  withLock_(function () { Store.update('todos', t._row, patch); });
  audit_(me.account, 'todo.status', t.id + ' → ' + d.status);
  return { todo: todoView_(findTodo_(t.id), today_()) };
}
function todoList_(me, d) {
  const today = today_();
  let list = allTodos_().filter(function (t) { return canSeeTodo_(me, t); });
  if (!d.all) list = list.filter(isOpenTodo_);
  const anom = list.filter(function (t) { return isAnomNew_(t, today); });
  list = list.filter(function (t) { return !isAnomNew_(t, today); });
  return { today: today, todos: list.map(function (t) { return todoView_(t, today); }).sort(function (a, b) { return (b.late - a.late) || (b.days - a.days); }).slice(0, 300),
    anom: anom.map(function (t) { return todoView_(t, today); }).sort(function (a, b) { return a.days - b.days; }).slice(0, 150), anomTotal: anom.length };
}
function photoGet_(me, d) {
  const xn = Store.rows('extnotes').filter(function (n) { return n.caseId === str_(d.id, 60) && n.photoId; })[0];
  if (xn) {
    extCase_(me, xn.caseId);                            // 權限同案件
    const b = DriveApp.getFileById(xn.photoId).getBlob();
    return { type: b.getContentType(), data: Utilities.base64Encode(b.getBytes()) };
  }
  const t = findTodo_(str_(d.id, 40));
  if (!canSeeTodo_(me, t)) fail_('你沒有這筆待辦的權限', 'forbidden');
  if (!t.photoId) fail_('這筆待辦沒有照片');
  const blob = DriveApp.getFileById(t.photoId).getBlob();
  return { type: blob.getContentType(), data: Utilities.base64Encode(blob.getBytes()) };
}

/* ---------- 週誌 ---------- */
function weekVisits_(who, wk, visits) {
  const end = addDays_(wk, 6);
  return visits.filter(function (v) { return v.who === who && v.date >= wk && v.date <= end; }).sort(function (a, b) { return (a.date + a.time).localeCompare(b.date + b.time); });
}
function md_(d) { return (+d.slice(5, 7)) + '/' + (+d.slice(8, 10)); }
function jAuto_(who, wk, c) {
  const stores = activeStores_().filter(function (s) { return s.supervisor === who; });
  const names = stores.map(function (s) { return s.store; });
  const vs = weekVisits_(who, wk, c.visits);
  const end = addDays_(wk, 6);
  const open = c.todos.filter(function (t) { return names.indexOf(t.store) >= 0 && isOpenTodo_(t); });
  const need = names.filter(function (n) { const m = mOf_(c.M, n); return m && m.need; });
  const camDone = names.filter(function (n) { return camSlots_(n, wk, c.visits).length === 3; }).length;
  const plan = c.events.filter(function (e) { return e.who === who && e.type === '巡店' && e.start <= end && e.end >= wk; });
  const site = vs.filter(function (v) { return v.mode === '現場'; }).length, remote = vs.filter(function (v) { return v.mode === '遠端'; }).length;
  const covered = {}; vs.forEach(function (v) { covered[v.store] = 1; });
  return {
    stores: names.length, site: site, remote: remote, camDone: camDone, open: open.length, late: open.filter(function (t) { return todoLate_(t, c.today); }).length, need: need,
    lines: [
      '負責門市 ' + names.length + ' 間；訪店紀錄 現場 ' + site + ' 筆、遠端 ' + remote + ' 筆，涵蓋 ' + Object.keys(covered).length + ' 間門市',
      '本週排定巡店 ' + plan.length + ' 次' + (plan.length ? '（' + plan.map(function (e) { return e.place; }).join('、') + '）' : ''),
      '遠端抽查：' + camDone + ' / ' + names.length + ' 間完成（開班、營業中、閉店各一次）',
      '待辦：未結案 ' + open.length + ' 筆，其中逾期 ' + open.filter(function (t) { return todoLate_(t, c.today); }).length + ' 筆',
      '需關注門市 ' + need.length + ' 間（落後區域平均 10% 以上或連續兩週下滑）' + (need.length ? '：' + need.join('、') : '')
    ]
  };
}
function jDraft_(who, wk, c) {
  const vs = weekVisits_(who, wk, c.visits);
  const trim = function (s) { return String(s || '').replace(/[。；\s]+$/, ''); };
  const found = vs.filter(function (v) { return v.kind !== '處理待辦' && (v.talk || v.fb || v.slot || Object.keys(J_(v.checks, {})).length); }).map(function (v) {
    const ch = J_(v.checks, {});
    const ng = Object.keys(ch).filter(function (k) { return ch[k] === 'ng'; });
    const parts = [trim(v.talk), ng.length ? '異常：' + ng.join('、') + (v.note ? '（' + trim(v.note) + '）' : '') : '', v.fb ? '店家反饋：' + trim(v.fb) : ''].filter(String);
    return md_(v.date) + ' ' + v.store + '（' + v.mode + (v.mode === '遠端' ? '・' + v.kind : '') + (v.slot ? '・' + v.slot + (yes_(v.pass) ? '通過' : '未計入') : '') + '）：' + (parts.join('；') || '無異常');
  });
  const byId = {}; c.todos.concat(c.anom).forEach(function (t) { byId[t.id] = t; });
  const issue = [], seen = {};
  vs.forEach(function (v) {
    J_(v.todos, []).forEach(function (id) { const t = byId[id]; if (t && !seen['n' + id]) { seen['n' + id] = 1; issue.push('回報' + t.source + '（' + t.dept + '）：' + t.store + ' ' + t.text); } });
    J_(v.nudges, []).forEach(function (id) { const t = byId[id]; if (t && !seen['g' + id]) { seen['g' + id] = 1; issue.push('已催' + t.dept + '：' + t.store + ' ' + t.text); } });
  });
  const nw = addDays_(wk, 7), nwEnd = addDays_(nw, 6);
  const plan = c.events.filter(function (e) { return e.who === who && e.type === '巡店' && e.start <= nwEnd && e.end >= nw; }).sort(function (a, b) { return a.start.localeCompare(b.start); })
    .map(function (e) { return md_(e.start) + ' ' + e.place; });
  const stale = activeStores_().filter(function (s) { if (s.supervisor !== who) return false; const lc = lastContact_(s.store, c.visits); return !lc || diffDays_(lc.date, c.today) >= 14; }).map(function (s) { return s.store; });
  if (stale.length) plan.push(stale.join('、') + ' 已超過兩週沒有關心，安排巡店或遠端抽查');
  return { n: vs.length, found: found.join('\n'), issue: issue.join('\n'), plan: plan.join('\n'), needs: '' };
}
function journalRow_(who, wk) { return Store.rows('journals').filter(function (j) { return j.who === who && j.week === wk; })[0]; }
function journalView_(j) { return j ? { state: j.state, found: j.found, issue: j.issue, plan: j.plan, needs: j.needs, sentAt: j.sentAt, readAt: j.readAt, reply: j.reply } : null; }
function weekArg_(d) { return isDate_(d.week) ? monday_(d.week) : monday_(today_()); }

function journalGet_(me, d) {
  const wk = weekArg_(d);
  const who = isSupervisor_(me) ? me.account : str_(d.who, 60);
  if (!isSupervisor_(me) && !isDirector_(me)) fail_('沒有權限', 'forbidden');
  const p = person_(who);
  if (!p || p.role !== 'supervisor') fail_('找不到這位督導');
  const c = ctx_();
  const vs = weekVisits_(who, wk, c.visits).map(visitView_);
  return { week: wk, weekEnd: addDays_(wk, 6), due: addDays_(wk, 7), who: { account: p.account, name: p.name }, auto: jAuto_(who, wk, c), visits: vs, draft: jDraft_(who, wk, c), saved: journalView_(journalRow_(who, wk)) };
}
function journalSave_(me, d) {
  if (!isSupervisor_(me)) fail_('只有督導可以填寫週誌', 'forbidden');
  const wk = weekArg_(d);
  const f = { found: str_(d.found, 4000), issue: str_(d.issue, 4000), plan: str_(d.plan, 4000), needs: str_(d.needs, 4000) };
  const send = !!d.send;
  if (send && (!f.found || !f.plan)) fail_('請至少填寫「本週重點發現」與「下週計畫」');
  withLock_(function () {
    const cur = journalRow_(me.account, wk);
    const patch = { state: send ? '已送出' : '草稿', found: f.found, issue: f.issue, plan: f.plan, needs: f.needs };
    if (send) { patch.sentAt = nowStamp_(); patch.readAt = ''; }
    if (cur) Store.update('journals', cur._row, patch);
    else Store.append('journals', Object.assign({ id: uid_('J'), week: wk, who: me.account, sentAt: '', readAt: '', reply: '' }, patch));
  });
  audit_(me.account, send ? 'journal.send' : 'journal.draft', wk);
  return { saved: journalView_(journalRow_(me.account, wk)) };
}
function journalBoard_(me, d) {
  if (!isDirector_(me)) fail_('沒有權限', 'forbidden');
  const wk = weekArg_(d), c = ctx_();
  const sups = Store.rows('people').filter(function (p) { return p.role === 'supervisor' && yes_(p.active); });
  return { week: wk, weekEnd: addDays_(wk, 6), due: addDays_(wk, 7), rows: sups.map(function (p) {
    const j = journalRow_(p.account, wk), a = jAuto_(p.account, wk, c);
    return { account: p.account, name: p.name, state: j ? j.state : '未填寫', sentAt: j ? j.sentAt : '', read: !!(j && j.readAt), needs: j && j.state === '已送出' ? j.needs : '',
      stores: a.stores, site: a.site, remote: a.remote, camDone: a.camDone, late: a.late };
  }) };
}
function journalAck_(me, d) {
  if (!isDirector_(me)) fail_('沒有權限', 'forbidden');
  const wk = weekArg_(d);
  const j = journalRow_(str_(d.who, 60), wk);
  if (!j || j.state !== '已送出') fail_('這份週誌尚未送出');
  withLock_(function () { Store.update('journals', j._row, { readAt: nowStamp_(), reply: str_(d.reply, 2000) }); });
  audit_(me.account, 'journal.ack', j.who + ' ' + wk);
  return {};
}

/* ---------- 行程 ---------- */
function visiblePeople_(me) {
  const all = Store.rows('people').filter(function (p) { return yes_(p.active); });
  if (isDirector_(me)) return all;
  return all.filter(function (p) { return p.account === me.account || (p.role === me.role && p.dept === me.dept); });
}
function eventsList_(me, d) {
  const today = today_();
  const from = isDate_(d.from) ? d.from : today, to = isDate_(d.to) ? d.to : addDays_(from, 6);
  if (to < from || diffDays_(from, to) > 100) fail_('日期範圍不正確');
  const people = visiblePeople_(me);
  const ok = {}; people.forEach(function (p) { ok[p.account] = 1; });
  const who = str_(d.who, 60);
  const list = Store.rows('events').filter(function (e) { return ok[e.who] && (!who || e.who === who) && e.start <= to && e.end >= from; }).map(eventView_)
    .sort(function (a, b) { return a.start.localeCompare(b.start) || a.name.localeCompare(b.name); });
  return { today: today, from: from, to: to, events: list, days: calendarDays_(from, to), people: people.map(function (p) { return { account: p.account, name: p.name, dept: p.dept, role: p.role }; }), types: EVENT_TYPES };
}
function eventFields_(d) {
  if (EVENT_TYPES.indexOf(d.type) < 0) fail_('請選擇行程類型');
  const place = str_(d.place, 100);
  if (!place) fail_('請填寫地點或說明');
  if (!isDate_(d.start)) fail_('開始日期不正確');
  const end = isDate_(d.end) && d.end >= d.start ? d.end : d.start;
  if (diffDays_(d.start, end) > 62) fail_('單次最多排 62 天');
  return { type: d.type, place: place, start: d.start, end: end };
}
function eventsAdd_(me, d) {
  const f = eventFields_(d);
  let whos = Array.isArray(d.whos) && d.whos.length ? d.whos.map(String) : [me.account];
  if (!isDirector_(me)) whos = [me.account];                          // 非總監只能排自己的行程
  const valid = {}; Store.rows('people').forEach(function (p) { if (yes_(p.active)) valid[p.account] = 1; });
  whos = whos.filter(function (w, i, a) { return valid[w] && a.indexOf(w) === i; });
  if (!whos.length) fail_('請至少選一位');
  const wds = Array.isArray(d.weekdays) && d.weekdays.length ? d.weekdays.map(Number) : [0, 1, 2, 3, 4, 5, 6];
  const all = []; for (let x = f.start; x <= f.end; x = addDays_(x, 1)) all.push(x);
  const days = all.filter(function (x) { return wds.indexOf(dow_(x)) >= 0; });
  if (!days.length) fail_('選擇的日期範圍內沒有符合的星期');
  const rows = [];
  whos.forEach(function (w) {
    if (days.length === all.length) rows.push({ who: w, start: f.start, end: f.end });      // 連續多天存成一筆
    else days.forEach(function (x) { rows.push({ who: w, start: x, end: x }); });
  });
  if (rows.length > 200) fail_('一次最多新增 200 筆，請縮小範圍');
  withLock_(function () {
    rows.forEach(function (r) { Store.append('events', { id: uid_('E'), who: r.who, start: r.start, end: r.end, type: f.type, place: f.place, todoId: '', createdBy: me.account, updatedAt: nowStamp_() }); });
  });
  audit_(me.account, 'events.add', whos.join(',') + ' ' + f.start + '~' + f.end + ' ' + f.type + ' ×' + rows.length);
  return { added: rows.length, people: whos.length };
}
function findEvent_(me, id) {
  const e = Store.rows('events').filter(function (x) { return x.id === id; })[0];
  if (!e) fail_('找不到這筆行程');
  if (!isDirector_(me) && e.who !== me.account) fail_('只能修改自己的行程', 'forbidden');
  return e;
}
function eventsUpdate_(me, d) {
  const e = findEvent_(me, str_(d.id, 40)), f = eventFields_(d);
  withLock_(function () { Store.update('events', e._row, { type: f.type, place: f.place, start: f.start, end: f.end, updatedAt: nowStamp_() }); });
  audit_(me.account, 'events.update', e.id);
  return {};
}
function eventsDelete_(me, d) {
  const e = findEvent_(me, str_(d.id, 40));
  withLock_(function () { Store.remove('events', findEvent_(me, e.id)._row); });
  audit_(me.account, 'events.delete', e.id + ' ' + e.who + ' ' + e.start);
  return {};
}

/* ---------- 行事曆訂閱 ---------- */
function calUrl_(me) {
  let token = me.calToken;
  if (!token) { token = newToken_(); withLock_(function () { Store.update('people', me._row, { calToken: token }); }); }
  return { url: ScriptApp.getService().getUrl() + '?cal=' + token };
}
function calReset_(me) {
  const token = newToken_();
  withLock_(function () { Store.update('people', me._row, { calToken: token }); });
  audit_(me.account, 'cal.reset', '');
  return { url: ScriptApp.getService().getUrl() + '?cal=' + token };
}
function icsEscape_(s) { return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'); }
function ics_(p) {
  const today = today_(), from = addDays_(today, -31), to = addDays_(today, 186);
  const z = function (d) { return d.replace(/-/g, ''); };
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//UG//Ops Workbench//ZH', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:' + icsEscape_('UG 行程 ' + p.name), 'X-WR-TIMEZONE:' + TZ, 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H'];
  Store.rows('events').filter(function (e) { return e.who === p.account && e.start <= to && e.end >= from; }).forEach(function (e) {
    const stamp = String(e.updatedAt || '').replace(/[-: ]/g, '');
    L.push('BEGIN:VEVENT', 'UID:' + e.id + '@ug-ops', 'DTSTAMP:' + (stamp.length === 14 ? stamp.slice(0, 8) + 'T' + stamp.slice(8) : z(today) + 'T000000'),
      'DTSTART;VALUE=DATE:' + z(e.start), 'DTEND;VALUE=DATE:' + z(addDays_(e.end, 1)), 'SUMMARY:' + icsEscape_(e.type + '・' + e.place), 'TRANSP:TRANSPARENT', 'END:VEVENT');
  });
  L.push('END:VCALENDAR');
  return L.join('\r\n');
}

/* ---------- 總監晨報 ---------- */
function brief_(me) {
  if (!isDirector_(me)) fail_('沒有權限', 'forbidden');
  const c = ctx_();
  const stores = activeStores_();
  const supOf = {}; stores.forEach(function (s) { supOf[s.store] = s.supervisor; });
  const open = c.todos.filter(isOpenTodo_);
  const late = open.filter(function (t) { return todoLate_(t, c.today); }).map(function (t) { const v = todoView_(t, c.today); v.supervisor = nameOf_(supOf[t.store] || ''); return v; })
    .sort(function (a, b) { return b.days - a.days; });
  const gap = stores.map(function (s) { const lc = lastContact_(s.store, c.visits); return { store: s.store, supervisor: s.supervisor ? nameOf_(s.supervisor) : (s.supName || ''), days: lc ? diffDays_(lc.date, c.today) : null, last: lc ? lc.date : '', mode: lc ? lc.mode : '' }; })
    .filter(function (x) { return x.days === null || x.days >= 7; }).sort(function (a, b) { return (b.days === null ? 999 : b.days) - (a.days === null ? 999 : a.days); });
  const need = stores.filter(function (s) { const m = mOf_(c.M, s.store); return m && m.need; }).map(function (s) {
    const m = mOf_(c.M, s.store);
    return { store: s.store, supervisor: s.supervisor ? nameOf_(s.supervisor) : (s.supName || ''), m: metricView_(m), open: open.filter(function (t) { return t.store === s.store; }).length };
  }).sort(function (a, b) { return (a.m.rel === null ? 0 : a.m.rel) - (b.m.rel === null ? 0 : b.m.rel); });
  let y = 0, yT = 0, a4 = 0, hasT = true;
  stores.forEach(function (s) { const m = mOf_(c.M, s.store); if (!m) return; y += m.y; a4 += m.avg4 || 0; if (m.yTarget) yT += m.yTarget; else hasT = false; });
  const people = Store.rows('people').filter(function (p) { return yes_(p.active) && p.account !== me.account; }).map(function (p) {
    const e = eventsOn_(c.events, p.account, c.today)[0];
    return { account: p.account, name: p.name, dept: p.dept, role: p.role, type: e ? e.type : '內勤', place: e ? e.place : '' };
  });
  const sups = Store.rows('people').filter(function (p) { return p.role === 'supervisor' && yes_(p.active); });
  const js = sups.map(function (p) { return journalRow_(p.account, c.wk); });
  return { today: c.today, asOf: c.M.asOf, metricsNote: c.M.note,
    kpi: { y: y, yTarget: hasT && yT ? yT : null, ach: hasT && yT ? Math.round(y / yT * 100) : null, ch: a4 ? Math.round((y - a4) / a4 * 1000) / 10 : null, stores: stores.length,
      open: open.length, late: late.length, out: people.filter(function (p) { return ['巡店', '外出', '訓練'].indexOf(p.type) >= 0; }).length, leave: people.filter(function (p) { return p.type === '請假'; }).length,
      jSent: js.filter(function (j) { return j && j.state === '已送出'; }).length, jUnread: js.filter(function (j) { return j && j.state === '已送出' && !j.readAt; }).length, jTotal: sups.length },
    postsPending: Store.rows('posts').filter(function (p) { return p.state === '待核定'; }).length,
    late: late.slice(0, 40), gap: gap.slice(0, 40), need: need.slice(0, 40), people: people,
    help: c.todos.concat(c.anom).filter(function (t) { return yes_(t.ext); }).map(function (t) { return todoView_(t, c.today); }).filter(function (v) { return v.help; }),
    anom: (function () { const n = {}; c.anom.forEach(function (t) { n[t.store] = (n[t.store] || 0) + 1; });
      return { total: c.anom.length, stores: Object.keys(n).map(function (k) { return { store: k, n: n[k], supervisor: supOf[k] ? nameOf_(supOf[k]) : '' }; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 40) }; })(),
    supervisors: sups.concat(stores.some(function (s) { return s.supervisor === me.account; }) ? [me] : []).map(function (p) { return { account: p.account, name: p.name }; }),
    unassigned: stores.filter(function (s) { return !s.supervisor; }).map(function (s) { return { store: s.store, supName: s.supName || '' }; }) };
}

/* ---------- 既有系統案件的補充說明（給總監看實際狀況，或請總監協助跨部門溝通） ---------- */
function extCase_(me, id) {
  const t = allTodos_().filter(function (x) { return yes_(x.ext) && x.id === id; })[0];
  if (!t) fail_('找不到這個案件，可能已經在原系統結案');
  if (!canSeeTodo_(me, t)) fail_('你沒有這個案件的權限', 'forbidden');
  return t;
}
function extNote_(me, d) {
  const t = extCase_(me, str_(d.id, 60));
  const text = str_(d.text, 800);
  if (!text) fail_('請寫下實際狀況');
  const help = !!d.help && !isDirector_(me);
  withLock_(function () { Store.append('extnotes', { id: uid_('N'), caseId: t.id, store: t.store, at: nowStamp_(), by: me.account, text: text, help: help, doneAt: '', doneBy: '', reply: '' }); });
  audit_(me.account, 'ext.note', t.id + (help ? ' 請總監協助' : ''));
  return { todo: todoView_(t, today_()) };
}
function extResolve_(me, d) {
  if (!isDirector_(me)) fail_('只有營運總監可以回覆協助請求', 'forbidden');
  const n = Store.rows('extnotes').filter(function (x) { return x.id === str_(d.noteId, 40); })[0];
  if (!n) fail_('找不到這則說明');
  withLock_(function () { Store.update('extnotes', n._row, { doneAt: nowStamp_(), doneBy: me.account, reply: str_(d.reply, 800) }); });
  audit_(me.account, 'ext.resolve', n.caseId);
  return {};
}
