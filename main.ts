// The token launch radar: reads the sealed snapshot, fits the market's own law of value from the
// protocols that already trade a token, prices every pre-token protocol by that law, and writes a
// ranked board, the page's data and the dossier the judge reads.
//
// Local run:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../kits-to/token-radar-01-kit/input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const TEXT_MAX_BYTES = 65_536;

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board }, null, 1)}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

function copyTree(from: string, to: string): number {
  if (!existsSync(from)) return 0;
  mkdirSync(to, { recursive: true });
  let n = 0;
  for (const name of readdirSync(from)) {
    if (name.startsWith('.') || name.startsWith('-')) continue;
    const src = join(from, name);
    const dst = join(to, name);
    const st = statSync(src);
    if (st.isDirectory()) n += copyTree(src, dst);
    else if (st.isFile()) {
      copyFileSync(src, dst);
      n++;
    }
  }
  return n;
}

copyTree(join(here, 'dashboard'), join(out, 'dashboard'));
copyTree(join(here, 'screenshots'), join(out, 'screenshots'));

const dossier = buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES });
writeFileSync(join(out, 'dossier.json'), dossier);

const f = radar.fit;
process.stdout.write(
  `token radar: ${board.length} rows, watchlist ${snapshot.watchlist.length}/${snapshot.watchlist.length}; ` +
    `law fitted on ${f.samples} live protocols: mcap = 10^${f.intercept.toFixed(4)} * tvl^${f.slope.toFixed(4)}; ` +
    `momentum ${radar.momentum_weight}; dossier ${dossier.length} bytes\n`,
);
