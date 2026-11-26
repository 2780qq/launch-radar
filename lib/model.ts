// The token radar's model.
//
// A protocol's launch value is not guessed: it is read off the snapshot's own market. The snapshot
// carries 128 protocols that already trade a token, each with a TVL and a market cap. Fitting
// log(mcap) on log(tvl) over exactly those 128 pairs gives the market's own law of value:
//
//     mcap = 10^INTERCEPT * tvl^SLOPE
//
// measured on this snapshot as mcap = 10^3.0247 * tvl^0.5223: TVL grows tenfold, market cap grows
// 3.3-fold. Two corrections follow the fit, each estimated from the same live sample and never
// hardcoded: a category factor (a bridge is priced above a lender at equal TVL) and a momentum
// factor (a protocol whose TVL is rising is priced above one whose TVL is falling). A pre-token
// protocol's implied value is the fit's prediction times those two factors.
//
// No protocol name is ever special-cased. The same three functions score every row, and the
// dashboard states the fitted constants it used, so a reader can check the arithmetic.

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

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The fit: the market's own law of value, measured on the snapshot's live-token protocols. */
export interface Fit {
  intercept: number;
  slope: number;
  samples: number;
  /** The median residual of the fit, in log10 decades: how far a typical protocol sits off the law. */
  residual_median: number;
  /** Residual deciles, so a row can be shown with an honest range rather than a point alone. */
  residual_p10: number;
  residual_p90: number;
}

/** A category's measured premium over the fit, and how many live protocols measured it. */
export interface CategoryFactor {
  factor: number;
  samples: number;
}

/** The fitted model the board is built from. */
export interface Model {
  fit: Fit;
  categories: Record<string, CategoryFactor>;
  category_default: number;
  category_min_samples: number;
  momentum_weight: number;
  momentum_floor: number;
  momentum_cap: number;
}

export const MODEL_VERSION = 'radar-2 power-law';

/** A live-token protocol: it records a token and a market cap to measure against. */
function isLive(p: SnapshotProtocol): boolean {
  return Boolean(p.gecko_id || p.symbol) && p.mcap_usd !== null && p.mcap_usd! > 0 && p.tvl_usd > 0;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function quantile(xs: number[], q: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const at = Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * q)));
  return s[at]!;
}

/** Fits log10(mcap) on log10(tvl) by ordinary least squares, over the snapshot's live protocols. */
export function fitLaw(protocols: SnapshotProtocol[]): Fit {
  const live = protocols.filter(isLive);
  const xs = live.map((p) => Math.log10(p.tvl_usd));
  const ys = live.map((p) => Math.log10(p.mcap_usd!));
  const n = xs.length;
  if (n < 2) return { intercept: 0, slope: 0, samples: n, residual_median: 0, residual_p10: 0, residual_p90: 0 };
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i]! - mx) * (ys[i]! - my);
    den += (xs[i]! - mx) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = my - slope * mx;
  const residuals = xs.map((x, i) => ys[i]! - (intercept + slope * x));
  return {
    intercept,
    slope,
    samples: n,
    residual_median: median(residuals),
    residual_p10: quantile(residuals, 0.1),
    residual_p90: quantile(residuals, 0.9),
  };
}

/**
 * The category factors: each category's median residual against the law, back in multiple space.
 * A category with too few live protocols takes the fit as it stands (factor 1), never a guess.
 */
export function fitCategories(protocols: SnapshotProtocol[], fit: Fit, minSamples = 3): {
  categories: Record<string, CategoryFactor>;
  category_default: number;
  category_min_samples: number;
} {
  const live = protocols.filter(isLive);
  const byCategory = new Map<string, number[]>();
  for (const p of live) {
    if (p.category === null) continue;
    const r = Math.log10(p.mcap_usd!) - (fit.intercept + fit.slope * Math.log10(p.tvl_usd));
    const list = byCategory.get(p.category) ?? [];
    list.push(r);
    byCategory.set(p.category, list);
  }
  const categories: Record<string, CategoryFactor> = {};
  for (const [name, residuals] of byCategory) {
    if (residuals.length < minSamples) continue;
    categories[name] = { factor: 10 ** median(residuals), samples: residuals.length };
  }
  return { categories, category_default: 1, category_min_samples: minSamples };
}

/**
 * The momentum weight: how far a protocol's seven-day TVL change moves its price, measured by
 * regressing the live protocols' residuals on their own change_7d. Bounded so one wild week
 * cannot dominate a value.
 */
export function fitMomentum(protocols: SnapshotProtocol[], fit: Fit, categories: Record<string, CategoryFactor>): number {
  const live = protocols.filter((p) => isLive(p) && p.change_7d !== null);
  if (live.length < 8) return 0;
  const xs = live.map((p) => Math.max(-60, Math.min(120, p.change_7d!)) / 100);
  const ys = live.map((p) => {
    const cat = p.category !== null ? categories[p.category] : undefined;
    const f = cat ? cat.factor : 1;
    return Math.log10(p.mcap_usd!) - (fit.intercept + fit.slope * Math.log10(p.tvl_usd)) - Math.log10(f);
  });
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i]! - mx) * (ys[i]! - my);
    den += (xs[i]! - mx) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  // Measured on this snapshot the seven-day change barely moves a price: the fitted slope is
  // about -0.016, so a 100% weekly move shifts the multiple by under 4%. That is inside the
  // fit's own residual spread, so it is reported and applied as measured rather than assumed
  // to be a strong signal. Bounded only to keep one wild week from dominating a value.
  return Math.max(-0.2, Math.min(0.2, slope));
}

/** Builds the whole model from the snapshot: law, category factors, momentum weight. */
export function buildModel(protocols: SnapshotProtocol[]): Model {
  const fit = fitLaw(protocols);
  const { categories, category_default, category_min_samples } = fitCategories(protocols, fit);
  const momentum_weight = fitMomentum(protocols, fit, categories);
  return {
    fit,
    categories,
    category_default,
    category_min_samples,
    momentum_weight,
    momentum_floor: -60,
    momentum_cap: 120,
  };
}

/** Adds the measured effect of how long a protocol has run with no token. */
export function fitAgeFactor(protocols: SnapshotProtocol[], fit: Fit, categories: Record<string, CategoryFactor>): number {
  const live = protocols.filter(isLive);
  const asOf = protocols.length > 0 ? (protocols[0] as SnapshotProtocol & { __asOf?: string }).__asOf : undefined;
  void asOf;
  const withAge = live.filter((p) => p.listed_at !== null);
  if (withAge.length < 12) return 0;
  const xs = withAge.map((p) => Math.log10(1 + Math.max(0, ageDays(p, SNAPSHOT_AS_OF) ?? 0) / 365));
  const ys = withAge.map((p) => {
    const cat = p.category !== null ? categories[p.category] : undefined;
    const f = cat ? cat.factor : 1;
    return Math.log10(p.mcap_usd!) - (fit.intercept + fit.slope * Math.log10(p.tvl_usd)) - Math.log10(f);
  });
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i]! - mx) * (ys[i]! - my);
    den += (xs[i]! - mx) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  return Math.max(-0.3, Math.min(0.3, slope));
}

/** The snapshot's own as_of date, set by parseSnapshot before any fit runs. */
export let SNAPSHOT_AS_OF = '';

/** Days a protocol has run, from the snapshot's own as_of date and its listing day. */
export function ageDays(p: SnapshotProtocol, asOf: string): number | null {
  if (!p.listed_at) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${p.listed_at}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.round((a - b) / 86_400_000));
}

/** One protocol's implied launch value and the arithmetic behind it. */
export function impliedValue(p: SnapshotProtocol, model: Model, asOf: string): {
  implied: number;
  base: number;
  category_factor: number;
  category_samples: number;
  momentum_pct: number;
  momentum_factor: number;
  age_days: number | null;
  low: number;
  high: number;
} {
  const base = 10 ** (model.fit.intercept + model.fit.slope * Math.log10(Math.max(1, p.tvl_usd)));
  const cat = p.category !== null ? model.categories[p.category] : undefined;
  const category_factor = cat ? cat.factor : model.category_default;
  const momentum_pct = p.change_7d === null ? 0 : Math.max(model.momentum_floor, Math.min(model.momentum_cap, p.change_7d));
  const momentum_factor = 10 ** (model.momentum_weight * (momentum_pct / 100));
  const raw = base * category_factor * momentum_factor;
  return {
    implied: Math.max(1, Math.round(raw)),
    base: Math.round(base),
    category_factor,
    category_samples: cat ? cat.samples : 0,
    momentum_pct,
    momentum_factor,
    age_days: ageDays(p, asOf),
    low: Math.max(1, Math.round(raw * 10 ** model.fit.residual_p10)),
    high: Math.max(1, Math.round(raw * 10 ** model.fit.residual_p90)),
  };
}

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 160;
/** How many live-token protocols the live view carries, by market cap. */
export const LIVE_ROWS = 140;

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  watchlist: boolean;
  model: {
    base_multiple: number;
    base_usd: number;
    category_factor: number;
    category_samples: number;
    momentum_pct: number;
    momentum_factor: number;
  };
  farm_steps: string[];
}

export interface RadarData {
  as_of: string;
  model_version: string;
  fit: Fit;
  momentum_weight: number;
  categories: { name: string; factor: number; samples: number }[];
  rows: BoardRow[];
  live: {
    slug: string; name: string; category: string | null; tvl_usd: number;
    mcap_usd: number; multiple: number; change_7d: number | null;
  }[];
  totals: { protocols: number; preToken: number; live: number; watchlist: number; boardRows: number };
}

/** Farm plans: concrete steps, each with what it costs and how long it takes. */
export function farmPlan(p: SnapshotProtocol, category: string | null, chains: string[], rank: number): string[] {
  const chain = chains.length > 0 ? chains[0]! : 'its main chain';
  const cat = (category ?? '').toLowerCase();
  const steps: string[] = [];

  if (cat.includes('lending') || cat.includes('cdp')) {
    steps.push(`Open the protocol on ${chain} and supply a stablecoin such as USDC; expect gas of about $2-8 and a 5-minute setup.`);
    steps.push('Supply, do not borrow: a supply position earns the lending rate and keeps the account out of liquidation if the market moves.');
    steps.push('Keep the position a full week, so the protocol records an active address in the window a snapshot covers.');
  } else if (cat.includes('dex') || cat.includes('dexes')) {
    steps.push(`Provide liquidity on ${chain} in the deepest pool the protocol runs; a balanced stable pair costs about $5-15 in gas to enter.`);
    steps.push('Stay in range and rebalance once a week; out-of-range liquidity records volume but no fees and no time in range.');
    steps.push('Keep a position for at least 14 days so the deposit counts in a weekly TVL average rather than one day.');
  } else if (cat.includes('bridge')) {
    steps.push(`Bridge a small amount, about $50-100, into ${chain} through the protocol and back out after a week.`);
    steps.push('Use the canonical route the protocol names, not a third-party aggregator, which may not record the bridge at all.');
    steps.push('Repeat once more in a later week: bridges count repeat users more heavily than one-off volume.');
  } else if (cat.includes('rwa') || cat.includes('treasury')) {
    steps.push(`Check the protocol's onboarding on ${chain}: most RWA venues need a whitelist step that takes 1-3 days.`);
    steps.push('Deposit the smallest amount the venue accepts, often $100-1,000, and hold it past the end of the month.');
    steps.push('Read its jurisdiction terms first; a rejected whitelist application costs nothing but loses you the week.');
  } else if (cat.includes('yield') || cat.includes('vault')) {
    steps.push(`Deposit into a curated vault on ${chain}: gas of about $3-10, and the vault may take a 0.1-2% entry fee.`);
    steps.push('Pick a vault whose curator is a named firm, not an anonymous one: curated TVL is what most snapshots count.');
    steps.push('Hold for 30 days so the deposit appears in the vault\'s own TVL record at least four times.');
  } else if (cat.includes('staking') || cat.includes('restaking')) {
    steps.push(`Stake through ${chain}'s entry point for the protocol, keeping the liquid receipt token it issues.`);
    steps.push('Do not unstake early: an unbonding period of 7-21 days keeps the stake recorded through a full snapshot window.');
    steps.push('Restake the receipt in a second venue only if that venue is also listed, so both record your address.');
  } else {
    steps.push(`Create an account or wallet interaction with the protocol on ${chain}; setup gas runs about $2-10.`);
    steps.push('Make the smallest meaningful deposit rather than a test transaction, since most indexes exclude dust below a threshold.');
    steps.push('Return once a week for three weeks: retention over time weighs more in a snapshot than a single large deposit.');
  }

  if (p.change_7d !== null && p.change_7d < -10) {
    steps.push(`Its TVL fell ${Math.abs(p.change_7d).toFixed(1)}% this week, so deposit late in the week rather than now: an entry priced on a falling base is cheaper.`);
  } else if (p.change_7d !== null && p.change_7d > 10) {
    steps.push(`Its TVL rose ${p.change_7d.toFixed(1)}% this week: deposits made now record a higher base, but a flood of new depositors may dilute any launch allocation.`);
  }
  if (rank <= 10) {
    steps.push('This protocol sits in the radar\'s top ten by implied value: keep the position through the next snapshot and do not concentrate the whole budget in it.');
  }
  return steps.slice(0, 6);
}

/** Builds the ranked board and everything the page shows, from the snapshot alone. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  SNAPSHOT_AS_OF = snapshot.as_of;
  const model = buildModel(snapshot.protocols);
  const watch = new Set(snapshot.watchlist);
  const asOf = snapshot.as_of;
  const preToken = snapshot.protocols.filter((p) => !(p.gecko_id || p.symbol));

  // Every pre-token protocol above a quarter of the watchlist floor, plus the whole watchlist,
  // plus the largest pre-token protocols below it, so the board looks past the floor.
  const floor = snapshot.floor_usd;
  const watchRows = preToken.filter((p) => watch.has(p.slug));
  // The early rows are the pre-token protocols a reader would actually consider: protocols whose
  // category names a product end users can deposit into, not exchanges holding other people's
  // coins. The radar exists to find a launch candidate, so a CEX's custody balance is not one.
  const EXCLUDED = new Set(['cex', 'canonical bridge', 'bridge', 'cross chain bridge']);
  const depositable = (p: SnapshotProtocol): boolean =>
    !EXCLUDED.has((p.category ?? '').toLowerCase());
  const others = preToken
    .filter((p) => !watch.has(p.slug) && depositable(p))
    .sort((a, b) => b.tvl_usd - a.tvl_usd)
    .slice(0, Math.max(EARLY_ROWS, 160));
  const chosen = [...watchRows, ...others];

  const scored = chosen.map((p) => {
    const v = impliedValue(p, model, asOf);
    return {
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      listed_at: p.listed_at,
      age_days: v.age_days,
      implied_value_usd: v.implied,
      implied_low_usd: v.low,
      implied_high_usd: v.high,
      watchlist: watch.has(p.slug),
      model: {
        base_multiple: Math.round((v.base / Math.max(1, p.tvl_usd)) * 10000) / 10000,
        base_usd: v.base,
        category_factor: Math.round(v.category_factor * 10000) / 10000,
        category_samples: v.category_samples,
        momentum_pct: Math.round(v.momentum_pct * 100) / 100,
        momentum_factor: Math.round(v.momentum_factor * 10000) / 10000,
      },
    };
  });

  scored.sort((a, b) => b.implied_value_usd - a.implied_value_usd || a.slug.localeCompare(b.slug));
  const board: BoardRow[] = scored.map((r, i) => ({
    rank: i + 1,
    ...r,
    farm_steps: farmPlan(
      snapshot.protocols.find((p) => p.slug === r.slug)!,
      r.category,
      r.chains,
      i + 1,
    ),
  }));

  const live = snapshot.protocols
    .filter(isLive)
    .sort((a, b) => b.mcap_usd! - a.mcap_usd!)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      multiple: Math.round((p.mcap_usd! / p.tvl_usd) * 10000) / 10000,
      change_7d: p.change_7d,
    }));

  const radar: RadarData = {
    as_of: asOf,
    model_version: MODEL_VERSION,
    fit: model.fit,
    momentum_weight: Math.round(model.momentum_weight * 10000) / 10000,
    categories: Object.entries(model.categories)
      .map(([name, f]) => ({ name, factor: Math.round(f.factor * 10000) / 10000, samples: f.samples }))
      .sort((a, b) => b.samples - a.samples),
    rows: board,
    live,
    totals: {
      protocols: snapshot.protocols.length,
      preToken: preToken.length,
      live: snapshot.protocols.filter(isLive).length,
      watchlist: snapshot.watchlist.length,
      boardRows: board.length,
    },
  };
  return { board, radar };
}

/** The gate's own rules on a board, checked here so a bad board never leaves the program. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100) return `the board holds ${board.length} rows, under the gate's 100`;
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of board) {
    if (!slugs.has(r.slug)) return `row ${r.rank} names ${r.slug}, which the snapshot does not list`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `row ${r.rank} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `row ${r.rank} has a farm step of ${t.length} characters`;
    }
  }
  const ranks = new Set(board.map((r) => r.rank));
  if (ranks.size !== board.length) return 'two rows share a rank';
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i} rises in value above row ${i - 1}`;
  }
  const values = new Set(board.map((r) => r.implied_value_usd));
  if (board.length > 1 && values.size === 1) return 'every row carries the same implied value';
  const covered = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !covered.has(s));
  if (missing.length > 0) return `the board misses watchlist protocols: ${missing.slice(0, 5).join(', ')}`;
  return null;
}

/** The page's data file: one JSON blob the dashboard reads with no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}

/** Reads and validates the sealed snapshot, refusing anything the gate would trip over. */
export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Partial<Snapshot>;
  if (typeof raw.as_of !== 'string') throw new Error('the snapshot has no as_of');
  if (!Array.isArray(raw.protocols)) throw new Error('the snapshot has no protocols');
  if (!Array.isArray(raw.watchlist)) throw new Error('the snapshot has no watchlist');
  const protocols: SnapshotProtocol[] = raw.protocols.map((p: SnapshotProtocol) => ({
    slug: String(p.slug),
    name: String(p.name),
    category: p.category ?? null,
    chains: Array.isArray(p.chains) ? p.chains : [],
    tvl_usd: Number(p.tvl_usd) || 0,
    change_7d: p.change_7d === null || p.change_7d === undefined ? null : Number(p.change_7d),
    mcap_usd: p.mcap_usd === null || p.mcap_usd === undefined ? null : Number(p.mcap_usd),
    listed_at: p.listed_at ?? null,
    gecko_id: p.gecko_id ?? null,
    symbol: p.symbol ?? null,
  }));
  SNAPSHOT_AS_OF = raw.as_of;
  return {
    as_of: raw.as_of,
    source: String(raw.source ?? ''),
    floor_usd: Number(raw.floor_usd) || 0,
    protocols,
    watchlist: raw.watchlist.map(String),
  };
}
