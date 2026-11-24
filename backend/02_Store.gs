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

  /** 讀出整個分頁，每列是一個物件，_row 是試算表列號。同一次請求內會快取。 */
  function rows(tab) {
    if (cache[tab]) return cache[tab];
    const vals = sheet(tab).getDataRange().getValues();
    const h = vals[0].map(String);
    const out = [];
    for (let i = 1; i < vals.length; i++) {
      if (vals[i].join('') === '') continue;
      const o = { _row: i + 1 };
      for (let c = 0; c < h.length; c++) o[h[c]] = norm(vals[i][c]);
      out.push(o);
    }
    cache[tab] = out;
    return out;
  }
  function append(tab, obj) {
    const sh = sheet(tab);
    sh.appendRow(head(sh).map(function (k) { return ser(obj[k]); }));
    delete cache[tab];
  }
  function update(tab, row, patch) {
    const sh = sheet(tab);
    const h = head(sh);
    const rng = sh.getRange(row, 1, 1, h.length);
    const cur = rng.getValues()[0].map(norm);
    h.forEach(function (k, i) { if (Object.prototype.hasOwnProperty.call(patch, k)) cur[i] = ser(patch[k]); });
    rng.setValues([cur]);
    delete cache[tab];
  }
  function remove(tab, row) { sheet(tab).deleteRow(row); delete cache[tab]; }
  function reset() { Object.keys(cache).forEach(function (k) { delete cache[k]; }); book = null; }

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
