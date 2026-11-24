/**
 * 入口：前端一律以 POST 傳 JSON（{action, token, data}），這裡驗證身分後分派。
 * 行事曆訂閱用 GET ?cal=<個人訂閱碼>，只回傳該員自己的行程。
 */
const ACTIONS = {
  'me':            { fn: function (me) { return { me: publicPerson_(me), today: today_() }; } },
  'password.change': { fn: changePassword_, open: true },
  'home':          { fn: home_ },
  'store':         { fn: store_ },
  'visit.add':     { fn: visitAdd_ },
  'todo.add':      { fn: todoAdd_ },
  'todo.append':   { fn: function (me, d) { return todoNote_(me, d, false); } },
  'todo.nudge':    { fn: function (me, d) { return todoNote_(me, d, true); } },
  'todo.status':   { fn: todoStatus_ },
  'todo.list':     { fn: todoList_ },
  'photo.get':     { fn: photoGet_ },
  'journal.get':   { fn: journalGet_ },
  'journal.save':  { fn: journalSave_ },
  'journal.board': { fn: journalBoard_ },
  'journal.ack':   { fn: journalAck_ },
  'events.list':   { fn: eventsList_ },
  'events.add':    { fn: eventsAdd_ },
  'events.update': { fn: eventsUpdate_ },
  'events.delete': { fn: eventsDelete_ },
  'cal.url':       { fn: calUrl_ },
  'cal.reset':     { fn: calReset_ },
  'brief':         { fn: brief_ }
};

function route_(req) {
  const action = String(req.action || '');
  const d = req.data && typeof req.data === 'object' ? req.data : {};
  if (action === 'login') return login_(d);
  if (action === 'logout') return logout_(req.token);
  const me = auth_(req.token);
  const a = Object.prototype.hasOwnProperty.call(ACTIONS, action) ? ACTIONS[action] : null;
  if (!a) fail_('不支援的操作');
  // 還沒改掉初始密碼的人，只能查自己和改密碼
  if (yes_(me.mustChange) && action !== 'me' && !a.open) fail_('請先變更初始密碼', 'must_change');
  return a.fn(me, d);
}

function reply_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }

function doPost(e) {
  try {
    const body = e && e.postData ? e.postData.contents : '';
    if (!body || body.length > 4000000) fail_('請求內容不正確');
    let req;
    try { req = JSON.parse(body); } catch (x) { fail_('請求內容不正確'); }
    if (!req || typeof req !== 'object') fail_('請求內容不正確');
    return reply_({ ok: true, data: route_(req) });
  } catch (err) {
    // 自己丟出的錯誤（有 code）才把訊息給前端；其他例外只回通用訊息，細節留在執行紀錄
    if (err && err.code) return reply_({ ok: false, error: err.message, code: err.code });
    console.error(err && err.stack ? err.stack : err);
    return reply_({ ok: false, error: '系統發生錯誤，請稍後再試', code: 'server' });
  }
}

function doGet(e) {
  const token = e && e.parameter ? String(e.parameter.cal || '') : '';
  if (token && /^[0-9a-f]{64}$/.test(token)) {
    const p = Store.rows('people').filter(function (x) { return x.calToken === token && yes_(x.active); })[0];
    if (p) return ContentService.createTextOutput(ics_(p)).setMimeType(ContentService.MimeType.ICAL);
  }
  return ContentService.createTextOutput('UG 營運工作台 API').setMimeType(ContentService.MimeType.TEXT);
}
