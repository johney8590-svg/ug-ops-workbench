/**
 * LINE 通知實際對外連線的部分（只有這個檔案會連到 Google 以外的服務：api.line.me）。
 * 這個檔案單獨放，是因為貼進 Apps Script 後，Google 會要求擁有者重新授權「連線到外部服務」；
 * 還沒授權前整個工作台可能暫時無法使用。所以要啟用 LINE 時才貼，貼完馬上執行一次 checkSetup 完成授權。
 */
function lineCall_(path, payload) {
  try {
    UrlFetchApp.fetch('https://api.line.me/v2/bot/message/' + path, { method: 'post', contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + prop_('LINE_TOKEN') }, payload: JSON.stringify(payload), muteHttpExceptions: true });
  } catch (e) { console.error('LINE 傳送失敗：' + e.message); }
}
