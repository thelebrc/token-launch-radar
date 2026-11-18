// token-radar-01: turn the sealed DeFiLlama snapshot into a ranked launch radar.
//
// What this program does, end to end:
//   1. Load the snapshot (sealed /input/snapshot.json in the grader, or --input <file|dir>).
//   2. Score every pre-token protocol with lib/model.ts and rank the board.
//   3. Refuse a board the gate would refuse, before writing anything the judge reads.
//   4. Write /output/board.json (the ranked rows) and /output/data.js (the dashboard's data).
//   5. Mirror this repo's dashboard/ and screenshots/ into /output.
//   6. Write /output/dossier.json last, so the scorer can rebuild it from this same /output
//      and compare bytes.
//
// The dashboard itself is a static page with no framework and no network calls: it reads the
// data.js this program writes. Outside the grader, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

// The scorer's own caps, from reference/gate.json. The text cap shapes the dossier's bytes;
// the other caps only refuse.
const MAX_TEXT_BYTES = 65_536;
const MAX_SHOTS = 4;
const MAX_SHOT_BYTES = 524_288;
const MAX_DASH_FILES = 400;
const MAX_DASH_BYTES = 4_194_304;

// A plain file name: letters, digits and . _ -, 1 to 128 characters, never starting with . or -.
const PLAIN_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** Print `message` to stderr and stop with `code`. */
function fail(message: string, code: number): never {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

/**
 * The value of `--name <value>` (or `--name=<value>`) on the command line, `fallback` when
 * the flag is absent. A bare trailing `--name` with no value after it falls through to the
 * `--name=` form, exactly as the kit starter did.
 */
function flagValue(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at !== -1 && at + 1 < process.argv.length) {
    return process.argv[at + 1]!;
  }
  const joined = process.argv.find((entry) => entry.startsWith(`--${name}=`));
  return joined === undefined ? fallback : joined.slice(name.length + 3);
}

/**
 * Mirror one directory's regular files into `target`, skipping dot-names. Returns the names
 * copied, in directory order. A missing source directory copies nothing.
 */
function mirrorDirectory(source: string, target: string): string[] {
  if (!existsSync(source)) return [];
  mkdirSync(target, { recursive: true });
  const names: string[] = [];
  for (const name of readdirSync(source)) {
    if (name.startsWith('.')) continue;
    const from = join(source, name);
    if (!statSync(from).isFile()) continue;
    copyFileSync(from, join(target, name));
    names.push(name);
  }
  return names;
}

function main(): void {
  // Where the snapshot lives: a JSON file directly, or a directory holding snapshot.json.
  const input = flagValue('input', '/input');
  const snapshotPath = input.endsWith('.json') ? input : join(input, 'snapshot.json');
  if (!existsSync(snapshotPath)) {
    fail(
      `token radar: no snapshot at ${snapshotPath}: pass --input <snapshot.json|directory> or mount the sealed /input`,
      2,
    );
  }
  const out = flagValue('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

  const snapshot = parseSnapshot(readFileSync(snapshotPath, 'utf8'));
  const { board, radar } = buildRadar(snapshot);
  const problem = boardIssue(board, snapshot);
  if (problem !== null) {
    fail(`token radar: the model wrote a board the gate refuses: ${problem}`, 1);
  }

  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
  writeFileSync(join(out, 'data.js'), dataScript(radar));

  const repoRoot = fileURLToPath(new URL('.', import.meta.url));
  mirrorDirectory(join(repoRoot, 'dashboard'), join(out, 'dashboard'));
  const shots = mirrorDirectory(join(repoRoot, 'screenshots'), join(out, 'screenshots'));
  if (shots.length < 3) {
    fail(
      `token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view`,
      1,
    );
  }
  for (const name of shots) {
    if (!PLAIN_NAME.test(name)) {
      fail(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`, 1);
    }
  }

  // The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
  writeFileSync(
    join(out, 'dossier.json'),
    buildDossier(out, {
      text_max_bytes: MAX_TEXT_BYTES,
      screenshots: { max: MAX_SHOTS, max_bytes: MAX_SHOT_BYTES },
      dashboard: { max_files: MAX_DASH_FILES, max_bytes: MAX_DASH_BYTES },
    }),
  );

  process.stdout.write(
    `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
      `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (3 files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
  );
}

main();
