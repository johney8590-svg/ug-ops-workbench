/**
 * 自訂待辦：自己記給自己的事，或營運經理交辦給同仁的事。跟門市回報的待辦（修繕／物料／文宣／客訴）分開。
 * 誰看得到：被指派的人、建立的人。誰能完成／刪除：被指派的人、建立的人、營運經理。
 */
function myTodoView_(t, me, today) {
  return { id: t.id, text: t.text, store: t.store || '', due: t.due || '', note: t.note || '', done: !!t.doneAt, doneAt: String(t.doneAt || '').slice(0, 10),
    owner: t.owner, ownerName: nameOf_(t.owner), byName: t.by !== t.owner ? nameOf_(t.by) : '', mine: t.owner === me.account,
    late: !t.doneAt && !!t.due && t.due < today, createdAt: String(t.createdAt).slice(0, 10) };
}
function myTodos_(me) {
  const today = today_(), keep = addDays_(today, -14);
  const list = Store.rows('mytodos').filter(function (t) { return (t.owner === me.account || t.by === me.account) && (!t.doneAt || String(t.doneAt).slice(0, 10) >= keep); })
    .map(function (t) { return myTodoView_(t, me, today); });
  const rank = function (t) { return (t.done ? 2 : 0) + (t.mine ? 0 : 1); };
  list.sort(function (a, b) { return (rank(a) - rank(b)) || (b.late - a.late) || (a.due || '9999').localeCompare(b.due || '9999') || b.createdAt.localeCompare(a.createdAt); });
  return { items: list.slice(0, 200), people: isDirector_(me) ? Store.rows('people').filter(function (p) { return yes_(p.active); }).map(function (p) { return { account: p.account, name: p.name }; }) : [] };
}
function myTodoAdd_(me, d) {
  const text = str_(d.text, 200);
  if (!text) fail_('請寫下要做的事');
  const due = isDate_(d.due) ? d.due : '';
  const store = str_(d.store, 60);
  if (store && !activeStores_().some(function (s) { return s.store === store; })) fail_('找不到這間門市');
  let owners = [me.account];
  if (isDirector_(me) && Array.isArray(d.owners) && d.owners.length) {
    const ok = {}; Store.rows('people').forEach(function (p) { if (yes_(p.active)) ok[p.account] = 1; });
    owners = d.owners.map(String).filter(function (a, i, arr) { return ok[a] && arr.indexOf(a) === i; }).slice(0, 30);
    if (!owners.length) fail_('請至少選一位');
  }
  const now = nowStamp_();
  withLock_(function () { owners.forEach(function (o) { Store.append('mytodos', { id: uid_('M'), createdAt: now, owner: o, by: me.account, text: text, store: store, due: due, note: str_(d.note, 500), doneAt: '', doneBy: '' }); }); });
  audit_(me.account, 'mytodo.add', owners.join(',') + ' ' + text);
  const others = owners.filter(function (o) { return o !== me.account; });
  if (others.length) linePush_(others, '【交辦】' + me.name + '：' + text + (store ? '（' + store + '）' : '') + (due ? '\n期限 ' + md_(due) : ''));
  return { added: owners.length };
}
function myTodoFind_(me, id) {
  const t = Store.rows('mytodos').filter(function (x) { return x.id === id; })[0];
  if (!t) fail_('找不到這筆待辦');
  if (!(t.owner === me.account || t.by === me.account || isDirector_(me))) fail_('你沒有這筆待辦的權限', 'forbidden');
  return t;
}
function myTodoDone_(me, d) {
  const t = myTodoFind_(me, str_(d.id, 40)), done = d.done !== false;
  withLock_(function () { Store.update('mytodos', t._row, { doneAt: done ? nowStamp_() : '', doneBy: done ? me.account : '' }); });
  audit_(me.account, done ? 'mytodo.done' : 'mytodo.reopen', t.id);
  if (done && t.by !== me.account) linePush_([t.by], '【已完成】' + me.name + '：' + t.text);
  return {};
}
function myTodoDelete_(me, d) {
  const t = myTodoFind_(me, str_(d.id, 40));
  if (t.by !== me.account && !isDirector_(me)) fail_('別人交辦的事不能刪除，完成後按完成即可', 'forbidden');
  withLock_(function () { Store.remove('mytodos', t._row); });
  audit_(me.account, 'mytodo.delete', t.id + ' ' + t.text);
  return {};
}
