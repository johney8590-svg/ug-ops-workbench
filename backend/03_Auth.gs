/**
 * 登入與權限。
 * 密碼只存加鹽後的 SHA-256 雜湊；登入憑證（token）也只存雜湊，
 * 即使有人看到試算表，也無法反推出密碼或冒用登入狀態。
 */
function sha_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}
function hashPw_(salt, pw) { return sha_(salt + ':' + pw); }
function newToken_() { return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ''); }

function person_(account) {
  return Store.rows('people').filter(function (p) { return p.account === account; })[0];
}
function publicPerson_(p) {
  return { account: p.account, name: p.name, role: p.role, dept: p.dept, mustChange: yes_(p.mustChange) };
}

function login_(d) {
  const account = str_(d.account, 60).toLowerCase();
  const pw = String(d.password || '');
  if (!account || !pw) fail_('請輸入帳號與密碼');
  const cache = CacheService.getScriptCache();
  const key = 'login:' + account;
  const tries = +(cache.get(key) || 0);
  if (tries >= 5) fail_('嘗試次數過多，請 15 分鐘後再試', 'throttled');
  const p = person_(account);
  if (!p || !yes_(p.active) || !p.pwHash || hashPw_(p.salt, pw) !== p.pwHash) {
    cache.put(key, String(tries + 1), 900);
    fail_('帳號或密碼不正確', 'auth_failed');
  }
  cache.remove(key);
  const token = newToken_();
  withLock_(function () {
    const now = Date.now();
    // 順手清掉過期的登入紀錄（由下往上刪，列號才不會跑掉）
    Store.rows('sessions').filter(function (s) { return +s.expires < now; })
      .sort(function (a, b) { return b._row - a._row; })
      .forEach(function (s) { Store.remove('sessions', s._row); });
    Store.append('sessions', { tokenHash: sha_(token), account: account, expires: String(now + SESSION_DAYS * 864e5) });
  });
  audit_(account, 'login', '');
  return { token: token, me: publicPerson_(p) };
}

function auth_(token) {
  if (!token || typeof token !== 'string') fail_('請先登入', 'auth');
  const h = sha_(token);
  const s = Store.rows('sessions').filter(function (x) { return x.tokenHash === h; })[0];
  if (!s || +s.expires < Date.now()) fail_('登入已過期，請重新登入', 'auth');
  const p = person_(s.account);
  if (!p || !yes_(p.active)) fail_('帳號已停用', 'auth');
  return p;
}

function logout_(token) {
  const h = sha_(String(token || ''));
  withLock_(function () {
    Store.rows('sessions').filter(function (x) { return x.tokenHash === h; })
      .sort(function (a, b) { return b._row - a._row; })
      .forEach(function (s) { Store.remove('sessions', s._row); });
  });
  return {};
}

function changePassword_(me, d) {
  const oldPw = String(d.oldPassword || ''), newPw = String(d.newPassword || '');
  if (hashPw_(me.salt, oldPw) !== me.pwHash) fail_('目前的密碼不正確', 'auth_failed');
  if (newPw.length < 8) fail_('新密碼至少 8 個字元');
  if (newPw === oldPw) fail_('新密碼不能和目前的密碼相同');
  const salt = Utilities.getUuid();
  withLock_(function () { Store.update('people', me._row, { salt: salt, pwHash: hashPw_(salt, newPw), mustChange: '' }); });
  audit_(me.account, 'password.change', '');
  return {};
}

function isDirector_(me) { return me.role === 'director'; }
function isSupervisor_(me) { return me.role === 'supervisor'; }

/** 門市名稱比對用：去空白、去掉字尾的「店」（各系統有的帶「店」有的沒有）。 */
function normStore_(s) { return String(s == null ? '' : s).replace(/\s+/g, '').replace(/店$/, ''); }

/**
 * 門市與負責督導。
 * 有設定 MASTER_SHEET_ID 時，直接讀共用的「門店資料表_UG」（修繕、文宣、物料異常三套系統用的同一份主檔），
 * 督導異動只要改主檔，這裡 10 分鐘內就會跟上；讀不到時退回本表的 stores 分頁。
 */
let storesMemo_ = null;
function activeStores_() {
  if (storesMemo_) return storesMemo_;
  let list = null;
  if (prop_('MASTER_SHEET_ID')) {
    const cache = CacheService.getScriptCache();
    const hit = cache.get('masterStores');
    if (hit) list = JSON.parse(hit);
    else {
      try { list = masterStores_(); cache.put('masterStores', JSON.stringify(list), 600); }
      catch (e) { console.error('讀取門店資料表失敗：' + e.message); list = null; }
    }
  }
  if (!list) list = Store.rows('stores').filter(function (s) { return yes_(s.active); })
    .map(function (s) { return { store: s.store, zone: s.zone, supervisor: s.supervisor, supName: '', type: s.type, active: 'Y' }; });
  storesMemo_ = list;
  return list;
}
/** 主檔督導欄（例如「劉靜蓮 Jill」）對到工作台帳號：people 分頁的 name 或 account 出現在該欄文字裡就算。 */
function accountOfSup_(text, people) {
  const t = String(text || '').toLowerCase().replace(/\s+/g, '');
  if (!t) return '';
  const hit = people.filter(function (p) {
    const n = String(p.name || '').toLowerCase().replace(/\s+/g, ''), a = String(p.account || '').toLowerCase();
    return (n && t.indexOf(n) >= 0) || (a && t.indexOf(a) >= 0);
  }).sort(function (x, y) { return String(y.name).length - String(x.name).length; })[0];
  return hit ? hit.account : '';
}
function masterStores_() {
  const ss = SpreadsheetApp.openById(prop_('MASTER_SHEET_ID'));
  const gid = Number(prop_('MASTER_SHEET_GID') || 0);
  const sh = ss.getSheets().filter(function (x) { return x.getSheetId() === gid; })[0] || ss.getSheets()[0];
  const vals = sh.getDataRange().getValues();
  let hr = -1, cStore = -1, cSup = -1, cRegion = -1, cType = -1;
  for (let i = 0; i < Math.min(vals.length, 12) && hr < 0; i++) {
    const row = vals[i].map(function (x) { return String(x == null ? '' : x).replace(/\s/g, ''); });
    const si = row.indexOf('門市'), pi = row.map(function (x) { return x.indexOf('督導') >= 0; }).indexOf(true);
    if (si >= 0 && pi >= 0) {
      hr = i; cStore = si; cSup = pi; cRegion = row.indexOf('區域');
      cType = row.map(function (x) { return x.indexOf('直營') >= 0 && x.indexOf('加盟') >= 0; }).indexOf(true);
    }
  }
  if (hr < 0) throw new Error('門店資料表找不到「門市」與「督導」欄位');
  const people = Store.rows('people').filter(function (p) { return yes_(p.active) && (p.role === 'supervisor' || p.role === 'director'); });
  const cell = function (r, c) { return c < 0 || vals[r][c] == null ? '' : String(vals[r][c]).replace(/\s+/g, ' ').trim(); };
  const out = [], idx = {};
  for (let r = hr + 1; r < vals.length; r++) {
    const name = cell(r, cStore);
    if (!name) continue;
    const sup = cell(r, cSup), type = cell(r, cType), key = normStore_(name);
    if (idx[key]) {                                        // 同門市有直營、加盟兩列時只留一筆
      if (sup && !idx[key].supName) { idx[key].supName = sup; idx[key].supervisor = accountOfSup_(sup, people); }
      if (type.indexOf('加盟') >= 0) idx[key].type = '加盟';
      continue;
    }
    const rec = { store: name, zone: cell(r, cRegion), supervisor: accountOfSup_(sup, people), supName: sup, type: type ? (type.indexOf('加盟') >= 0 ? '加盟' : '直營') : '', active: 'Y' };
    idx[key] = rec; out.push(rec);
  }
  if (!out.length) throw new Error('門店資料表沒有讀到任何門市');
  return out;
}
/** 這個人可以看的門市：營運經理看全部，督導看自己負責的，部門窗口看全部（只用於待辦）。 */
function storesFor_(me) {
  const all = activeStores_();
  if (isSupervisor_(me)) return all.filter(function (s) { return s.supervisor === me.account; });
  return all;
}
/** 能不能打開這間門市的門市頁、填訪店紀錄、回報待辦。督導也可以進別人的門市（去別人的店巡訪要能留紀錄，2026-11-27 決定）。 */
function assertStore_(me, store) {
  const ok = activeStores_().some(function (s) { return s.store === store; });
  if (!ok) fail_('你沒有這間門市的權限', 'forbidden');
}
