/** 畫面流程測試（手機尺寸）：node dev/test-e2e.js。會自己啟動示範伺服器。 */
process.env.PORT = process.env.PORT || '8799';
const { server, env } = require('./server');
const { chromium, devices } = require('playwright');
const fs = require('fs'), path = require('path');
const OUT = process.env.SHOTS || path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('  ✗ ' + name, extra || ''); } };
const URL_ = 'http://localhost:' + process.env.PORT + '/';

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const open = async () => { const ctx = await browser.newContext({ ...devices['iPhone 13'] }); const page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); await page.goto(URL_); return page; };
  const login = async (page, a) => { await page.fill('#lg-a', a); await page.fill('#lg-p', 'ugdemo1234'); await page.click('[data-act=login]'); await page.waitForSelector('nav.tabs'); };
  const shot = (page, n) => page.screenshot({ path: path.join(OUT, n + '.png') });
  const toast = (page, re) => page.waitForFunction(src => new RegExp(src).test(document.getElementById('toast').textContent) && document.getElementById('toast').classList.contains('show'), re.source, { timeout: 8000 }).then(() => true, () => false);

  // ---- 督導 ----
  let p = await open();
  await p.fill('#lg-a', 'jill'); await p.fill('#lg-p', 'nope'); await p.click('[data-act=login]');
  await p.waitForSelector('.login .note.bad'); ok(/不正確/.test(await p.textContent('.login .note.bad')), '登入錯誤有提示');
  await login(p, 'jill');
  await p.waitForSelector('button.card[data-store]');
  ok(await p.locator('button.card[data-store]').count() === 3, '我的門市 3 間');
  ok((await p.locator('button.card[data-store]').first().getAttribute('data-store')) === '台北公館店', '今日行程的門市排第一');
  ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '首頁沒有水平捲動');
  await shot(p, '1-home');

  await p.click('button.card[data-store="台北信義店"]');
  await p.waitForSelector('#vform');
  ok(await p.locator('.sheet .item [data-act=t-nudge]').count() === 2, '門市頁有 2 筆待辦');
  ok(await p.evaluate(() => { const b = document.querySelector('.sheet-body'); return b.scrollWidth <= b.clientWidth; }), '門市頁沒有水平捲動');
  await shot(p, '2-store');
  await p.locator('[data-act=t-nudge]').first().click(); ok(await toast(p, /已催辦/), '催辦');
  await p.waitForSelector('[data-act=t-nudge][disabled]');
  // 回報 → 提示重複 → 併單
  await p.click('[data-act=report]'); await p.fill('#rp-text', '鮮乳今天又少送'); await p.click('[data-act=report-send]');
  await p.waitForSelector('[data-act=report-merge]'); await shot(p, '3-dupe');
  await p.click('[data-act=report-merge]'); await p.waitForSelector('#rp-text', { state: 'detached' });
  // 回報新單（附照片）
  await p.click('[data-act=report]'); await p.fill('#rp-text', '冷氣漏水');
  await p.setInputFiles('#rp-photo', { name: 'a.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64') });
  await p.click('[data-act=report-send]');
  await p.waitForSelector('[data-act=report-force]'); await p.click('[data-act=report-force]');   // 同店已有修繕單，確認不是同一件
  await p.waitForSelector('#rp-text', { state: 'detached' });
  await p.waitForFunction(() => document.querySelectorAll('.sheet .item [data-act=t-nudge]').length === 3);
  ok(await p.locator('.sheet [data-act=t-photo]').count() === 1, '新單帶照片');
  ok(/催辦 2 筆、回報 1 筆/.test(await p.textContent('#vform')), '訪店表單帶入這次的催辦與回報', await p.textContent('#vform .note'));
  // 現場紀錄
  await p.click('[data-name=mode][data-v="現場"]');
  await p.fill('[data-f=talk]', '確認冬季新品備料 <b>測試</b>'); await p.fill('[data-f=fb]', '希望增加人力');
  await p.click('[data-act=visit-save]'); ok(await toast(p, /已儲存/), '儲存現場紀錄');
  await p.waitForFunction(() => /確認冬季新品備料 <b>測試<\/b>/.test(document.querySelector('.sheet-body').textContent));
  ok(await p.locator('.sheet-body b:text-is("測試")').count() === 0, '輸入的 HTML 不會被當成標籤');
  // 遠端抽查：上傳截圖自動帶時間
  await p.click('[data-name=mode][data-v="遠端"]');
  await p.click('[data-name=slot][data-v="營業中"]');
  await p.setInputFiles('#shot', { name: 's.png', mimeType: 'image/png', buffer: Buffer.from('x') });
  await p.waitForFunction(() => document.querySelector('[data-f=shotTime]').value !== '');
  await p.fill('[data-f=shotDate]', '2026-11-24'); await p.fill('[data-f=shotTime]', '15:20');
  ok(/會計入本週抽查/.test(await p.textContent('#shot-note')), '時間符合有提示');
  await p.fill('[data-f=shotTime]', '22:30'); ok(/不在/.test(await p.textContent('#shot-note')), '時間不符有提示');
  await p.fill('[data-f=shotTime]', '15:20');
  await p.click('[data-act=chk][data-k="均質秒數"][data-v=ng]'); await p.fill('[data-f=note]', '只有 5 秒');
  ok((await p.inputValue('[data-f=shotTime]')) === '15:20', '切換檢查項目不會清掉已填內容');
  await shot(p, '4-cam');
  await p.click('[data-act=visit-save]'); ok(await toast(p, /計入本週「營業中」/), '抽查計入');
  await p.waitForFunction(() => document.querySelectorAll('.sheet .dot.on').length >= 1);
  await p.click('[data-act=back]'); await p.waitForSelector('.sheet', { state: 'detached' });
  // 只催辦就離開 → 自動記錄
  await p.click('button.card[data-store="台北南京店"]'); await p.waitForSelector('#vform');
  await p.click('[data-act=t-nudge]'); await toast(p, /已催辦/);
  await p.click('[data-act=back]'); await p.waitForFunction(() => /自動記錄/.test(document.getElementById('toast').textContent));
  ok(env.gas.Store.rows('visits').some(v => v.kind === '處理待辦' && v.store === '台北南京店'), '只催辦也會留下紀錄');

  // 週誌
  await p.click('[data-tab=journal]'); await p.waitForSelector('[data-j=found]');
  const found = await p.inputValue('[data-j=found]');
  ok(/確認冬季新品備料/.test(found) && /均質秒數/.test(found), '週誌自動帶入', found);
  ok(/回報修繕（工務）：台北信義店 冷氣漏水/.test(await p.inputValue('[data-j=issue]')), '週誌帶入回報', await p.inputValue('[data-j=issue]'));
  await shot(p, '5-journal');
  await p.fill('[data-j=needs]', '信義店需要工務加速'); await p.click('[data-act=j-send]');
  await p.waitForSelector('.note.good'); ok(/已於/.test(await p.textContent('.note.good')), '週誌送出');

  // 行程
  await p.click('[data-tab=sched]'); await p.waitForSelector('.day');
  ok(/巡店・台北公館店/.test(await p.textContent('.day.today')), '今天的行程');
  await p.click('[data-act=ev-new]'); await p.fill('#ev-place', '台北信義店'); await p.fill('#ev-start', '2026-11-26'); await p.click('[data-act=ev-add]');
  await p.waitForFunction(() => /台北信義店/.test(document.getElementById('view').textContent));
  await shot(p, '6-sched');
  await p.click('button.ev:has-text("台北信義店")'); await p.click('[data-act=ev-del]'); await p.click('[data-act=ev-del]');
  await p.waitForFunction(() => !/台北信義店/.test(document.getElementById('view').textContent)); ok(true, '刪除行程');
  await p.click('[data-name=smode][data-v=month]'); await p.waitForSelector('.cal-c');
  ok(await p.locator('.cal-c').count() === 42 && await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '月行事曆：11 月六週、沒有水平捲動');
  await shot(p, '6b-month');
  await p.click('[data-act=mo][data-n="1"]'); await p.waitForFunction(() => /12 月/.test(document.getElementById('view').textContent) && /行憲紀念日/.test(document.getElementById('view').textContent));
  await p.click('.cal-c[data-day="2026-12-25"]'); await p.waitForSelector('[data-act=ev-new][data-day]');
  ok(/行憲紀念日/.test(await p.textContent('.sheet .hol.off')), '月行事曆：點日期看到假日名稱');
  await p.click('[data-act=ev-new][data-day]'); ok((await p.inputValue('#ev-start')) === '2026-12-25', '月行事曆：從日期新增會帶入那一天');
  await p.fill('#ev-place', '台北南京店'); await p.click('[data-act=ev-add]');
  await p.waitForFunction(() => { const c = document.querySelector('.cal-c[data-day="2026-12-25"]'); return c && /巡店/.test(c.textContent); }); ok(true, '月行事曆：新增後出現在格子裡');
  await shot(p, '6c-month-dec');
  await p.click('[data-act=mo][data-n="0"]'); await p.click('[data-name=smode][data-v=week]'); await p.waitForSelector('.day');
  await p.click('[data-act=cal]'); await p.waitForSelector('#cal-url');
  const calUrl = await p.textContent('#cal-url');
  ok(/^webcal:\/\/localhost/.test(await p.getAttribute('a.btn.primary', 'href')), '訂閱連結');
  const ics = await (await fetch(calUrl)).text(); ok(/BEGIN:VCALENDAR/.test(ics) && /台北公館店/.test(ics), '訂閱網址回傳行事曆');
  await shot(p, '7-cal');
  await p.click('[data-act=back]');
  // 重新整理仍保持登入；登出後失效
  await p.reload(); await p.waitForSelector('nav.tabs'); ok(true, '重新整理仍登入');
  await p.click('[data-act=account]'); await p.click('[data-act=logout]'); await p.waitForSelector('#lg-a');
  ok(await p.evaluate(() => localStorage.getItem('ug-ops-token')) === null, '登出清除憑證');
  await p.context().close();

  // ---- 部門窗口 ----
  p = await open(); await login(p, 'gongwu');
  ok(await p.locator('nav.tabs button').count() === 3, '部門有待辦、行程、公告');
  await p.waitForSelector('[data-act=t-done]');
  ok((await p.textContent('#view')).includes('冷氣漏水') && !(await p.textContent('#view')).includes('鮮乳'), '只看到工務的單');
  await shot(p, '8-dept');
  const row = p.locator('.item', { hasText: '冷氣漏水' });
  await row.locator('[data-act=t-photo]').click(); await p.waitForSelector('img.photo'); await p.click('[data-act=back]');
  await row.locator('[data-act=t-done]').click(); await p.fill('#tx', '已派工修復'); await p.click('[data-act=t-done-send]');
  await p.waitForFunction(() => !document.getElementById('view').textContent.includes('冷氣漏水')); ok(true, '部門結案');
  await p.context().close();

  // ---- 總監 ----
  p = await open(); await login(p, 'robert');
  await p.click('[data-tab=posts]'); await p.waitForSelector('[data-act=p-new]'); await p.click('[data-act=p-new]');
  await p.fill('#pn-title', '冬季新品 SOP v2'); await p.fill('#pn-body', '糖度調整'); await p.click('[data-act=p-add][data-publish="1"]');
  await p.waitForFunction(() => /冬季新品 SOP v2/.test(document.getElementById('view').textContent) && /已確認 0 \/ 10/.test(document.getElementById('view').textContent));
  ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '公告頁沒有水平捲動（六個分頁）'); await shot(p, '12-posts');
  await p.click('[data-tab=brief]');
  await p.waitForSelector('.kpis'); ok(/需關注門市/.test(await p.textContent('#view')) && /台北公館店/.test(await p.textContent('#view')), '晨報');
  ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '晨報沒有水平捲動');
  await shot(p, '9-brief');
  await p.click('[data-tab=journal]'); await p.waitForSelector('[data-act=j-open]');
  ok(/待閱/.test(await p.textContent('[data-who=jill]')), '週誌待閱');
  await p.click('[data-who=jill]'); await p.waitForSelector('#j-reply'); await shot(p, '10-review');
  await p.fill('#j-reply', '收到，週三一起看'); await p.click('[data-act=j-ack]');
  await p.waitForFunction(() => /已讀/.test(document.querySelector('[data-who=jill]').textContent)); ok(true, '總監回覆週誌');
  await p.click('[data-tab=home]'); await p.waitForSelector('#as-sel'); await p.selectOption('#as-sel', 'joyce');
  await p.waitForSelector('button.card[data-store="板橋府中店"]'); ok(true, '總監切換檢視督導');
  await p.click('[data-tab=sched]'); await p.waitForSelector('.day'); await p.click('[data-act=ev-new]');
  await p.fill('#ev-place', '加盟主訓練'); await p.selectOption('#ev-type', '訓練'); await p.fill('#ev-start', '2026-12-10'); await p.fill('#ev-end', '2026-12-13');
  await p.check('input[name=ev-who][value=jill]'); await p.check('input[name=ev-who][value=joyce]'); await p.uncheck('input[name=ev-who][value=robert]');
  await shot(p, '11-batch');
  await p.click('[data-act=ev-add]'); ok(await toast(p, /已新增 2 筆/), '批次排程');
  await p.context().close();

  ok(errors.length === 0, '瀏覽器沒有錯誤（含 CSP）', errors.join(' | '));
  await browser.close(); server.close();
  console.log(`\n${pass} 通過，${fail} 失敗`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
