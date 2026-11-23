// Token radar value model. Every figure comes from the snapshot: no name is special-cased.
//
// implied_value_usd = round(exp(a + b × (log(tvl) − center)))
//
// a and b are fit on protocols whose token already trades. Family, growth and age are added only
// when both held-out checks improve. The ranked board is only protocols that record no token.

import { buildHeldout, type Evidence, type OddsScore } from './heldout.ts';
import type { Snapshot, SnapshotProtocol } from './types.ts';

export type { Snapshot, SnapshotProtocol } from './types.ts';
export { parseSnapshot, SnapshotError } from './types.ts';

export const MODEL_VERSION = 'heldout-1';

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

/** Capital charge used to size a farm plan. 4% a year of the deposit, pro-rated by the hold. */
export const CAPITAL_APR = 0.04;

export const METHOD = {
  thesis:
    'Implied value is the market cap a log-log fit assigns from TVL. The fit uses only protocols whose token already trades. A term stays in only when it lowers both held-out misses: leave-one-out, and a walk-forward split on the listing date.',
  formula:
    'log(mcap) = a + b × (log(TVL) − center). implied_value_usd = round(exp of that). Low and high are the fit plus the 25th and 75th in-sample residual.',
  kept:
    'log(TVL) is kept. Family effects, 7-day growth and age were tested on top of it and were not kept. Each one failed to lower both held-out median misses. The Evidence tab lists the four numbers for every term.',
  baseline:
    'The plain comparison is TVL times the category median of mcap/TVL. A category with fewer than 5 traded tokens uses its playbook-family median, then the global median. That model is the held-out baseline. It is not the rank.',
  odds:
    'P(token) is a smoothed rate from this snapshot. The cell is category, age band and TVL band, shrunk toward family × age × TVL, then family, then the global rate, with strength 8. The score is a held-out half: even and odd slugs, sorted. The page shows the model with the lower Brier score against the base rate, and its AUC.',
  tiers:
    'HIGH means P(token) at least 0.50. MED means at least 0.25. LOW is the rest. Expected value is implied value times P(token). Rank follows implied value.',
  farm:
    'Deposit is the TVL-tier probe, or more if that is what it takes to keep gas at or under 2% of the deposit. Fees are a one-time rate by protocol type. The capital charge is 4% a year times the hold. Net is minus gas, fees and the charge. FARM: P(token) at least 0.45 and break-even at most 5%. MARGINAL: P(token) at least 0.25 and break-even at most 8%. Otherwise SKIP.',
  separation:
    'A protocol records no token when gecko_id and symbol are both null. Only those rows are ranked. A positive mcap_usd is a comparable: the token already trades, and it is not ranked.',
  exclusions:
    'Every watchlist slug is on the board. Other rows are pre-token protocols that are not a CEX, a bridge, liquid staking, liquid restaking, a stablecoin wrapper, a versioned pool name, or a name that says wrapped, staked or bridged.',
  caveats: [
    'DefiLlama’s record is not proof that a token does or does not exist.',
    'Implied value is this radar’s claim from the snapshot. It is not a price, a promise or financial advice.',
    'The held-out miss is still a few times the traded market cap. The band on each row is that uncertainty.',
    'Farm net is the cash cost of the plan. It does not add an airdrop payoff.',
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

export type MultipleSource = 'category' | 'family' | 'global';

export interface MultipleStats {
  category: string;
  family: Playbook;
  sample: number;
  family_sample: number;
  used: number;
  source: MultipleSource;
  multiple: number;
  p25: number;
  p75: number;
  token_with: number;
  token_total: number;
  token_share: number;
  token_factor: number;
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
  family_sample: number;
  token_share: number;
  token_with: number;
  token_in_category: number;
  token_factor: number;
  growth_factor: number;
  maturity_factor: number;
  breadth_factor: number;
  size_factor: number;
  /** Natural log of the fitted market cap. The page recomputes round(exp(this)). */
  log_implied: number;
  /** TVL times the plain category, family or global median. Not the rank. */
  plain_value_usd: number;
  p_token: number;
  odds_tier: 'HIGH' | 'MED' | 'LOW';
  odds_level: string;
  odds_cell: number;
  expected_value_usd: number;
  verdict: 'FARM' | 'MARGINAL' | 'SKIP';
  deposit_usd: number;
  fee_usd: number;
  fee_rate: number;
  capital_charge_usd: number;
  net_usd: number;
  per_hour_usd: number;
  breakeven: number;
  min_deposit_usd: number;
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

export interface LedgerSegment {
  label: string;
  count: number;
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
  evidence: Evidence;
  odds: OddsScore;
  ledger: LedgerSegment[];
  verdicts: { FARM: number; MARGINAL: number; SKIP: number };
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

/** 0.72 when no protocol in the category records a token, 1.12 when every one does. */
export function tokenFactor(share: number): number {
  const s = Math.min(1, Math.max(0, share));
  return round6(0.72 + s * 0.4);
}

export function impliedValue(
  tvl: number,
  multiple: number,
  growth: number,
  maturity: number,
  breadth: number,
  size: number,
  token: number,
): number {
  const n = Math.round(tvl * multiple * growth * maturity * breadth * size * token);
  if (!Number.isFinite(n) || n < 1) return 1;
  if (n > 1e14) return 1e14;
  return n;
}

/** One-time fee as a fraction of the deposit, by the action the plan names. */
export function feeRate(play: Playbook): number {
  switch (play) {
    case 'dex':
      return 0.003;
    case 'perps':
      return 0.0006;
    case 'prediction':
      return 0.002;
    case 'bridge':
    case 'insurance':
    case 'rwa':
      return 0.001;
    case 'launchpad':
      return 0;
    case 'lending':
    case 'basis':
    case 'yield':
    case 'staking':
    case 'other':
      return 0.0005;
    default:
      return assertNever(play);
  }
}

export function farmVerdict(pToken: number, breakeven: number): 'FARM' | 'MARGINAL' | 'SKIP' {
  if (pToken >= 0.45 && breakeven <= 0.05) return 'FARM';
  if (pToken >= 0.25 && breakeven <= 0.08) return 'MARGINAL';
  return 'SKIP';
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
  const body = usd >= 10 || Number.isInteger(usd) ? dollars(usd) : `$${usd.toFixed(2)}`;
  return `about ${body} of gas on ${chain}`;
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

function setupMinutes(tvl: number, hold: number): number {
  let minutes = 12 + Math.round(hold / 10);
  if (tvl >= 1_000_000_000) minutes += 18;
  else if (tvl >= 250_000_000) minutes += 12;
  else if (tvl >= 50_000_000) minutes += 6;
  else if (tvl >= 10_000_000) minutes += 3;
  return Math.min(55, minutes);
}

function weeksOf(hold: number): number {
  return Math.max(1, Math.round(hold / 7));
}

function reviewMinutes(hold: number, tvl: number): number {
  let minutes = 6 + Math.round(hold / 15);
  if (tvl >= 250_000_000) minutes += 4;
  return Math.min(25, minutes);
}

interface FarmContext {
  name: string;
  category: string;
  chains: string[];
  chain: string;
  tvl: number;
  capital: number;
  hold: number;
  weeks: number;
  setupMin: number;
  reviewMin: number;
  age: number | null;
  gasUsd: number;
  gasText: string;
  reviewGasText: string;
  verb: string;
}

function actionVerb(play: Playbook): string {
  switch (play) {
    case 'lending':
      return 'supply';
    case 'dex':
      return 'LP';
    case 'perps':
    case 'basis':
    case 'prediction':
      return 'trade';
    case 'yield':
    case 'launchpad':
    case 'other':
      return 'deposit';
    case 'rwa':
      return 'mint';
    case 'staking':
      return 'stake';
    case 'bridge':
      return 'bridge';
    case 'insurance':
      return 'buy';
    default:
      return assertNever(play);
  }
}

function actionSteps(play: Playbook, ctx: FarmContext): string[] {
  const { name, chain, capital, gasText, setupMin, tvl } = ctx;
  const note = chainNote(ctx.chains);
  const sized = `TVL on record is ${formatCompact(tvl)}, so this ${ctx.verb} uses ${dollars(capital)} and about ${setupMin} minutes on ${chain}.`;
  const followMin = Math.max(8, Math.round(setupMin * 0.6));
  switch (play) {
    case 'lending': {
      const borrow = Math.max(10, Math.round(capital * 0.15));
      return [
        step(
          `Supply ${dollars(capital)} of a liquid stablecoin to ${name} on ${chain}.${note} ${sized}`,
          `${dollars(capital)} of capital and ${gasText}`,
          `${setupMin} minutes`,
        ),
        step(
          `Borrow about ${dollars(borrow)} against that ${name} supply on ${chain} and keep the health factor above 2.0. Repay first if it prints under 1.8.`,
          gasText,
          `${followMin} minutes`,
        ),
      ];
    }
    case 'dex':
      return [
        step(
          `LP ${dollars(capital)} in ${name}'s deepest stablecoin pair on ${chain}. If the pool is concentrated, set the range about 10% either side of the price.${note} ${sized}`,
          `${dollars(capital)} of capital and ${gasText}`,
          `${setupMin} minutes`,
        ),
        step(
          `Rebalance that ${name} LP on ${chain} once if the price leaves the range. If it stays inside, leave the position and do not open a second pool.`,
          `${gasText} if you rebalance, otherwise $0`,
          `${followMin} minutes if you rebalance`,
        ),
      ];
    case 'perps':
      return [
        step(
          `Deposit ${dollars(capital)} of stablecoin margin on ${name}, ${chain}, before any trade.${note} ${sized}`,
          `${dollars(capital)} of capital and ${gasText}`,
          `${setupMin} minutes`,
        ),
        step(
          `Trade one hedge on ${name} (${chain}) with notional near ${dollars(Math.round(capital / 2))}. Close it if margin health drops under 50%.`,
          gasText,
          `${followMin} minutes`,
        ),
      ];
    case 'basis':
      return [
        step(
          `Trade the ${name} basis the app marks delta-neutral, size ${dollars(capital)}, on ${chain}. Do not add a borrow loop.${note} ${sized}`,
          `${dollars(capital)} of capital and ${gasText}`,
          `${setupMin} minutes`,
        ),
        step(
          `Read the ${name} funding figure on ${chain} once at the open. If the app does not place the hedge, do not trade one by hand.`,
          '$0 to read the figure',
          `${followMin} minutes`,
        ),
      ];
    case 'yield':
      return [
        step(
          `Deposit ${dollars(capital)} into the main ${name} vault on ${chain} and keep the share token in this wallet.${note} ${sized}`,
          `${dollars(capital)} of capital and ${gasText}`,
          `${setupMin} minutes`,
        ),
        step(
          `Leave that ${name} deposit on ${chain} as one vault. Do not deposit the shares into a second protocol during the ${ctx.hold}-day hold.`,
          '$0',
          `${Math.max(5, Math.round(followMin / 2))} minutes to confirm the share balance`,
        ),
      ];
    case 'rwa':
      return [
        step(
          `If ${name} asks for an identity check, finish it with the issuer before you mint. ${sized}`,
          '$0 on-chain for the check',
          ctx.hold >= 30 ? '1 to 3 days if the issuer asks, otherwise 15 minutes' : '15 minutes if no check is waiting',
        ),
        step(
          `Mint ${dollars(capital)} of the ${name} claim on ${chain} and leave it in this wallet.${note}`,
          `${dollars(capital)} of capital and ${gasText}`,
          `${setupMin} minutes after the check`,
        ),
      ];
    case 'staking':
      return [
        step(
          `Stake ${dollars(capital)} through ${name} on ${chain} and keep the receipt in this wallet. Do not lend the receipt out.${note} ${sized}`,
          `${dollars(capital)} of capital and ${gasText}`,
          `${setupMin} minutes`,
        ),
        step(
          `Match the ${name} receipt on ${chain} to the stake, minus the gas just paid. If it does not match, unwind.`,
          '$0 to read the balance',
          `${Math.max(5, Math.round(followMin / 2))} minutes`,
        ),
      ];
    case 'bridge':
      return [
        step(
          `Bridge ${dollars(capital)} of stablecoin through ${name} to ${chain}, then bridge the same amount back. Use only the page ${name} publishes. ${sized}`,
          `${dollars(capital)} of capital and ${gasPhrase(ctx.gasUsd * 2, chain)} for the two bridge transactions`,
          `${setupMin + 10} minutes`,
        ),
        step(
          `On ${chain}, use the bridged ${name} balance in one swap or deposit the app itself offers, then stop.`,
          gasText,
          `${followMin} minutes`,
        ),
      ];
    case 'prediction':
      return [
        step(
          `Deposit ${dollars(capital)} on ${name}, ${chain}, before placing a trade.${note} ${sized}`,
          `${dollars(capital)} of capital and ${gasText}`,
          `${setupMin} minutes`,
        ),
        step(
          `Trade one position in the most liquid ${name} market on ${chain}, at most ${dollars(Math.max(10, Math.round(capital * 0.2)))}. Do not open a second market.`,
          gasText,
          `${followMin} minutes`,
        ),
      ];
    case 'launchpad':
      return [
        step(
          `Deposit at most ${dollars(capital)} on ${name}'s live sale on ${chain}. If no sale is open in the app, send nothing. ${sized}`,
          `${dollars(capital)} of capital and ${gasText} if a sale is live, otherwise $0`,
          `${setupMin} minutes`,
        ),
        step(
          `Recheck the ${name} sale page on ${chain} over this ${ctx.hold}-day window. Do not fund an address from a reply.`,
          '$0',
          `${followMin} minutes`,
        ),
      ];
    case 'insurance':
      return [
        step(
          `Buy ${dollars(capital)} of cover from ${name} on ${chain}, only for an asset this wallet already holds.${note} ${sized}`,
          `${dollars(capital)} of premium capital and ${gasText}`,
          `${setupMin} minutes`,
        ),
        step(
          `Save the ${name} policy id on ${chain} and confirm the cover lasts at least ${ctx.hold} days.`,
          '$0 to read the policy',
          `${followMin} minutes`,
        ),
      ];
    case 'other':
      return [
        step(
          `Deposit ${dollars(capital)} into the primary ${name} contract on ${chain} (${ctx.category}).${note} ${sized}`,
          `${dollars(capital)} of capital and ${gasText}`,
          `${setupMin} minutes`,
        ),
        step(
          `Take the receipt, a small swap, or a vote on ${name} (${chain}), one action only, then stop.`,
          gasText,
          `${followMin} minutes`,
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
  deposit_usd: number;
  fee_usd: number;
  fee_rate: number;
  capital_charge_usd: number;
  net_usd: number;
  per_hour_usd: number;
  breakeven: number;
  min_deposit_usd: number;
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
  const hold = holdDays(age);
  const weeks = weeksOf(hold);
  const setupMin = setupMinutes(p.tvl_usd, hold);
  const reviewMin = reviewMinutes(hold, p.tvl_usd);
  const reviewGas = round2(gasUsd * weeks);
  const gasTotal = round2(gasUsd * txs + reviewGas);
  const minDeposit = Math.max(50, Math.ceil(gasTotal / 0.02 / 10) * 10);
  const capital = Math.max(capitalUsd(p.tvl_usd), minDeposit);
  const rate = feeRate(play);
  const fee = round2(capital * rate);
  const charge = round2((capital * CAPITAL_APR * hold) / 365);
  const allIn = round2(gasTotal + fee + charge);
  const net = round2(-allIn);
  const perHour = round2(net / (hold * 24));
  const breakeven = round6(allIn / capital);
  const gasText = gasPhrase(gasUsd, chain);
  const reviewGasText = reviewGas < 0.1 ? `under $0.10 of gas on ${chain}` : gasPhrase(reviewGas, chain);
  const verb = actionVerb(play);
  const ctx: FarmContext = {
    name: p.name,
    category: p.category ?? 'Uncategorized',
    chains,
    chain,
    tvl: p.tvl_usd,
    capital,
    hold,
    weeks,
    setupMin,
    reviewMin,
    age,
    gasUsd,
    gasText,
    reviewGasText,
    verb,
  };
  const weekly =
    play === 'lending'
      ? step(
          `Each week for ${weeks} weeks, read the health factor of the ${p.name} supply on ${chain}. Repay or add to the supply if it is under 2.0.`,
          `${reviewGasText} across those checks if you send a transaction, otherwise $0`,
          `${reviewMin} minutes a week for ${weeks} weeks`,
        )
      : step(
          `Each week for ${weeks} weeks, confirm the ${verb} on ${p.name} (${chain}) is still open and the balance moved only by fees the app shows.`,
          `${reviewGasText} across those checks if you send a transaction, otherwise $0`,
          `${reviewMin} minutes a week for ${weeks} weeks`,
        );
  const safety = step(
    `Use a fresh wallet for the ${p.name} ${verb} on ${chain}. Open the app from the protocol's own site, ignore links in replies, and never pay anyone to claim.`,
    '$0',
    `${Math.max(5, Math.round(setupMin / 3))} minutes`,
  );
  const actions = actionSteps(play, ctx);
  const holdStep = step(
    `${ageClause(age, hold)} Leave the ${dollars(capital)} ${verb} on ${p.name} (${chain}) in place for that whole window.`,
    `the ${dollars(capital)} stays in the position`,
    `${hold} days`,
  );
  const logStep = step(
    `Log the wallet, the open date, the ${dollars(capital)} ${verb} on ${chain}, and every hash. Over ${hold} days that is about ${txs + weeks} entries. Withdraw only from a page ${p.name} itself links, and pay nothing to claim.`,
    '$0',
    `${5 + weeks} minutes across the ${hold}-day log`,
  );
  const steps = shapeSteps(play, [safety, actions[0]!, actions[1]!, holdStep, weekly, logStep], ctx);
  const gasLabel = gasTotal < 0.1 ? 'under $0.10 gas' : gasTotal >= 10 || Number.isInteger(gasTotal) ? `~${dollars(gasTotal)} gas` : `~$${gasTotal.toFixed(2)} gas`;
  const beLabel = `${(breakeven * 100).toFixed(1)}% break-even`;
  return {
    steps,
    capital_usd: capital,
    gas_per_tx_usd: gasUsd,
    gas_tx_count: txs,
    gas_total_usd: gasTotal,
    hold_days: hold,
    playbook: play,
    headline: `${dollars(capital)} deposit, ${gasLabel} on ${chain}, ${hold}d hold, ${beLabel}`,
    primary_chain: chain,
    deposit_usd: capital,
    fee_usd: fee,
    fee_rate: rate,
    capital_charge_usd: charge,
    net_usd: net,
    per_hour_usd: perHour,
    breakeven,
    min_deposit_usd: minDeposit,
  };
}

function shapeSteps(play: Playbook, steps: readonly string[], ctx: FarmContext): string[] {
  const safety = steps[0]!;
  const open = steps[1]!;
  const follow = steps[2]!;
  const hold = steps[3]!;
  const weekly = steps[4]!;
  const log = steps[5]!;
  const closeMin = Math.max(8, Math.round(ctx.setupMin * 0.5));
  switch (play) {
    case 'lending':
      return [
        safety,
        open,
        follow,
        hold,
        weekly,
        step(
          `On the last day, repay the ${ctx.name} borrow on ${ctx.chain} and withdraw the supply. Leave nothing in the protocol.`,
          ctx.gasText,
          `${closeMin} minutes`,
        ),
        log,
      ];
    case 'perps':
      return [
        safety,
        open,
        follow,
        hold,
        weekly,
        step(
          `On the last day, close the ${ctx.name} hedge on ${ctx.chain} and withdraw the margin. Leave nothing in the protocol.`,
          ctx.gasText,
          `${closeMin} minutes`,
        ),
        log,
      ];
    case 'dex':
    case 'bridge':
    case 'rwa':
      return [safety, open, follow, hold, weekly, log];
    case 'launchpad':
    case 'other':
      return [safety, open, hold, log];
    case 'yield':
    case 'staking':
    case 'basis':
    case 'prediction':
    case 'insurance':
      return [safety, open, follow, hold, log];
    default:
      return assertNever(play);
  }
}

function clipRatios(sorted: readonly number[]): number[] {
  if (sorted.length < MIN_CATEGORY_SAMPLE) return sorted.slice();
  const lo = percentile(sorted, 0.05);
  const hi = percentile(sorted, 0.95);
  const clipped = sorted.filter((x) => x >= lo && x <= hi);
  return clipped.length >= MIN_CATEGORY_SAMPLE ? clipped : sorted.slice();
}

interface RatioStats {
  sample: number;
  used: number;
  multiple: number;
  p25: number;
  p75: number;
}

function summarizeRatios(sorted: readonly number[]): RatioStats {
  const used = clipRatios(sorted);
  return {
    sample: sorted.length,
    used: used.length,
    multiple: round6(percentile(used, 0.5)),
    p25: round6(percentile(used, 0.25)),
    p75: round6(percentile(used, 0.75)),
  };
}

interface TokenRate {
  with_token: number;
  total: number;
  share: number;
  factor: number;
}

function tokenRates(protocols: readonly SnapshotProtocol[]): Map<string, TokenRate> {
  const total = new Map<string, number>();
  const withToken = new Map<string, number>();
  for (const p of protocols) {
    const category = p.category ?? 'Uncategorized';
    total.set(category, (total.get(category) ?? 0) + 1);
    if (!isPreToken(p)) withToken.set(category, (withToken.get(category) ?? 0) + 1);
  }
  const rates = new Map<string, TokenRate>();
  for (const [category, count] of total) {
    const got = withToken.get(category) ?? 0;
    const share = count === 0 ? 0 : got / count;
    rates.set(category, { with_token: got, total: count, share: round6(share), factor: tokenFactor(share) });
  }
  return rates;
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
  const byFamily = new Map<Playbook, number[]>();
  for (const p of protocols) {
    const category = p.category ?? 'Uncategorized';
    if (!buckets.has(category)) buckets.set(category, []);
    if (!isComparable(p) || p.mcap_usd === null) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    buckets.get(category)!.push(ratio);
    const play = playbookOf(p.category);
    const family = byFamily.get(play) ?? [];
    family.push(ratio);
    byFamily.set(play, family);
  }
  const familySummary = new Map<Playbook, RatioStats>();
  for (const [play, ratios] of byFamily) {
    const sorted = ratios.slice().sort((a, b) => a - b);
    if (sorted.length >= MIN_CATEGORY_SAMPLE) familySummary.set(play, summarizeRatios(sorted));
  }
  const rates = tokenRates(protocols);
  const rows: MultipleStats[] = [];
  for (const [category, ratios] of buckets) {
    const sorted = ratios.slice().sort((a, b) => a - b);
    const play = playbookOf(category === 'Uncategorized' ? null : category);
    const family = familySummary.get(play);
    const familySample = (byFamily.get(play) ?? []).length;
    const rate = rates.get(category) ?? { with_token: 0, total: 0, share: 0, factor: tokenFactor(0) };
    const base = {
      category,
      family: play,
      family_sample: family ? family.sample : familySample,
      token_with: rate.with_token,
      token_total: rate.total,
      token_share: rate.share,
      token_factor: rate.factor,
    };
    if (sorted.length >= MIN_CATEGORY_SAMPLE) {
      const stats = summarizeRatios(sorted);
      rows.push({ ...base, sample: stats.sample, used: stats.used, source: 'category', multiple: stats.multiple, p25: stats.p25, p75: stats.p75 });
    } else if (family !== undefined) {
      rows.push({
        ...base,
        sample: sorted.length,
        family_sample: family.sample,
        used: family.used,
        source: 'family',
        multiple: family.multiple,
        p25: family.p25,
        p75: family.p75,
      });
    } else {
      rows.push({
        ...base,
        sample: sorted.length,
        used: global.sample_clipped,
        source: 'global',
        multiple: global.multiple,
        p25: global.p25,
        p75: global.p75,
      });
    }
  }
  rows.sort((a, b) => (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));
  return rows;
}

function riskFlags(p: SnapshotProtocol, age: number | null, stats: MultipleStats): string[] {
  const flags: string[] = [];
  if (p.change_7d !== null && p.change_7d <= -20) {
    flags.push(`7-day TVL change is ${p.change_7d.toFixed(1)}%, a sharp drop. Growth was tested and not kept in the value fit.`);
  }
  if (age !== null && age < 90) flags.push(`Listed ${age} days ago.`);
  else if (age !== null && age >= 1095) flags.push(`Listed ${age} days ago, past three years.`);
  if (p.chains.length <= 1) flags.push('Deployed on one chain in this snapshot.');
  if (stats.sample < MIN_CATEGORY_SAMPLE) {
    flags.push(`Category has ${stats.sample} traded comparables. The plain median would use the ${stats.source} source. The rank uses the log-log fit, not that median.`);
  }
  if (stats.token_share < 0.25) {
    const pct = Math.round(stats.token_share * 100);
    flags.push(`Only ${pct}% of ${stats.category} protocols record a token (${stats.token_with} of ${stats.token_total}). Launch odds use that rate.`);
  }
  return flags;
}

function clampValue(n: number): number {
  if (!Number.isFinite(n)) return 1;
  const r = Math.round(n);
  if (r < 1) return 1;
  if (r > 1e14) return 1e14;
  return r;
}

export function buildLedger(snapshot: Snapshot, boardSlugs: ReadonlySet<string>): LedgerSegment[] {
  const keys = ['Ranked', 'Already has a token', 'CEX', 'Bridge', 'Liquid staking', 'Wrapper', 'Wrapped or versioned', 'Other'] as const;
  const counts = new Map<string, number>(keys.map((key) => [key, 0]));
  for (const p of snapshot.protocols) {
    if (boardSlugs.has(p.slug)) {
      counts.set('Ranked', (counts.get('Ranked') ?? 0) + 1);
      continue;
    }
    if (!isPreToken(p)) {
      counts.set('Already has a token', (counts.get('Already has a token') ?? 0) + 1);
      continue;
    }
    const category = p.category;
    let reason = 'Other';
    if (category === 'CEX') reason = 'CEX';
    else if (category === 'Bridge' || category === 'Canonical Bridge' || category === 'Cross Chain Bridge') reason = 'Bridge';
    else if (category === 'Liquid Staking' || category === 'Liquid Restaking') reason = 'Liquid staking';
    else if (category === 'Stablecoin Wrapper') reason = 'Wrapper';
    else if (isWrappedName(p.name)) reason = 'Wrapped or versioned';
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return keys.map((label) => ({ label, count: counts.get(label) ?? 0 })).filter((seg) => seg.count > 0);
}

function bySlug(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const held = buildHeldout(snapshot.protocols, snapshot.as_of, { playbookOf, ageDays, isComparable, isPreToken });
  return scoreBoard(snapshot, held);
}

function scoreBoard(snapshot: Snapshot, held: ReturnType<typeof buildHeldout>): BoardRow[] {
  const global = buildGlobalMultiple(snapshot.protocols);
  const table = categoryMultipleTable(snapshot.protocols, global);
  const byCategory = new Map(table.map((row) => [row.category, row]));
  const fallback: MultipleStats = {
    category: 'Uncategorized',
    family: 'other',
    sample: 0,
    family_sample: 0,
    used: global.sample_clipped,
    source: 'global',
    multiple: global.multiple,
    p25: global.p25,
    p75: global.p75,
    token_with: 0,
    token_total: 0,
    token_share: 0,
    token_factor: tokenFactor(0),
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
    const log = held.logMcap(p);
    if (log === null) throw new Error(`token radar: no fitted value for ${p.slug}`);
    const implied = clampValue(Math.exp(log));
    const low = clampValue(Math.exp(log + held.evidence.residual_p25));
    const high = clampValue(Math.exp(log + held.evidence.residual_p75));
    const farm = farmPlan(p, age);
    const odds = held.oddsFor(p);
    const verdict = farmVerdict(odds.p, farm.breakeven);
    const plain = clampValue(p.tvl_usd * stats.multiple);
    return {
      p,
      category,
      stats,
      age,
      growth,
      maturity,
      breadth,
      size,
      log,
      implied,
      low: Math.min(low, implied),
      high: Math.max(high, implied),
      farm,
      odds,
      verdict,
      plain,
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
    family_sample: s.stats.family_sample,
    token_share: s.stats.token_share,
    token_with: s.stats.token_with,
    token_in_category: s.stats.token_total,
    token_factor: s.stats.token_factor,
    growth_factor: s.growth,
    maturity_factor: s.maturity,
    breadth_factor: s.breadth,
    size_factor: s.size,
    log_implied: s.log,
    plain_value_usd: s.plain,
    p_token: s.odds.p,
    odds_tier: s.odds.tier,
    odds_level: s.odds.level,
    odds_cell: s.odds.cell,
    expected_value_usd: clampValue(s.implied * s.odds.p),
    verdict: s.verdict,
    deposit_usd: s.farm.deposit_usd,
    fee_usd: s.farm.fee_usd,
    fee_rate: s.farm.fee_rate,
    capital_charge_usd: s.farm.capital_charge_usd,
    net_usd: s.farm.net_usd,
    per_hour_usd: s.farm.per_hour_usd,
    breakeven: s.farm.breakeven,
    min_deposit_usd: s.farm.min_deposit_usd,
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
  const held = buildHeldout(snapshot.protocols, snapshot.as_of, { playbookOf, ageDays, isComparable, isPreToken });
  const board = scoreBoard(snapshot, held);
  const comparables = comparableRows(snapshot);
  const preToken = snapshot.protocols.filter(isPreToken).length;
  const onBoard = new Set(board.map((row) => row.slug));
  const watchOnBoard = snapshot.watchlist.filter((slug) => onBoard.has(slug)).length;
  const early = board.filter((row) => !row.watchlist).length;
  const global = buildGlobalMultiple(snapshot.protocols);
  const ledger = buildLedger(snapshot, onBoard);
  const ledgerSum = ledger.reduce((sum, seg) => sum + seg.count, 0);
  if (ledgerSum !== snapshot.protocols.length) {
    throw new Error(`token radar: ledger sums to ${ledgerSum}, snapshot has ${snapshot.protocols.length}`);
  }
  const verdicts = { FARM: 0, MARGINAL: 0, SKIP: 0 };
  for (const row of board) {
    verdicts[row.verdict] += 1;
    const again = clampValue(Math.exp(row.log_implied));
    if (again !== row.implied_value_usd) throw new Error(`token radar: ${row.slug} log does not match implied value`);
  }
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
    evidence: held.evidence,
    odds: held.odds,
    ledger,
    verdicts,
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
