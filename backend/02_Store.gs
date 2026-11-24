/**
 * Google Sheets 資料存取。
 * 所有欄位一律以「純文字」存放（Setup 會把整張表設成文字格式），
 * 避免 Sheets 把 2026-11-02 這種字串自動轉成日期物件而比對失敗。
 */
const Store = (function () {
  let book = null;
  const cache = {};

  function ss() {
    if (!book) {
      const id = prop_('DATA_SHEET_ID');
      book = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
      if (!book) fail_('找不到資料表，請先設定指令碼屬性 DATA_SHEET_ID', 'config');
    }
    return book;
  }
  function sheet(tab) {
    const sh = ss().getSheetByName(tab);
    if (!sh) fail_('資料表缺少分頁「' + tab + '」，請先執行 setup()', 'config');
    return sh;
  }
  function norm(v) {
    if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
    return v === null || v === undefined ? '' : v;
  }
  function ser(v) {
    if (v === undefined || v === null) return '';
    if (typeof v === 'boolean') return v ? 'Y' : '';
    if (typeof v === 'object') return JSON.stringify(v);
    const s = String(v);
    // 開頭是 = + - @ 的文字前面加單引號，Sheets 會當純文字存，不會被當成公式執行
    return /^[=+\-@]/.test(s) ? "'" + s : s;
  }
  function head(sh) { return sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0].map(String); }

  /**
   * 讀出整個分頁，每列是一個物件，_row 是試算表列號。
   * 為了速度，讀過的分頁會暫存 5 分鐘；任何經由程式的寫入都會立刻清掉暫存。
   * （直接在試算表上手動改資料，最慢 5 分鐘後生效。）
   */
  const keys = {};
  function sc() { return CacheService.getScriptCache(); }
  function remember(tab, out) { const k = {}; out.forEach(function (o) { k[o._row] = o.__k; delete o.__k; }); keys[tab] = k; }
  function rows(tab) {
    if (cache[tab]) return cache[tab];
    let out = null;
    const hit = sc().get('tab:' + tab);
    if (hit) { try { out = JSON.parse(hit); } catch (e) { out = null; } }
    if (!out) {
      const vals = sheet(tab).getDataRange().getValues();
      const h = vals[0].map(String);
      out = [];
      for (let i = 1; i < vals.length; i++) {
        if (vals[i].join('') === '') continue;
        const o = { _row: i + 1, __k: String(norm(vals[i][0])) };
        for (let c = 0; c < h.length; c++) o[h[c]] = norm(vals[i][c]);
        out.push(o);
      }
      const json = JSON.stringify(out);
      if (json.length < 95000) { try { sc().put('tab:' + tab, json, 300); } catch (e) { /* 太大就不暫存 */ } }
    }
    remember(tab, out);
    cache[tab] = out;
    return out;
  }
  function invalidate(tab) { delete cache[tab]; delete keys[tab]; try { sc().remove('tab:' + tab); } catch (e) { /* 忽略 */ } }
  /** 暫存的列號可能因為有人手動刪列而對不上：寫入前先核對第一欄，對不上就請使用者重試，絕不寫錯列。 */
  function guard(tab, row, actual) {
    const k = keys[tab];
    if (k && k[row] !== undefined && String(norm(actual)) !== k[row]) { invalidate(tab); fail_('資料剛被更新，請再操作一次', 'retry'); }
  }
  function append(tab, obj) {
    const sh = sheet(tab);
    sh.appendRow(head(sh).map(function (k) { return ser(obj[k]); }));
    invalidate(tab);
  }
  function update(tab, row, patch) {
    const sh = sheet(tab);
    const h = head(sh);
    const rng = sh.getRange(row, 1, 1, h.length);
    const cur = rng.getValues()[0].map(norm);
    guard(tab, row, cur[0]);
    h.forEach(function (k, i) { if (Object.prototype.hasOwnProperty.call(patch, k)) cur[i] = ser(patch[k]); });
    rng.setValues([cur]);
    invalidate(tab);
  }
  function remove(tab, row) { const sh = sheet(tab); guard(tab, row, sh.getRange(row, 1, 1, 1).getValues()[0][0]); sh.deleteRow(row); invalidate(tab); }
  function reset() { Object.keys(TABS).forEach(invalidate); book = null; }

  return { rows: rows, append: append, update: update, remove: remove, ss: ss, reset: reset };
})();

/** 寫入類操作一律包在鎖裡，避免兩個人同時寫入互相覆蓋。 */
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function audit_(account, action, detail) {
  try { Store.append('log', { at: nowStamp_(), account: account, action: action, detail: str_(detail, 500) }); } catch (e) { /* 稽核紀錄失敗不影響主流程 */ }
}
