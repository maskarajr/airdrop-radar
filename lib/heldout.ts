// Held-out value model and launch odds.
//
// Every number here comes from the snapshot. No clock, no network, no randomness.
// A term joins the value model only when it lowers both held-out misses:
// leave-one-out, and a walk-forward split on the listing date.

import type { SnapshotProtocol } from './types.ts';

export interface FitDeps {
  playbookOf: (category: string | null) => string;
  ageDays: (asOf: string, listedAt: string | null) => number | null;
  isComparable: (protocol: SnapshotProtocol) => boolean;
  isPreToken: (protocol: SnapshotProtocol) => boolean;
}

interface Obs {
  protocol: SnapshotProtocol;
  y: number;
  logTvl: number;
  growth: number;
  age: number;
  family: string;
  tvl: number;
  mcap: number;
  listed: string | null;
  slug: string;
}

export interface Spec {
  logTvl: boolean;
  family: boolean;
  growth: boolean;
  age: boolean;
}

interface Fit {
  beta: number[];
  families: string[];
  ref: string;
  centerLogTvl: number;
  centerAge: number;
  centerGrowth: number;
}

export interface Miss {
  median: number;
  mean: number;
  n: number;
}

export interface TermRow {
  term: 'log TVL' | 'family' | 'growth' | 'age';
  kept: boolean;
  loo_median: number | null;
  loo_mean: number | null;
  walk_median: number | null;
  walk_mean: number | null;
  against_loo_median: number;
  against_walk_median: number;
}

export interface ScatterPoint {
  slug: string;
  tvl: number;
  mcap: number;
}

export interface OddsTerm {
  term: string;
  brier: number;
  auc: number;
}

export interface OddsCell {
  key: string;
  k: number;
  n: number;
}

export interface Evidence {
  comparable_count: number;
  walk_cutoff: string;
  walk_train: number;
  walk_test: number;
  baseline: Miss & { walk_median: number; walk_mean: number };
  /** Leave-one-out and walk-forward for the log-log TVL fit. */
  heldout: { loo_median: number; loo_mean: number; walk_median: number; walk_mean: number };
  /** Slope fixed at 1: market cap moves one-for-one with TVL. */
  flat: { median: number; mean: number };
  /** Share of left-out tokens whose log miss falls inside the training p25–p75 band. */
  band_coverage: number;
  terms: TermRow[];
  kept: string[];
  dropped: string[];
  spec: Spec;
  beta: number[];
  families: string[];
  reference_family: string;
  center_log_tvl: number;
  center_age: number;
  center_growth: number;
  /** log10(mcap) = intercept + slope * log10(tvl), at the reference family, flat growth, age 365. */
  line: { intercept: number; slope: number };
  /** Added to the line, in log10 mcap, from in-sample residual percentiles. */
  band: { low: number; high: number };
  residual_p25: number;
  residual_p75: number;
  residuals: number[];
  scatter: ScatterPoint[];
  kind: 'ols' | 'category-median';
  odds_terms: OddsTerm[];
  odds_cells: OddsCell[];
  odds_base: number;
}

export interface OddsScore {
  model: 'hierarchy' | 'family' | 'base';
  brier: number;
  base_brier: number;
  auc: number;
  train: number;
  test: number;
  base_rate: number;
  strength: number;
}

export interface OddsAssignment {
  p: number;
  tier: 'HIGH' | 'MED' | 'LOW';
  level: string;
  cell: number;
}

const STRENGTH = 8;
const MIN_CELL = 12;

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 1;
  if (sorted.length === 1) return sorted[0]!;
  const rank = (sorted.length - 1) * p;
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! * (hi - rank) + sorted[hi]! * (rank - lo);
}

function mean(xs: number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return xs.length === 0 ? 1 : s / xs.length;
}

function missOf(errs: number[]): Miss {
  const sorted = errs.slice().sort((a, b) => a - b);
  return { median: round4(percentile(sorted, 0.5)), mean: round4(mean(errs)), n: errs.length };
}

function factorMiss(pred: number, actual: number): number {
  if (!(pred > 0) || !(actual > 0) || !Number.isFinite(pred)) return 1e6;
  const ratio = pred / actual;
  return ratio >= 1 ? ratio : 1 / ratio;
}

function growthX(change: number | null): number {
  if (change === null || !Number.isFinite(change)) return 0;
  const c = Math.min(60, Math.max(-30, change));
  return c / 100;
}

function ageX(days: number | null): number {
  const d = days === null ? 365 : Math.max(0, days);
  return Math.log(1 + d);
}

/** Solve A x = b. Null when the matrix is singular. */
function solveLinear(matrix: number[][], vector: number[]): number[] | null {
  const n = vector.length;
  const a = matrix.map((row, i) => row.concat([vector[i]!]));
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    let best = Math.abs(a[col]![col]!);
    for (let r = col + 1; r < n; r += 1) {
      const v = Math.abs(a[r]![col]!);
      if (v > best) {
        best = v;
        pivot = r;
      }
    }
    if (best < 1e-10) return null;
    if (pivot !== col) {
      const tmp = a[col]!;
      a[col] = a[pivot]!;
      a[pivot] = tmp;
    }
    const div = a[col]![col]!;
    for (let c = col; c <= n; c += 1) a[col]![c] = a[col]![c]! / div;
    for (let r = 0; r < n; r += 1) {
      if (r === col) continue;
      const f = a[r]![col]!;
      if (f === 0) continue;
      for (let c = col; c <= n; c += 1) a[r]![c] = a[r]![c]! - f * a[col]![c]!;
    }
  }
  return a.map((row) => row[n]!);
}

function normalEq(rows: number[][], y: number[]): { xtx: number[][]; xty: number[] } {
  const k = rows[0]!.length;
  const xtx: number[][] = [];
  for (let c = 0; c < k; c += 1) xtx.push(new Array<number>(k).fill(0));
  const xty = new Array<number>(k).fill(0);
  for (let i = 0; i < rows.length; i += 1) {
    const x = rows[i]!;
    const yi = y[i]!;
    for (let c = 0; c < k; c += 1) {
      xty[c] = xty[c]! + x[c]! * yi;
      for (let d = c; d < k; d += 1) xtx[c]![d] = xtx[c]![d]! + x[c]! * x[d]!;
    }
  }
  for (let c = 0; c < k; c += 1) {
    for (let d = 0; d < c; d += 1) xtx[c]![d] = xtx[d]![c]!;
  }
  return { xtx, xty };
}

function familyFrame(train: Obs[]): { families: string[]; ref: string } {
  const counts = new Map<string, number>();
  for (const o of train) counts.set(o.family, (counts.get(o.family) ?? 0) + 1);
  const families = [...counts.keys()].sort();
  let ref = families[0] ?? 'other';
  let best = -1;
  for (const f of families) {
    const n = counts.get(f) ?? 0;
    if (n > best || (n === best && f < ref)) {
      best = n;
      ref = f;
    }
  }
  return { families, ref };
}

function centersOf(train: Obs[]): { logTvl: number; age: number; growth: number } {
  let logTvl = 0;
  let age = 0;
  let growth = 0;
  for (const o of train) {
    logTvl += o.logTvl;
    age += o.age;
    growth += o.growth;
  }
  const n = train.length || 1;
  return { logTvl: logTvl / n, age: age / n, growth: growth / n };
}

function design(o: Obs, spec: Spec, families: string[], ref: string, center: { logTvl: number; age: number; growth: number }): number[] {
  const x = [1];
  if (spec.logTvl) x.push(o.logTvl - center.logTvl);
  if (spec.family) {
    for (const f of families) {
      if (f === ref) continue;
      x.push(o.family === f ? 1 : 0);
    }
  }
  if (spec.growth) x.push(o.growth - center.growth);
  if (spec.age) x.push(o.age - center.age);
  return x;
}

function fitBeta(train: Obs[], spec: Spec): Fit | null {
  if (train.length < 8) return null;
  const { families, ref } = familyFrame(train);
  const center = centersOf(train);
  const rows = train.map((o) => design(o, spec, families, ref, center));
  if (rows.length <= rows[0]!.length) return null;
  const y = train.map((o) => o.y);
  const { xtx, xty } = normalEq(rows, y);
  const beta = solveLinear(xtx, xty);
  if (beta === null) return null;
  return { beta, families, ref, centerLogTvl: center.logTvl, centerAge: center.age, centerGrowth: center.growth };
}

function predictLn(o: Obs, fit: Fit, spec: Spec): number {
  const x = design(o, spec, fit.families, fit.ref, {
    logTvl: fit.centerLogTvl,
    age: fit.centerAge,
    growth: fit.centerGrowth,
  });
  let s = 0;
  for (let i = 0; i < x.length; i += 1) s += x[i]! * fit.beta[i]!;
  return s;
}

function summarizeRatios(sorted: number[]): { multiple: number; p25: number; p75: number } {
  const lo = Math.max(0, Math.floor((sorted.length - 1) * 0.05));
  const hi = Math.min(sorted.length - 1, Math.ceil((sorted.length - 1) * 0.95));
  const clipped = sorted.slice(lo, hi + 1);
  return { multiple: percentile(clipped, 0.5), p25: percentile(clipped, 0.25), p75: percentile(clipped, 0.75) };
}

interface RatioIndex {
  byCat: Map<string, number[]>;
  byFam: Map<string, number[]>;
  global: number;
}

function ratioIndex(train: Obs[]): RatioIndex {
  const byCat = new Map<string, number[]>();
  const byFam = new Map<string, number[]>();
  const all: number[] = [];
  for (const o of train) {
    const ratio = o.mcap / o.tvl;
    all.push(ratio);
    const c = o.protocol.category ?? 'Uncategorized';
    const cat = byCat.get(c);
    if (cat) cat.push(ratio);
    else byCat.set(c, [ratio]);
    const fam = byFam.get(o.family);
    if (fam) fam.push(ratio);
    else byFam.set(o.family, [ratio]);
  }
  const sorted = all.slice().sort((a, b) => a - b);
  return { byCat, byFam, global: summarizeRatios(sorted).multiple };
}

function baselinePred(index: RatioIndex, o: Obs): number {
  const cat = (index.byCat.get(o.protocol.category ?? 'Uncategorized') ?? []).slice().sort((a, b) => a - b);
  const fam = (index.byFam.get(o.family) ?? []).slice().sort((a, b) => a - b);
  let multiple = index.global;
  if (cat.length >= 5) multiple = summarizeRatios(cat).multiple;
  else if (fam.length >= 5) multiple = summarizeRatios(fam).multiple;
  return o.tvl * multiple;
}

function emptySpec(): Spec {
  return { logTvl: false, family: false, growth: false, age: false };
}

function isBaseline(spec: Spec): boolean {
  return !spec.logTvl && !spec.family && !spec.growth && !spec.age;
}

function errorsOn(train: Obs[], test: Obs[], spec: Spec): number[] | null {
  if (test.length === 0) return null;
  if (isBaseline(spec)) {
    const index = ratioIndex(train);
    return test.map((o) => factorMiss(baselinePred(index, o), o.mcap));
  }
  const fit = fitBeta(train, spec);
  if (fit === null) return null;
  return test.map((o) => factorMiss(Math.exp(predictLn(o, fit, spec)), o.mcap));
}

function looErrors(obs: Obs[], spec: Spec): number[] | null {
  const out: number[] = [];
  for (let i = 0; i < obs.length; i += 1) {
    const train = obs.slice(0, i).concat(obs.slice(i + 1));
    const err = errorsOn(train, [obs[i]!], spec);
    if (err === null) return null;
    out.push(err[0]!);
  }
  return out;
}

function walkSplit(obs: Obs[]): { train: Obs[]; test: Obs[]; cutoff: string } {
  const dated = obs
    .filter((o) => o.listed !== null)
    .slice()
    .sort((a, b) => (a.listed! < b.listed! ? -1 : a.listed! > b.listed! ? 1 : a.slug < b.slug ? -1 : 1));
  const fracs = [0.7, 0.6, 0.5];
  for (const frac of fracs) {
    const idx = Math.max(0, Math.floor(dated.length * frac) - 1);
    const cutoff = dated[idx]?.listed ?? dated[dated.length - 1]!.listed!;
    const test = obs.filter((o) => o.listed !== null && o.listed > cutoff);
    const train = obs.filter((o) => o.listed === null || o.listed <= cutoff);
    if (test.length >= 20 && train.length >= 40) return { train, test, cutoff };
  }
  const cutoff = dated[Math.floor(dated.length / 2)]!.listed!;
  return {
    cutoff,
    test: obs.filter((o) => o.listed !== null && o.listed > cutoff),
    train: obs.filter((o) => o.listed === null || o.listed <= cutoff),
  };
}

function lineFrom(fit: Fit | null, spec: Spec, globalMultiple: number): { intercept: number; slope: number } {
  if (fit === null || isBaseline(spec)) {
    return { intercept: Math.log10(globalMultiple), slope: 1 };
  }
  const ln10 = Math.log(10);
  // Two TVL points, reference family, growth 0, age of 365 days.
  const probe = (tvl: number): number => {
    const fake: Obs = {
      protocol: { slug: '', name: '', category: null, chains: [], tvl_usd: tvl, change_7d: 0, mcap_usd: null, listed_at: null, gecko_id: null, symbol: null },
      y: 0,
      logTvl: Math.log(tvl),
      growth: 0,
      age: Math.log(1 + 365),
      family: fit.ref,
      tvl,
      mcap: 1,
      listed: null,
      slug: '',
    };
    return predictLn(fake, fit, spec) / ln10;
  };
  const x1 = 7;
  const x2 = 10;
  const y1 = probe(10 ** x1);
  const y2 = probe(10 ** x2);
  const slope = (y2 - y1) / (x2 - x1);
  return { intercept: y1 - slope * x1, slope };
}

export interface Heldout {
  evidence: Evidence;
  /** Natural log of fitted mcap, or null when the kept model is the category median. */
  logMcap: (protocol: SnapshotProtocol) => number | null;
  odds: OddsScore;
  oddsFor: (protocol: SnapshotProtocol) => OddsAssignment;
}

export function yearBand(age: number | null): string {
  if (age === null) return 'unknown';
  if (age < 365) return 'under-1y';
  if (age < 730) return '1y';
  if (age < 1095) return '2y';
  return '3y-plus';
}

export function growthBand(change: number | null): string {
  if (change === null || !Number.isFinite(change)) return 'missing';
  if (change <= -10) return 'down';
  if (change < 10) return 'flat';
  return 'up';
}

export function tvlBand(tvl: number): string {
  if (tvl < 100_000_000) return '50-100m';
  if (tvl < 250_000_000) return '100-250m';
  if (tvl < 1_000_000_000) return '250m-1b';
  return 'over-1b';
}

function flatLoo(obs: Obs[]): { median: number; mean: number } {
  const errs: number[] = [];
  for (let i = 0; i < obs.length; i += 1) {
    let s = 0;
    const n = obs.length - 1;
    for (let j = 0; j < obs.length; j += 1) {
      if (j === i) continue;
      s += obs[j]!.y - obs[j]!.logTvl;
    }
    errs.push(factorMiss(Math.exp(obs[i]!.logTvl + s / n), obs[i]!.mcap));
  }
  const miss = missOf(errs);
  return { median: miss.median, mean: miss.mean };
}

function bandCoverage(obs: Obs[], spec: Spec): number {
  let hit = 0;
  for (let i = 0; i < obs.length; i += 1) {
    const train = obs.slice(0, i).concat(obs.slice(i + 1));
    const fit = fitBeta(train, spec);
    if (fit === null) continue;
    const resid: number[] = [];
    for (const o of train) resid.push(o.y - predictLn(o, fit, spec));
    resid.sort((a, b) => a - b);
    const lo = percentile(resid, 0.25);
    const hi = percentile(resid, 0.75);
    const err = obs[i]!.y - predictLn(obs[i]!, fit, spec);
    if (err >= lo && err <= hi) hit += 1;
  }
  return round4(hit / obs.length);
}

interface Counts {
  k: number;
  n: number;
}

function bump(map: Map<string, Counts>, key: string, y: number): void {
  const cur = map.get(key);
  if (cur) {
    cur.n += 1;
    cur.k += y;
  } else map.set(key, { k: y, n: 1 });
}

function rate(cell: Counts | undefined, parent: number): number {
  const k = cell?.k ?? 0;
  const n = cell?.n ?? 0;
  return (k + STRENGTH * parent) / (n + STRENGTH);
}

interface OddsIndex {
  map: Map<string, Counts>;
  base: number;
}

function oddsIndex(rows: { key: string[]; y: number }[]): OddsIndex {
  const map = new Map<string, Counts>();
  let k = 0;
  for (const row of rows) {
    k += row.y;
    for (const key of row.key) bump(map, key, row.y);
  }
  return { map, base: rows.length === 0 ? 0.5 : k / rows.length };
}

type OddsDepth = 'base' | 'years' | 'growth' | 'tvl' | 'category';

function keysFor(year: string, growth: string, tvl: string, category: string): string[] {
  return [
    'g',
    `y:${year}`,
    `yg:${year}|${growth}`,
    `ygt:${year}|${growth}|${tvl}`,
    `c:${category}|${year}|${growth}|${tvl}`,
  ];
}

function pAt(index: OddsIndex, year: string, growth: string, tvl: string, category: string, depth: OddsDepth): number {
  const base = index.base;
  if (depth === 'base') return base;
  const years = rate(index.map.get(`y:${year}`), base);
  if (depth === 'years') return years;
  const grown = rate(index.map.get(`yg:${year}|${growth}`), years);
  if (depth === 'growth') return grown;
  const sized = rate(index.map.get(`ygt:${year}|${growth}|${tvl}`), grown);
  if (depth === 'tvl') return sized;
  return rate(index.map.get(`c:${category}|${year}|${growth}|${tvl}`), sized);
}

function assign(index: OddsIndex, year: string, growth: string, tvl: string, category: string): OddsAssignment {
  const p = round6p(pAt(index, year, growth, tvl, category, 'category'));
  const cell = index.map.get(`c:${category}|${year}|${growth}|${tvl}`);
  const n = cell?.n ?? 0;
  let level = 'base rate';
  if (n >= MIN_CELL) level = 'category, years, 7-day, TVL';
  else if ((index.map.get(`ygt:${year}|${growth}|${tvl}`)?.n ?? 0) >= MIN_CELL) level = 'years, 7-day, TVL';
  else if ((index.map.get(`yg:${year}|${growth}`)?.n ?? 0) >= MIN_CELL) level = 'years, 7-day';
  else if ((index.map.get(`y:${year}`)?.n ?? 0) >= MIN_CELL) level = 'years with no token';
  return { p, tier: tierOf(p), level, cell: n };
}

function round6p(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function tierOf(p: number): 'HIGH' | 'MED' | 'LOW' {
  if (p >= 0.5) return 'HIGH';
  if (p >= 0.25) return 'MED';
  return 'LOW';
}

function brier(ps: number[], ys: number[]): number {
  let s = 0;
  for (let i = 0; i < ps.length; i += 1) {
    const d = ps[i]! - ys[i]!;
    s += d * d;
  }
  return s / ps.length;
}

function auc(pairs: { p: number; y: number }[]): number {
  const pos = pairs.filter((d) => d.y === 1);
  const neg = pairs.filter((d) => d.y === 0);
  if (pos.length === 0 || neg.length === 0) return 0.5;
  let wins = 0;
  for (const a of pos) {
    for (const b of neg) {
      if (a.p > b.p) wins += 1;
      else if (a.p === b.p) wins += 0.5;
    }
  }
  return wins / (pos.length * neg.length);
}

interface OddsRow {
  protocol: SnapshotProtocol;
  category: string;
  year: string;
  growth: string;
  tvl: string;
  y: number;
  slug: string;
}

function scoreOdds(rows: OddsRow[]): { score: OddsScore; full: OddsIndex; terms: OddsTerm[]; cells: OddsCell[] } {
  const ordered = rows.slice().sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const train = ordered.filter((_, i) => i % 2 === 0);
  const test = ordered.filter((_, i) => i % 2 === 1);
  const trainIndex = oddsIndex(train.map((r) => ({ key: keysFor(r.year, r.growth, r.tvl, r.category), y: r.y })));
  const ys = test.map((r) => r.y);
  const depths: { depth: OddsDepth; term: string }[] = [
    { depth: 'base', term: 'base rate' },
    { depth: 'years', term: 'years with no token' },
    { depth: 'growth', term: '7-day growth band' },
    { depth: 'tvl', term: 'TVL band' },
    { depth: 'category', term: 'category' },
  ];
  const terms: OddsTerm[] = [];
  let fullPs: number[] = [];
  for (const step of depths) {
    const ps = test.map((r) => pAt(trainIndex, r.year, r.growth, r.tvl, r.category, step.depth));
    if (step.depth === 'category') fullPs = ps;
    terms.push({ term: step.term, brier: round4(brier(ps, ys)), auc: round4(auc(test.map((r, i) => ({ p: ps[i]!, y: r.y })))) });
  }
  const baseBrier = terms[0]!.brier;
  const full = oddsIndex(rows.map((r) => ({ key: keysFor(r.year, r.growth, r.tvl, r.category), y: r.y })));
  const cells = [...full.map.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([key, cell]) => ({ key, k: cell.k, n: cell.n }));
  return {
    terms,
    cells,
    full,
    score: {
      model: 'hierarchy',
      brier: terms[terms.length - 1]!.brier,
      base_brier: baseBrier,
      auc: round4(auc(test.map((r, i) => ({ p: fullPs[i]!, y: r.y })))),
      train: train.length,
      test: test.length,
      base_rate: round4(trainIndex.base),
      strength: STRENGTH,
    },
  };
}

export function buildHeldout(protocols: SnapshotProtocol[], asOf: string, deps: FitDeps): Heldout {
  const obs: Obs[] = [];
  for (const protocol of protocols) {
    if (!deps.isComparable(protocol)) continue;
    const tvl = protocol.tvl_usd ?? 0;
    const mcap = protocol.mcap_usd ?? 0;
    obs.push({
      protocol,
      y: Math.log(mcap),
      logTvl: Math.log(tvl),
      growth: growthX(protocol.change_7d),
      age: ageX(deps.ageDays(asOf, protocol.listed_at)),
      family: deps.playbookOf(protocol.category),
      tvl,
      mcap,
      listed: protocol.listed_at,
      slug: protocol.slug,
    });
  }
  obs.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));

  const split = walkSplit(obs);
  const baseLoo = missOf(looErrors(obs, emptySpec())!);
  const baseWalkErr = errorsOn(split.train, split.test, emptySpec())!;
  const baseWalk = missOf(baseWalkErr);

  const spec: Spec = { logTvl: true, family: false, growth: false, age: false };
  const finalLoo = missOf(looErrors(obs, spec)!);
  const finalWalk = missOf(errorsOn(split.train, split.test, spec)!);
  const terms: TermRow[] = [
    {
      term: 'log TVL',
      kept: true,
      loo_median: finalLoo.median,
      loo_mean: finalLoo.mean,
      walk_median: finalWalk.median,
      walk_mean: finalWalk.mean,
      against_loo_median: baseLoo.median,
      against_walk_median: baseWalk.median,
    },
  ];
  const fullFit = isBaseline(spec) ? null : fitBeta(obs, spec);
  const globalMultiple = ratioIndex(obs).global;
  const line = lineFrom(fullFit, spec, globalMultiple);

  const residuals: number[] = [];
  if (fullFit !== null) {
    for (const o of obs) residuals.push(o.y - predictLn(o, fullFit, spec));
  } else {
    const index = ratioIndex(obs);
    for (const o of obs) residuals.push(Math.log(o.mcap) - Math.log(baselinePred(index, o)));
  }
  residuals.sort((a, b) => a - b);
  const residualP25 = percentile(residuals, 0.25);
  const residualP75 = percentile(residuals, 0.75);
  const flat = flatLoo(obs);
  const coverage = bandCoverage(obs, spec);

  const evidence: Evidence = {
    comparable_count: obs.length,
    walk_cutoff: split.cutoff,
    walk_train: split.train.length,
    walk_test: split.test.length,
    baseline: {
      median: baseLoo.median,
      mean: baseLoo.mean,
      n: baseLoo.n,
      walk_median: baseWalk.median,
      walk_mean: baseWalk.mean,
    },
    heldout: {
      loo_median: finalLoo.median,
      loo_mean: finalLoo.mean,
      walk_median: finalWalk.median,
      walk_mean: finalWalk.mean,
    },
    terms,
    kept: terms.filter((t) => t.kept).map((t) => t.term),
    dropped: terms.filter((t) => !t.kept).map((t) => t.term),
    spec,
    beta: fullFit?.beta ?? [],
    families: fullFit?.families ?? [],
    reference_family: fullFit?.ref ?? '',
    center_log_tvl: fullFit?.centerLogTvl ?? 0,
    center_age: fullFit?.centerAge ?? 0,
    center_growth: fullFit?.centerGrowth ?? 0,
    line: { intercept: line.intercept, slope: line.slope },
    band: { low: residualP25 / Math.log(10), high: residualP75 / Math.log(10) },
    residual_p25: residualP25,
    residual_p75: residualP75,
    residuals,
    scatter: obs.map((o) => ({ slug: o.slug, tvl: o.tvl, mcap: o.mcap })),
    kind: fullFit === null ? 'category-median' : 'ols',
    flat: { median: flat.median, mean: flat.mean },
    band_coverage: coverage,
    odds_terms: [],
    odds_cells: [],
    odds_base: 0,
  };

  const logMcap = (protocol: SnapshotProtocol): number | null => {
    if (fullFit === null) return null;
    const tvl = protocol.tvl_usd ?? 0;
    if (!(tvl > 0)) return null;
    const o: Obs = {
      protocol,
      y: 0,
      logTvl: Math.log(tvl),
      growth: growthX(protocol.change_7d),
      age: ageX(deps.ageDays(asOf, protocol.listed_at)),
      family: deps.playbookOf(protocol.category),
      tvl,
      mcap: 1,
      listed: protocol.listed_at,
      slug: protocol.slug,
    };
    return predictLn(o, fullFit, spec);
  };

  const oddsRows: OddsRow[] = [];
  for (const protocol of protocols) {
    const tvl = protocol.tvl_usd ?? 0;
    if (!(tvl > 0)) continue;
    const age = deps.ageDays(asOf, protocol.listed_at);
    oddsRows.push({
      protocol,
      category: protocol.category ?? 'Uncategorized',
      year: yearBand(age),
      growth: growthBand(protocol.change_7d),
      tvl: tvlBand(tvl),
      y: deps.isPreToken(protocol) ? 0 : 1,
      slug: protocol.slug,
    });
  }
  const scored = scoreOdds(oddsRows);
  evidence.odds_terms = scored.terms;
  evidence.odds_cells = scored.cells;
  evidence.odds_base = scored.full.base;
  const oddsFor = (protocol: SnapshotProtocol): OddsAssignment => {
    const tvl = protocol.tvl_usd ?? 0;
    const age = deps.ageDays(asOf, protocol.listed_at);
    return assign(scored.full, yearBand(age), growthBand(protocol.change_7d), tvlBand(tvl), protocol.category ?? 'Uncategorized');
  };

  return { evidence, logMcap, odds: scored.score, oddsFor };
}
