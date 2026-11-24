/**
 * 版本公告：行銷／營運／訓練三類。
 * 來源有兩種：(1) 人工新增；(2) 指定的雲端資料夾裡有檔案更新時，系統自動產生一則「待核定」。
 * 一律要營運總監核定後才會公告給同仁；同仁看完按「已確認」，總監看得到確認率。
 */
const POST_CATS = { '行銷': 'ANN_FOLDER_MARKETING', '營運': 'ANN_FOLDER_OPS', '訓練': 'ANN_FOLDER_TRAINING' };

function postView_(p, me, acks, audience) {
  const mine = acks.filter(function (a) { return a.postId === p.id; });
  const v = { id: p.id, cat: p.cat, title: p.title, body: p.body, fileName: p.fileName, fileUrl: /^https:\/\//.test(String(p.fileUrl)) ? p.fileUrl : '',
    state: p.state, at: String(p.approvedAt || p.createdAt).slice(0, 16), by: p.createdBy === 'system' ? '雲端檔案更新' : nameOf_(p.createdBy),
    acked: mine.some(function (a) { return a.account === me.account; }) };
  if (isDirector_(me)) {
    const done = {}; mine.forEach(function (a) { done[a.account] = 1; });
    v.ackN = audience.filter(function (x) { return done[x.account]; }).length; v.ackTotal = audience.length;
    v.waiting = audience.filter(function (x) { return !done[x.account]; }).map(function (x) { return x.name; });
  }
  return v;
}
function postsList_(me) {
  const acks = Store.rows('postacks');
  const audience = Store.rows('people').filter(function (p) { return yes_(p.active) && p.role !== 'director'; });
  const all = Store.rows('posts').slice().sort(function (a, b) { return String(b.approvedAt || b.createdAt).localeCompare(String(a.approvedAt || a.createdAt)); });
  const view = function (p) { return postView_(p, me, acks, audience); };
  const out = { cats: Object.keys(POST_CATS), canDraft: true, canApprove: isDirector_(me),
    posts: all.filter(function (p) { return p.state === '已公告'; }).slice(0, 80).map(view) };
  out.unread = out.posts.filter(function (p) { return !p.acked; }).length;
  if (isDirector_(me)) out.pending = all.filter(function (p) { return p.state === '待核定'; }).map(view);
  else out.mine = all.filter(function (p) { return p.createdBy === me.account && p.state !== '已公告'; }).slice(0, 20).map(view);
  return out;
}
function postAdd_(me, d) {
  if (!POST_CATS[d.cat]) fail_('請選擇公告類別');
  const title = str_(d.title, 80), body = str_(d.body, 3000), url = str_(d.fileUrl, 500);
  if (!title) fail_('請填寫標題');
  if (url && !/^https:\/\//.test(url)) fail_('檔案連結必須是 https:// 開頭');
  const now = nowStamp_(), publish = isDirector_(me) && !!d.publish;
  withLock_(function () {
    Store.append('posts', { id: uid_('P'), cat: d.cat, title: title, body: body, fileId: '', fileName: '', fileUrl: url, fileUpdated: '',
      state: publish ? '已公告' : '待核定', createdAt: now, createdBy: me.account, approvedAt: publish ? now : '', approvedBy: publish ? me.account : '' });
  });
  audit_(me.account, 'post.add', d.cat + ' ' + title + (publish ? '（直接公告）' : ''));
  return { published: publish };
}
function postDecide_(me, d) {
  if (!isDirector_(me)) fail_('只有營運總監可以核定公告', 'forbidden');
  const p = Store.rows('posts').filter(function (x) { return x.id === str_(d.id, 40); })[0];
  if (!p || p.state !== '待核定') fail_('找不到這則待核定的公告');
  const patch = d.approve ? { state: '已公告', approvedAt: nowStamp_(), approvedBy: me.account } : { state: '退回', approvedAt: '', approvedBy: me.account };
  if (d.approve) { const t = str_(d.title, 80), b = str_(d.body, 3000); if (t) patch.title = t; if (d.body !== undefined) patch.body = b; }
  withLock_(function () { Store.update('posts', p._row, patch); });
  audit_(me.account, d.approve ? 'post.approve' : 'post.reject', p.id);
  return {};
}
function postAck_(me, d) {
  const id = str_(d.id, 40);
  const p = Store.rows('posts').filter(function (x) { return x.id === id && x.state === '已公告'; })[0];
  if (!p) fail_('找不到這則公告');
  if (!Store.rows('postacks').some(function (a) { return a.postId === id && a.account === me.account; }))
    withLock_(function () { Store.append('postacks', { postId: id, account: me.account, at: nowStamp_() }); });
  return {};
}

/** 掃描三個公告資料夾：上次掃描之後有更新的檔案，各產生一則「待核定」。第一次掃描只記下時間，不補發舊檔。 */
function scanPostFolders_() {
  const props = PropertiesService.getScriptProperties();
  let made = 0;
  Object.keys(POST_CATS).forEach(function (cat) {
    const fid = prop_(POST_CATS[cat]);
    if (!fid) return;
    const key = POST_CATS[cat] + '_SEEN', since = Number(prop_(key) || 0), now = Date.now();
    try {
      if (since) {
        const known = {}; Store.rows('posts').forEach(function (p) { if (p.fileId) known[p.fileId + '|' + p.fileUpdated] = 1; });
        const walk = function (folder, depth) {
          const it = folder.getFiles();
          while (it.hasNext() && made < 40) {
            const f = it.next(), up = f.getLastUpdated().getTime();
            if (up <= since) continue;
            const stamp = String(up);
            if (known[f.getId() + '|' + stamp]) continue;
            Store.append('posts', { id: uid_('P'), cat: cat, title: cut_('檔案更新：' + f.getName(), 80), body: '', fileId: f.getId(), fileName: f.getName(), fileUrl: f.getUrl(), fileUpdated: stamp,
              state: '待核定', createdAt: nowStamp_(), createdBy: 'system', approvedAt: '', approvedBy: '' });
            made++;
          }
          if (depth < 3) { const sub = folder.getFolders(); while (sub.hasNext()) walk(sub.next(), depth + 1); }
        };
        walk(DriveApp.getFolderById(fid), 0);
      }
      props.setProperty(key, String(now));
    } catch (e) { console.error(cat + '公告資料夾讀取失敗：' + e.message); }
  });
  return made;
}
