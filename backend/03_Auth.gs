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

function activeStores_() { return Store.rows('stores').filter(function (s) { return yes_(s.active); }); }
/** 這個人可以看的門市：總監看全部，督導看自己負責的，部門窗口看全部（只用於待辦）。 */
function storesFor_(me) {
  const all = activeStores_();
  if (isSupervisor_(me)) return all.filter(function (s) { return s.supervisor === me.account; });
  return all;
}
function assertStore_(me, store) {
  const ok = storesFor_(me).some(function (s) { return s.store === store; });
  if (!ok) fail_('你沒有這間門市的權限', 'forbidden');
}
