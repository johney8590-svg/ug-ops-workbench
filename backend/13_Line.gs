/**
 * LINE 通知（選用）。指令碼屬性 LINE_TOKEN 填了官方帳號的 Channel access token 才會啟用。
 * 綁定方式：同仁在工作台「我的帳號」取得 6 位數綁定碼 → 加官方帳號好友 → 傳「綁定 123456」。
 * 注意：Apps Script 收不到 LINE 的簽章標頭，無法驗證訊息真的來自 LINE；所以 webhook 只接受「綁定碼」這一件事，
 * 綁定碼是一次性、10 分鐘有效、只有登入的人看得到，偽造的訊息沒有綁定碼就什麼都做不了。
 */
/** 要同時有 token、又有 14_LineSend.gs（實際對外連線的那一小段）才算啟用。 */
function lineOn_() { return !!prop_('LINE_TOKEN') && typeof lineCall_ === 'function'; }
/** 推給指定帳號（有綁定的才收得到）。失敗不影響主流程。 */
function linePush_(accounts, text) {
  if (!lineOn_()) return 0;
  const want = {}; accounts.forEach(function (a) { want[a] = 1; });
  const ids = Store.rows('people').filter(function (p) { return want[p.account] && yes_(p.active) && p.lineId; }).map(function (p) { return p.lineId; });
  const msg = [{ type: 'text', text: cut_(text, 900) + '\n' + (prop_('APP_URL') || '') }];
  for (let i = 0; i < ids.length; i += 500) lineCall_('multicast', { to: ids.slice(i, i + 500), messages: msg });
  return ids.length;
}
function lineRole_(fn) { return Store.rows('people').filter(function (p) { return yes_(p.active) && fn(p); }).map(function (p) { return p.account; }); }
function lineStatus_(me) { return { enabled: lineOn_(), bound: !!me.lineId }; }
function lineCode_(me) {
  if (!lineOn_()) fail_('LINE 通知尚未啟用');
  const code = String(Math.floor(100000 + Math.random() * 900000));
  CacheService.getScriptCache().put('linebind:' + code, me.account, 600);
  audit_(me.account, 'line.code', '');
  return { code: code };
}
function lineUnbind_(me) { withLock_(function () { Store.update('people', me._row, { lineId: '' }); }); audit_(me.account, 'line.unbind', ''); return {}; }
/** LINE 平台打進來的 webhook：只處理「綁定 123456」。 */
function lineWebhook_(body) {
  (body.events || []).slice(0, 20).forEach(function (ev) {
    const uid = ev && ev.source && ev.source.userId, text = ev && ev.message && ev.message.type === 'text' ? String(ev.message.text) : '';
    const m = text.match(/(\d{6})/);
    if (!uid || !/^U[0-9a-f]{32}$/.test(uid) || !m || !/綁定|bind/i.test(text)) return;
    const cache = CacheService.getScriptCache(), account = cache.get('linebind:' + m[1]);
    let reply = '綁定碼不正確或已過期，請回工作台「我的帳號」重新取得。';
    if (account) {
      cache.remove('linebind:' + m[1]);
      const p = person_(account);
      if (p && yes_(p.active)) { withLock_(function () { Store.update('people', p._row, { lineId: uid }); }); audit_(account, 'line.bind', ''); reply = '綁定完成，' + p.name + '。之後工作台的通知會傳到這裡。'; }
    }
    if (lineOn_() && ev.replyToken) lineCall_('reply', { replyToken: ev.replyToken, messages: [{ type: 'text', text: reply }] });
  });
}
