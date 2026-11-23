// Dev-only reimplementation of the seven token-radar-01 gate rows against an output directory.
// Usage: node tools/gate-check.mjs out /path/to/snapshot.json
// Never imported by main.ts.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { buildDossier } from '../vendor/makefun-board.ts';

const out = process.argv[2] || 'out';
const snapshotPath = process.argv[3];
if (!snapshotPath) {
  process.stderr.write('usage: node tools/gate-check.mjs <output-dir> <snapshot.json>\n');
  process.exit(2);
}
const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
const fails = [];
function check(name, ok, detail) {
  process.stdout.write(`${ok ? 'pass' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}\n`);
  if (!ok) fails.push(name);
}

const NAME = /^[A-Za-z0-9._-]{1,128}$/;
function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.')) fails.push(`dot-name ${name}`);
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) {
      if (name.startsWith('.') || name.startsWith('-')) fails.push(`dot-dir ${name}`);
      walk(path, files);
    } else if (st.isFile()) files.push({ name, path, size: st.size });
  }
  return files;
}

const dashDir = join(out, 'dashboard');
const dashFiles = walk(dashDir);
const dashBytes = dashFiles.reduce((s, f) => s + f.size, 0);
const hasHtml = dashFiles.some((f) => f.name === 'index.html');
const hasCss = dashFiles.some((f) => f.name.endsWith('.css'));
const hasJs = dashFiles.some((f) => f.name.endsWith('.js'));
let urlHit = '';
for (const file of dashFiles) {
  if (file.name.startsWith('.') || file.name.startsWith('-') || !NAME.test(file.name)) urlHit = urlHit || `bad name ${file.name}`;
  const text = readFileSync(file.path, 'utf8');
  if (file.name.endsWith('.css') && /https?:\/\//.test(text)) urlHit = urlHit || `url in ${file.name}`;
  if (file.name.endsWith('.html')) {
    const styleBodies = text.match(/<style[\s\S]*?<\/style>/gi) || [];
    if (styleBodies.some((body) => /https?:\/\//.test(body))) urlHit = urlHit || 'url in style';
    const attrs = text.matchAll(/\s(?:[A-Za-z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g);
    for (const hit of attrs) {
      const value = hit[2] ?? hit[3] ?? '';
      if (/https?:\/\//.test(value)) urlHit = urlHit || `url in attribute ${hit[0].slice(0, 40)}`;
    }
  }
  if (file.name.endsWith('.js')) {
    const specs = text.matchAll(/(?:import\s*\(|\brequire\s*\(|\bfrom\s*)\s*['"]([^'"]+)['"]/g);
    for (const hit of specs) if (/https?:\/\//.test(hit[1])) urlHit = urlHit || `url import ${hit[1]}`;
  }
}
check('dashboard_files', hasHtml && hasCss && hasJs && dashFiles.length <= 400 && dashBytes <= 4_194_304 && !urlHit, urlHit || `${dashFiles.length} files, ${dashBytes} bytes`);

const boardRaw = readFileSync(join(out, 'board.json'));
const board = JSON.parse(boardRaw.toString('utf8'));
const rows = board.rows;
const slugs = new Set(snapshot.protocols.map((p) => p.slug));
let boardDetail = `${rows.length} rows, ${boardRaw.length} bytes`;
let boardOk = board && Array.isArray(rows) && rows.length >= 100 && rows.length <= 4000 && boardRaw.length <= 8_388_608;
const seen = new Set();
if (boardOk) {
  for (const row of rows) {
    if (typeof row.slug !== 'string' || /\s/.test(row.slug) || !slugs.has(row.slug) || seen.has(row.slug)) {
      boardOk = false;
      boardDetail = `slug ${row.slug}`;
      break;
    }
    seen.add(row.slug);
    if (typeof row.name !== 'string' || row.name.trim() === '') {
      boardOk = false;
      boardDetail = `name ${row.slug}`;
      break;
    }
    if (!Number.isSafeInteger(row.rank) || row.rank < 1) {
      boardOk = false;
      boardDetail = `rank ${row.slug}`;
      break;
    }
    if (!Number.isSafeInteger(row.implied_value_usd) || row.implied_value_usd < 1 || row.implied_value_usd > 1e14) {
      boardOk = false;
      boardDetail = `value ${row.slug}`;
      break;
    }
    if (!Array.isArray(row.farm_steps)) {
      boardOk = false;
      boardDetail = `steps ${row.slug}`;
      break;
    }
  }
}
check('board_file', boardOk, boardDetail);

let orderOk = rows.length > 1 && rows[0].implied_value_usd !== rows[rows.length - 1].implied_value_usd;
let orderDetail = '';
for (let i = 0; i < rows.length; i++) {
  if (rows[i].rank !== i + 1) {
    orderOk = false;
    orderDetail = `rank ${i + 1} is ${rows[i].rank}`;
    break;
  }
  if (i > 0 && rows[i].implied_value_usd > rows[i - 1].implied_value_usd) {
    orderOk = false;
    orderDetail = `row ${i + 1} value rises`;
    break;
  }
}
check('sorted_by_value', orderOk, orderDetail);

const missing = snapshot.watchlist.filter((slug) => !seen.has(slug));
check('coverage', missing.length === 0, missing.length ? missing.slice(0, 5).join(', ') : `${snapshot.watchlist.length}/${snapshot.watchlist.length}`);

let farmOk = true;
let farmDetail = '';
for (const row of rows) {
  if (row.farm_steps.length < 3 || row.farm_steps.length > 12) {
    farmOk = false;
    farmDetail = `${row.slug} count ${row.farm_steps.length}`;
    break;
  }
  for (const step of row.farm_steps) {
    const n = String(step).trim().length;
    if (n < 20 || n > 600) {
      farmOk = false;
      farmDetail = `${row.slug} length ${n}`;
      break;
    }
  }
  if (!farmOk) break;
}
check('farm_steps', farmOk, farmDetail || `${rows[0].farm_steps.length} steps`);

function pngSize(buf) {
  if (buf.length < 24 || buf[0] !== 0x89 || buf.toString('ascii', 1, 4) !== 'PNG') return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}
function jpegSize(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    }
    if (len < 2) break;
    i += 2 + len;
  }
  return null;
}
const shots = readdirSync(join(out, 'screenshots')).filter((n) => !n.startsWith('.')).sort();
let shotOk = shots.length === 3 || shots.length === 4;
let shotDetail = shots.join(', ');
if (shotOk) {
  for (const name of shots) {
    const buf = readFileSync(join(out, 'screenshots', name));
    const dim = pngSize(buf) || jpegSize(buf);
    const long = dim ? Math.max(dim.w, dim.h) : 0;
    const short = dim ? Math.min(dim.w, dim.h) : 0;
    if (!dim || buf.length > 524_288 || long > 1440 || short < 800) {
      shotOk = false;
      shotDetail = `${name} ${buf.length} ${dim ? `${dim.w}x${dim.h}` : 'not an image'}`;
      break;
    }
    shotDetail = `${shotDetail}; ${name} ${buf.length} ${dim.w}x${dim.h}`;
  }
}
check('screenshots', shotOk, shotDetail);

let dossierOk = false;
let dossierDetail = '';
try {
  const expected = Buffer.from(buildDossier(out, { text_max_bytes: 65536, screenshots: { max: 4, max_bytes: 524_288 }, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));
  const actual = readFileSync(join(out, 'dossier.json'));
  const text = actual.toString('utf8');
  dossierOk = actual.equals(expected) && actual.length <= 1_572_864 && !text.includes('not shown');
  dossierDetail = `${actual.length} bytes${actual.equals(expected) ? '' : ' mismatch'}${text.includes('not shown') ? ' cut' : ''}`;
} catch (err) {
  dossierDetail = err instanceof Error ? err.message : String(err);
}
check('dossier_matches', dossierOk, dossierDetail);

process.exit(fails.length === 0 ? 0 : 1);
