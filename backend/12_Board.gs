/**
 * 工作看板：一眼看到「誰手上有什麼」。只有營運總監看得到。
 * 部門那一半算的是待辦（含三套原系統未結案的單）；督導那一半算的是門市、訪店、抽查與週誌。
 */
function board_(me) {
  if (!isDirector_(me)) fail_('沒有權限', 'forbidden');
  const c = ctx_();
  const open = c.todos.filter(isOpenTodo_);
  const helpIds = {}; Store.rows('extnotes').forEach(function (n) { if (yes_(n.help) && !n.doneAt) helpIds[n.caseId] = 1; });
  const depts = {};
  open.forEach(function (t) {
    const k = t.dept || '未指定', d = depts[k] || (depts[k] = { dept: k, open: 0, wait: 0, late: 0, oldest: 0, help: 0, bySource: {} });
    d.open++; if (/^待/.test(String(t.status))) d.wait++;
    if (todoLate_(t, c.today)) d.late++;
    d.oldest = Math.max(d.oldest, todoDays_(t, c.today));
    if (helpIds[t.id]) d.help++;
    d.bySource[t.source] = (d.bySource[t.source] || 0) + 1;
  });
  const stores = activeStores_(), end = addDays_(c.wk, 6);
  const sups = Store.rows('people').filter(function (p) { return yes_(p.active) && (p.role === 'supervisor' || stores.some(function (s) { return s.supervisor === p.account; })); });
  return {
    today: c.today, week: c.wk,
    depts: Object.keys(depts).map(function (k) { return depts[k]; }).sort(function (a, b) { return (b.late - a.late) || (b.open - a.open); }),
    anomNew: c.anom.length,
    sups: sups.map(function (p) {
      const mine = stores.filter(function (s) { return s.supervisor === p.account; }).map(function (s) { return s.store; });
      const has = {}; mine.forEach(function (n) { has[n] = 1; });
      const o = open.filter(function (t) { return has[t.store]; });
      const wv = c.visits.filter(function (v) { return v.who === p.account && v.date >= c.wk && v.date <= end; });
      const j = journalRow_(p.account, c.wk), ev = eventsOn_(c.events, p.account, c.today)[0];
      return { account: p.account, name: p.name, stores: mine.length, open: o.length, late: o.filter(function (t) { return todoLate_(t, c.today); }).length,
        need: mine.filter(function (n) { const m = mOf_(c.M, n); return m && m.need; }).length,
        site: wv.filter(function (v) { return v.mode === '現場'; }).length, remote: wv.filter(function (v) { return v.mode === '遠端'; }).length,
        camDone: mine.filter(function (n) { return camSlots_(n, c.wk, c.visits).length === 3; }).length,
        journal: p.role === 'supervisor' ? (j ? j.state : '未填寫') : '', today: ev ? ev.type + '・' + ev.place : '內勤' };
    }).sort(function (a, b) { return (b.late - a.late) || (b.open - a.open); })
  };
}
