/**
 * 管理工具：只能由試算表擁有者在 Apps Script 編輯器或試算表選單執行，不對外開放。
 * 這份指令碼請從資料試算表的「擴充功能 → Apps Script」建立（綁定在試算表上）。
 */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('UG 工作台')
    .addItem('① 建立資料分頁', 'setup')
    .addItem('② 從儀表板帶入門市', 'importStores')
    .addItem('③ 產生初始密碼（尚未設定的帳號）', 'issuePasswords')
    .addSeparator()
    .addItem('重設某人的密碼', 'resetPasswordPrompt')
    .addItem('清除營收快取', 'clearMetricsCache')
    .addToUi();
}

/** 建立所有分頁與表頭，整張設成純文字格式。可重複執行，不會清掉既有資料。 */
function setup() {
  const ss = Store.ss();
  Object.keys(TABS).forEach(function (tab) {
    let sh = ss.getSheetByName(tab);
    if (!sh) sh = ss.insertSheet(tab);
    const cols = TABS[tab];
    sh.getRange(1, 1, sh.getMaxRows(), Math.max(cols.length, sh.getMaxColumns())).setNumberFormat('@');
    const have = sh.getRange(1, 1, 1, cols.length).getValues()[0].map(String);
    if (have.join('') === '') sh.getRange(1, 1, 1, cols.length).setValues([cols]);
    else cols.forEach(function (c, i) {
      if (have[i] === '') { sh.getRange(1, i + 1).setValue(c); return; }          // 新版多出來的欄位：補在最後面
      if (have[i] !== c) throw new Error('分頁「' + tab + '」第 ' + (i + 1) + ' 欄應為 ' + c + '，目前是 ' + have[i] + '。請手動確認後再執行。');
    });
    sh.setFrozenRows(1);
  });
  Store.reset();
  if (!Store.rows('people').length) {
    [['robert', 'Robert', 'director', '營運部'],
     ['jill', 'Jill', 'supervisor', '營運部'], ['joyce', 'Joyce', 'supervisor', '營運部'], ['lydia', 'Lydia', 'supervisor', '營運部'],
     ['diana', 'Diana', 'supervisor', '營運部'], ['ivory', 'Ivory', 'supervisor', '營運部'], ['benson', 'Benson', 'supervisor', '營運部'],
     ['gongwu', '工務窗口', 'dept', '工務'], ['caigou', '採購窗口', 'dept', '採購'], ['marketing', '行銷窗口', 'dept', '行銷'], ['houqin', '營運後勤窗口', 'dept', '營運後勤']
    ].forEach(function (r) { Store.append('people', { account: r[0], name: r[1], role: r[2], dept: r[3], email: '', active: 'Y' }); });
  }
  return '完成。請確認 people 分頁的名單，再執行「產生初始密碼」。';
}

/** 從營運儀表板的資料分頁帶入門市與區域；已存在的門市不會被覆蓋。督導欄請手動填上督導的帳號。 */
function importStores() {
  Store.reset();   // 從編輯器執行時一律重讀試算表，不用暫存
  const id = prop_('DASHBOARD_SHEET_ID');
  if (!id) throw new Error('請先設定指令碼屬性 DASHBOARD_SHEET_ID');
  const sh = SpreadsheetApp.openById(id).getSheetByName(prop_('DASHBOARD_TAB') || 'data');
  if (!sh) throw new Error('儀表板找不到資料分頁');
  const vals = sh.getDataRange().getValues();
  const h = vals[0].map(function (x) { return String(x).trim().toLowerCase(); });
  const iS = h.indexOf('store'), iZ = h.indexOf('zone');
  if (iS < 0) throw new Error('儀表板資料分頁沒有 store 欄');
  const have = {}; Store.rows('stores').forEach(function (s) { have[s.store] = 1; });
  let n = 0;
  for (let i = 1; i < vals.length; i++) {
    const name = String(vals[i][iS]).trim();
    if (!name || have[name]) continue;
    have[name] = 1; n++;
    Store.append('stores', { store: name, zone: iZ >= 0 ? String(vals[i][iZ]).trim() : '', supervisor: '', type: '', active: 'Y' });
  }
  return '新增 ' + n + ' 間門市。請在 stores 分頁的 supervisor 欄填上負責督導的帳號。';
}

function randomPassword_() {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // 去掉容易看錯的字
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Utilities.getUuid());
  let s = '';
  for (let i = 0; i < 10; i++) s += chars.charAt((bytes[i] & 0xff) % chars.length);
  return s;
}
function setPassword_(p, pw) {
  const salt = Utilities.getUuid();
  Store.update('people', p._row, { salt: salt, pwHash: hashPw_(salt, pw), mustChange: 'Y' });
  // 讓這個人原本的登入狀態全部失效
  Store.rows('sessions').filter(function (s) { return s.account === p.account; }).sort(function (a, b) { return b._row - a._row; })
    .forEach(function (s) { Store.remove('sessions', s._row); });
}
function handout_(rows) {
  const ss = Store.ss();
  let sh = ss.getSheetByName('初始密碼');
  if (!sh) { sh = ss.insertSheet('初始密碼'); sh.getRange(1, 1, sh.getMaxRows(), 4).setNumberFormat('@'); sh.getRange(1, 1, 1, 4).setValues([['account', 'name', '初始密碼', '產生時間']]); }
  rows.forEach(function (r) { sh.appendRow([r.account, r.name, r.pw, nowStamp_()]); });
}

/** 幫 people 分頁裡還沒有密碼的帳號產生隨機初始密碼，寫到「初始密碼」分頁。發給同仁後請把該分頁刪除。 */
function issuePasswords() {
  Store.reset();   // 從編輯器執行時一律重讀試算表，不用暫存
  const out = [];
  withLock_(function () {
    const todo = Store.rows('people').filter(function (p) { return p.account && !p.pwHash; });
    // 先全部檢查完再動手：中途才發現錯誤的話，前面幾個帳號會被設了密碼卻沒有留下紀錄
    todo.forEach(function (p) {
      if (ROLES.indexOf(p.role) < 0) throw new Error(p.account + ' 的 role 必須是 director、supervisor 或 dept');
      if (p.account !== String(p.account).toLowerCase()) throw new Error('帳號請用小寫：' + p.account);
    });
    todo.forEach(function (p) {
      const pw = randomPassword_();
      setPassword_(p, pw);
      out.push({ account: p.account, name: p.name, pw: pw });
    });
    if (out.length) handout_(out);
  });
  audit_('admin', 'password.issue', out.map(function (r) { return r.account; }).join(','));
  return '已產生 ' + out.length + ' 組初始密碼，請看「初始密碼」分頁。個別發給同仁後請刪除該分頁；同仁第一次登入會被要求改密碼。';
}

function resetPassword(account) {
  Store.reset();
  const p = person_(String(account || '').trim().toLowerCase());
  if (!p) throw new Error('找不到帳號');
  const pw = randomPassword_();
  withLock_(function () { setPassword_(p, pw); handout_([{ account: p.account, name: p.name, pw: pw }]); });
  audit_('admin', 'password.reset', p.account);
  return '已重設，新密碼在「初始密碼」分頁。';
}
/**
 * 把所有啟用中帳號的密碼一次設成同一組臨時密碼。
 * 密碼不寫在程式裡：先在「指令碼屬性」加一筆 TEMP_PASSWORD，再執行這個函式；執行完會自動把那筆屬性刪掉。
 * 所有人會被登出，第一次用臨時密碼登入時會被要求改成自己的密碼。
 */
function setAllPasswords() {
  Store.reset();
  const pw = String(prop_('TEMP_PASSWORD') || '');
  if (pw.length < 8) throw new Error('請先在指令碼屬性加上 TEMP_PASSWORD（至少 8 個字元）');
  let n = 0;
  withLock_(function () {
    Store.rows('people').filter(function (p) { return p.account && yes_(p.active); }).map(function (p) { return p.account; })
      .forEach(function (a) { setPassword_(person_(a), pw); n++; });
  });
  PropertiesService.getScriptProperties().deleteProperty('TEMP_PASSWORD');
  const sh = Store.ss().getSheetByName('初始密碼');
  if (sh && sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);   // 舊的初始密碼已經失效，清掉避免混淆
  audit_('admin', 'password.setall', n + ' 個帳號');
  console.log('已把 ' + n + ' 個帳號設成臨時密碼；每個人第一次登入都要改密碼。');
  return n;
}
function resetPasswordPrompt() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt('重設密碼', '請輸入帳號', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() === ui.Button.OK) ui.alert(resetPassword(r.getResponseText()));
}
function clearMetricsCache() { CacheService.getScriptCache().remove('metrics:' + today_()); return '已清除'; }

/** 自我檢查：在編輯器執行後看「執行記錄」。只印數量與對不上的名稱，不印任何密碼。 */
function checkSetup() {
  Store.reset();   // 從編輯器執行時一律重讀試算表，不用暫存
  const M = computeMetrics_(today_());
  console.log('營收資料：' + (M.asOf ? '更新到 ' + M.asOf + '，共 ' + Object.keys(M.stores).length + ' 間門市' : '讀不到（' + M.note + '）'));
  if (!M.asOf) {
    try {
      const sh = SpreadsheetApp.openById(prop_('DASHBOARD_SHEET_ID')).getSheetByName(prop_('DASHBOARD_TAB') || 'data');
      const v = sh.getRange(1, 1, 3, sh.getLastColumn()).getValues(), last = sh.getRange(sh.getLastRow(), 1, 1, sh.getLastColumn()).getValues()[0];
      const show = function (row) { return row.slice(0, 9).map(function (x) { return (x instanceof Date ? 'Date:' + x.toISOString() : typeof x + ':' + String(x)).slice(0, 40); }).join(' | '); };
      console.log('儀表板表頭：' + show(v[0])); console.log('第 2 列：' + show(v[1])); console.log('最後一列（第 ' + sh.getLastRow() + ' 列）：' + show(last));
    } catch (e) { console.log('儀表板讀取失敗：' + e.message); }
  }
  storesMemo_ = null; CacheService.getScriptCache().remove('masterStores');
  let stores;
  try { stores = prop_('MASTER_SHEET_ID') ? masterStores_() : activeStores_(); console.log('門市來源：' + (prop_('MASTER_SHEET_ID') ? '門店資料表（連動）' : 'stores 分頁') + '，共 ' + stores.length + ' 間'); }
  catch (e) { console.log('門店資料表讀取失敗：' + e.message); return; }
  const bySup = {}, noMetric = [];
  stores.forEach(function (s) { const k = s.supervisor || ('未對應：' + (s.supName || '主檔未填')); bySup[k] = (bySup[k] || 0) + 1; if (M.asOf && !mOf_(M, s.store)) noMetric.push(s.store); });
  Object.keys(bySup).sort().forEach(function (k) { console.log('  ' + k + '：' + bySup[k] + ' 間'); });
  console.log('主檔有、儀表板沒有營收的門市（' + noMetric.length + '）：' + noMetric.join('、'));
  try {
    const ext = readExternal_(), n = {}, known = {}, miss = {};
    stores.forEach(function (x) { known[normStore_(x.store)] = 1; });
    ext.forEach(function (t) { n[t.source] = (n[t.source] || 0) + 1; if (!known[normStore_(t.store)]) miss[t.store] = 1; });
    console.log('既有系統未結案：' + JSON.stringify(n) + '；門市名稱對不上主檔的：' + (Object.keys(miss).join('、') || '無') + '；暫存大小 ' + JSON.stringify(ext).length);
  } catch (e) { console.log('既有系統讀取失敗：' + e.message); }
  console.log('LINE 通知：' + (lineOn_() ? '已啟用，已綁定 ' + Store.rows('people').filter(function (p) { return p.lineId; }).length + ' 人' : '未啟用'));
  console.log('回報寫回原系統：' + (prop_('WRITEBACK') === 'on' ? '開啟' : '關閉') + '；公告資料夾：' + Object.keys(POST_CATS).filter(function (c) { return prop_(POST_CATS[c]); }).join('、') + '；QSC 最近一次同步：' + (prop_('QSC_LAST') || '尚無'));
  const people = Store.rows('people');
  console.log('帳號 ' + people.length + ' 個，其中已設定密碼 ' + people.filter(function (p) { return p.pwHash; }).length + ' 個');
}

/** 檢查三套既有系統的後台長什麼樣子：只印分頁名稱、表頭與各狀態的筆數，不印內容。 */
function checkSources() {
  [['修繕', 'REPAIR_SHEET_ID'], ['物料異常', 'ANOMALY_SHEET_ID'], ['文宣', 'PROMO_SHEET_ID']].forEach(function (x) {
    const id = prop_(x[1]);
    if (!id) { console.log(x[0] + '：尚未設定 ' + x[1]); return; }
    try {
      SpreadsheetApp.openById(id).getSheets().forEach(function (sh) {
        const lr = sh.getLastRow(), lc = sh.getLastColumn();
        if (!lr || !lc) { console.log(x[0] + '｜' + sh.getName() + '：空白'); return; }
        const h = sh.getRange(1, 1, 1, lc).getValues()[0].map(String);
        console.log(x[0] + '｜' + sh.getName() + '（' + lr + ' 列）表頭：' + h.join(', ').slice(0, 900));
        const si = h.map(function (k) { return /^(status|狀態)$/i.test(k.trim()) || k.indexOf('狀態') >= 0; }).indexOf(true);
        if (si >= 0 && lr > 1) {
          const cnt = {};
          sh.getRange(2, si + 1, lr - 1, 1).getValues().forEach(function (r) { const k = String(r[0]); cnt[k] = (cnt[k] || 0) + 1; });
          console.log('    「' + h[si] + '」各值筆數：' + JSON.stringify(cnt).slice(0, 600));
        }
      });
    } catch (e) { console.log(x[0] + '：讀取失敗 ' + e.message); }
  });
}
