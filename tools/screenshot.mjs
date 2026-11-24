// Dev-only. Captures the three dossier screenshots from a local main.ts output.
// Usage: node tools/screenshot.mjs out
// Never imported by main.ts. Uses the system Chrome over the local DevTools port.

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const outDir = resolve(process.argv[2] || 'out');
const pageUrl = pathToFileURL(resolve(outDir, 'dashboard/index.html')).href;
const shotDir = resolve('screenshots');
const chromeBin = process.env.CHROME || 'google-chrome';
const port = 9334;

const chrome = spawn(chromeBin, [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  '--hide-scrollbars',
  '--force-device-scale-factor=1',
  `--remote-debugging-port=${port}`,
  '--window-size=1440,1320',
  'about:blank',
], { stdio: 'ignore' });

let ws;
try {
  let version;
  for (let i = 0; i < 40; i++) {
    try {
      version = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json());
      break;
    } catch {
      await delay(100);
    }
  }
  if (!version) throw new Error('Chrome DevTools port did not open');
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
  const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  if (!page) throw new Error('Chrome opened no page target');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolveOpen, reject) => {
    ws.addEventListener('open', resolveOpen);
    ws.addEventListener('error', reject);
  });

  let seq = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const data = JSON.parse(ev.data);
    if (data.id && pending.has(data.id)) {
      const { resolve: done, reject } = pending.get(data.id);
      pending.delete(data.id);
      if (data.error) reject(new Error(JSON.stringify(data.error)));
      else done(data.result);
    }
  });
  function send(method, params = {}) {
    const id = ++seq;
    return new Promise((done, reject) => {
      pending.set(id, { resolve: done, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1320,
    deviceScaleFactor: 1,
    mobile: false,
  });

  async function open(url) {
    await send('Page.navigate', { url });
    await delay(400);
  }
  async function evalJs(expression) {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'page script failed');
    return result.result?.value;
  }
  async function shot(name) {
    let quality = 62;
    let bytes = Buffer.alloc(0);
    for (; quality >= 28; quality -= 6) {
      const image = await send('Page.captureScreenshot', { format: 'jpeg', quality, fromSurface: true });
      bytes = Buffer.from(image.data, 'base64');
      if (bytes.length <= 240_000) break;
    }
    const file = resolve(shotDir, name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, bytes);
    process.stdout.write(`screenshot: ${file} ${bytes.length} bytes q=${quality}\n`);
    if (bytes.length > 240_000) throw new Error(`${name} is ${bytes.length} bytes`);
  }

  await open(pageUrl);
  const boot = await evalJs('({rows: !!(window.RADAR && window.RADAR.rows), text: document.body.innerText.slice(0, 80)})');
  if (!boot || !boot.rows) throw new Error(`page has no radar data: ${JSON.stringify(boot)}`);

  await evalJs(`document.querySelector('.back') && document.querySelector('.back').click()`);
  await delay(150);
  await shot('1-board.jpg');

  await evalJs(`document.querySelector('[data-dep="10000"]').click()`);
  await delay(100);
  await evalJs(`location.hash = 'metalx-swap'`);
  await delay(200);
  const detail = await evalJs('document.body.innerText.includes("MetalX") && document.body.innerText.includes("FARM") && document.body.innerText.includes("Cost") && document.body.innerText.includes("How the figure is made")');
  if (!detail) throw new Error('detail view did not open a FARM row');
  await shot('2-detail.jpg');

  await evalJs(`document.querySelector('.back') && document.querySelector('.back').click()`);
  await delay(100);
  await evalJs(`document.querySelector('[data-dep="plan"]').click()`);
  await delay(80);
  await evalJs(`
    var row = window.RADAR.rows.find(function (r) { return r.verdict === 'MARGINAL'; });
    var cat = document.getElementById('category');
    cat.value = row.category;
    cat.dispatchEvent(new Event('change'));
  `);
  await delay(80);
  await evalJs(`
    var verdict = document.getElementById('verdict');
    verdict.value = 'MARGINAL';
    verdict.dispatchEvent(new Event('change'));
  `);
  await delay(80);
  await evalJs(`document.querySelector('.expand').click()`);
  await delay(150);
  const filtered = await evalJs('document.body.innerText.includes("MARGINAL") && document.body.innerText.includes("of 203") && document.body.innerText.includes("Cost") && document.body.innerText.includes("×")');
  if (!filtered) throw new Error('filtered view did not show chips, the count, and expanded steps');
  await shot('3-filtered.jpg');

  await evalJs(`document.querySelector('[data-tab="evidence"]').click()`);
  await delay(250);
  const evidence = await evalJs('document.body.innerText.includes("Market cap against TVL") && document.body.innerText.includes("years with no token")');
  if (!evidence) throw new Error('evidence tab did not render');
  await shot('4-evidence.jpg');
} finally {
  if (ws && ws.readyState === WebSocket.OPEN) ws.close();
  chrome.kill('SIGKILL');
}
