const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const Module = require('node:module');
const original = Module._load;
Module._load = function(id, ...args) { return id === 'vscode' ? {} : original.call(this, id, ...args); };
const { _startProxy } = require('../extension');
Module._load = original;
function get(port, path, cookie) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path, headers: cookie ? { cookie } : {} }, res => {
      let body = ''; res.on('data', b => body += b); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on('error', reject);
  });
}
test('proxy requires its own session and forwards only the upstream cookie', async t => {
  const upstream = http.createServer((req, res) => res.end(req.headers.cookie));
  await new Promise(r => upstream.listen(0, '127.0.0.1', r));
  t.after(() => upstream.close());
  const proxy = await _startProxy({ host: '127.0.0.1', port: upstream.address().port }, 'harness=private');
  t.after(() => proxy.srv.close());
  assert.equal((await get(proxy.port, '/')).status, 403);
  assert.equal((await get(proxy.port, '/', 'other=value')).status, 403);
  const bootstrap = await get(proxy.port, proxy.secretPath + '/');
  assert.equal(bootstrap.status, 302);
  const cookie = bootstrap.headers['set-cookie'][0];
  assert.match(cookie, /HttpOnly; Secure; SameSite=None/);
  const response = await get(proxy.port, '/assets/app.js', cookie.split(';')[0]);
  assert.equal(response.status, 200);
  assert.equal(response.body, 'harness=private');
});
