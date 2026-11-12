import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { promisify } from 'node:util';
import { exportConfig, roundLikeSheet, slug } from '../src/export.mjs';
import { loadXlsx } from '../src/workbook.mjs';
import { coreLoopData, writeWorkbook } from './fixture.mjs';

let dir;
let n = 0;
before(async () => (dir = await mkdtemp(join(tmpdir(), 'export-config-'))));
after(async () => rm(dir, { recursive: true, force: true }));

/** Writes the fixture (optionally changed) to a real .xlsx and exports it. */
async function run(mutate) {
  const data = coreLoopData();
  mutate?.(data);
  const path = join(dir, `wb${n++}.xlsx`);
  await writeWorkbook(data, path);
  return exportConfig(await loadXlsx(path));
}
const parsed = (res) => Object.fromEntries(Object.entries(res.files).map(([k, v]) => [k, JSON.parse(JSON.stringify(v))]));
const row = (data, sheet, name) => data[sheet].find((r) => r[0] === name);

describe('the live Sheet (revision 8)', () => {
  let res, cfg;
  before(async () => {
    res = await run();
    cfg = parsed(res);
  });

  test('exports with no errors or warnings', () => {
    assert.deepEqual(res.errors, []);
    // No warnings also means every formula preview on "Building Levels" equals
    // what the exporter derives: 15 rows x 7 numbers of rounding parity.
    assert.deepEqual(res.warnings, []);
    assert.deepEqual(Object.keys(res.files).sort(), ['buildings.json', 'economy.json', 'research.json', 'resources.json', 'units.json']);
  });

  test('resources', () => {
    assert.equal(cfg['resources.json'].length, 6);
    assert.deepEqual(cfg['resources.json'][0], { id: 'food', name: 'Food', type: 'basic', starting: 5000, storageCap: 20000 });
    assert.equal(cfg['resources.json'].find((r) => r.id === 'gems').storageCap, null);
  });

  test('buildings get a full level table from their curves', () => {
    const b = cfg['buildings.json'];
    assert.equal(b.length, 13);
    assert.ok(b.every((x) => x.levels.length === 30));
    const keep = b.find((x) => x.id === 'keep');
    assert.deepEqual(keep.levels[1], {
      level: 2,
      cost: { food: 0, timber: 310, stone: 233, iron: 0 },
      buildTimeSec: 96,
      outputPerHour: 125,
      keepLevelRequired: 1,
      power: 5,
    });
    assert.equal(keep.produces, 'gold');
    const farm = b.find((x) => x.id === 'farm');
    assert.equal(farm.levels[1].buildTimeSec, 44); // 30 * 1.45 = 43.5 -> 44, as the Sheet rounds
    const mageTower = b.find((x) => x.id === 'mage_tower');
    assert.equal(mageTower.levels[0].keepLevelRequired, 12); // unlock level beats building level
    assert.equal(mageTower.levels[19].keepLevelRequired, 20);
  });

  test('units reference buildings and types by id', () => {
    const knight = cfg['units.json'].find((u) => u.id === 'knight');
    assert.equal(knight.trainedAt, 'stables');
    assert.equal(knight.strongVs, 'archer');
    assert.deepEqual(knight.cost, { food: 125, timber: 75, stone: 0, iron: 50 });
    assert.equal(cfg['units.json'].find((u) => u.id === 'battle_mage').strongVs, 'all');
  });

  test('research', () => {
    const masonry = cfg['research.json'].find((t) => t.id === 'masonry');
    assert.equal(masonry.requiresTech, 'forestry');
    assert.equal(masonry.effect, 'stone_output');
    assert.equal(masonry.valuePerLevel, 0.05);
    assert.equal(masonry.levels.length, 20);
    assert.deepEqual(masonry.levels[1], { level: 2, cost: { food: 840, timber: 840, stone: 280, iron: 0 }, timeSec: 560 });
  });

  test('economy', () => {
    const e = cfg['economy.json'];
    assert.equal(e.instantFinishGemsPerMinute, 1);
    assert.equal(e.speedUps.length, 8);
    assert.deepEqual(e.speedUps.find((s) => s.id === '1_hour_builders_haste'), {
      id: '1_hour_builders_haste', name: "1-hour Builder's Haste", appliesTo: 'construction', skipSeconds: 3600, gems: 40,
    });
    assert.equal(e.gemPacks.length, 6);
    assert.deepEqual(e.gemPacks.at(-1), { id: 'dragons_hoard', name: "Dragon's Hoard", pricePence: 9999, gems: 15000 });
  });
});

describe('Building Levels overrides', () => {
  test('a typed value replaces that level only, and power follows the cost', async () => {
    const res = await run((d) => {
      d['Building Levels'].find((r) => r[0] === 'Farm' && r[1] === 3)[3] = 999; // Timber
    });
    assert.deepEqual(res.errors, []);
    const farm = res.files['buildings.json'].find((b) => b.id === 'farm');
    assert.equal(farm.levels[2].cost.timber, 999);
    assert.equal(farm.levels[2].power, 11); // round((999 + 98) / 100)
    assert.equal(farm.levels[3].cost.timber, 274);
    assert.deepEqual(res.overrides, ['Farm L3 timber = 999']);
  });

  test('a typed power is kept as typed', async () => {
    const res = await run((d) => {
      const r = d['Building Levels'].find((x) => x[0] === 'Keep' && x[1] === 1);
      r[3] = 1000;
      r[10] = 1;
    });
    assert.deepEqual(res.errors, []);
    const keep = res.files['buildings.json'].find((b) => b.id === 'keep');
    assert.equal(keep.levels[0].power, 1);
  });

  test('formula previews that disagree with the curve are warned about, not exported', async () => {
    const res = await run((d) => {
      row(d, 'Buildings', 'Farm')[10] = 1.5; // cost growth changed, previews still show 1.4
    });
    assert.deepEqual(res.errors, []);
    assert.ok(res.warnings.some((w) => w.startsWith("Building Levels!D8: formula shows 140 but the exporter derives 150")));
    const farm = res.files['buildings.json'].find((b) => b.id === 'farm');
    assert.equal(farm.levels[1].cost.timber, 150);
  });

  test('levels past max level and duplicates are errors', async () => {
    const res = await run((d) => {
      d['Building Levels'].push(['Farm', 31, 1, 1, 1, 1, 1, null, 1, 1, 1, null]);
      d['Building Levels'].push(['Farm', 2, null, 5, null, null, null, null, null, null, null, null]);
    });
    assert.deepEqual(res.files, {});
    assert.ok(res.errors.includes('Building Levels!B17: Farm only goes to level 30'));
    assert.ok(res.errors.includes('Building Levels!B18: Farm level 2 is listed twice'));
  });
});

describe('validation', () => {
  test('reports every problem with its cell, and writes nothing', async () => {
    const res = await run((d) => {
      d.Buildings.push(['farm', 'Resource', 30, 1, 30, 1.45, 0, 0, 0, 0, 1.4, 0, 1, null, null]); // same id as Farm
      row(d, 'Units', 'Knight')[3] = 'Stable'; // typo
      row(d, 'Units', 'Spearman')[17] = 'Dragons';
      row(d, 'Research', 'Forestry')[12] = 'Master Builders'; // forestry -> master builders -> masonry -> forestry
      row(d, 'Resources', 'Iron')[2] = 'lots';
      row(d, 'Buildings', 'Quarry')[13] = 'Marble';
    });
    assert.deepEqual(res.files, {});
    for (const e of [
      'Buildings!A15: "farm" has the same id (farm) as row 3',
      'Units!D8: "stable" is not a building',
      'Units!R2: "dragons" is not a unit type (expected one of infantry, archer, cavalry, mage or All)',
      'Research!A3: prerequisite loop: forestry -> master_builders -> masonry -> forestry',
      'Resources!C5: expected a number, got "lots"',
      'Buildings!N5: Produces "marble" is not a resource',
    ]) {
      assert.ok(res.errors.includes(e), `missing error: ${e}\nerrors: ${res.errors.join('\n')}`);
    }
  });

  test('a missing column names the column', async () => {
    const res = await run((d) => {
      d.Units[0][13] = 'Hit points';
    });
    assert.ok(res.errors.includes('Units: missing column "HP" (header row 1)'));
  });

  test('a new resource column is picked up without code changes', async () => {
    const res = await run((d) => {
      d.Units[0].splice(9, 0, 'Gold');
      for (const r of d.Units.slice(1)) r.splice(9, 0, 7);
    });
    assert.deepEqual(res.errors, []);
    assert.equal(res.files['units.json'][0].cost.gold, 7);
  });

  test('an unknown column is warned about', async () => {
    const res = await run((d) => {
      d.Resources[0][6] = 'Icon';
    });
    assert.ok(res.warnings.includes('Resources!G1: column "Icon" is not exported'));
  });
});

describe('helpers', () => {
  test('rounds like the Sheet', () => {
    assert.equal(roundLikeSheet(50 * 1.13), 57); // 56.49999999999999 in doubles
    assert.equal(roundLikeSheet(2.5), 3);
    assert.equal(roundLikeSheet(-2.5), -3);
    assert.equal(roundLikeSheet(2.4999), 2);
  });

  test('slugs', () => {
    assert.equal(slug('Lumber Mill'), 'lumber_mill');
    assert.equal(slug("Dragon's Hoard"), 'dragons_hoard');
    assert.equal(slug('Speed-ups & Gems'), 'speed_ups_and_gems');
  });
});

describe('cli', () => {
  test('writes config, then --check passes; a change makes --check fail', async () => {
    const exec = promisify(execFile);
    const cli = new URL('../src/cli.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
    const xlsx = join(dir, 'cli.xlsx');
    const out = join(dir, 'config');
    await writeWorkbook(coreLoopData(), xlsx);

    const first = await exec(process.execPath, [cli, xlsx, '--out', out]);
    assert.match(first.stdout, /wrote buildings\.json, economy\.json|wrote resources\.json/);
    assert.equal((await exec(process.execPath, [cli, xlsx, '--out', out, '--check'])).stdout.trim(), 'config is up to date');

    await writeFile(join(out, 'units.json'), '[]\n');
    await assert.rejects(exec(process.execPath, [cli, xlsx, '--out', out, '--check']), (e) => e.code === 1 && /out of date: units\.json/.test(e.stdout));
    assert.ok((await readFile(join(out, 'resources.json'), 'utf8')).endsWith('\n'));
  });
});
