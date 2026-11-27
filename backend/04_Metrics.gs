/**
 * 營收指標：直接讀營運儀表板後台的逐日 × 逐店明細（data 分頁）。
 * 只讀不寫。計算結果快取 30 分鐘，避免每次開頁面都重讀整張表。
 *
 * 規則（依 2026/11 定案）：
 *  - 比較基準：與自己近 4 週同星期的平均比，再減掉所屬區域的平均變化
 *  - 需關注：相對區域平均落後 10% 以上，或連續兩週下滑（任一成立）
 *  - 暫行目標：基期（預設 9、10 月）各星期別的平均日營收 × (1 + 成長率 5%)，
 *    基期先扣掉 specials 分頁登記的特殊狀況業績，公休日不計
 */
function normDate_(v, year) {
  const p2 = function (n) { return ('0' + n).slice(-2); };
  const y = /^\d{4}$/.test(String(year == null ? '' : year).trim()) ? String(year).trim() : '';
  if (v instanceof Date) {
    const d = Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
    return y ? y + d.slice(4) : d;                      // 儀表板另有 year 欄時以它為準
  }
  const t = String(v == null ? '' : v).trim();
  let m = t.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
  if (m) return m[1] + '-' + p2(m[2]) + '-' + p2(m[3]);
  m = t.match(/^(\d{1,2})[-\/.](\d{1,2})$/);           // 儀表板的日期是「月/日」，年份在 year 欄
  if (m && y) return y + '-' + p2(m[1]) + '-' + p2(m[2]);
  return '';
}

function metrics_() {
  const today = today_();
  const cache = CacheService.getScriptCache();
  const key = 'metrics:' + today;
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);
  const out = computeMetrics_(today);
  try { cache.put(key, JSON.stringify(out), 2700); } catch (e) { /* 超過快取大小就不快取 */ }
  return out;
}

/**
 * 預先算好營收指標與門市主檔。設定成每 30 分鐘自動執行（時間觸發條件）後，
 * 同仁開頁面時永遠拿到算好的結果，不會有人剛好碰到重算而多等幾秒。
 */
function warmCache() {
  const today = today_(), cache = CacheService.getScriptCache();
  Object.keys(TABS).forEach(function (t) { if (t !== 'log') { try { Store.refresh(t); } catch (e) { console.error('分頁 ' + t + ' 重讀失敗：' + e.message); } } });
  const out = computeMetrics_(today);
  try { cache.put('metrics:' + today, JSON.stringify(out), 2700); } catch (e) { /* 忽略 */ }
  try { syncQsc_(); } catch (e) { console.error('QSC 同步失敗：' + e.message); }
  try { scanPostFolders_(); } catch (e) { console.error('公告資料夾掃描失敗：' + e.message); }
  try { putExternal_(readExternal_()); } catch (e) { console.error('既有系統讀取失敗：' + e.message); }
  if (prop_('MASTER_SHEET_ID')) { try { cache.put('masterStores', JSON.stringify(masterStores_()), 2700); } catch (e) { console.error('門店資料表讀取失敗：' + e.message); } }
}

function computeMetrics_(today) {
  const empty = function (note) { return { asOf: '', note: note, stores: {} }; };
  const id = prop_('DASHBOARD_SHEET_ID');
  if (!id) return empty('尚未設定營運儀表板資料來源');
  let sh;
  try { sh = SpreadsheetApp.openById(id).getSheetByName(prop_('DASHBOARD_TAB') || 'data'); } catch (e) { return empty('無法開啟營運儀表板資料表'); }
  if (!sh) return empty('營運儀表板找不到資料分頁');
  // 只讀需要的欄位（表頭先讀一列，再讀到用得到的最後一欄為止），大表才不會慢
  const h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (x) { return String(x).trim().toLowerCase(); });
  const need = ['store', 'date', 'revenue', 'zone', 'year'].map(function (k) { return h.indexOf(k); });
  const vals = sh.getRange(1, 1, sh.getLastRow(), Math.max.apply(null, need) + 1).getValues();
  const iS = h.indexOf('store'), iD = h.indexOf('date'), iR = h.indexOf('revenue'), iZ = h.indexOf('zone');
  const iY = h.indexOf('year');
  if (iS < 0 || iD < 0 || iR < 0) return empty('營運儀表板資料欄位不符（需要 store、date、revenue）');

  const rev = {}, dashZone = {};
  const y = addDays_(today, -1);
  let latest = '';
  for (let i = 1; i < vals.length; i++) {
    const s = String(vals[i][iS]).trim(), d = normDate_(vals[i][iD], iY >= 0 ? vals[i][iY] : '');
    if (!s || !d) continue;
    const r = Number(String(vals[i][iR]).replace(/,/g, '')) || 0;
    (rev[s] = rev[s] || {})[d] = (rev[s][d] || 0) + r;
    if (iZ >= 0) dashZone[s] = String(vals[i][iZ]).trim();
    if (d <= y && d > latest && r > 0) latest = d;
  }
  if (!latest) return empty('營運儀表板沒有昨天以前的資料');

  // 基期扣除特殊狀況業績
  const baseFrom = prop_('TARGET_BASE_FROM') || '2026-09-01', baseTo = prop_('TARGET_BASE_TO') || '2026-10-31';
  const growth = 1 + (Number(prop_('TARGET_GROWTH')) || 0.05);
  const special = {};
  Store.rows('specials').forEach(function (x) {
    if (!x.store || !isDate_(x.date)) return;
    (special[x.store] = special[x.store] || {})[x.date] = (special[x.store][x.date] || 0) + (Number(x.amount) || 0);
  });


  const L = latest, Ldow = dow_(L);
  const wk1 = Ldow === 0 ? monday_(L) : addDays_(monday_(L), -7);       // 最近一個完整週的週一
  const monthStart = L.slice(0, 8) + '01';
  const monthDays = new Date(Date.UTC(+L.slice(0, 4), +L.slice(5, 7), 0)).getUTCDate();
  const out = {};

  Object.keys(rev).forEach(function (s) {
    const r = rev[s];
    const yv = r[L] || 0;
    let sum4 = 0, n4 = 0;
    for (let k = 1; k <= 4; k++) { const v = r[addDays_(L, -7 * k)] || 0; if (v > 0) { sum4 += v; n4++; } }
    const avg4 = n4 ? sum4 / n4 : null;
    const ch = avg4 && yv > 0 ? (yv - avg4) / avg4 * 100 : null;
    const wsum = function (start) { let t = 0; for (let i = 0; i < 7; i++) t += r[addDays_(start, i)] || 0; return t; };
    const w1 = wsum(wk1), w2 = wsum(addDays_(wk1, -7)), w3 = wsum(addDays_(wk1, -14));
    const down2 = w1 > 0 && w2 > 0 && w3 > 0 && w1 < w2 && w2 < w3;

    const dowSum = [0, 0, 0, 0, 0, 0, 0], dowCnt = [0, 0, 0, 0, 0, 0, 0];
    for (let d = baseFrom; d <= baseTo; d = addDays_(d, 1)) {
      const v = (r[d] || 0) - ((special[s] || {})[d] || 0);
      if (v > 0) { const w = dow_(d); dowSum[w] += v; dowCnt[w]++; }
    }
    const dayTarget = function (d) { const w = dow_(d); return dowCnt[w] ? dowSum[w] / dowCnt[w] * growth : null; };
    const hasTarget = dowCnt.some(function (c) { return c > 0; });
    let monthTarget = 0, mtdTarget = 0, mtd = 0;
    if (hasTarget) {
      for (let i = 0; i < monthDays; i++) {
        const d = addDays_(monthStart, i), t = dayTarget(d) || 0;
        monthTarget += t;
        if (d <= L) { mtdTarget += t; mtd += r[d] || 0; }
      }
    }
    out[s] = {
      zone: dashZone[s] || '',
      y: Math.round(yv), avg4: avg4 === null ? null : Math.round(avg4),
      ch: ch === null ? null : Math.round(ch * 10) / 10,
      down2: down2,
      yTarget: hasTarget && dayTarget(L) ? Math.round(dayTarget(L)) : null,
      mtd: Math.round(mtd), mtdTarget: hasTarget ? Math.round(mtdTarget) : null, monthTarget: hasTarget ? Math.round(monthTarget) : null
    };
  });

  // 相對區域平均
  const zsum = {}, zcnt = {};
  Object.keys(out).forEach(function (s) { const m = out[s]; if (m.ch === null) return; zsum[m.zone] = (zsum[m.zone] || 0) + m.ch; zcnt[m.zone] = (zcnt[m.zone] || 0) + 1; });
  Object.keys(out).forEach(function (s) {
    const m = out[s];
    m.rel = m.ch === null || !zcnt[m.zone] ? null : Math.round((m.ch - zsum[m.zone] / zcnt[m.zone]) * 10) / 10;
    m.need = (m.rel !== null && m.rel <= -10) || m.down2;
  });
  const alias = {};
  Object.keys(out).forEach(function (s) { alias[normStore_(s)] = s; });
  return { asOf: L, note: '', stores: out, alias: alias };
}

/** 取某門市的指標；門市名稱與儀表板差一個「店」字或空白也對得上。 */
function mOf_(M, name) { return M.stores[name] || M.stores[(M.alias || {})[normStore_(name)]] || null; }
