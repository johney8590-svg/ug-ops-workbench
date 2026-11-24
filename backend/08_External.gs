/**
 * 既有三套系統（修繕進度、物料異常回報、文宣申請）的未結案案件 —— 只讀不寫。
 * 工作台把它們當成待辦顯示在門市頁、晨報與待辦清單；要處理仍回到原系統。
 * 結果暫存 45 分鐘，warmCache 每次執行會重新整理。
 */
const EXT_SYSTEMS = {
  '修繕':     { sys: '修繕系統',     url: 'https://johney8590-svg.github.io/ug-repair-web/' },
  '物料異常': { sys: '物料異常系統', url: 'https://johney8590-svg.github.io/store-anomaly-report-web/' },
  '文宣':     { sys: '文宣申請系統', url: 'https://johney8590-svg.github.io/promo-apply-web/' }
};

function extStamp_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd HH:mm:ss');
  const t = String(v == null ? '' : v).trim();
  if (/^\d{4}-\d{2}-\d{2}T/.test(t)) { const d = new Date(t); if (!isNaN(d.getTime())) return Utilities.formatDate(d, TZ, 'yyyy-MM-dd HH:mm:ss'); }
  const d = normDate_(t, '');
  return d ? d + ' 00:00:00' : '';
}
function extTab_(id, name) {
  const sh = SpreadsheetApp.openById(id).getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  const vals = sh.getDataRange().getValues(), h = vals[0].map(function (x) { return String(x).trim(); });
  return vals.slice(1).map(function (r) { const o = {}; h.forEach(function (k, i) { if (k) o[k] = r[i]; }); return o; });
}
function cut_(s, n) { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function promoItems_(v) {
  const j = J_(v, null);
  if (Array.isArray(j)) return j.map(function (x) { return typeof x === 'string' ? x : (x && (x.name || x.item || x.title)) || ''; }).filter(String).join('、');
  return String(v == null ? '' : v);
}

function readExternal_() {
  const out = [];
  const push = function (source, id, created, store, dept, text, status) {
    const at = extStamp_(created);
    if (!id || !store || !at) return;
    out.push({ id: String(id), createdAt: at, store: String(store).trim(), source: source, dept: dept || SOURCES[source].dept, text: cut_(text, 90), status: status,
      by: '門市', photoId: '', notes: '', nudgedAt: '', closedAt: '', closedBy: '', ext: 'Y' });
  };
  const safe = function (label, prop, fn) {
    const id = prop_(prop);
    if (!id) return;
    try { fn(id); } catch (e) { console.error(label + '讀取失敗：' + e.message); }
  };
  safe('修繕系統', 'REPAIR_SHEET_ID', function (id) {
    extTab_(id, 'repairs').forEach(function (r) {
      if (String(r.status).trim() === '已結案') return;
      push('修繕', r.id, r.createdAt || r.occurDate, r.store, String(r.handleUnit || '').trim(), [r.equipment, r.description].filter(String).join('：'), String(r.status).trim() || '待處理');
    });
  });
  safe('物料異常系統', 'ANOMALY_SHEET_ID', function (id) {
    const name = { pend: '待處理', doing: '處理中', supp: '待補件' };
    extTab_(id, 'cases').forEach(function (r) {
      const st = String(r.status).trim();
      if (st === 'done' || !name[st]) return;
      push('物料異常', r.caseNo, r.createdAt || r.date, r.store, '', [r.mat, r.cls].filter(String).join(' ') + (r.desc ? '：' + r.desc : ''), name[st]);
    });
  });
  safe('文宣申請系統', 'PROMO_SHEET_ID', function (id) {
    const name = { '0': '待處理', '1': '設計中' };
    extTab_(id, 'cases').forEach(function (r) {
      const st = String(r.status).trim();
      if (!name[st]) return;
      push('文宣', r.caseNo, r.createdAt || r.applyDate, r.store, '', '文宣申請：' + promoItems_(r.items), name[st]);
    });
  });
  return out;
}

let extMemo_ = null;
function externalTodos_() {
  if (extMemo_) return extMemo_;
  if (!prop_('REPAIR_SHEET_ID') && !prop_('ANOMALY_SHEET_ID') && !prop_('PROMO_SHEET_ID')) return (extMemo_ = []);
  const cache = CacheService.getScriptCache();
  const hit = cache.get('ext:todos');
  let list = null;
  if (hit) { try { list = JSON.parse(hit); } catch (e) { list = null; } }
  if (!list) { list = readExternal_(); putExternal_(list); }
  // 門市名稱對回主檔的寫法（差一個「店」字或空白也算同一間）
  const byNorm = {};
  activeStores_().forEach(function (s) { byNorm[normStore_(s.store)] = s.store; });
  list.forEach(function (t) { const m = byNorm[normStore_(t.store)]; if (m) t.store = m; });
  extMemo_ = list;
  return list;
}
function putExternal_(list) {
  const json = JSON.stringify(list);
  if (json.length < 95000) { try { CacheService.getScriptCache().put('ext:todos', json, 2700); } catch (e) { /* 忽略 */ } }
}
/** 工作台自己的待辦＋既有系統的未結案案件。 */
function allTodos_() { return Store.rows('todos').concat(externalTodos_()); }
