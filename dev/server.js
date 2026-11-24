/** 本機示範伺服器：node dev/server.js → http://localhost:8787（示範帳號 jill / robert / gongwu，密碼 ugdemo1234） */
const http = require('http'), fs = require('fs'), path = require('path');
const { load } = require('./gas-shim'), { seed } = require('./seed');
const PORT = +process.env.PORT || 8787;
const env = seed(load({ url: 'http://localhost:' + PORT + '/exec', props: { PHOTO_FOLDER_ID: 'PHOTOS' } }));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const root = path.join(__dirname, '..', 'docs');
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/exec') {
    if (req.method === 'GET') { const o = env.gas.doGet({ parameter: Object.fromEntries(u.searchParams) }); res.writeHead(200, { 'Content-Type': o.mime + '; charset=utf-8' }); return res.end(o.content); }
    let body = ''; req.on('data', c => { body += c; });
    return req.on('end', () => { env.gas.Store.reset(); const o = env.gas.doPost({ postData: { contents: body } }); res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(o.content); });
  }
  if (u.pathname === '/config.js') { res.writeHead(200, { 'Content-Type': TYPES['.js'] }); return res.end("window.UG_CONFIG = { API_URL: '/exec' };"); }
  const f = path.join(root, path.normalize(u.pathname === '/' ? 'index.html' : u.pathname).replace(/^(\.\.[\/\\])+/, ''));
  if (!f.startsWith(root) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); res.end(fs.readFileSync(f));
});
server.listen(PORT, () => console.log('http://localhost:' + PORT));
module.exports = { server, env };
