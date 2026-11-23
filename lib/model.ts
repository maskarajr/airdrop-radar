// Token radar value model. Every figure comes from the snapshot: no name is special-cased.
//
// implied_value_usd = round(tvl × categoryMultiple × growthFactor × maturityFactor × breadthFactor × sizeFactor)
//
// categoryMultiple is the median mcap/TVL of protocols in that category whose token already trades
// (positive mcap_usd), after dropping non-positive ratios and clipping to the 5th–95th percentile.
// A category with fewer than 5 such tokens uses the global median of that same clipped set.
// The ranked board is only protocols that record no token. Traded tokens are comparables, not rows.

import type { Snapshot, SnapshotProtocol } from './types.ts';

export type { Snapshot, SnapshotProtocol } from './types.ts';
export { parseSnapshot, SnapshotError } from './types.ts';

export const MODEL_VERSION = 'comparables-1';

export const MIN_CATEGORY_SAMPLE = 5;
export const GROWTH_FLOOR = -30;
export const GROWTH_CAP = 60;
export const GROWTH_WEIGHT = 0.5;

/** Day knots for maturityFactor: [age_days, factor]. Rises into the 6–18 month window, then fades. */
export const MATURITY_KNOTS: ReadonlyArray<readonly [number, number]> = [
  [0, 0.85],
  [180, 1],
  [365, 1.15],
  [540, 1.12],
  [1095, 0.9],
  [1825, 0.72],
];

export const BREADTH_FACTORS = [1, 1.03, 1.06, 1.08] as const;
export const SIZE_LOG_LO = 6.7;
export const SIZE_LOG_HI = 10;
export const SIZE_FACTOR_LO = 0.97;
export const SIZE_FACTOR_SPAN = 0.11;

/** Gas for one simple transaction, in US cents, keyed by the snapshot's chain name. */
export const GAS_CENTS: Record<string, number> = {
  Ethereum: 600,
  Arbitrum: 8,
  Base: 8,
  Optimism: 8,
  Unichain: 8,
  Scroll: 12,
  Linea: 12,
  'zkSync Era': 12,
  Blast: 10,
  Mantle: 10,
  Solana: 2,
  Binance: 12,
  BSC: 12,
  'BNB Chain': 12,
  Polygon: 25,
  Avalanche: 40,
  'Hyperliquid L1': 5,
  Sui: 2,
  Aptos: 2,
  Tron: 40,
  Bitcoin: 150,
  Near: 5,
  TON: 5,
};

export const GAS_DEFAULT_CENTS = 80;

export const METHOD = {
  thesis:
    'Implied value is TVL times a category mcap/TVL multiple taken from protocols whose token already trades, then scaled by 7-day growth, time listed with no token, chain breadth and size.',
  formula:
    'implied_value_usd = round(tvl_usd × categoryMultiple × growthFactor × maturityFactor × breadthFactor × sizeFactor), and at least 1.',
  growth:
    'growthFactor = 1 + clamp(change_7d, -30, 60) / 100 × 0.5. A missing 7-day change is neutral (1).',
  maturity:
    'maturityFactor is piecewise linear: 0.85 at day 0, 1.00 at day 180, 1.15 at day 365, 1.12 at day 540, 0.90 at day 1095, 0.72 at day 1825 and after. A missing listed_at is neutral (1). The rise matches the 6 to 18 month window; the fade treats a token as less likely after about 3 years.',
  breadth: 'breadthFactor is 1.00, 1.03, 1.06 or 1.08 for 1, 2, 3 or 4 or more chains on the record.',
  size:
    'sizeFactor moves from 0.97 at about $5M TVL (log10 6.7) to 1.08 at $10B (log10 10). TVL already scales the result; this term is only a small size tilt.',
  multiples:
    'categoryMultiple is the median of mcap_usd / tvl_usd for protocols in the category with a positive market cap, after clipping that category to its own 5th–95th percentile. Fewer than 5 such tokens, and the row uses the global median of all positive ratios clipped to the global 5th–95th percentile. Low and high use that set’s 25th and 75th percentiles in place of the median.',
  separation:
    'A protocol records no token when gecko_id and symbol are both null. Only those rows are ranked. A protocol with a positive mcap_usd is listed as a comparable: its token already trades, and it is not ranked.',
  exclusions:
    'Every watchlist slug is on the board. Other rows are pre-token protocols that are not a CEX, a bridge, liquid staking, liquid restaking, a stablecoin wrapper, a versioned pool name, or a name that says wrapped, staked or bridged.',
  caveats: [
    'DefiLlama’s record is not proof that a token does or does not exist.',
    'Implied value is this radar’s claim from the snapshot’s TVL and market-cap ratios. It is not a price, a promise or financial advice.',
    'A symbol with no market cap is not a comparable. Versioned pools often reuse a parent symbol and record no mcap.',
    'Farm costs are planning estimates from a chain gas table and a TVL-tier capital probe, not live quotes.',
  ],
} as const;

const EXCLUDED_CATEGORIES = new Set([
  'CEX',
  'Bridge',
  'Canonical Bridge',
  'Cross Chain Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Stablecoin Wrapper',
]);

const VERSIONED_NAME = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

export type Playbook =
  | 'lending'
  | 'dex'
  | 'perps'
  | 'basis'
  | 'yield'
  | 'rwa'
  | 'staking'
  | 'bridge'
  | 'prediction'
  | 'launchpad'
  | 'insurance'
  | 'other';

export type MultipleSource = 'category' | 'global';

export interface MultipleStats {
  category: string;
  sample: number;
  used: number;
  source: MultipleSource;
  multiple: number;
  p25: number;
  p75: number;
}

export interface GlobalMultiple {
  sample_positive: number;
  sample_clipped: number;
  p05: number;
  p95: number;
  multiple: number;
  p25: number;
  p75: number;
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  low_value_usd: number;
  high_value_usd: number;
  farm_steps: string[];
  category: string;
  chains: string[];
  primary_chain: string;
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  listed_at: string | null;
  watchlist: boolean;
  token_status: 'records-no-token';
  category_multiple: number;
  multiple_p25: number;
  multiple_p75: number;
  multiple_source: MultipleSource;
  comparable_count: number;
  growth_factor: number;
  maturity_factor: number;
  breadth_factor: number;
  size_factor: number;
  capital_usd: number;
  gas_per_tx_usd: number;
  gas_tx_count: number;
  gas_total_usd: number;
  hold_days: number;
  playbook: Playbook;
  risk_flags: string[];
  farm_headline: string;
}

export interface Comparable {
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
  mcap_tvl: number;
  symbol: string | null;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  thesis: string;
  formula: string;
  method: typeof METHOD;
  counts: {
    protocols: number;
    pre_token: number;
    records_token: number;
    traded: number;
    board: number;
    watchlist: number;
    watchlist_on_board: number;
    early: number;
  };
  global_multiple: GlobalMultiple;
  category_multiples: MultipleStats[];
  rows: BoardRow[];
  comparables: Comparable[];
  watchlist: string[];
  gas_table: { chain: string; usd_per_tx: number }[];
  gas_default_usd: number;
  early_size: number;
  live_size: number;
}

const DAY_MS = 86_400_000;

export function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Linear percentile on a sorted array. p is 0..1. */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  if (lo === hi) return sorted[lo]!;
  const w = i - lo;
  return sorted[lo]! * (1 - w) + sorted[hi]! * w;
}

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

export function isPreToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

export function isComparable(p: SnapshotProtocol): boolean {
  return !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0;
}

function isWrappedName(name: string): boolean {
  if (VERSIONED_NAME.test(name)) return true;
  const n = name.toLowerCase();
  if (n.includes('wrapped')) return true;
  if (/\bstaked\b/.test(n)) return true;
  if (/\bbridged\b/.test(n)) return true;
  return false;
}

/** Pre-token rows the radar may add beyond the watchlist. */
export function isEligibleAddition(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (isWrappedName(p.name)) return false;
  return true;
}

export function growthFactor(change: number | null): number {
  if (change === null) return 1;
  const g = Math.min(GROWTH_CAP, Math.max(GROWTH_FLOOR, change));
  return round6(1 + (g / 100) * GROWTH_WEIGHT);
}

export function maturityFactor(age: number | null): number {
  if (age === null) return 1;
  const knots = MATURITY_KNOTS;
  if (age <= knots[0]![0]) return knots[0]![1];
  const last = knots[knots.length - 1]!;
  if (age >= last[0]) return last[1];
  for (let i = 1; i < knots.length; i++) {
    const right = knots[i]!;
    if (age <= right[0]) {
      const left = knots[i - 1]!;
      const t = (age - left[0]) / (right[0] - left[0]);
      return round6(left[1] + (right[1] - left[1]) * t);
    }
  }
  return last[1];
}

export function breadthFactor(chains: readonly string[]): number {
  const n = chains.length;
  if (n <= 1) return BREADTH_FACTORS[0];
  if (n === 2) return BREADTH_FACTORS[1];
  if (n === 3) return BREADTH_FACTORS[2];
  return BREADTH_FACTORS[3];
}

export function sizeFactor(tvl: number): number {
  const log = Math.log10(tvl > 1 ? tvl : 1);
  let t = (log - SIZE_LOG_LO) / (SIZE_LOG_HI - SIZE_LOG_LO);
  if (t < 0) t = 0;
  if (t > 1) t = 1;
  return round6(SIZE_FACTOR_LO + t * SIZE_FACTOR_SPAN);
}

export function impliedValue(
  tvl: number,
  multiple: number,
  growth: number,
  maturity: number,
  breadth: number,
  size: number,
): number {
  const n = Math.round(tvl * multiple * growth * maturity * breadth * size);
  if (!Number.isFinite(n) || n < 1) return 1;
  if (n > 1e14) return 1e14;
  return n;
}

export function playbookOf(category: string | null): Playbook {
  const c = (category ?? '').toLowerCase();
  if (c.includes('bridge')) return 'bridge';
  if (c.includes('prediction')) return 'prediction';
  if (c.includes('launchpad')) return 'launchpad';
  if (c.includes('insurance')) return 'insurance';
  if (c.includes('basis')) return 'basis';
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'lending';
  if (c.includes('dex') || c.includes('liquidity manager')) return 'dex';
  if (c.includes('derivative') || c.includes('option') || c.includes('synthetic') || c.includes('perpetual')) return 'perps';
  if (c.includes('rwa')) return 'rwa';
  if (c.includes('stak') || c.includes('restak')) return 'staking';
  if (c.includes('yield') || c.includes('curator') || c.includes('allocator') || c.includes('farm') || c.includes('index') || c.includes('vault')) {
    return 'yield';
  }
  return 'other';
}

function assertNever(x: never): never {
  throw new Error(`unexpected playbook ${String(x)}`);
}

export function capitalUsd(tvl: number): number {
  if (tvl >= 5_000_000_000) return 2000;
  if (tvl >= 1_000_000_000) return 1000;
  if (tvl >= 250_000_000) return 500;
  if (tvl >= 50_000_000) return 250;
  if (tvl >= 10_000_000) return 100;
  return 50;
}

export function holdDays(age: number | null): number {
  if (age === null) return 21;
  if (age < 180) return 45;
  if (age < 540) return 30;
  if (age < 1095) return 21;
  return 14;
}

export function gasCentsForChain(chain: string): number {
  return GAS_CENTS[chain] ?? GAS_DEFAULT_CENTS;
}

function dollars(n: number): string {
  const r = Math.round(n);
  const body = String(Math.abs(r)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return r < 0 ? `-$${body}` : `$${body}`;
}

function gasPhrase(usd: number, chain: string): string {
  if (usd < 0.1) return `under $0.10 of gas on ${chain}`;
  if (usd >= 1) return `about ${dollars(usd)} of gas on ${chain}`;
  return `about $${usd.toFixed(2)} of gas on ${chain}`;
}

function formatCompact(n: number): string {
  const sign = n < 0 ? '-' : '';
  const v = Math.abs(n);
  const trim = (x: number): string => {
    const s = x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2);
    return s.replace(/\.0+$/, '').replace(/(\.\d)0$/, '$1');
  };
  if (v >= 1e9) return `${sign}$${trim(v / 1e9)}B`;
  if (v >= 1e6) return `${sign}$${trim(v / 1e6)}M`;
  if (v >= 1e3) return `${sign}$${trim(v / 1e3)}K`;
  return `${sign}$${Math.round(v)}`;
}

function ageClause(age: number | null, hold: number): string {
  if (age === null) return `The listed date is missing, so the maturity factor stays neutral and the hold is ${hold} days.`;
  if (age < 180) {
    return `It has been listed ${age} days and records no token, still under 6 months, so the hold is ${hold} days to build a record before the usual token window.`;
  }
  if (age < 540) {
    return `It has been listed ${age} days and records no token, inside the 6 to 18 month window, so the hold is ${hold} days.`;
  }
  if (age < 1095) {
    return `It has been listed ${age} days and records no token, past 18 months, so the hold is the shorter ${hold} days.`;
  }
  return `It has been listed ${age} days and records no token, past 3 years, when a token is less likely, so the hold is ${hold} days.`;
}

function chainNote(chains: readonly string[]): string {
  if (chains.length <= 1) return '';
  const rest = chains.slice(1, 4).join(', ');
  const more = chains.length > 4 ? ` and ${chains.length - 4} more` : '';
  return ` It also lists ${rest}${more}. Keep this probe on ${chains[0]} only.`;
}

function step(text: string, cost: string, time: string): string {
  let s = `${text} Cost: ${cost}. Time: ${time}.`;
  if (s.length > 600) s = `${s.slice(0, 597)}...`;
  if (s.length < 20) s = `${s} Recheck the position before leaving it.`;
  return s;
}

/** Paid transactions the plan actually commits to, not the optional weekly check. */
function gasTxCount(play: Playbook): number {
  switch (play) {
    case 'lending':
      return 2;
    case 'dex':
      return 1;
    case 'perps':
      return 2;
    case 'basis':
      return 1;
    case 'yield':
      return 1;
    case 'rwa':
      return 1;
    case 'staking':
      return 1;
    case 'bridge':
      return 3;
    case 'prediction':
      return 2;
    case 'launchpad':
      return 1;
    case 'insurance':
      return 1;
    case 'other':
      return 2;
    default:
      return assertNever(play);
  }
}

interface FarmContext {
  name: string;
  category: string;
  chains: string[];
  chain: string;
  tvl: number;
  capital: number;
  hold: number;
  age: number | null;
  gasUsd: number;
  gasText: string;
}

function actionSteps(play: Playbook, ctx: FarmContext): string[] {
  const { name, chain, capital, gasText } = ctx;
  const note = chainNote(ctx.chains);
  const tvlBit = `TVL on record is ${formatCompact(ctx.tvl)}, so the probe capital is ${dollars(capital)}.`;
  switch (play) {
    case 'lending': {
      const borrow = Math.max(10, Math.round(capital * 0.15));
      return [
        step(
          `On ${chain}, supply ${dollars(capital)} of a liquid stablecoin to ${name}.${note} ${tvlBit}`,
          `${dollars(capital)} of capital and ${gasText}`,
          '20 minutes',
        ),
        step(
          `Borrow about ${dollars(borrow)} (near 15% of the supply) and keep the health factor above 2.0. If it prints under 1.8, repay before any other action.`,
          gasText,
          '10 minutes',
        ),
      ];
    }
    case 'dex':
      return [
        step(
          `On ${chain}, add ${dollars(capital)} to ${name}'s deepest stablecoin pair. If the pool is concentrated, set a range about 10% either side of the current price.${note} ${tvlBit}`,
          `${dollars(capital)} of capital and ${gasText}`,
          '25 minutes',
        ),
        step(
          `If the price leaves that range, rebalance once. If it does not, leave the liquidity where it is and do not add a second pool in this probe.`,
          `${gasText} if you rebalance, otherwise $0`,
          '15 minutes if you rebalance',
        ),
      ];
    case 'perps':
      return [
        step(
          `On ${chain}, deposit ${dollars(capital)} of stablecoin margin on ${name}.${note} ${tvlBit}`,
          `${dollars(capital)} of capital and ${gasText}`,
          '15 minutes',
        ),
        step(
          `Open one hedged position with notional near ${dollars(Math.round(capital / 2))}, about half the margin, so a 10% move cannot wipe the account. Close it if margin health drops under 50%.`,
          gasText,
          '15 minutes',
        ),
      ];
    case 'basis':
      return [
        step(
          `On ${chain}, put ${dollars(capital)} into the ${name} basis position the app marks as delta-neutral. Do not add a borrow loop on top.${note} ${tvlBit}`,
          `${dollars(capital)} of capital and ${gasText}`,
          '20 minutes',
        ),
        step(
          `Read the funding or basis figure once at open. If the app does not open the hedge itself, stop and do not place one by hand for this probe.`,
          '$0 to read the figure',
          '10 minutes',
        ),
      ];
    case 'yield':
      return [
        step(
          `On ${chain}, deposit ${dollars(capital)} into the main ${name} vault and keep the share token in this same wallet.${note} ${tvlBit}`,
          `${dollars(capital)} of capital and ${gasText}`,
          '15 minutes',
        ),
        step(
          `Do not restake or deposit those shares into a second protocol during this probe. One vault, one wallet.`,
          '$0',
          '5 minutes to confirm the share balance',
        ),
      ];
    case 'rwa':
      return [
        step(
          `If ${name} asks for an identity check, finish it with the issuer before sending funds. ${tvlBit}`,
          '$0 on-chain for the check',
          '1 to 3 days if the issuer asks, otherwise 15 minutes',
        ),
        step(
          `On ${chain}, mint or buy ${dollars(capital)} of the ${name} claim and leave it in this wallet.${note}`,
          `${dollars(capital)} of capital and ${gasText}`,
          '20 minutes after the check',
        ),
      ];
    case 'staking':
      return [
        step(
          `On ${chain}, stake ${dollars(capital)} of the asset ${name} accepts and keep the receipt token in this wallet. Do not lend the receipt out.${note} ${tvlBit}`,
          `${dollars(capital)} of capital and ${gasText}`,
          '15 minutes',
        ),
        step(
          `Confirm the receipt balance matches the stake, minus only the gas just paid. If it does not, stop and unwind.`,
          '$0 to read the balance',
          '5 minutes',
        ),
      ];
    case 'bridge':
      return [
        step(
          `Send ${dollars(capital)} of stablecoin through ${name} to ${chain}, using only the bridge page the protocol publishes, then bridge that same amount back once. That round trip is two transactions. ${tvlBit}`,
          `${dollars(capital)} of capital and ${gasPhrase(ctx.gasUsd * 2, chain)} for the two bridge transactions`,
          '30 minutes',
        ),
        step(
          `On ${chain}, use the bridged funds in one action the app itself offers, such as a swap or a deposit, and stop there.`,
          gasText,
          '15 minutes',
        ),
      ];
    case 'prediction':
      return [
        step(
          `Fund ${name} with ${dollars(capital)} on ${chain}.${note} ${tvlBit}`,
          `${dollars(capital)} of capital and ${gasText}`,
          '15 minutes',
        ),
        step(
          `Take one position in the most liquid open market, staking at most ${dollars(Math.max(10, Math.round(capital * 0.2)))} (20% of the probe). Do not add a second market.`,
          gasText,
          '15 minutes',
        ),
      ];
    case 'launchpad':
      return [
        step(
          `On ${chain}, open ${name}'s sale page and commit at most ${dollars(capital)} only if a sale is live in the app. Do not send funds to an address posted in a reply. ${tvlBit}`,
          `${dollars(capital)} of capital and ${gasText} if a sale is live, otherwise $0`,
          '20 minutes',
        ),
        step(
          `If nothing is live, do not pre-send funds. Recheck the same official page, not a forwarded link.`,
          '$0',
          '10 minutes',
        ),
      ];
    case 'insurance':
      return [
        step(
          `Buy ${dollars(capital)} of cover from ${name} on ${chain}, only for an asset this wallet already holds.${note} ${tvlBit}`,
          `${dollars(capital)} of premium capital and ${gasText}`,
          '20 minutes',
        ),
        step(
          `Save the policy id and confirm the cover runs at least ${ctx.hold} days. Do not renew through anyone but ${name}.`,
          '$0 to read the policy',
          '10 minutes',
        ),
      ];
    case 'other':
      return [
        step(
          `On ${chain}, deposit ${dollars(capital)} into the primary ${name} contract the app presents first (${ctx.category}).${note} ${tvlBit}`,
          `${dollars(capital)} of capital and ${gasText}`,
          '20 minutes',
        ),
        step(
          `Make one further action the app treats as use, such as taking a receipt, a small swap or a vote, and then stop.`,
          gasText,
          '10 minutes',
        ),
      ];
    default:
      return assertNever(play);
  }
}

export interface FarmPlan {
  steps: string[];
  capital_usd: number;
  gas_per_tx_usd: number;
  gas_tx_count: number;
  gas_total_usd: number;
  hold_days: number;
  playbook: Playbook;
  headline: string;
  primary_chain: string;
}

export function farmPlan(p: SnapshotProtocol, age: number | null): FarmPlan {
  const play = playbookOf(p.category);
  const chains = p.chains;
  const primary = chains.length > 0 ? chains[0]! : 'the main chain';
  let chain = primary;
  let cents = gasCentsForChain(primary);
  if (play === 'bridge' && chains.length > 0) {
    for (const c of chains) {
      const next = gasCentsForChain(c);
      if (next > cents) {
        cents = next;
        chain = c;
      }
    }
  }
  const gasUsd = cents / 100;
  const txs = gasTxCount(play);
  const gasTotal = round2((cents * txs) / 100);
  const capital = capitalUsd(p.tvl_usd);
  const hold = holdDays(age);
  const gasText = gasPhrase(gasUsd, chain);
  const ctx: FarmContext = {
    name: p.name,
    category: p.category ?? 'Uncategorized',
    chains,
    chain,
    tvl: p.tvl_usd,
    capital,
    hold,
    age,
    gasUsd,
    gasText,
  };
  const weekly =
    play === 'lending'
      ? step(
          `Once a week, read the health factor on ${p.name}. Repay or add supply if it is under 2.0.`,
          `${gasText} if you send a transaction, otherwise $0`,
          '10 minutes a week',
        )
      : step(
          `Once a week, confirm the ${p.name} position is still open and the receipt balance moved only by fees the app itself shows.`,
          `${gasText} if you send a transaction, otherwise $0`,
          '10 minutes a week',
        );
  const steps = [
    step(
      `Start with a fresh wallet that holds only this ${p.name} probe. Open the app from the protocol's own site, ignore links in replies and ads, and never pay anyone to claim a token.`,
      '$0',
      '10 minutes',
    ),
    ...actionSteps(play, ctx),
    step(
      `${ageClause(age, hold)} Leave the ${p.name} position in place for that whole window.`,
      `the ${dollars(capital)} stays in the position`,
      `${hold} days`,
    ),
    weekly,
    step(
      `Write the wallet, the open date, the size and every transaction hash in a log. Withdraw only from a page ${p.name} itself links, and pay nothing to claim.`,
      '$0',
      '5 minutes to start the log, then 2 minutes per transaction',
    ),
  ];
  const gasLabel = gasTotal < 0.1 ? 'under $0.10 gas' : gasTotal >= 10 || Number.isInteger(gasTotal) ? `~${dollars(gasTotal)} gas` : `~$${gasTotal.toFixed(2)} gas`;
  return {
    steps,
    capital_usd: capital,
    gas_per_tx_usd: gasUsd,
    gas_tx_count: txs,
    gas_total_usd: gasTotal,
    hold_days: hold,
    playbook: play,
    headline: `${dollars(capital)} capital, ${gasLabel} on ${chain}, ${hold}d hold`,
    primary_chain: chain,
  };
}

function clipRatios(sorted: readonly number[]): number[] {
  if (sorted.length < MIN_CATEGORY_SAMPLE) return sorted.slice();
  const lo = percentile(sorted, 0.05);
  const hi = percentile(sorted, 0.95);
  const clipped = sorted.filter((x) => x >= lo && x <= hi);
  return clipped.length >= MIN_CATEGORY_SAMPLE ? clipped : sorted.slice();
}

function statsOf(sortedPositive: readonly number[], category: string, global: GlobalMultiple | null): MultipleStats {
  if (global !== null && sortedPositive.length < MIN_CATEGORY_SAMPLE) {
    return {
      category,
      sample: sortedPositive.length,
      used: global.sample_clipped,
      source: 'global',
      multiple: global.multiple,
      p25: global.p25,
      p75: global.p75,
    };
  }
  const used = clipRatios(sortedPositive);
  return {
    category,
    sample: sortedPositive.length,
    used: used.length,
    source: 'category',
    multiple: round6(percentile(used, 0.5)),
    p25: round6(percentile(used, 0.25)),
    p75: round6(percentile(used, 0.75)),
  };
}

export function buildGlobalMultiple(protocols: readonly SnapshotProtocol[]): GlobalMultiple {
  const ratios: number[] = [];
  for (const p of protocols) {
    if (!isComparable(p) || p.mcap_usd === null) continue;
    ratios.push(p.mcap_usd / p.tvl_usd);
  }
  ratios.sort((a, b) => a - b);
  if (ratios.length === 0) {
    return { sample_positive: 0, sample_clipped: 0, p05: 0.15, p95: 0.4, multiple: 0.25, p25: 0.15, p75: 0.4 };
  }
  const p05 = percentile(ratios, 0.05);
  const p95 = percentile(ratios, 0.95);
  const clipped = clipRatios(ratios);
  return {
    sample_positive: ratios.length,
    sample_clipped: clipped.length,
    p05: round6(p05),
    p95: round6(p95),
    multiple: round6(percentile(clipped, 0.5)),
    p25: round6(percentile(clipped, 0.25)),
    p75: round6(percentile(clipped, 0.75)),
  };
}

export function categoryMultipleTable(protocols: readonly SnapshotProtocol[], global: GlobalMultiple): MultipleStats[] {
  const buckets = new Map<string, number[]>();
  for (const p of protocols) {
    const category = p.category ?? 'Uncategorized';
    if (!buckets.has(category)) buckets.set(category, []);
    if (!isComparable(p) || p.mcap_usd === null) continue;
    buckets.get(category)!.push(p.mcap_usd / p.tvl_usd);
  }
  const rows: MultipleStats[] = [];
  for (const [category, ratios] of buckets) {
    const sorted = ratios.slice().sort((a, b) => a - b);
    rows.push(statsOf(sorted, category, global));
  }
  rows.sort((a, b) => (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));
  return rows;
}

function riskFlags(p: SnapshotProtocol, age: number | null, stats: MultipleStats): string[] {
  const flags: string[] = [];
  if (p.change_7d === null) flags.push('7-day TVL change is missing, so the growth factor is neutral.');
  else if (p.change_7d <= -20) flags.push(`7-day TVL change is ${p.change_7d.toFixed(1)}%, a sharp drop.`);
  else if (p.change_7d > GROWTH_CAP) flags.push(`7-day TVL change is ${p.change_7d.toFixed(1)}% and is clipped at ${GROWTH_CAP} for the growth factor.`);
  if (age === null) flags.push('Listed date is missing, so the maturity factor is neutral.');
  else if (age < 90) flags.push(`Listed ${age} days ago. This model’s token window peaks later, around 6 to 18 months.`);
  else if (age >= 1095) flags.push(`Listed ${age} days ago. Past three years, this model treats a new token as less likely.`);
  if (p.chains.length <= 1) flags.push('Deployed on one chain in this snapshot.');
  if (stats.source === 'global') {
    const noun = stats.sample === 1 ? 'traded comparable' : 'traded comparables';
    flags.push(`Category has ${stats.sample} ${noun} (under ${MIN_CATEGORY_SAMPLE}), so the multiple is the global median.`);
  }
  return flags;
}

function bySlug(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const global = buildGlobalMultiple(snapshot.protocols);
  const table = categoryMultipleTable(snapshot.protocols, global);
  const byCategory = new Map(table.map((row) => [row.category, row]));
  const fallback: MultipleStats = {
    category: 'Uncategorized',
    sample: 0,
    used: global.sample_clipped,
    source: 'global',
    multiple: global.multiple,
    p25: global.p25,
    p75: global.p75,
  };
  const watch = new Set(snapshot.watchlist);
  const chosen: SnapshotProtocol[] = [];
  const seen = new Set<string>();
  for (const slug of snapshot.watchlist) {
    const p = snapshot.protocols.find((row) => row.slug === slug);
    if (p === undefined || seen.has(p.slug)) continue;
    chosen.push(p);
    seen.add(p.slug);
  }
  const extras = snapshot.protocols.filter((p) => !seen.has(p.slug) && isEligibleAddition(p));
  extras.sort((a, b) => b.tvl_usd - a.tvl_usd || bySlug(a.slug, b.slug));
  for (const p of extras) chosen.push(p);

  const scored = chosen.map((p) => {
    const category = p.category ?? 'Uncategorized';
    const stats = byCategory.get(category) ?? fallback;
    const age = ageDays(snapshot.as_of, p.listed_at);
    const growth = growthFactor(p.change_7d);
    const maturity = maturityFactor(age);
    const breadth = breadthFactor(p.chains);
    const size = sizeFactor(p.tvl_usd);
    const implied = impliedValue(p.tvl_usd, stats.multiple, growth, maturity, breadth, size);
    const low = impliedValue(p.tvl_usd, stats.p25, growth, maturity, breadth, size);
    const high = impliedValue(p.tvl_usd, stats.p75, growth, maturity, breadth, size);
    const farm = farmPlan(p, age);
    return {
      p,
      category,
      stats,
      age,
      growth,
      maturity,
      breadth,
      size,
      implied,
      low: Math.min(low, implied),
      high: Math.max(high, implied),
      farm,
    };
  });
  scored.sort((a, b) => b.implied - a.implied || bySlug(a.p.slug, b.p.slug));
  return scored.map((s, i) => ({
    slug: s.p.slug,
    name: s.p.name,
    rank: i + 1,
    implied_value_usd: s.implied,
    low_value_usd: s.low,
    high_value_usd: s.high,
    farm_steps: s.farm.steps,
    category: s.category,
    chains: s.p.chains,
    primary_chain: s.farm.primary_chain,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    age_days: s.age,
    listed_at: s.p.listed_at,
    watchlist: watch.has(s.p.slug),
    token_status: 'records-no-token',
    category_multiple: s.stats.multiple,
    multiple_p25: s.stats.p25,
    multiple_p75: s.stats.p75,
    multiple_source: s.stats.source,
    comparable_count: s.stats.sample,
    growth_factor: s.growth,
    maturity_factor: s.maturity,
    breadth_factor: s.breadth,
    size_factor: s.size,
    capital_usd: s.farm.capital_usd,
    gas_per_tx_usd: s.farm.gas_per_tx_usd,
    gas_tx_count: s.farm.gas_tx_count,
    gas_total_usd: s.farm.gas_total_usd,
    hold_days: s.farm.hold_days,
    playbook: s.farm.playbook,
    risk_flags: riskFlags(s.p, s.age, s.stats),
    farm_headline: s.farm.headline,
  }));
}

export function comparableRows(snapshot: Snapshot): Comparable[] {
  const rows: Comparable[] = [];
  for (const p of snapshot.protocols) {
    if (!isComparable(p) || p.mcap_usd === null) continue;
    rows.push({
      slug: p.slug,
      name: p.name,
      category: p.category ?? 'Uncategorized',
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      mcap_tvl: round6(p.mcap_usd / p.tvl_usd),
      symbol: p.symbol,
    });
  }
  rows.sort((a, b) => b.mcap_usd - a.mcap_usd || bySlug(a.slug, b.slug));
  return rows;
}

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot);
  const comparables = comparableRows(snapshot);
  const preToken = snapshot.protocols.filter(isPreToken).length;
  const onBoard = new Set(board.map((row) => row.slug));
  const watchOnBoard = snapshot.watchlist.filter((slug) => onBoard.has(slug)).length;
  const early = board.filter((row) => !row.watchlist).length;
  const global = buildGlobalMultiple(snapshot.protocols);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    thesis: METHOD.thesis,
    formula: METHOD.formula,
    method: METHOD,
    counts: {
      protocols: snapshot.protocols.length,
      pre_token: preToken,
      records_token: snapshot.protocols.length - preToken,
      traded: comparables.length,
      board: board.length,
      watchlist: snapshot.watchlist.length,
      watchlist_on_board: watchOnBoard,
      early,
    },
    global_multiple: global,
    category_multiples: categoryMultipleTable(snapshot.protocols, global),
    rows: board,
    comparables,
    watchlist: snapshot.watchlist.slice(),
    gas_table: Object.keys(GAS_CENTS)
      .sort()
      .map((chain) => ({ chain, usd_per_tx: GAS_CENTS[chain]! / 100 })),
    gas_default_usd: GAS_DEFAULT_CENTS / 100,
    early_size: early,
    live_size: comparables.length,
  };
  return { board, radar };
}

export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board has ${board.length} rows`;
  const slugs = new Set<string>();
  for (const row of board) {
    if (slugs.has(row.slug)) return `duplicate slug ${row.slug}`;
    slugs.add(row.slug);
    if (/\s/.test(row.slug) || row.slug.length === 0) return `bad slug ${row.slug}`;
    if (row.name.trim().length === 0) return `empty name ${row.slug}`;
  }
  const missing = snapshot.watchlist.filter((slug) => !slugs.has(slug));
  if (missing.length > 0) return `missing watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  for (let i = 0; i < board.length; i++) {
    if (board[i]!.rank !== i + 1) return `rank ${i + 1} is ${board[i]!.rank}`;
  }
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i}`;
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return 'every row has the same implied value';
  }
  for (const row of board) {
    if (!Number.isSafeInteger(row.implied_value_usd) || row.implied_value_usd < 1 || row.implied_value_usd > 1e14) {
      return `${row.slug} implied value ${row.implied_value_usd}`;
    }
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) return `${row.slug} has ${row.farm_steps.length} farm steps`;
    for (const text of row.farm_steps) {
      const trimmed = text.trim();
      if (trimmed.length < 20 || trimmed.length > 600) return `${row.slug} farm step length ${trimmed.length}`;
    }
  }
  return null;
}

export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
