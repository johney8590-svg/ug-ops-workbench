/** 後端測試：直接執行 backend/*.gs（透過 gas-shim），驗證流程與權限。node dev/test-api.js */
const { load } = require('./gas-shim'), { seed, TODAY } = require('./seed');
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('  ✗ ' + name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 400)); } };
const env = seed(load({ props: { PHOTO_FOLDER_ID: 'PHOTOS', NOTIFY_EMAIL: 'on' } }));
const call = (action, data, token) => JSON.parse(env.gas.doPost({ postData: { contents: JSON.stringify({ action, data, token }) } }).content);
const login = a => call('login', { account: a, password: 'ugdemo1234' }).data.token;

// --- 登入 ---
let r = call('login', { account: 'jill', password: 'wrong' });
ok(!r.ok && r.code === 'auth_failed', '錯誤密碼被拒', r);
r = call('home', {}, 'bogus'); ok(!r.ok && r.code === 'auth', '假 token 被拒', r);
r = call('home', {}); ok(!r.ok && r.code === 'auth', '沒有 token 被拒', r);
const jill = login('jill'), joyce = login('joyce'), robert = login('robert'), gongwu = login('gongwu'), caigou = login('caigou');
ok(jill && jill.length === 64, '登入取得 token');
ok(!JSON.stringify(env.books.DATA._sheets.sessions._rows).includes(jill), 'sessions 分頁不存明碼 token');
ok(!JSON.stringify(env.books.DATA._sheets.people._rows).includes('ugdemo1234'), 'people 分頁不存明碼密碼');
for (let i = 0; i < 5; i++) call('login', { account: 'ivory', password: 'x' });
r = call('login', { account: 'ivory', password: 'ugdemo1234' }); ok(!r.ok && r.code === 'throttled', '連續失敗 5 次後鎖定', r);

// --- 我的門市 ---
r = call('home', {}, jill);
ok(r.ok && r.data.cards.length === 3, '督導只看到自己的 3 間門市', r);
const card = n => r.data.cards.find(c => c.store === n);
ok(r.data.asOf === '2026-11-23', '營收資料截至昨天', r.data.asOf);
ok(card('台北公館店').m.down2 === true && card('台北公館店').m.need, '連兩週下滑被標為需關注', card('台北公館店'));
ok(card('台北公館店').today === true, '今日行程的門市有標記');
ok(card('台北信義店').late === 1 && card('台北信義店').open === 2, '逾期與待辦數正確', card('台北信義店'));
ok(card('台北南京店').cam.join() === '開班', '本週已完成的抽查時段', card('台北南京店').cam);
ok(card('台北信義店').m.yTarget > 0 && card('台北信義店').m.monthTarget > 0, '有暫行目標');
r = call('home', {}, joyce);
ok(r.data.cards.find(c => c.store === '板橋府中店').m.rel <= -10, '落後區域平均 10% 以上', r.data.cards.find(c => c.store === '板橋府中店').m);
ok(r.data.cards.find(c => c.store === '板橋府中店').days === 20, '未關心天數');
r = call('home', { as: 'jill' }, robert); ok(r.ok && r.data.cards.length === 3, '總監可預覽督導畫面');
r = call('home', { as: 'jill' }, gongwu); ok(!r.ok && r.code === 'forbidden', '部門窗口不能看我的門市', r);

// --- 門市頁與權限 ---
r = call('store', { store: '台北信義店' }, jill);
ok(r.ok && r.data.todos.length === 2 && r.data.qsc.score === 86 && r.data.qsc.fails.length === 2, '門市頁：待辦與 QSC', r);
ok(r.data.todos[0].late === true, '逾期排最前');
r = call('store', { store: '板橋府中店' }, jill); ok(!r.ok && r.code === 'forbidden', '督導不能看別人的門市', r);

// --- 訪店紀錄 ---
r = call('visit.add', { store: '台北信義店', mode: '現場' }, jill); ok(!r.ok, '空白紀錄被拒', r);
r = call('visit.add', { store: '台北信義店', mode: '現場', talk: '檢查製冰機，與店長確認備料', fb: '尖峰人手不足', nudges: ['RP-demo01', 'nope'] }, jill);
ok(r.ok && r.data.pass === false, '現場紀錄存檔', r);
r = call('visit.add', { store: '板橋府中店', mode: '現場', talk: 'x' }, jill); ok(!r.ok && r.code === 'forbidden', '不能幫別人的門市寫紀錄', r);
r = call('visit.add', { store: '台北南京店', mode: '遠端', kind: '監視器抽查', slot: '營業中', shotTime: '15:10', shotDate: TODAY, checks: { '每小時消毒作業': 'ok', '均質秒數': 'ng', '亂填': 'ok' }, note: '均質只有 5 秒' }, jill);
ok(r.ok && r.data.pass === true && r.data.cam.join() === '開班,營業中', '營業中抽查通過並累計', r);
r = call('visit.add', { store: '台北南京店', mode: '遠端', kind: '監視器抽查', slot: '閉店', shotTime: '15:10', shotDate: TODAY }, jill);
ok(r.ok && r.data.pass === false && /時段/.test(r.data.reason), '時間不在時段內不計入', r);
r = call('visit.add', { store: '台北南京店', mode: '遠端', kind: '監視器抽查', slot: '閉店', shotTime: '21:30', shotDate: '2026-11-20' }, jill);
ok(r.ok && r.data.pass === false && /本週/.test(r.data.reason), '上週的截圖不計入', r);
r = call('visit.add', { store: '台北南京店', mode: '遠端', kind: '監視器抽查', slot: '閉店', shotTime: '21:30', shotDate: '2026-11-23' }, jill);
ok(r.ok && r.data.pass === true && r.data.cam.length === 3, '三個時段都完成', r);

// --- 回報、去重、催辦 ---
r = call('todo.add', { store: '台北信義店', text: '鮮乳又少送一箱' }, jill);
ok(r.ok && r.data.dupes && r.data.dupes[0].id === 'MA-demo02' && r.data.source === '物料異常', '到貨問題自動歸類並提示已有單', r);
r = call('todo.append', { id: 'MA-demo02', text: '今天又少一箱' }, jill); ok(r.ok && r.data.todo.notes.length === 1, '補充到原單', r);
r = call('todo.add', { store: '台北信義店', text: '鮮乳又少送一箱', force: true }, jill); ok(r.ok && /^MA-/.test(r.data.todo.id), '確認後仍可另開新單', r);
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
r = call('todo.add', { store: '台北公館店', text: '冷藏冰箱門關不緊', photo: { type: 'image/png', data: png } }, jill);
ok(r.ok && /^RP-/.test(r.data.todo.id) && r.data.todo.dept === '工務' && r.data.todo.hasPhoto, '拍照回報開修繕單', r);
const newId = r.data.todo.id;
ok(env.mails.some(m => m.subject.includes('冷藏冰箱')), '通知處理單位');
r = call('photo.get', { id: newId }, jill); ok(r.ok && r.data.data === png, '照片可讀回', r);
r = call('photo.get', { id: newId }, joyce); ok(!r.ok && r.code === 'forbidden', '別的督導不能看照片', r);
r = call('photo.get', { id: newId }, caigou); ok(!r.ok && r.code === 'forbidden', '別的部門不能看照片', r);
r = call('todo.add', { store: '台北公館店', text: 'x', photo: { type: 'text/html', data: 'PGI+' }, force: true }, jill); ok(!r.ok, '非圖片檔被拒', r);
r = call('todo.nudge', { id: 'RP-demo01' }, jill); ok(r.ok && r.data.todo.nudgedToday, '催辦', r);
r = call('todo.nudge', { id: 'RP-demo04' }, jill); ok(!r.ok && r.code === 'forbidden', '不能催別人門市的單', r);
r = call('todo.status', { id: 'RP-demo01', status: '已完成' }, jill); ok(!r.ok && r.code === 'forbidden', '督導不能自己結案', r);
r = call('todo.status', { id: 'RP-demo01', status: '已完成' }, caigou); ok(!r.ok && r.code === 'forbidden', '別的部門不能結案', r);
r = call('todo.list', {}, gongwu); ok(r.ok && r.data.todos.every(t => t.dept === '工務') && r.data.todos.length === 3, '部門只看到自己的待辦', r.data && r.data.todos.length);
r = call('todo.status', { id: 'RP-demo01', status: '已完成', note: '已更換零件' }, gongwu); ok(r.ok && r.data.todo.status === '已完成', '處理單位結案', r);
r = call('todo.list', {}, jill); ok(r.ok && r.data.todos.every(t => /^台北/.test(t.store)), '督導只看到自己門市的待辦');

r = call('todo.append', { id: 'MA-demo02', text: '=HYPERLINK("http://x","點我")' }, jill);
ok(r.ok && r.data.todo.notes.slice(-1)[0].text.startsWith('=HYPERLINK'), '公式樣式的文字原樣保存為文字', r);
r = call('visit.add', { store: '台北信義店', mode: '遠端', kind: '電話', talk: '=1+1' }, jill);
ok(r.ok && env.gas.Store.rows('visits').some(v => v.talk === '=1+1'), '開頭為 = 的內容不會變成公式');
// --- 週誌 ---
r = call('journal.get', {}, jill);
ok(r.ok && r.data.week === '2026-11-23' && r.data.visits.length === 8, '週誌帶入本週紀錄', r.data && r.data.visits.length);
ok(/均質秒數/.test(r.data.draft.found) && /尖峰人手不足/.test(r.data.draft.found), '草稿含異常與店家反饋', r.data.draft.found);
ok(/已催工務/.test(r.data.draft.issue), '草稿含催辦', r.data.draft.issue);
ok(/台北南京店/.test(r.data.draft.plan) || /台北信義店/.test(r.data.draft.plan), '草稿含下週巡店', r.data.draft.plan);
r = call('journal.save', { send: true, found: '' }, jill); ok(!r.ok, '必填未填不能送出', r);
r = call('journal.save', { found: 'A', issue: 'B', plan: 'C', needs: '需要工務支援' }, jill); ok(r.ok && r.data.saved.state === '草稿', '存草稿', r);
r = call('journal.board', {}, robert); ok(r.ok && r.data.rows.find(x => x.account === 'jill').needs === '', '草稿內容總監看不到');
r = call('journal.save', { send: true, found: 'A', issue: 'B', plan: 'C', needs: '需要工務支援' }, jill); ok(r.ok && r.data.saved.state === '已送出', '送出', r);
r = call('journal.board', {}, jill); ok(!r.ok && r.code === 'forbidden', '督導不能看審閱總表', r);
r = call('journal.board', {}, robert); ok(r.ok && r.data.rows.length === 6 && r.data.rows.find(x => x.account === 'jill').state === '已送出', '總監審閱總表', r);
r = call('journal.get', { who: 'jill' }, robert); ok(r.ok && r.data.saved.needs === '需要工務支援', '總監讀週誌');
r = call('journal.ack', { who: 'jill', reply: '收到，週三討論' }, robert); ok(r.ok, '總監回覆', r);
r = call('journal.get', {}, jill); ok(r.data.saved.reply === '收到，週三討論' && r.data.saved.readAt, '督導看到回覆');
r = call('journal.get', { who: 'jill' }, joyce); ok(r.ok && r.data.who.account === 'joyce', '督導帶別人的帳號只會拿到自己的', r.data && r.data.who);

// --- 行程 ---
r = call('events.add', { type: '巡店', place: '台北信義店', start: '2026-11-27' }, jill); ok(r.ok && r.data.added === 1, '新增行程', r);
r = call('events.add', { type: '巡店', place: 'x', start: '2026-11-27', whos: ['joyce'] }, jill);
r = call('events.list', { from: '2026-11-27', to: '2026-11-27' }, robert);
ok(r.data.events.filter(e => e.who === 'joyce').length === 0 && r.data.events.filter(e => e.who === 'jill').length === 2, '非總監指定別人時只會排到自己', r.data.events);
r = call('events.add', { type: '訓練', place: '加盟主訓練', start: '2026-12-10', end: '2026-12-13', whos: ['jill', 'joyce', 'lydia'] }, robert); ok(r.ok && r.data.added === 3, '總監批次排程（連續多天一筆）', r);
r = call('events.add', { type: '會議', place: '週會', start: '2026-12-01', end: '2026-12-31', weekdays: [1], whos: ['jill', 'joyce'] }, robert); ok(r.ok && r.data.added === 8, '每週一重複', r);
r = call('events.add', { type: '跳舞', place: 'x', start: '2026-12-01' }, jill); ok(!r.ok, '不合法的類型被拒', r);
r = call('events.list', { from: TODAY, to: '2026-12-31' }, jill);
ok(r.ok && r.data.events.every(e => ['jill', 'joyce', 'lydia', 'diana', 'ivory', 'benson'].includes(e.who)), '督導看得到督導群的行程，看不到其他部門');
const mine = r.data.events.find(e => e.who === 'jill' && e.start === '2026-11-27');
const other = r.data.events.find(e => e.who === 'joyce');
r = call('events.delete', { id: other.id }, jill); ok(!r.ok && r.code === 'forbidden', '不能刪別人的行程', r);
r = call('events.update', { id: mine.id, type: '外出', place: '總部開會', start: '2026-11-28' }, jill); ok(r.ok, '修改自己的行程', r);
r = call('events.delete', { id: mine.id }, jill); ok(r.ok, '刪除自己的行程', r);

// --- 行事曆訂閱 ---
r = call('cal.url', {}, jill); const url = r.data.url; ok(r.ok && /\?cal=[0-9a-f]{64}$/.test(url), '取得訂閱網址');
ok(call('cal.url', {}, jill).data.url === url, '訂閱網址固定不變');
let ics = env.gas.doGet({ parameter: { cal: url.split('cal=')[1] } });
ok(ics.mime === 'text/calendar' && /BEGIN:VCALENDAR/.test(ics.content) && /加盟主訓練/.test(ics.content) && /DTSTART;VALUE=DATE:20261210\r\nDTEND;VALUE=DATE:20261214/.test(ics.content), 'ICS 內容正確（多日行程）', ics.content.slice(0, 300));
ok(!/特休/.test(ics.content), 'ICS 只有本人行程');
ok(env.gas.doGet({ parameter: { cal: 'a'.repeat(64) } }).mime === 'text/plain', '錯誤訂閱碼不回傳行程');
r = call('cal.reset', {}, jill); ok(r.ok && r.data.url !== url, '重設訂閱網址');
ok(env.gas.doGet({ parameter: { cal: url.split('cal=')[1] } }).mime === 'text/plain', '舊訂閱網址失效');

// --- 總監晨報 ---
r = call('brief', {}, jill); ok(!r.ok && r.code === 'forbidden', '督導不能看晨報', r);
r = call('brief', {}, robert);
ok(r.ok && r.data.kpi.stores === 18 && r.data.kpi.y > 0 && r.data.kpi.leave === 1, '晨報 KPI', r.data && r.data.kpi);
ok(r.data.need.some(x => x.store === '台北公館店') && r.data.need.some(x => x.store === '板橋府中店'), '晨報需關注門市', r.data.need.map(x => x.store));
ok(r.data.gap.some(x => x.store === '板橋府中店' && x.days === 20), '晨報未關心門市');
ok(r.data.kpi.jSent === 1 && r.data.kpi.jUnread === 0, '晨報週誌統計', r.data.kpi);

// --- 門市主檔連動（門店資料表_UG）---
{
  const e3 = seed(load({ props: { MASTER_SHEET_ID: 'MASTER' } }));
  const m = e3.books.MASTER.insertSheet('門店');
  m.appendRow(['門店資料表', '', '', '']);
  m.appendRow(['區域', '門 市', '直營/加盟', '督導']);
  m.appendRow(['北一', '台北信義', '直營', '劉靜蓮 Jill']);       // 沒有「店」字，要對得上儀表板的「台北信義店」
  m.appendRow(['北一', '台北信義', '加盟', '']);
  m.appendRow(['北一', '台北南京店', '加盟', '呂韋興 Robert']);
  m.appendRow(['北二', '板橋府中店', '加盟', '林凱琳 Liisa']);     // people 沒有這位
  const c3 = (action, data, token) => JSON.parse(e3.gas.doPost({ postData: { contents: JSON.stringify({ action, data, token }) } }).content);
  const tj = c3('login', { account: 'jill', password: 'ugdemo1234' }).data.token, tr = c3('login', { account: 'robert', password: 'ugdemo1234' }).data.token;
  r = c3('home', {}, tj);
  ok(r.ok && r.data.cards.length === 1 && r.data.cards[0].store === '台北信義' && r.data.cards[0].m && r.data.cards[0].m.y > 0, '主檔連動：督導門市來自主檔，名稱少一個店字也對得到營收', r);
  r = c3('store', { store: '台北南京店' }, tj); ok(!r.ok && r.code === 'forbidden', '主檔連動：不是自己的門市仍被拒', r);
  r = c3('brief', {}, tr);
  ok(r.ok && r.data.kpi.stores === 3 && r.data.unassigned.length === 1 && r.data.unassigned[0].supName === '林凱琳 Liisa', '主檔連動：對不到帳號的督導會列出來', r.data && r.data.unassigned);
  ok(r.data.supervisors.some(p => p.account === 'robert'), '主檔連動：總監自己有門市時可切換檢視');
  r = c3('home', { as: 'robert' }, tr); ok(r.ok && r.data.cards.length === 1 && r.data.cards[0].store === '台北南京店', '主檔連動：總監看自己負責的門市', r);
}

// --- 初始密碼流程 ---
const env2 = seed(load(), { passwords: false, sample: false });
env2.gas.issuePasswords();
const hand = env2.books.DATA._sheets['初始密碼']._rows;
ok(hand.length === 12, '每個帳號都有初始密碼', hand.length);
const c2 = (action, data, token) => JSON.parse(env2.gas.doPost({ postData: { contents: JSON.stringify({ action, data, token }) } }).content);
const row = hand.find(x => x[0] === 'jill');
r = c2('login', { account: 'jill', password: row[2] }); ok(r.ok && r.data.me.mustChange === true, '初始密碼可登入且需改密碼', r);
const t2 = r.data.token;
r = c2('home', {}, t2); ok(!r.ok && r.code === 'must_change', '未改密碼不能使用功能', r);
r = c2('password.change', { oldPassword: row[2], newPassword: 'short' }, t2); ok(!r.ok, '密碼太短被拒', r);
r = c2('password.change', { oldPassword: row[2], newPassword: 'newpassword1' }, t2); ok(r.ok, '改密碼', r);
r = c2('home', {}, t2); ok(r.ok, '改完可使用', r);
r = c2('logout', {}, t2); r = c2('home', {}, t2); ok(!r.ok && r.code === 'auth', '登出後 token 失效', r);
r = JSON.parse(env2.gas.doPost({ postData: { contents: 'not json' } }).content); ok(!r.ok, '壞掉的請求被拒');
r = c2('constructor', {}, c2('login', { account: 'jill', password: 'newpassword1' }).data.token); ok(!r.ok && r.code === 'bad_request', '不存在的操作被拒', r);

console.log(`\n${pass} 通過，${fail} 失敗`);
process.exit(fail ? 1 : 0);
