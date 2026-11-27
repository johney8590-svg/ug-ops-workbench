/**
 * 既有三套系統（修繕進度、物料異常回報、文宣申請）的未結案案件 —— 只讀不寫。
 * 工作台把它們當成待辦顯示在門市頁、晨報與待辦清單；要處理仍回到原系統。
 * 結果暫存 45 分鐘，warmCache 每次執行會重新整理。
 */
const EXT_SYSTEMS = {
  '修繕':     { sys: '修繕系統',     front: 'https://johney8590-svg.github.io/ug-repair-web/',              adminProp: 'REPAIR_ADMIN_URL',  admin: '' },
  '物料異常': { sys: '物料異常系統', front: 'https://johney8590-svg.github.io/store-anomaly-report-web/',   adminProp: 'ANOMALY_ADMIN_URL', admin: 'https://johney8590-svg.github.io/store-anomaly-report-web/admin.html' },
  '文宣':     { sys: '文宣申請系統', front: 'https://johney8590-svg.github.io/promo-apply-web/',            adminProp: 'PROMO_ADMIN_URL',   admin: 'https://johney8590-svg.github.io/promo-apply-web/admin.html' }
};
/**
 * 連回原系統的網址。營運經理與處理單位拿到「管理用」網址；督導拿不到（督導不處理案件，管理網址也不該外流）。
 * 修繕系統的管理網址帶有管理金鑰，所以不寫在程式裡，請放在指令碼屬性 REPAIR_ADMIN_URL。
 */
let VIEWER_ = null;
function extUrl_(t) {
  const x = EXT_SYSTEMS[t.source];
  if (!x || !VIEWER_ || VIEWER_.role === 'supervisor') return '';
  let u = prop_(x.adminProp) || x.admin;
  if (!/^https:\/\//.test(String(u))) return '';
  if (t.source === '修繕') u += (u.indexOf('?') >= 0 ? '&' : '?') + 'case=' + encodeURIComponent(t.id);
  return u;
}

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

/**
 * 督導在工作台回報的修繕／物料異常，直接寫進原系統的後台（指令碼屬性 WRITEBACK=on 才會啟用）。
 * 案號照原系統的規則自動產生。注意：這樣寫入不會觸發原系統自己的 LINE／Email 通知，照片也不會帶過去
 * （照片留在工作台，案件上看得到）。
 */
function writeBackOn_(source) {
  return prop_('WRITEBACK') === 'on' && ((source === '修繕' && prop_('REPAIR_SHEET_ID')) || (source === '物料異常' && prop_('ANOMALY_SHEET_ID')));
}
function appendByHeader_(sh, obj) {
  const h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (x) { return String(x).trim(); });
  sh.appendRow(h.map(function (k) { const v = obj[k]; return v === undefined ? '' : (typeof v === 'string' && /^[=+\-@]/.test(v) ? "'" + v : v); }));
}
function writeBack_(me, source, store, text) {
  const s = activeStores_().filter(function (x) { return x.store === store; })[0] || {};
  const now = new Date(), iso = now.toISOString(), day = today_();
  let id = '';
  if (source === '修繕') {
    const sh = SpreadsheetApp.openById(prop_('REPAIR_SHEET_ID')).getSheetByName('repairs');
    if (!sh) fail_('修繕系統後台找不到 repairs 分頁');
    const used = {}; sh.getRange(1, 1, sh.getLastRow(), 1).getValues().forEach(function (r) { used[String(r[0])] = 1; });
    do { id = 'R' + day.replace(/-/g, '') + '-' + Math.floor(Math.random() * 9000 + 1000); } while (used[id]);
    appendByHeader_(sh, { id: id, createdAt: iso, store: store, supervisor: s.supName || me.name, occurDate: day, equipment: '其他', description: text, status: '待處理', handleUnit: '工務',
      progressNote: '', repairConfirm: '', closeDate: '', supervisorConfirm: '', robertNote: '',
      statusHistory: JSON.stringify([{ at: iso, by: '督導', from: '', to: '待處理', note: '營運工作台回報（' + me.name + '）' }]), updatedAt: iso, zone: '', equipNo: '', contact: me.name, phone: '' });
  } else {
    const sh = SpreadsheetApp.openById(prop_('ANOMALY_SHEET_ID')).getSheetByName('cases');
    if (!sh) fail_('物料異常系統後台找不到 cases 分頁');
    const prefix = store + day.replace(/-/g, '');
    let seq = 0; sh.getRange(1, 1, sh.getLastRow(), 1).getValues().forEach(function (r) { if (String(r[0]).indexOf(prefix) === 0) seq++; });
    id = prefix + ('00' + (seq + 1)).slice(-3);
    appendByHeader_(sh, { caseNo: id, date: day, store: store, name: me.name + '（督導）', mat: '', mfg: '', exp: '', qty: '', cls: '督導回報', desc: text, mediaUrls: '[]',
      handle: '', method: '', result: '', status: 'pend', createdAt: iso, supp: '', history: JSON.stringify([{ at: iso, act: '營運工作台回報', note: me.name }]) });
  }
  CacheService.getScriptCache().remove('ext:todos'); extMemo_ = null;
  return id;
}
