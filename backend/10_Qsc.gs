/**
 * QSC 同步：訓練部把稽核結果丟進指定的雲端資料夾（QSC_FOLDER_ID），系統每 30 分鐘讀一次寫進 qsc 分頁。
 * 支援 Google 試算表與 CSV。欄位名稱認得中文或英文：門市、日期、分數、稽核人、未達標項目。
 * 同一間門市同一天重複上傳，以最後一次為準。Excel（.xlsx）讀不了，請先用 Google 試算表開啟或另存 CSV。
 */
const QSC_COLS = {
  store: ['門市', '店名', '門店', 'store'], date: ['日期', '稽核日期', '檢查日期', 'date'], score: ['分數', '總分', '得分', 'score'],
  by: ['稽核人', '檢查人', '執行人', '稽核人員', 'by'], fails: ['未達標', '未達標項目', '缺失', '缺失項目', '不合格項目', 'fails']
};
function qscParse_(vals) {
  let hr = -1, idx = null;
  for (let i = 0; i < Math.min(vals.length, 10) && hr < 0; i++) {
    const row = vals[i].map(function (x) { return String(x == null ? '' : x).replace(/\s/g, '').toLowerCase(); });
    const m = {};
    Object.keys(QSC_COLS).forEach(function (k) { m[k] = row.map(function (c) { return QSC_COLS[k].indexOf(c) >= 0; }).indexOf(true); });
    if (m.store >= 0 && m.date >= 0 && m.score >= 0) { hr = i; idx = m; }
  }
  if (hr < 0) return { error: '找不到「門市、日期、分數」三個欄位' };
  const out = [];
  for (let r = hr + 1; r < vals.length; r++) {
    const g = function (k) { return idx[k] < 0 || vals[r][idx[k]] == null ? '' : vals[r][idx[k]]; };
    const store = String(g('store')).replace(/\s+/g, '').trim(), date = normDate_(g('date'), ''), score = Number(String(g('score')).replace(/[^\d.]/g, ''));
    if (!store || !date || !(score >= 0) || String(g('score')).trim() === '') continue;
    out.push({ store: store, date: date, score: String(Math.round(score * 10) / 10), by: cut_(g('by'), 30) || '訓練部', fails: cut_(g('fails'), 300) });
  }
  return { rows: out };
}
function syncQsc_() {
  const fid = prop_('QSC_FOLDER_ID');
  if (!fid) return null;
  const props = PropertiesService.getScriptProperties();
  const seen = J_(prop_('QSC_SEEN'), {});
  const byNorm = {}; activeStores_().forEach(function (s) { byNorm[normStore_(s.store)] = s.store; });
  const report = { at: nowStamp_(), files: 0, rows: 0, problems: [] };
  const it = DriveApp.getFolderById(fid).getFiles();
  while (it.hasNext() && report.files < 20) {
    const f = it.next(), name = f.getName(), stamp = String(f.getLastUpdated().getTime());
    if (/範本/.test(name) || seen[f.getId()] === stamp) continue;
    let vals = null;
    try {
      const mime = f.getMimeType();
      if (mime === 'application/vnd.google-apps.spreadsheet') vals = SpreadsheetApp.openById(f.getId()).getSheets()[0].getDataRange().getValues();
      else if (mime === 'text/csv' || /\.csv$/i.test(name)) vals = Utilities.parseCsv(f.getBlob().getDataAsString());
      else { report.problems.push(name + '：不支援這種檔案，請用 Google 試算表或 CSV'); seen[f.getId()] = stamp; continue; }
    } catch (e) { report.problems.push(name + '：讀取失敗'); continue; }
    const p = qscParse_(vals);
    seen[f.getId()] = stamp;
    if (p.error) { report.problems.push(name + '：' + p.error); continue; }
    report.files++;
    p.rows.forEach(function (r) {
      const store = byNorm[normStore_(r.store)];
      if (!store) { if (report.problems.length < 15) report.problems.push(name + '：門市「' + r.store + '」對不上門店資料表'); return; }
      r.store = store;
      const cur = Store.rows('qsc').filter(function (q) { return q.store === store && q.date === r.date; })[0];
      if (cur) Store.update('qsc', cur._row, r); else Store.append('qsc', r);
      report.rows++;
    });
  }
  const keys = Object.keys(seen);
  if (keys.length > 300) keys.slice(0, keys.length - 300).forEach(function (k) { delete seen[k]; });
  props.setProperty('QSC_SEEN', JSON.stringify(seen));
  if (report.files || report.problems.length) props.setProperty('QSC_LAST', JSON.stringify(report).slice(0, 8000));
  return report;
}
