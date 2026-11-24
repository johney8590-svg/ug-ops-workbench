/** 示範資料：18 間門市、六位督導、約四個月的逐日營收。全部是假資料。 */
const TODAY = '2026-11-24';
const SUPS = ['jill', 'joyce', 'lydia', 'diana', 'ivory', 'benson'];
const STORES = [
  ['台北信義店', '北一區', 'jill'], ['台北南京店', '北一區', 'jill'], ['台北公館店', '北一區', 'jill'],
  ['板橋府中店', '北二區', 'joyce'], ['新莊幸福店', '北二區', 'joyce'], ['三重正義店', '北二區', 'joyce'],
  ['桃園中正店', '桃竹區', 'lydia'], ['中壢中原店', '桃竹區', 'lydia'], ['新竹巨城店', '桃竹區', 'lydia'],
  ['台中逢甲店', '中區', 'diana'], ['台中一中店', '中區', 'diana'], ['彰化中山店', '中區', 'diana'],
  ['台南成大店', '南區', 'ivory'], ['高雄巨蛋店', '南區', 'ivory'], ['高雄文化店', '南區', 'ivory'],
  ['香港旺角店', '香港', 'benson'], ['香港銅鑼灣店', '香港', 'benson'], ['香港荃灣店', '香港', 'benson']
];
const add = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);

function seed(env, opts) {
  opts = opts || {};
  const { gas, books, props } = env;
  props.TEST_TODAY = TODAY;
  // 儀表板逐日資料
  const dash = books.DASH.insertSheet('data');
  dash.appendRow(['store', 'date', 'revenue', 'zone']);
  STORES.forEach(([s, z], i) => {
    const base = 26000 + (i * 7919) % 14000;
    for (let d = '2026-08-01'; d < TODAY; d = add(d, 1)) {
      const w = new Date(d + 'T00:00:00Z').getUTCDay();
      let v = base * [1.25, 0.9, 0.92, 0.95, 1.0, 1.15, 1.3][w] * (1 + (((i * 31 + Date.parse(d) / 864e5) * 7) % 11 - 5) / 100);
      if (d >= '2026-11-01') v *= 1.06;
      if (s === '台北公館店' && d >= '2026-11-02') v *= d >= '2026-11-16' ? 0.72 : d >= '2026-11-09' ? 0.85 : 0.95;   // 連續下滑
      if (s === '板橋府中店' && d >= '2026-11-17') v *= 0.8;                                                           // 落後區域
      dash.appendRow([s, d, Math.round(v), z]);
    }
  });
  gas.setup();
  gas.Store.reset();
  STORES.forEach(([s, z, sup]) => gas.Store.append('stores', { store: s, zone: z, supervisor: sup, type: '加盟', active: 'Y' }));
  gas.Store.append('specials', { store: '台北信義店', date: '2026-10-10', amount: '15000', note: '國慶活動' });
  gas.Store.append('qsc', { store: '台北信義店', date: '2026-11-12', score: '86', by: '訓練部', fails: '茶湯濃度紀錄、冰箱溫度紀錄' });
  gas.Store.rows('people').slice().forEach(p => gas.Store.update('people', p._row, { email: p.account + '@example.com' }));
  if (opts.passwords !== false) {
    // 示範用：所有帳號密碼都是 ugdemo1234（正式環境請用 issuePasswords 產生隨機密碼）
    gas.Store.rows('people').slice().forEach(p => gas.Store.update('people', p._row, { salt: 's-' + p.account, pwHash: gas.hashPw_('s-' + p.account, 'ugdemo1234'), mustChange: '' }));
  }
  if (opts.sample !== false) {
    const S = gas.Store;
    const todo = (id, days, store, source, dept, text, status) => S.append('todos', { id, createdAt: add(TODAY, -days) + ' 10:00:00', store, source, dept, text, status, by: STORES.find(x => x[0] === store)[2], photoId: '', notes: [], nudgedAt: '', closedAt: '', closedBy: '' });
    todo('RP-demo01', 12, '台北信義店', '修繕', '工務', '製冰機出冰量不足', '處理中');
    todo('MA-demo02', 2, '台北信義店', '物料異常', '採購', '鮮乳少送 2 箱', '待受理');
    todo('PR-demo03', 6, '台北南京店', '文宣', '行銷', '冬季新品海報未到', '待受理');
    todo('RP-demo04', 3, '板橋府中店', '修繕', '工務', '招牌燈不亮', '待受理');
    todo('MA-demo05', 5, '香港旺角店', '物料異常', '採購', '杯蓋到貨破損', '待受理');
    const visit = (id, days, who, store, mode, kind, extra) => S.append('visits', Object.assign({ id, date: add(TODAY, -days), time: '14:30', who, store, mode, kind, slot: '', shotTime: '', pass: '', checks: {}, note: '', talk: '', fb: '', nudges: [], todos: [], createdAt: add(TODAY, -days) + ' 14:30:00' }, extra));
    visit('V-demo01', 1, 'jill', '台北信義店', '現場', '巡店', { talk: '確認冬季新品備料與陳列', fb: '希望海報早點到' });
    visit('V-demo02', 1, 'jill', '台北南京店', '遠端', '監視器抽查', { slot: '開班', shotTime: '10:20', time: '10:20', pass: 'Y', checks: { '煮茶機標定': 'ok', '茶飲機開班潤洗': 'ok', '茶飲機標定': 'ok' } });
    visit('V-demo03', 9, 'jill', '台北公館店', '遠端', '電話', { talk: '了解近期業績下滑原因，附近新開競品' });
    visit('V-demo04', 20, 'joyce', '板橋府中店', '現場', '巡店', { talk: '例行巡店' });
    const ev = (id, who, start, end, type, place) => S.append('events', { id, who, start, end, type, place, todoId: '', createdBy: 'robert', updatedAt: add(TODAY, -3) + ' 09:00:00' });
    ev('E-demo01', 'jill', TODAY, TODAY, '巡店', '台北公館店');
    ev('E-demo02', 'jill', add(TODAY, 2), add(TODAY, 2), '巡店', '台北南京店');
    ev('E-demo03', 'jill', add(TODAY, 7), add(TODAY, 7), '巡店', '台北信義店');
    ev('E-demo04', 'joyce', TODAY, TODAY, '請假', '特休');
    ev('E-demo05', 'lydia', add(TODAY, 1), add(TODAY, 3), '訓練', '加盟主訓練（總部）');
    ev('E-demo06', 'gongwu', TODAY, TODAY, '外出', '台北信義店 製冰機維修');
  }
  gas.Store.reset();
  return env;
}
module.exports = { seed, TODAY, STORES, SUPS };
