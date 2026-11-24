/**
 * 本機模擬 Google Apps Script 執行環境，用來在電腦上直接執行 backend/*.gs 做測試。
 * 只模擬這個專案用到的 API；資料存在記憶體裡，重開就清空。
 */
const vm = require('vm'), fs = require('fs'), path = require('path'), crypto = require('crypto');

const lit = x => (typeof x === 'string' && x[0] === "'" ? x.slice(1) : x);   // Sheets 會吃掉開頭的單引號
function makeSheet(name) {
  const rows = [];
  const width = () => rows.reduce((m, r) => Math.max(m, r.length), 0);
  const cell = (r, c) => (rows[r] && rows[r][c] !== undefined ? rows[r][c] : '');
  return {
    _rows: rows, getName: () => name, getSheetId: () => 0,
    getLastColumn: width, getLastRow: () => rows.length, getMaxRows: () => 1000, getMaxColumns: () => 26,
    getDataRange() { const w = Math.max(1, width()); return { getValues: () => (rows.length ? rows : [[]]).map(r => Array.from({ length: w }, (_, c) => (r[c] === undefined ? '' : r[c]))) }; },
    getRange(r, c, nr, nc) {
      nr = nr || 1; nc = nc || 1;
      return {
        getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => cell(r - 1 + i, c - 1 + j))),
        setValues(v) { v.forEach((line, i) => { while (rows.length < r + i) rows.push([]); line.forEach((x, j) => { rows[r - 1 + i][c - 1 + j] = lit(x); }); }); return this; },
        setNumberFormat() { return this; }
      };
    },
    appendRow(a) { rows.push(a.map(lit)); }, deleteRow(n) { rows.splice(n - 1, 1); }, setFrozenRows() {}
  };
}
function makeBook() {
  const sheets = {};
  return { _sheets: sheets, getSheets: () => Object.values(sheets), getSheetByName: n => sheets[n] || null, insertSheet(n) { sheets[n] = makeSheet(n); return sheets[n]; } };
}

function load(opts) {
  opts = opts || {};
  const books = { DATA: makeBook(), DASH: makeBook(), MASTER: makeBook(), REPAIR: makeBook(), ANOMALY: makeBook(), PROMO: makeBook() };
  const props = Object.assign({ DATA_SHEET_ID: 'DATA', DASHBOARD_SHEET_ID: 'DASH' }, opts.props || {});
  const cache = {}, files = {}, mails = [];
  const pad = n => ('0' + n).slice(-2);
  const sandbox = {
    console,
    SpreadsheetApp: { openById(id) { if (!books[id]) throw new Error('no such spreadsheet'); return books[id]; }, getActiveSpreadsheet: () => books.DATA, getUi() { throw new Error('no ui'); } },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty(k, v) { props[k] = v; } }) },
    CacheService: { getScriptCache: () => ({ get: k => (k in cache ? cache[k] : null), put(k, v) { cache[k] = String(v); }, remove(k) { delete cache[k]; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: { MimeType: { JSON: 'application/json', ICAL: 'text/calendar', TEXT: 'text/plain' },
      createTextOutput(s) { return { content: s, mime: 'text/plain', setMimeType(m) { this.mime = m; return this; }, getContent() { return this.content; } }; } },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest(alg, s) { return Array.from(crypto.createHash('sha256').update(String(s), 'utf8').digest()).map(b => (b > 127 ? b - 256 : b)); },
      getUuid: () => crypto.randomUUID(),
      formatDate(d, tz, fmt) {
        const t = new Date(d.getTime() + 8 * 3600e3);   // Asia/Taipei 固定 UTC+8
        return fmt.replace('yyyy', t.getUTCFullYear()).replace('MM', pad(t.getUTCMonth() + 1)).replace('dd', pad(t.getUTCDate()))
          .replace('HH', pad(t.getUTCHours())).replace('mm', pad(t.getUTCMinutes())).replace('ss', pad(t.getUTCSeconds()));
      },
      base64Decode: s => Array.from(Buffer.from(s, 'base64')), base64Encode: b => Buffer.from(b).toString('base64'),
      newBlob: (bytes, type, name) => ({ bytes, type, name })
    },
    DriveApp: {
      getFolderById(id) { if (id !== props.PHOTO_FOLDER_ID) throw new Error('no folder'); return { createFile(blob) { const fid = 'F' + crypto.randomUUID(); files[fid] = blob; return { getId: () => fid }; } }; },
      getFileById(id) { const b = files[id]; if (!b) throw new Error('no file'); return { getBlob: () => ({ getContentType: () => b.type, getBytes: () => b.bytes }) }; }
    },
    MailApp: { sendEmail(to, subject, body) { mails.push({ to, subject, body }); } },
    ScriptApp: { getService: () => ({ getUrl: () => opts.url || 'https://script.google.com/macros/s/DEV/exec' }) }
  };
  const dir = path.join(__dirname, '..', 'backend');
  const src = fs.readdirSync(dir).filter(f => f.endsWith('.gs')).sort().map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n;\n') +
    '\n;globalThis.__gas = { doPost, doGet, setup, issuePasswords, importStores, resetPassword, Store, hashPw_, computeMetrics_ };';
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'backend.gs' });
  return { gas: sandbox.__gas, books, props, cache, files, mails };
}
module.exports = { load };
