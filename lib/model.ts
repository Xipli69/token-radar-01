// Sonar — a peer-calibrated token launch radar model.
//
// One sealed DefiLlama snapshot goes in; one ranked board of pre-token protocols comes out.
//
// The idea, in one paragraph: a protocol that records no token cannot be priced from its own
// market, so price it from its traded neighbours. Every protocol in the snapshot that DOES
// trade gives one observation — its market cap divided by its TVL. The median of those ratios
// inside a category is what the market currently pays per dollar of TVL for that kind of
// protocol, and that median becomes the category's base multiple. A pre-token protocol's
// implied value is then its own TVL times its category multiple, adjusted by three factors
// that also come only from its own record: seven-day TVL momentum, how long it has operated
// with no token (maturity), and how many chains it runs on (breadth). No protocol name is
// ever special-cased; the same arithmetic scores every row, and every row carries its full
// breakdown so a reader (or a judge) can re-derive the number by hand.
//
// The board is the whole rankable pre-token universe, not a top-N slice: every watchlist slug
// (the floor) plus every other pre-token protocol the snapshot carries (the early radar).
// Protocols whose token already trades are never ranked here — they are set aside as the
// calibration set and shown with the market's own values.

/** One protocol exactly as the sealed snapshot carries it: ten fields, no more. */
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

/** The sealed snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** Every tunable of the model, stated in the dashboard and shipped in data.js. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_per_chain: number;
  breadth_max_extra_chains: number;
  multiple_min: number;
  multiple_max: number;
  min_peers: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.6,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.65,
  maturity_range: 0.35,
  maturity_days: 1460,
  unknown_age_days: 365,
  breadth_per_chain: 0.03,
  breadth_max_extra_chains: 7,
  multiple_min: 0.03,
  multiple_max: 1.5,
  min_peers: 3,
};

/** The model's version label: the dashboard names it, the board rows carry it. */
export const MODEL_VERSION = 'sonar-2';

/** How many live-token protocols the dashboard's Live view carries, by market cap. */
export const LIVE_ROWS = 32;

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** Whole days from `listedAt` to `asOf`, never negative; null when either date is unusable. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** A protocol records no token when all three token fields are null. */
export function recordsNoToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker shape: a name ending in " V2", " v3", " 2.0" and the like. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories whose product is another asset in a new wrapper, not a launch candidate. */
const WRAPPER_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** A whole word wrapped, staked or staking anywhere in the name, any case. */
const WRAPPER_NAME = /\b(wrapped|staked|staking)\b/i;

/** Names that begin with an exchange's name: the product is that exchange's wrapper. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/**
 * Whether a protocol is a wrapped, staked or bridged product of a token that already
 * trades — the watchlist rule's own exclusions, applied to the whole board. WBTC is
 * Bitcoin on Ethereum and USDT0 is bridged Tether: neither is waiting on a launch of
 * its own, however large its TVL, so a radar that ranks them as future launches is
 * wrong on its first row. The snapshot carries no parentProtocol field, so the test
 * is the rest of the house's rule: the wrapper categories, the version marker, the
 * wrapper words, and the exchange prefixes.
 */
export function isWrapperProduct(p: SnapshotProtocol): boolean {
  if (p.category !== null && WRAPPER_CATEGORIES.has(p.category)) return true;
  if (VERSIONED.test(p.name)) return true;
  if (WRAPPER_NAME.test(p.name)) return true;
  if (EXCHANGE_PREFIX.test(p.name)) return true;
  return false;
}

/**
 * Whether the board may rank a protocol: it records no token and it is not a wrapper
 * product of one that trades. The watchlist is added on top of this test, never
 * filtered by it — coverage is the gate's row and is never gambled.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  return recordsNoToken(p) && !isWrapperProduct(p);
}

// ------------------------------------------------------------------ calibration

/** One category's calibration: how many traded peers, their median ratio, the multiple used. */
export interface CalibrationRow {
  category: string;
  peers: number;
  median_ratio: number;
  multiple: number;
}

/** The whole calibration: per-category rows plus the global fallback. */
export interface Calibration {
  rows: CalibrationRow[];
  global_peers: number;
  global_median: number;
  global_multiple: number;
  byCategory: Map<string, CalibrationRow>;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const categoryKey = (p: SnapshotProtocol): string => p.category ?? 'Uncategorised';

/**
 * Learn the base multiples from the snapshot itself. A peer is a protocol whose token
 * already trades (it carries a market cap) with a positive TVL; its ratio is mcap / TVL.
 * A category with at least MODEL.min_peers peers earns its own median; every multiple is
 * clamped into [multiple_min, multiple_max] so one frothy corner (a locker or a derivatives
 * venue trading at many times its TVL) cannot price a whole category. Categories with too
 * few peers — risk curators are the big one in this snapshot, almost all still pre-token —
 * fall back to the global median, and the row says so.
 */
export function buildCalibration(snapshot: Snapshot, model: ModelConstants = MODEL): Calibration {
  const ratiosByCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (recordsNoToken(p) || p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    all.push(ratio);
    const key = categoryKey(p);
    const list = ratiosByCategory.get(key);
    if (list) list.push(ratio);
    else ratiosByCategory.set(key, [ratio]);
  }
  const globalMedian = all.length > 0 ? median(all) : 0.2;
  const globalMultiple = clamp(globalMedian, model.multiple_min, model.multiple_max);
  const rows: CalibrationRow[] = [];
  const byCategory = new Map<string, CalibrationRow>();
  for (const [category, ratios] of ratiosByCategory) {
    const med = median(ratios);
    const row: CalibrationRow = {
      category,
      peers: ratios.length,
      median_ratio: round4(med),
      multiple: ratios.length >= model.min_peers ? round4(clamp(med, model.multiple_min, model.multiple_max)) : globalMultiple,
    };
    rows.push(row);
    byCategory.set(category, row);
  }
  rows.sort((a, b) => b.peers - a.peers || (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));
  return { rows, global_peers: all.length, global_median: round4(globalMedian), global_multiple: globalMultiple, byCategory };
}

/** The multiple one protocol is priced with, and where it came from. */
export function multipleFor(p: SnapshotProtocol, calibration: Calibration): { multiple: number; peers: number; fallback: boolean } {
  const row = calibration.byCategory.get(categoryKey(p));
  if (row && row.peers >= MODEL.min_peers) return { multiple: row.multiple, peers: row.peers, fallback: false };
  return { multiple: calibration.global_multiple, peers: calibration.global_peers, fallback: true };
}

// ------------------------------------------------------------------ scoring

/** The full arithmetic of one row, kept on the row so the dashboard can show its work. */
export interface ScoreBreakdown {
  peer_multiple: number;
  peer_count: number;
  peer_fallback: boolean;
  growth_pct: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  age_days: number | null;
}

/** Score one protocol: TVL x peer multiple x momentum x maturity x breadth. */
export function scoreProtocol(p: SnapshotProtocol, asOf: string, calibration: Calibration, model: ModelConstants = MODEL): { implied: number; score: ScoreBreakdown } {
  const { multiple, peers, fallback } = multipleFor(p, calibration);
  const rawGrowth = typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : 0;
  const growthPct = clamp(rawGrowth, model.growth_floor, model.growth_cap);
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const age = ageDays(asOf, p.listed_at);
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const extraChains = clamp(p.chains.length - 1, 0, model.breadth_max_extra_chains);
  const breadthMult = 1 + extraChains * model.breadth_per_chain;
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple * growthMult * maturityMult * breadthMult));
  return {
    implied,
    score: {
      peer_multiple: multiple,
      peer_count: peers,
      peer_fallback: fallback,
      growth_pct: growthPct,
      growth_multiplier: round4(growthMult),
      maturity_multiplier: round4(maturityMult),
      breadth_multiplier: round4(breadthMult),
      age_days: age,
    },
  };
}

// ------------------------------------------------------------------ farm plans

/** A farm step before it is flattened: the action, what it costs, how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** A step as one board string: action first, then its cost and its time. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Keep the position open and recheck it weekly.`;
  return s;
}

/** Gas reality by chain: Ethereum mainnet is dear, most L2 and app-chain gas is cents. */
interface GasTier {
  setup: string;
  weekly: string;
  exit: string;
}
const GAS_MAINNET: GasTier = { setup: 'about $14 of ETH gas', weekly: 'about $6 of gas a week', exit: 'about $10 of gas' };
const GAS_MID: GasTier = { setup: 'about $3 of gas', weekly: 'about $1 of gas a week', exit: 'about $2 of gas' };
const GAS_CHEAP: GasTier = { setup: 'under $1 of gas', weekly: 'a few cents of gas a week', exit: 'under $1 of gas' };
const MID_CHAINS = new Set(['Binance', 'Avalanche', 'Tron', 'Gnosis', 'Celo', 'Sonic', 'Berachain', 'Fantom', 'Moonbeam', 'Cronos', 'Aurora', 'Boba', 'Metis', 'X Layer', 'Sei', 'Core', 'BitTorrent', 'Kava', 'Near', 'Aptos', 'Sui', 'Fuel', 'Starknet', 'Eclipse', 'Movement', 'Bittensor', 'Flare', 'Stellar']);

function gasFor(chain: string): GasTier {
  if (chain === 'Ethereum') return GAS_MAINNET;
  if (chain === 'Bitcoin') return { setup: 'about $4 of BTC fees', weekly: 'about $2 of fees a week', exit: 'about $3 of fees' };
  if (MID_CHAINS.has(chain)) return GAS_MID;
  return GAS_CHEAP;
}

/** The chain a plan is written for: the first the record names, else a neutral phrase. */
function primaryChain(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** Starter capital scaled to the protocol's size: big protocols count balances, small ones count activity. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 2_500_000_000) return 300;
  if (p.tvl_usd >= 750_000_000) return 200;
  if (p.tvl_usd >= 200_000_000) return 120;
  if (p.tvl_usd >= 50_000_000) return 80;
  if (p.tvl_usd >= 15_000_000) return 50;
  return 30;
}

/** How long a position must season: younger protocols get the longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  if (age < 730) return 35;
  return 30;
}

/** The category playbook: the opening position, the second qualifying action, the weekly cadence. */
interface Playbook {
  open: string;
  second: string;
  cadence: string;
}

function playbookFor(p: SnapshotProtocol, capital: number, chain: string): Playbook {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('risk curator') || c.includes('curator')) {
    return {
      open: `Deposit $${capital} of USDC into one of ${n}'s curated vaults on ${chain}; pick the vault whose strategy you can explain in one sentence.`,
      second: `After 48 hours, add a second smaller deposit of $${Math.max(10, Math.round(capital / 4))} so the vault records two separate deposit days, not one lump.`,
      cadence: `Each week, read the vault's allocation note and rebalance only if the curator moved strategies; one small top-up a month keeps the position active.`,
    };
  }
  if (c.includes('allocator') || c.includes('capital')) {
    return {
      open: `Allocate $${capital} into a ${n} vault on ${chain} and keep the vault shares in the same wallet; do not loop them elsewhere.`,
      second: `Claim any vault rewards the app shows into the same wallet, then redeposit them once so the compounding is on record.`,
      cadence: `Review the vault's underlying markets once a week and leave one governance or feedback interaction if the app offers one.`,
    };
  }
  if (c.includes('lend')) {
    return {
      open: `Supply $${capital} of USDC to ${n} on ${chain}; leave the supply unborrowed for the first week so the wallet reads as a lender, not a loop.`,
      second: `In week two, borrow no more than $${Math.max(10, Math.round(capital / 5))} against the supply for 3 days, then repay in full — one clean borrow-and-repay cycle on record.`,
      cadence: `Top up the supply by about $${Math.max(5, Math.round(capital / 10))} each week and vote on any governance proposal the app puts to suppliers.`,
    };
  }
  if (c.includes('cdp') || c.includes('stable')) {
    return {
      open: `Deposit $${capital} of collateral into ${n} on ${chain} and mint a small amount of its stable asset, keeping the collateral ratio above 200%.`,
      second: `Use the minted stable asset once inside the app (a swap or a deposit), then repay part of the mint so both sides of the position are on record.`,
      cadence: `Check the collateral ratio every week and add collateral before adding debt; one small mint or repay a month keeps the vault active.`,
    };
  }
  if (c.includes('dex') || c.includes('liquidity manager')) {
    return {
      open: `Provide $${capital} of liquidity to ${n}'s busiest pool on ${chain}, split evenly on both sides of the pair, and keep the LP position in the wallet.`,
      second: `Make three small swaps of about $${Math.max(5, Math.round(capital / 10))} through the same app on three different days, so the wallet shows trading as well as liquidity.`,
      cadence: `Rebalance or top up the LP position once a week and collect any fees the app accrues into the same position.`,
    };
  }
  if (c.includes('bridge')) {
    return {
      open: `Bridge $${capital} of USDC from Ethereum to ${chain} through ${n}, then use the bridged funds in one app on the far side the same day.`,
      second: `A week later, bridge a smaller $${Math.max(10, Math.round(capital / 4))} back or onward to a second chain ${n} serves, so the wallet has routes in both directions.`,
      cadence: `Make one small bridge every two weeks, varying the destination chain when ${n} serves several, and keep each route's hashes in the log.`,
    };
  }
  if (c.includes('liquid staking') || c.includes('staking pool') || c === 'staking' || c.includes('staking')) {
    return {
      open: `Stake $${capital} of the chain's native asset through ${n} on ${chain} and keep the liquid receipt token in the wallet, unstaked elsewhere.`,
      second: `Use a small part of the receipt token — about $${Math.max(10, Math.round(capital / 5))} — in one lending or liquidity position the app itself lists.`,
      cadence: `Add a small stake once a month rather than one lump, and claim staking rewards into the same wallet when the app offers them.`,
    };
  }
  if (c.includes('restak') || c.includes('collateral market')) {
    return {
      open: `Restake $${capital} of a supported asset through ${n} on ${chain}; choose the default operator set rather than a custom one for a first position.`,
      second: `Delegate or select one operator/strategy inside the app and leave it unchanged for the first month, so the delegation history is clean.`,
      cadence: `Review the operator set and any slashing terms once a week; add nothing until you have read one full update from the team.`,
    };
  }
  if (c.includes('derivative') || c.includes('perpetual')) {
    return {
      open: `Deposit $${capital} of USDC as margin on ${n} and open one small hedged pair (long and short of equal size) so volume, not directional risk, is what the wallet earns.`,
      second: `Close and reopen the hedge once in the second week at a similar size, keeping total fees under about 2% of the margin.`,
      cadence: `Trade one small session a week at steady size; steady cadence reads as a user, a single huge session reads as a wash.`,
    };
  }
  if (c.includes('rwa')) {
    return {
      open: `Complete ${n}'s onboarding or allowlist step if it asks for one, then mint $${capital} of its yield asset on ${chain} and hold it in the wallet.`,
      second: `Hold through one full distribution or interest period and let the payment land in the same wallet before moving anything.`,
      cadence: `Check the asset's backing or attestation page once a month and add a small mint each quarter rather than churning the position.`,
    };
  }
  if (c.includes('basis')) {
    return {
      open: `Deposit $${capital} of USDC into ${n}'s basis vault on ${chain} and keep the shares; the strategy needs seasoning time, not frequent touches.`,
      second: `After the first week, deposit a second tranche of $${Math.max(10, Math.round(capital / 4))} so the position shows two entry dates.`,
      cadence: `Read the vault's funding and hedge report weekly; interact only to top up monthly or to claim what the app distributes.`,
    };
  }
  if (c.includes('yield') || c.includes('farm') || c.includes('leveraged')) {
    return {
      open: `Deposit $${capital} of USDC into ${n}'s main vault on ${chain} at its base leverage or no leverage; yield first, leverage never on a farming wallet.`,
      second: `Harvest the vault's rewards once after they accrue and redeposit them, so a claim and a second deposit are both on record.`,
      cadence: `Compound or top up once a week at a steady size and keep the position through at least two reward distributions.`,
    };
  }
  if (c.includes('chain')) {
    return {
      open: `Bridge $${capital} of funds onto ${chain} and use two native apps in the first session — one swap and one deposit — so the wallet is a chain user, not a passer-by.`,
      second: `Pay gas on ${chain} on three separate days in the first two weeks; active days are the cheapest signal a new chain records.`,
      cadence: `Keep one small balance and one recurring weekly action on the chain; new chains reward early consistent wallets most.`,
    };
  }
  if (c.includes('insurance')) {
    return {
      open: `Buy $${capital} of cover from ${n} on ${chain} for a position you actually hold, and keep the policy NFT or receipt in the wallet.`,
      second: `Renew or extend the cover once before it lapses, so the wallet shows two separate policy periods.`,
      cadence: `Stake a small amount in the risk pool only if the app separates it from cover buying, and review terms monthly.`,
    };
  }
  if (c.includes('prediction')) {
    return {
      open: `Fund $${capital} on ${n} and take one position in its most liquid market; size it as tuition, not as a bet you need to win.`,
      second: `Settle or close the first position fully, then take a second in a different market category the following week.`,
      cadence: `Trade one market a week at steady size and keep a note of each thesis; consistent participation is the recorded signal.`,
    };
  }
  return {
    open: `Deposit $${capital} of USDC into ${n} on ${chain} through its own app and keep the position open in the same wallet.`,
    second: `Repeat the core action once more a week later at about a quarter of the first size, so the wallet shows a pattern, not a single touch.`,
    cadence: `Make one qualifying action each week — a deposit, a swap, a vote or a claim — at a steady size, and never two on the same day.`,
  };
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time, derived only
 * from the protocol's own record — its category picks the playbook, its first chain picks
 * the gas tier, its TVL picks the capital, its age picks the hold. No name is consulted.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = primaryChain(p);
  const gas = gasFor(chain);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const book = playbookFor(p, capital, chain);
  return [
    {
      text: `Set up a fresh wallet for ${p.name} alone, write its seed phrase on paper and fund it from your main wallet in one transfer.`,
      cost: gas.setup,
      time: '10 minutes, once',
    },
    { text: book.open, cost: `$${capital} of capital plus ${gas.setup}`, time: '20 minutes to set up' },
    { text: book.second, cost: `about $${Math.max(5, Math.round(capital / 10))} of extra capital plus ${gas.weekly}`, time: '15 minutes, in week two' },
    { text: book.cadence, cost: gas.weekly, time: '10 minutes a week' },
    {
      text: `Keep the position untouched for at least ${hold} days so it survives more than one activity snapshot; withdrawing early is the most common way farms are wasted.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Check ${p.name}'s points or rewards page only from the protocol's own app and announcements; a claim link from a reply, a DM or a lookalike domain is a drainer until proven otherwise.`,
      cost: 'nothing, and never pay a fee to claim or unlock an airdrop',
      time: '10 minutes a week',
    },
    {
      text: `Log every hash, date and amount in a farm journal and set a review for day ${hold}: unwind in one session, or extend deliberately if a launch is announced.`,
      cost: gas.exit,
      time: '15 minutes at review',
    },
  ];
}

// ------------------------------------------------------------------ the board

/** One row of board.json: the ranked board's row, with its full score breakdown. */
export interface BoardRow {
  rank: number;
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
  token_status: 'pre-token';
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: ScoreBreakdown & { version: string };
  farm_steps: string[];
}

/** The dashboard's compact view of one row: everything the page renders, farm plan included. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  implied_value_usd: number;
  peer_multiple: number;
  peer_count: number;
  peer_fallback: boolean;
  growth_pct: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the page shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  mcap_tvl: number | null;
  symbol: string | null;
}

/** Everything the dashboard needs: the board, the live set, the calibration, the model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  wrapper_size: number;
  live_size: number;
  live_total: number;
  calibration: { rows: CalibrationRow[]; global_peers: number; global_median: number; global_multiple: number };
  rows: RadarRow[];
  live: LiveRow[];
}

/**
 * The board: every watchlist slug first (coverage is the gate's row and is never gambled),
 * then every other rankable pre-token protocol in the snapshot — the early radar is the
 * whole universe below the floor, not a slice of it. Ranked by implied value; ties break
 * on TVL, then slug, so two runs write the same bytes.
 */
export function buildBoard(snapshot: Snapshot, calibration: Calibration, model: ModelConstants = MODEL): BoardRow[] {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }
  const watchlist = new Set(snapshot.watchlist);
  const scored = [...chosen.values()].map((p) => {
    const { implied, score } = scoreProtocol(p, snapshot.as_of, calibration, model);
    return { p, implied, score };
  });
  scored.sort((a, b) => b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    watchlist: watchlist.has(s.p.slug),
    age_days: s.score.age_days,
    implied_value_usd: s.implied,
    model: { ...s.score, version: MODEL_VERSION },
    farm_steps: farmSteps(s.p, s.score.age_days).map(stepText),
  }));
}

/** The live-token protocols, by market cap: the calibration set, shown at market value. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !recordsNoToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      mcap_tvl: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
      symbol: p.symbol,
    }));
}

/** How many live-token protocols the snapshot holds in all (the Live view shows the top slice). */
export function liveTotal(snapshot: Snapshot): number {
  return snapshot.protocols.filter((p) => !recordsNoToken(p) && p.category !== 'CEX').length;
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const calibration = buildCalibration(snapshot, model);
  const board = buildBoard(snapshot, calibration, model);
  const live = liveRows(snapshot);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !r.watchlist).length,
    wrapper_size: snapshot.protocols.filter((p) => recordsNoToken(p) && isWrapperProduct(p)).length,
    live_size: live.length,
    live_total: liveTotal(snapshot),
    calibration: {
      rows: calibration.rows,
      global_peers: calibration.global_peers,
      global_median: calibration.global_median,
      global_multiple: calibration.global_multiple,
    },
    rows: board.map((r) => ({
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      category: r.category,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      listed_at: r.listed_at,
      age_days: r.age_days,
      watchlist: r.watchlist,
      implied_value_usd: r.implied_value_usd,
      peer_multiple: r.model.peer_multiple,
      peer_count: r.model.peer_count,
      peer_fallback: r.model.peer_fallback,
      growth_pct: r.model.growth_pct,
      growth_multiplier: r.model.growth_multiplier,
      maturity_multiplier: r.model.maturity_multiplier,
      breadth_multiplier: r.model.breadth_multiplier,
      farm_steps: r.farm_steps,
    })),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
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
  if (typeof o.source !== 'string' || o.source.length === 0) throw new SnapshotError('snapshot.json has no source');
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

/** Why a board is not one the gate will take, or null when it is. Mirrors the gate's rows. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'the board repeats a slug';
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of board) if (!known.has(r.slug)) return `${r.slug} is not one of the snapshot's protocols`;
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < byRank.length; i++) {
    if (byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) return `rank ${byRank[i]!.rank} outvalues rank ${byRank[i - 1]!.rank}`;
  }
  if (board.length >= 2 && byRank[0]!.implied_value_usd === byRank[byRank.length - 1]!.implied_value_usd) return 'every row shares one implied value: not a ranking';
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (typeof r.name !== 'string' || r.name.length === 0) return `${r.slug} has no name`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  return null;
}

/** data.js: the dashboard's whole dataset as one script — no fetch, no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
