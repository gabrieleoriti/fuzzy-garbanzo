#!/usr/bin/env node
// Usage:
//   npm run export -- <workbook.xlsx> [--out <dir>] [--check]
//
// <workbook.xlsx>  the core-loop Sheet downloaded as .xlsx from its page
// --out <dir>      where to write the JSON (default: <repo>/config)
// --check          write nothing; exit 1 if the files in --out differ from the workbook
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportConfig } from './export.mjs';
import { loadXlsx } from './workbook.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function parseArgs(argv) {
  const args = { input: null, out: join(repoRoot, 'config'), check: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') args.out = resolve(argv[++i] ?? '');
    else if (a === '--check') args.check = true;
    else if (a === '-h' || a === '--help') args.help = true;
    else if (!args.input) args.input = resolve(a);
    else throw new Error(`unexpected argument: ${a}`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.input) {
    console.log('Usage: npm run export -- <workbook.xlsx> [--out <dir>] [--check]');
    return args.help ? 0 : 2;
  }

  const { files, errors, warnings, overrides } = exportConfig(await loadXlsx(args.input));
  for (const w of warnings) console.warn(`warning: ${w}`);
  if (errors.length) {
    for (const e of errors) console.error(`error: ${e}`);
    console.error(`\n${errors.length} error(s); nothing written.`);
    return 1;
  }
  if (overrides.length) console.log(`hand-tuned levels: ${overrides.join('; ')}`);

  const changed = [];
  if (!args.check) await mkdir(args.out, { recursive: true });
  for (const [name, data] of Object.entries(files)) {
    const path = join(args.out, name);
    const text = JSON.stringify(data, null, 2) + '\n';
    const before = await readFile(path, 'utf8').catch(() => null);
    if (before === text) continue;
    changed.push(name);
    if (!args.check) await writeFile(path, text);
  }

  if (args.check) {
    console.log(changed.length ? `out of date: ${changed.join(', ')}` : 'config is up to date');
    return changed.length ? 1 : 0;
  }
  console.log(changed.length ? `wrote ${changed.join(', ')} to ${args.out}` : `no changes in ${args.out}`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e?.message ?? e);
    process.exit(1);
  }
);
