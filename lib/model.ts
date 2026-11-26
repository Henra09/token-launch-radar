// The radar's scoring engine: one sealed snapshot in, one ranked board out.
//
// What the board claims
// ---------------------
// Every row answers one question with the snapshot's own numbers: if this protocol
// issued a token tomorrow and the market priced it the way it prices comparable
// on-chain cash flows today, what would the token plausibly be worth? The answer is
// the entry's own claim - never a prediction of whether a launch happens or when.
//
// The formula (stated verbatim on the dashboard):
//
//   implied_value_usd = round( tvl_usd
//                              x BASE_MULTIPLE                (0.32)
//                              x momentum(change_7d)          (0.775 .. 1.45)
//                              x patience(age_days)           (0.65 .. 1.20)
//                              x category_weight(category)    (0.80 .. 1.35) )
//
//   momentum(g) = 1 + clamp(g, -50, +100) / 100 x MOMENTUM_WEIGHT (0.45)
//     A seven-day TVL move of -50% or worse scores 0.775; +100% or better scores 1.45;
//     an unreported change scores 1.00. Momentum rewards protocols that are growing
//     now, because a launch usually arrives while attention is arriving.
//
//   patience(a) = 0.65 + min(a, 1095) / 1095 x 0.55
//     Age counts from listed_at to the snapshot's as_of day. A protocol that has run
//     for years with no token has earned a user base a distribution would pay for; a
//     two-week-old protocol has not. Unknown age scores as PATIENCE_DEFAULT_DAYS (240).
//
//   category_weight prices one dollar of TVL differently by what kind of cash flow the
//     protocol produces (fee capture, spread, lending interest) - never by its name.
//     The table lives in CATEGORY_WEIGHTS and is printed on the dashboard.
//
// No protocol is special-cased by name: the same function scores every row.
//
// Coverage: the snapshot's watchlist (every slug on it) is the floor, never the ceiling;
// the board adds the strongest pre-token protocols below the watchlist floor under the
// same score, so the radar surfaces early names the watchlist has not caught yet.

/** The snapshot's protocol record: exactly the ten sealed fields. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's knobs; the dashboard prints every one of them. */
export interface ModelConstants {
  base_multiple: number;
  momentum_weight: number;
  momentum_floor: number;
  momentum_cap: number;
  patience_floor: number;
  patience_range: number;
  patience_days: number;
  patience_default_days: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.32,
  momentum_weight: 0.45,
  momentum_floor: -50,
  momentum_cap: 100,
  patience_floor: 0.65,
  patience_range: 0.55,
  patience_days: 1095,
  patience_default_days: 240,
};

/** Version label shown on the page and next to every score. */
export const MODEL_VERSION = 'v2.1';

/** How many pre-floor early candidates the board carries beyond the watchlist. */
export const EARLY_ROWS = 220;

/** How many live-token protocols the comparison view carries. */
export const LIVE_ROWS = 30;

/**
 * Category weights: how the market prices one dollar of TVL by the kind of cash flow a
 * protocol captures. Matched by substring against the lowercase category; the first hit
 * wins; an unnamed or unmatched category scores the neutral 1.00.
 */
export const CATEGORY_WEIGHTS: Array<{ match: string; label: string; weight: number }> = [
  { match: 'lending', label: 'Lending', weight: 1.35 },
  { match: 'cdp', label: 'CDP', weight: 1.3 },
  { match: 'collateralized debt', label: 'Collateralized debt', weight: 1.3 },
  { match: 'oracle', label: 'Oracle', weight: 1.3 },
  { match: 'infrastructure', label: 'Infrastructure', weight: 1.3 },
  { match: 'dex', label: 'DEX', weight: 1.2 },
  { match: 'swap', label: 'Swap', weight: 1.2 },
  { match: 'perp', label: 'Perpetuals', weight: 1.25 },
  { match: 'derivative', label: 'Derivatives', weight: 1.25 },
  { match: 'wallet', label: 'Wallet', weight: 1.25 },
  { match: 'launchpad', label: 'Launchpad', weight: 1.2 },
  { match: 'stablecoin', label: 'Stablecoin issuer', weight: 1.15 },
  { match: 'stable', label: 'Stablecoin issuer', weight: 1.15 },
  { match: 'prediction', label: 'Prediction market', weight: 1.15 },
  { match: 'rwa', label: 'RWA', weight: 1.1 },
  { match: 'privacy', label: 'Privacy', weight: 1.1 },
  { match: 'yield', label: 'Yield aggregator', weight: 1.05 },
  { match: 'vault', label: 'Vault', weight: 1.05 },
  { match: 'insurance', label: 'Insurance', weight: 1.0 },
  { match: 'nft', label: 'NFT market', weight: 0.95 },
  { match: 'cross-chain', label: 'Cross-chain', weight: 0.95 },
  { match: 'gaming', label: 'Gaming', weight: 0.9 },
  { match: 'restak', label: 'Restaking', weight: 0.9 },
  { match: 'liquid staking', label: 'Liquid staking', weight: 0.85 },
  { match: 'staking', label: 'Staking pool', weight: 0.85 },
  { match: 'bridge', label: 'Bridge', weight: 0.85 },
  { match: 'liquid', label: 'Liquid wrapper', weight: 0.85 },
  { match: 'centralized exchange', label: 'CEX', weight: 0.8 },
];

/** The weight one category scores; unnamed or unmatched categories score the neutral 1.00. */
export function categoryWeight(category: string | null): number {
  if (category === null) return 1.0;
  const c = category.toLowerCase();
  for (const w of CATEGORY_WEIGHTS) if (c.includes(w.match)) return w.weight;
  return 1.0;
}

/** A row of board.json - exactly the fields the gate names, extra keys dropped for a lean file. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  implied_value_usd: number;
  farm_steps: string[];
}

/** A single farm step: what to do, what it costs, how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** The full per-protocol payload the dashboard renders. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  category_label: string;
  category_weight: number;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  on_watchlist: boolean;
  implied_value_usd: number;
  momentum_mult: number;
  patience_mult: number;
  farm_steps: FarmStep[];
}

/** A live-token protocol, shown apart so the board never mixes a traded token into its ranking. */
export interface LiveRow {
  slug: string;
  name: string;
  symbol: string | null;
  category: string | null;
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs, serialized into data.js. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  category_weights: Array<{ label: string; weight: number }>;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

const DAY_MS = 86_400_000;

/** Whole days from `listedAt` to `asOf`, clamped at zero; null when either date is missing or unreadable. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** One protocol's four factors and its implied value. */
export function impliedValue(p: SnapshotProtocol, asOf: string, m: ModelConstants = MODEL): {
  implied: number; momentum: number; patience: number; catWeight: number; age: number | null;
} {
  const age = ageDays(asOf, p.listed_at);
  const g = typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null;
  const momentum = g === null ? 1 : 1 + (Math.min(m.momentum_cap, Math.max(m.momentum_floor, g)) / 100) * m.momentum_weight;
  const ageUsed = age ?? m.patience_default_days;
  const patience = m.patience_floor + (Math.min(Math.max(ageUsed, 0), m.patience_days) / m.patience_days) * m.patience_range;
  const catWeight = categoryWeight(p.category);
  const implied = Math.max(1, Math.round(p.tvl_usd * m.base_multiple * momentum * patience * catWeight));
  return { implied, momentum, patience, catWeight, age };
}

/** Names ending in a version marker are pools of a parent protocol, not candidates of their own. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** True when the record carries no market cap, no CoinGecko id and no symbol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Rankable = pre-token, not an exchange venue, not a numbered pool of something else. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

const bySlug = (ps: SnapshotProtocol[]): Map<string, SnapshotProtocol> => new Map(ps.map((p) => [p.slug, p]));

/* ------------------------------------------------------------------ */
/* Farm plans                                                          */
/* ------------------------------------------------------------------ */

function mainChain(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main network';
}

function chainList(p: SnapshotProtocol): string {
  if (p.chains.length === 0) return 'its main network';
  if (p.chains.length <= 3) return p.chains.join(', ');
  return `${p.chains.slice(0, 3).join(', ')} and ${p.chains.length - 3} more`;
}

/** Position size the plan quotes, scaled to the protocol's own TVL. */
function capital(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 300;
  if (p.tvl_usd >= 1_000_000_000) return 200;
  if (p.tvl_usd >= 250_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** Qualifying window - longer for younger protocols, where fewer snapshot dates exist. */
function holdDays(age: number | null): number {
  if (age === null) return 45;
  if (age < 120) return 90;
  if (age < 365) return 60;
  return 30;
}

/** The category's core action, derived from the record (category, chains, TVL), never a name list. */
function coreAction(p: SnapshotProtocol, cap: number, chain: string): FarmStep {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateralized'))
    return { text: `Supply $${cap} of USDC into ${p.name}'s lending market on ${chain}; if it runs a borrow market, borrow under 30% LTV against the deposit so both sides of the book count as your activity.`, cost: `$${cap} capital, about $${cap >= 150 ? 8 : 4} gas`, time: '15 minutes to open' };
  if (c.includes('dex') || c.includes('swap'))
    return { text: `Deposit $${cap} into ${p.name}'s most liquid pair on ${chain} as LP, and route one small swap through the same pool each week so swap volume is credited to your wallet as well.`, cost: `$${cap} capital, ~$${cap >= 150 ? 10 : 5} gas, impermanent-loss risk`, time: '20 minutes to open' };
  if (c.includes('perp') || c.includes('derivative'))
    return { text: `Deposit $${cap} of USDC as margin on ${p.name} (${chain}) and open one small position at 2x leverage or less; keep funding cost near zero so the position can sit for weeks.`, cost: `$${cap} margin, funding usually under $1/day at small size`, time: '15 minutes' };
  if (c.includes('restak'))
    return { text: `Stake $${cap} of the native asset through ${p.name} on ${chain}, then delegate the receipt to one operator - do not split it, fragmented restakes look weak in attribution.`, cost: `$${cap} capital, withdrawable after the unbond period`, time: '10 minutes' };
  if (c.includes('staking'))
    return { text: `Stake $${cap} of the chain's native asset through ${p.name} on ${chain} and hold the liquid receipt token in the same wallet.`, cost: `$${cap} capital, unstaking waits for the chain's unbond period`, time: '10 minutes' };
  if (c.includes('bridge'))
    return { text: `Bridge $${cap} of USDC across to ${chain} through ${p.name}, then put the received funds to work in a dApp on the destination chain instead of bridging straight back.`, cost: `$${cap} capital + bridge fee (usually under $5)`, time: '15 minutes' };
  if (c.includes('yield') || c.includes('vault'))
    return { text: `Deposit $${cap} into ${p.name}'s highest-TVL vault on ${chain} and leave it untouched - auto-compounding vaults reward wallets that do not churn.`, cost: `$${cap} capital, ~$5 gas`, time: '10 minutes' };
  if (c.includes('stablecoin') || c.includes('stable'))
    return { text: `Mint or swap into $${cap} of ${p.name}'s stable asset on ${chain}, then redeposit it in one of its savings markets so you appear on both the issuer and the lender side.`, cost: `$${cap} capital, plus any mint fee the issuer charges`, time: '15 minutes' };
  if (c.includes('insurance'))
    return { text: `Buy $${cap} of cover from ${p.name} on ${chain} against a protocol you actually hold, and renew once before the policy lapses to show a repeat customer.`, cost: `$${cap} premium (cover is consumed, not returned)`, time: '10 minutes' };
  if (c.includes('rwa'))
    return { text: `Mint $${cap} of ${p.name}'s yield-bearing asset on ${chain} and hold it through at least one interest payout so your wallet shows on two snapshot dates.`, cost: `$${cap} capital, KYC may be required`, time: '30 minutes including checks' };
  if (c.includes('prediction'))
    return { text: `Deposit $${cap} into ${p.name} and take one position in its most liquid market; settle it, then place a second trade in a different market to show breadth.`, cost: `$${cap} stake at risk on the trades`, time: '15 minutes' };
  if (c.includes('oracle') || c.includes('infrastructure'))
    return { text: `Wire ${p.name} into something you control - a bot, a script or a small dApp build on ${chain} - so your wallet appears as a builder user, not just a depositor.`, cost: 'gas only, $5-$15', time: '1-2 hours to set up' };
  if (c.includes('launchpad'))
    return { text: `Join one public sale or allocation round on ${p.name} at the minimum ticket, and stake whatever platform asset its tier system requires.`, cost: `minimum ticket plus $${cap} of required stake`, time: '30 minutes' };
  if (c.includes('nft'))
    return { text: `Trade one mid-priced collection on ${p.name}'s marketplace on ${chain}, then list an NFT for sale so both sides of the market see your wallet.`, cost: `$${cap} of inventory, ~$5 gas`, time: '20 minutes' };
  if (c.includes('gaming'))
    return { text: `Play ${p.name} on ${chain} for the daily quest every day for two weeks - consistent daily wallets outrank one-off deposits in most game distributions.`, cost: 'gas plus any in-game entry fee', time: '20 minutes a day' };
  if (c.includes('wallet'))
    return { text: `Make ${p.name} your daily wallet on ${chain} for two weeks: send, swap and sign through it so the usage is attributable to one address.`, cost: 'gas only', time: 'daily use' };
  return { text: `Deposit $${cap} of USDC into ${p.name} on ${chain} and keep the position open; touch a second feature of the app if it has one.`, cost: `$${cap} capital, ~$5 gas`, time: '15 minutes' };
}

/**
 * A protocol's farm plan: six steps, each derived from its own record. Step 1 wallet
 * hygiene, step 2 the core action, step 3 recurring activity, step 4 the holding window,
 * step 5 reward-claim safety, step 6 record keeping.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const cap = capital(p);
  const chain = mainChain(p);
  const hold = holdDays(age);
  const core = coreAction(p, cap, chain);
  const spread = p.chains.length > 1
    ? ` Repeat the core action once on a second chain it runs on (${chainList(p)}) in case the launch snapshot is chain-specific.`
    : ' Do not split the position across many wallets - sybil-looking fragments hurt attribution more than they help.';
  return [
    {
      text: 'Set up a fresh wallet used only for this farm; fund it from an exchange withdrawal rather than a mixer, and keep the seed phrase offline.',
      cost: 'under $3 of gas to fund',
      time: '10 minutes',
    },
    core,
    {
      text: `Make one small qualifying interaction every week for ${hold} days (a top-up, a swap, a vote or a claim) so the wallet stays active across many snapshot dates.${spread}`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Leave the core position untouched for at least ${hold} days${age === null ? ' - the tracking start date is unknown, so assume a launch snapshot can come at any time' : ` - the protocol has already run ${age} days, so a launch could be near`}.`,
      cost: `the $${cap} stays committed`,
      time: `${hold} days`,
    },
    {
      text: `If a points or rewards program exists, register your wallet through ${p.name}'s own interface and claim only from links it publishes - never pay anyone to "unlock" a claim.`,
      cost: 'no fee; a claim asking for payment is a scam',
      time: '10 minutes',
    },
    {
      text: 'Log the wallet address, dates, transaction hashes and position size after every action, so you can prove your history or unwind quickly.',
      cost: 'nothing but the log',
      time: '5 minutes per action',
    },
  ];
}

/** The gate's step string: action, cost, time, trimmed into 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Review the position weekly.`;
  return s;
}

/* ------------------------------------------------------------------ */
/* Board assembly                                                      */
/* ------------------------------------------------------------------ */

/** The ranked board: the whole watchlist first, then the strongest pre-floor candidates. */
export function buildBoard(snapshot: Snapshot, m: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug on it is covered, whatever its score.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the floor, ranked by raw TVL, capped.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => ({ p, ...impliedValue(p, snapshot.as_of, m) }));
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    implied_value_usd: s.implied,
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** The live-token comparison set, by market cap, never mixed into the ranked board. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({ slug: p.slug, name: p.name, symbol: p.symbol, category: p.category, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d }));
}

/** A category's display label and weight for the dashboard. */
function catMeta(p: SnapshotProtocol): { label: string; weight: number } {
  if (p.category === null) return { label: 'Uncategorized', weight: 1.0 };
  const hit = CATEGORY_WEIGHTS.find((x) => p.category!.toLowerCase().includes(x.match));
  return { label: p.category, weight: hit ? hit.weight : 1.0 };
}

/** The dashboard's full row payload. */
export function radarRow(row: BoardRow, p: SnapshotProtocol, snapshot: Snapshot): RadarRow {
  const { momentum, patience, age } = impliedValue(p, snapshot.as_of);
  const meta = catMeta(p);
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: p.category,
    category_label: meta.label,
    category_weight: meta.weight,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    listed_at: p.listed_at,
    age_days: age,
    on_watchlist: snapshot.watchlist.includes(row.slug),
    implied_value_usd: row.implied_value_usd,
    momentum_mult: Math.round(momentum * 1e4) / 1e4,
    patience_mult: Math.round(patience * 1e4) / 1e4,
    farm_steps: farmSteps(p, age),
  };
}

/** Build the board and the dashboard dataset from one snapshot. */
export function buildRadar(snapshot: Snapshot, m: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, m);
  const live = liveRows(snapshot);
  const index = bySlug(snapshot.protocols);
  const rows = board.map((r) => radarRow(r, index.get(r.slug)!, snapshot));
  const early = rows.filter((r) => !r.on_watchlist).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: m,
    model_version: MODEL_VERSION,
    category_weights: CATEGORY_WEIGHTS.map(({ label, weight }) => ({ label, weight })),
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows,
    live,
  };
  return { board, radar };
}

/* ------------------------------------------------------------------ */
/* Snapshot parsing and gate self-checks                               */
/* ------------------------------------------------------------------ */

/** Thrown when the input is not a snapshot this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

/** Parse and shape-check the snapshot's text. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why the gate would refuse this board, or null when every row of it passes. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug(s): ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100) return `the board holds ${board.length} rows; the gate takes 100 or more`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share implied value $${board[0]!.implied_value_usd}: that is not a ranking`;
  }
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) return `${r.slug} has implied value ${r.implied_value_usd}`;
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${s.trim().length} characters`;
  }
  return null;
}

/** The dashboard's dataset as one inline script: the page never fetches anything. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};`;
}
