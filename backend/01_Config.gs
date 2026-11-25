/**
 * UG 營運工作台 — 設定與共用工具
 * 所有機密（資料表 ID、照片資料夾 ID）都放在「指令碼屬性」，不寫在程式碼裡。
 */
const TZ = 'Asia/Taipei';

const TABS = {
  people:   ['account', 'name', 'role', 'dept', 'email', 'salt', 'pwHash', 'mustChange', 'calToken', 'active'],
  stores:   ['store', 'zone', 'supervisor', 'type', 'active'],
  visits:   ['id', 'date', 'time', 'who', 'store', 'mode', 'kind', 'slot', 'shotTime', 'pass', 'checks', 'note', 'talk', 'fb', 'nudges', 'todos', 'createdAt'],
  todos:    ['id', 'createdAt', 'store', 'source', 'dept', 'text', 'status', 'by', 'photoId', 'notes', 'nudgedAt', 'closedAt', 'closedBy'],
  events:   ['id', 'who', 'start', 'end', 'type', 'place', 'todoId', 'createdBy', 'updatedAt'],
  journals: ['id', 'week', 'who', 'state', 'found', 'issue', 'plan', 'needs', 'sentAt', 'readAt', 'reply'],
  qsc:      ['store', 'date', 'score', 'by', 'fails'],
  specials: ['store', 'date', 'amount', 'note'],
  extnotes: ['id', 'caseId', 'store', 'at', 'by', 'text', 'help', 'doneAt', 'doneBy', 'reply', 'photoId'],
  posts:    ['id', 'cat', 'title', 'body', 'fileId', 'fileName', 'fileUrl', 'fileUpdated', 'state', 'createdAt', 'createdBy', 'approvedAt', 'approvedBy'],
  postacks: ['postId', 'account', 'at'],
  sessions: ['tokenHash', 'account', 'expires'],
  log:      ['at', 'account', 'action', 'detail']
};

const ROLES = ['director', 'supervisor', 'dept'];
const EVENT_TYPES = ['巡店', '外出', '訓練', '會議', '內勤', '請假'];
const SOURCES = { '修繕': { dept: '工務', limit: 7 }, '物料異常': { dept: '採購', limit: 3 }, '文宣': { dept: '行銷', limit: 7 }, '其他': { dept: '營運後勤', limit: 7 } };
const SLOTS = {
  '開班':   ['煮茶機標定', '茶飲機開班潤洗', '茶飲機標定'],
  '營業中': ['每小時消毒作業', '均質秒數'],
  '閉店':   ['閉店噴灑魔潔', '茶飲機收班清潔', 'POS 關閉電源']
};
const SLOT_RULE = { '開班': '11:00 以前', '營業中': '10:00–21:00', '閉店': '20:00 以後' };
const SESSION_DAYS = 30;
const DEDUPE_DAYS = 14;

function prop_(k) { return PropertiesService.getScriptProperties().getProperty(k); }

/** 今天（台北時間）。測試時可用指令碼屬性 TEST_TODAY 固定日期。 */
function today_() { return prop_('TEST_TODAY') || Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function nowHM_() { return Utilities.formatDate(new Date(), TZ, 'HH:mm'); }
function nowStamp_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss'); }

function ms_(d) { return Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)); }
function iso_(t) { return new Date(t).toISOString().slice(0, 10); }
function addDays_(d, n) { return iso_(ms_(d) + n * 864e5); }
function diffDays_(a, b) { return Math.round((ms_(b) - ms_(a)) / 864e5); }
function dow_(d) { return new Date(ms_(d)).getUTCDay(); }               // 0 = 週日
function monday_(d) { return addDays_(d, -((dow_(d) + 6) % 7)); }
function isDate_(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && iso_(ms_(s)) === s; }
function isHM_(s) { return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s); }

function J_(v, def) { if (v === '' || v === null || v === undefined) return def; if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch (e) { return def; } }
function yes_(v) { return v === 'Y' || v === true || v === 'TRUE' || v === 'true'; }
function uid_(prefix) { return prefix + '-' + Utilities.getUuid().replace(/-/g, '').slice(0, 10); }
function str_(v, max) { return String(v === undefined || v === null ? '' : v).trim().slice(0, max || 2000); }

function slotOk_(slot, hm) {
  if (slot === '開班') return hm < '11:00';
  if (slot === '營業中') return hm >= '10:00' && hm <= '21:00';
  if (slot === '閉店') return hm >= '20:00';
  return false;
}

function fail_(msg, code) { const e = new Error(msg); e.code = code || 'bad_request'; throw e; }
