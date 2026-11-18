// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Osgood001. See LICENSE and NOTICE.
'use strict';
const vscode = require('vscode');
const cp = require('child_process');
const http = require('http');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

let server = null;   // { child, upstream:{host,port}, cookie, proxy, proxyPort, url }
let starting = null;
let view = null;
let out;

function findDsh() {
  const cfg = vscode.workspace.getConfiguration('dsh').get('path');
  if (cfg) return cfg;
  const cands = [path.join(os.homedir(), '.local/bin/dsh'), '/usr/local/bin/dsh', '/opt/homebrew/bin/dsh'];
  return cands.find(p => fs.existsSync(p)) || 'dsh';
}

function workspaceCwd() {
  const f = vscode.workspace.workspaceFolders;
  return f && f.length ? f[0].uri.fsPath : os.homedir();
}

function stopServer() {
  if (!server) return;
  try { server.proxy.close(); } catch {}
  try { server.child.kill(); } catch {}
  server = null;
}

function fetchCookie(u) {
  return new Promise((resolve, reject) => {
    http.get(u, res => {
      res.resume();
      const sc = (res.headers['set-cookie'] || [])[0];
      if (!sc) return reject(new Error('dsh web did not issue an auth cookie'));
      resolve(sc.split(';')[0]);
    }).on('error', reject);
  });
}

function startProxy(upstream, cookie) {
  const secretPath = '/' + crypto.randomBytes(32).toString('hex');
  const cookieName = 'dsh_sidebar_' + crypto.randomBytes(8).toString('hex');
  const cookieValue = crypto.randomBytes(32).toString('hex');
  function authorize(req) {
    return String(req.headers.cookie || '').split(';').some(v => v.trim() === `${cookieName}=${cookieValue}`);
  }
  const strip = h => {
    const o = { ...h };
    delete o['x-frame-options'];
    if (o['content-security-policy']) {
      o['content-security-policy'] = String(o['content-security-policy'])
        .split(';').filter(d => !/^\s*frame-ancestors/i.test(d)).join(';');
    }
    return o;
  };
  const upHeaders = (h) => {
    const o = { ...h, host: `${upstream.host}:${upstream.port}`, cookie };
    if (o.origin) o.origin = `http://${upstream.host}:${upstream.port}`;
    delete o.referer;
    return o;
  };
  const srv = http.createServer((req, res) => {
    if (req.url === secretPath + '/') {
      res.writeHead(302, { 'Location': '/', 'Set-Cookie': `${cookieName}=${cookieValue}; HttpOnly; Secure; SameSite=None; Path=/`, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
      res.end(); return;
    }
    if (!authorize(req)) { res.writeHead(403); res.end('Forbidden'); return; }
    const r = http.request({ ...upstream, method: req.method, path: req.url, headers: upHeaders(req.headers) }, ures => {
      res.writeHead(ures.statusCode, strip(ures.headers));
      ures.pipe(res);
    });
    r.on('error', e => { res.writeHead(502); res.end('dsh upstream error: ' + e.message); });
    req.pipe(r);
  });
  srv.on('upgrade', (req, socket, head) => {
    if (!authorize(req)) { socket.destroy(); return; }
    const s = net.connect(upstream.port, upstream.host, () => {
      const h = upHeaders(req.headers);
      let raw = `${req.method} ${req.url} HTTP/1.1\r\n`;
      for (const [k, v] of Object.entries(h)) raw += `${k}: ${v}\r\n`;
      s.write(raw + '\r\n');
      if (head && head.length) s.write(head);
      s.pipe(socket); socket.pipe(s);
    });
    s.on('error', () => socket.destroy());
    socket.on('error', () => s.destroy());
  });
  return new Promise((resolve, reject) => {
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port, secretPath }));
  });
}

function startServer() {
  if (!vscode.workspace.isTrusted) return Promise.reject(new Error('Trust this workspace before starting DeepSeek Harness.'));
  if (server) return Promise.resolve(server);
  if (starting) return starting;
  const cfg = vscode.workspace.getConfiguration('dsh');
  const args = ['--profile', cfg.get('profile') || 'web', '--no-open', '--port', '0', ...(cfg.get('extraArgs') || [])];
  const bin = findDsh();
  out.appendLine(`$ ${bin} ${args.join(' ')}  (cwd=${workspaceCwd()})`);
  starting = new Promise((resolve, reject) => {
    const child = cp.spawn(bin, args, { cwd: workspaceCwd(), env: { ...process.env, PATH: `${path.join(os.homedir(), '.local/bin')}:${process.env.PATH || ''}`, BROWSER: 'none' } });
    let buf = '', done = false;
    const fail = e => { if (!done) { done = true; starting = null; try { child.kill(); } catch {} reject(e); } };
    const onData = async d => {
      const s = d.toString();
      out.append(s.replace(/([?&]token=)[^\s]+/g, '$1[redacted]'));
      if (done) return;
      buf += s;
      const m = buf.match(/http:\/\/(127\.0\.0\.1|localhost):(\d+)\/?\?token=[^\s]+/);
      if (!m) return;
      done = true;
      try {
        const upstream = { host: m[1], port: Number(m[2]) };
        const cookie = await fetchCookie(m[0]);
        const { srv, port, secretPath } = await startProxy(upstream, cookie);
        server = { child, upstream, cookie, proxy: srv, proxyPort: port, secretPath, url: m[0] };
        child.on('exit', () => { if (server && server.child === child) { server = null; render(); } });
        starting = null;
        resolve(server);
      } catch (e) { done = false; fail(e); }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', fail);
    child.on('exit', c => fail(new Error(`dsh exited (code ${c}) before serving`)));
    setTimeout(() => fail(new Error('timed out waiting for dsh web to start')), 60000);
  });
  return starting;
}

const page = body => `<!doctype html><html><head><meta charset="utf-8">
<style>html,body{height:100%;margin:0;padding:0;background:var(--vscode-sideBar-background);color:var(--vscode-foreground);font-family:var(--vscode-font-family)}
iframe{border:0;width:100%;height:100vh;display:block;background:#fff}.m{padding:16px}pre{white-space:pre-wrap;color:var(--vscode-errorForeground)}</style></head><body>${body}</body></html>`;

async function render() {
  if (!view) return;
  const wv = view.webview;
  wv.options = { enableScripts: true };
  wv.html = page('<div class="m">Starting DeepSeek Harness…</div>');
  try {
    const s = await startServer();
    const ext = await vscode.env.asExternalUri(vscode.Uri.parse(`http://127.0.0.1:${s.proxyPort}${s.secretPath}/`));
    const origin = new URL(ext.toString()).origin;
    wv.html = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src ${origin} http://127.0.0.1:* http://localhost:*; style-src 'unsafe-inline';">
<style>html,body{height:100%;margin:0;padding:0}iframe{border:0;width:100%;height:100vh;display:block}</style></head>
<body><iframe src="${ext.toString()}" allow="clipboard-read; clipboard-write"></iframe></body></html>`;
  } catch (e) {
    const msg = String(e && e.message || e).replace(/</g, '&lt;');
    wv.html = page(`<div class="m"><b>Could not start dsh</b><pre>${msg}</pre>Check the "DeepSeek Harness" output channel, or set <code>dsh.path</code>.</div>`);
  }
}

function activate(context) {
  out = vscode.window.createOutputChannel('DeepSeek Harness');
  context.subscriptions.push(out);
  context.subscriptions.push(vscode.window.registerWebviewViewProvider('dsh.sidebar', {
    resolveWebviewView(v) {
      view = v;
      v.onDidDispose(() => { view = null; });
      render();
    }
  }, { webviewOptions: { retainContextWhenHidden: true } }));
  context.subscriptions.push(
    vscode.commands.registerCommand('dsh.restart', async () => { stopServer(); await render(); }),
    vscode.commands.registerCommand('dsh.openInBrowser', async () => {
      try { const s = await startServer(); vscode.env.openExternal(vscode.Uri.parse(s.url)); }
      catch (e) { vscode.window.showErrorMessage(String(e.message || e)); }
    }),
    vscode.commands.registerCommand('dsh.focus', () => vscode.commands.executeCommand('dsh.sidebar.focus'))
  );
}

function deactivate() { stopServer(); }
module.exports = { activate, deactivate, _startProxy: startProxy, _startServer: startServer, _stop: stopServer, _setOut: o => { out = o; } };
