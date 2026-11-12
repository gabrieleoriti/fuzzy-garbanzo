// Turns the core-loop workbook (see workbook.mjs for the model) into the JSON
// the server loads. Pure: no file I/O, so tests can feed it any workbook.
//
// Rules worth knowing:
// - ids are slugs of the names in column A ("Lumber Mill" -> "lumber_mill");
//   cross-references (Trained at, Produces, Requires tech, ...) are written by name
//   in the sheet and exported as ids.
// - Cost columns are found by resource name ("Base Food" on Buildings/Research,
//   "Food" on Units/Building Levels), so adding a resource to a cost needs no code.
// - Every building and tech gets a full level table, derived as
//   ROUND(base * growth^(level-1)), rounded the way the spreadsheet rounds.
// - On "Building Levels", a TYPED value overrides that level; formula cells are
//   only previews (a mismatch with what we derive is reported as a warning).
// - Notes and display-only columns are not exported.
import { colLetter } from './workbook.mjs';

export const SHEET = {
  resources: 'Resources',
  buildings: 'Buildings',
  levels: 'Building Levels',
  units: 'Units',
  research: 'Research',
  economy: 'Speed-ups & Gems',
};

/** Columns that are deliberately not exported (no "ignored column" warning). */
const IGNORED_HEADERS = new Set(
  ['Notes', 'Produced by', 'Build time', 'Gems per minute', 'Gems per £', 'Bonus vs smallest'].map(norm)
);

class Fatal extends Error {}

class Ctx {
  constructor(sheets) {
    this.sheets = sheets;
    this.errors = [];
    this.warnings = [];
  }
  sheet(name) {
    const s = this.sheets.get(name);
    if (!s) {
      this.errors.push(`missing sheet "${name}"`);
      throw new Fatal();
    }
    return s;
  }
  error(sheet, r, c, msg) {
    this.errors.push(`${sheet}!${colLetter(c)}${r}: ${msg}`);
  }
  warn(sheet, r, c, msg) {
    this.warnings.push(`${sheet}!${colLetter(c)}${r}: ${msg}`);
  }
}

export function exportConfig(sheets) {
  const ctx = new Ctx(sheets);
  const out = {};
  // Each section is independent enough that one broken sheet shouldn't hide the
  // errors in the others; later sections need the earlier ones, so stop there.
  try {
    const resources = readResources(ctx);
    out['resources.json'] = resources;
    const buildings = readBuildings(ctx, resources);
    applyLevelOverrides(ctx, buildings, resources);
    out['buildings.json'] = buildings;
    out['units.json'] = readUnits(ctx, resources, buildings);
    out['research.json'] = readResearch(ctx, resources, buildings);
    out['economy.json'] = readEconomy(ctx);
  } catch (e) {
    if (!(e instanceof Fatal)) throw e;
  }
  return {
    files: ctx.errors.length ? {} : out,
    errors: ctx.errors,
    warnings: ctx.warnings,
    overrides: ctx.overrides ?? [],
  };
}

// --- Sheets ----------------------------------------------------------------------

function readResources(ctx) {
  const rows = readTable(ctx, SHEET.resources, {
    columns: [
      { header: 'Resource', key: 'name', type: 'name' },
      { header: 'Type', key: 'type', type: 'enum', values: ['basic', 'premium'] },
      { header: 'Starting amount', key: 'starting', type: 'int' },
      { header: 'Base storage cap', key: 'storageCap', type: 'int', blank: null }, // blank = no cap
    ],
  });
  uniqueIds(ctx, SHEET.resources, rows);
  if (!rows.length) fatal(ctx, `${SHEET.resources}: no resources`);
  return rows.map(({ v }) => ({ id: slug(v.name), name: v.name, type: v.type, starting: v.starting, storageCap: v.storageCap }));
}

function readBuildings(ctx, resources) {
  const rows = readTable(ctx, SHEET.buildings, {
    columns: [
      { header: 'Building', key: 'name', type: 'name' },
      { header: 'Category', key: 'category', type: 'enum' },
      { header: 'Max level', key: 'maxLevel', type: 'int', min: 1 },
      { header: 'Unlocks at Keep lvl', key: 'unlockKeepLevel', type: 'int' },
      { header: 'Base build time (s)', key: 'baseTime', type: 'num' },
      { header: 'Time growth / lvl', key: 'timeGrowth', type: 'growth' },
      { header: 'Cost growth / lvl', key: 'costGrowth', type: 'growth' },
      { header: 'Base output / hr', key: 'baseOutput', type: 'num' },
      { header: 'Output growth / lvl', key: 'outputGrowth', type: 'growth' },
      { header: 'Produces', key: 'produces', type: 'ref', blank: null },
    ],
    costColumns: (h) => resourceFor(resources, h.replace(/^base\s+/i, ''), /^base\s+/i.test(h)),
  });
  uniqueIds(ctx, SHEET.buildings, rows);

  const keep = rows.find((b) => slug(b.v.name) === 'keep');
  if (!keep) fatal(ctx, `${SHEET.buildings}: there must be a "Keep" row (it gates every other building)`);
  const resourceIds = new Set(resources.map((r) => r.id));

  return rows.map(({ r, v, cost, col }) => {
    const id = slug(v.name);
    if (v.produces !== null && !resourceIds.has(v.produces)) {
      ctx.error(SHEET.buildings, r, col.produces, `Produces "${v.produces}" is not a resource`);
    }
    if (id !== 'keep' && v.unlockKeepLevel > keep.v.maxLevel) {
      ctx.error(SHEET.buildings, r, col.unlockKeepLevel, `needs Keep ${v.unlockKeepLevel} but the Keep's max level is ${keep.v.maxLevel}`);
    }
    const levels = [];
    for (let level = 1; level <= v.maxLevel; level++) {
      const levelCost = mapValues(cost, (base) => curve(base, v.costGrowth, level));
      levels.push({
        level,
        cost: levelCost,
        buildTimeSec: curve(v.baseTime, v.timeGrowth, level),
        outputPerHour: curve(v.baseOutput, v.outputGrowth, level),
        keepLevelRequired: id === 'keep' ? level - 1 : Math.max(level, v.unlockKeepLevel),
        power: powerOf(levelCost),
      });
    }
    return {
      id,
      name: v.name,
      category: v.category,
      maxLevel: v.maxLevel,
      unlockKeepLevel: v.unlockKeepLevel,
      produces: v.produces,
      levels,
    };
  });
}

/** Typed values on "Building Levels" replace the derived ones for that level. */
function applyLevelOverrides(ctx, buildings, resources) {
  const S = SHEET.levels;
  const fields = [
    { header: 'Build time (s)', key: 'buildTimeSec' },
    { header: 'Output / hr', key: 'outputPerHour' },
    { header: 'Keep lvl required', key: 'keepLevelRequired' },
    { header: 'Power', key: 'power' },
  ];
  const rows = readTable(ctx, S, {
    columns: [
      { header: 'Building', key: 'building', type: 'ref' },
      { header: 'Level', key: 'level', type: 'int', min: 1 },
      ...fields.map((f) => ({ ...f, type: 'raw', required: false })),
    ],
    costColumns: (h) => resourceFor(resources, h, true),
    rawCost: true,
  });
  const byId = new Map(buildings.map((b) => [b.id, b]));
  const seen = new Set();
  ctx.overrides = [];

  for (const { r, v, cost, col } of rows) {
    const b = byId.get(v.building);
    if (!b) {
      ctx.error(S, r, col.building, `"${v.building}" is not a building`);
      continue;
    }
    if (v.level > b.maxLevel) {
      ctx.error(S, r, col.level, `${b.name} only goes to level ${b.maxLevel}`);
      continue;
    }
    const key = `${b.id}#${v.level}`;
    if (seen.has(key)) {
      ctx.error(S, r, col.level, `${b.name} level ${v.level} is listed twice`);
      continue;
    }
    seen.add(key);
    const lvl = b.levels[v.level - 1];

    // Typed values win; collect formula previews to cross-check afterwards.
    const previews = [];
    const take = (cell, c, label, set, get) => {
      if (!cell || cell.v === null) return;
      if (cell.f !== null) {
        previews.push({ cell, c, label, get });
        return;
      }
      const n = toNumber(cell.v);
      if (n === null || n < 0 || !Number.isInteger(n)) {
        ctx.error(S, r, c, `override must be a whole number ≥ 0, got ${JSON.stringify(cell.v)}`);
        return;
      }
      set(n);
      ctx.overrides.push(`${b.name} L${v.level} ${label} = ${n}`);
    };
    let powerTyped = false;
    for (const [res, { cell, c }] of Object.entries(cost)) {
      take(cell, c, res, (n) => (lvl.cost[res] = n), () => lvl.cost[res]);
    }
    for (const f of fields) {
      take(v[f.key], col[f.key], f.key, (n) => {
        lvl[f.key] = n;
        if (f.key === 'power') powerTyped = true;
      }, () => lvl[f.key]);
    }
    if (!powerTyped) lvl.power = powerOf(lvl.cost);

    for (const p of previews) {
      if (typeof p.cell.v === 'number' && p.cell.v !== p.get()) {
        ctx.warn(S, r, p.c, `formula shows ${p.cell.v} but the exporter derives ${p.get()} for ${p.label} (the Buildings curve is what gets exported; type a value here to override)`);
      }
    }
  }
}

function readUnits(ctx, resources, buildings) {
  const S = SHEET.units;
  const rows = readTable(ctx, S, {
    columns: [
      { header: 'Unit', key: 'name', type: 'name' },
      { header: 'Tier', key: 'tier', type: 'int', min: 1 },
      { header: 'Type', key: 'type', type: 'enum' },
      { header: 'Trained at', key: 'trainedAt', type: 'ref' },
      { header: 'Building lvl req', key: 'buildingLevelRequired', type: 'int' },
      { header: 'Train time (s)', key: 'trainTimeSec', type: 'num' },
      { header: 'Upkeep Food / hr', key: 'upkeepFoodPerHour', type: 'num' },
      { header: 'Attack', key: 'attack', type: 'num' },
      { header: 'Defence', key: 'defence', type: 'num' },
      { header: 'HP', key: 'hp', type: 'num', min: 1 },
      { header: 'Speed (tiles/min)', key: 'speedTilesPerMin', type: 'num' },
      { header: 'Load', key: 'load', type: 'num' },
      { header: 'Power', key: 'power', type: 'num' },
      { header: 'Strong vs', key: 'strongVs', type: 'enum' },
    ],
    costColumns: (h) => resourceFor(resources, h, true),
  });
  uniqueIds(ctx, S, rows);
  const byId = new Map(buildings.map((b) => [b.id, b]));
  const types = new Set(rows.map((u) => u.v.type));

  return rows.map(({ r, v, cost, col }) => {
    const at = byId.get(v.trainedAt);
    if (!at) ctx.error(S, r, col.trainedAt, `"${v.trainedAt}" is not a building`);
    else if (v.buildingLevelRequired > at.maxLevel) {
      ctx.error(S, r, col.buildingLevelRequired, `${at.name} only goes to level ${at.maxLevel}`);
    }
    if (v.strongVs !== 'all' && !types.has(v.strongVs)) {
      ctx.error(S, r, col.strongVs, `"${v.strongVs}" is not a unit type (expected one of ${[...types].join(', ')} or All)`);
    }
    return {
      id: slug(v.name),
      name: v.name,
      tier: v.tier,
      type: v.type,
      trainedAt: v.trainedAt,
      buildingLevelRequired: v.buildingLevelRequired,
      cost,
      trainTimeSec: v.trainTimeSec,
      upkeepFoodPerHour: v.upkeepFoodPerHour,
      attack: v.attack,
      defence: v.defence,
      hp: v.hp,
      speedTilesPerMin: v.speedTilesPerMin,
      load: v.load,
      power: v.power,
      strongVs: v.strongVs,
    };
  });
}

function readResearch(ctx, resources, buildings) {
  const S = SHEET.research;
  const rows = readTable(ctx, S, {
    columns: [
      { header: 'Tech', key: 'name', type: 'name' },
      { header: 'Branch', key: 'branch', type: 'enum' },
      { header: 'Max level', key: 'maxLevel', type: 'int', min: 1 },
      { header: 'Effect', key: 'effect', type: 'enum' },
      { header: 'Value per level', key: 'valuePerLevel', type: 'num' },
      { header: 'Base time (s)', key: 'baseTime', type: 'num' },
      { header: 'Cost & time growth / lvl', key: 'growth', type: 'growth' },
      { header: 'Academy lvl req', key: 'academyLevelRequired', type: 'int' },
      { header: 'Requires tech', key: 'requiresTech', type: 'ref', blank: null },
    ],
    costColumns: (h) => resourceFor(resources, h.replace(/^base\s+/i, ''), /^base\s+/i.test(h)),
  });
  uniqueIds(ctx, S, rows);
  const ids = new Set(rows.map((t) => slug(t.v.name)));
  const academy = buildings.find((b) => b.id === 'academy');
  if (!academy) ctx.warnings.push(`${SHEET.buildings}: no "Academy" row, so research has nowhere to happen`);

  const techs = rows.map(({ r, v, cost, col }) => {
    const id = slug(v.name);
    if (v.requiresTech !== null && !ids.has(v.requiresTech)) {
      ctx.error(S, r, col.requiresTech, `"${v.requiresTech}" is not a tech`);
    }
    if (v.requiresTech === id) ctx.error(S, r, col.requiresTech, 'a tech cannot require itself');
    if (academy && v.academyLevelRequired > academy.maxLevel) {
      ctx.error(S, r, col.academyLevelRequired, `Academy only goes to level ${academy.maxLevel}`);
    }
    const levels = [];
    for (let level = 1; level <= v.maxLevel; level++) {
      levels.push({
        level,
        cost: mapValues(cost, (base) => curve(base, v.growth, level)),
        timeSec: curve(v.baseTime, v.growth, level),
      });
    }
    return {
      id,
      name: v.name,
      branch: v.branch,
      maxLevel: v.maxLevel,
      effect: v.effect,
      valuePerLevel: v.valuePerLevel,
      academyLevelRequired: v.academyLevelRequired,
      requiresTech: v.requiresTech,
      levels,
      _row: r,
    };
  });

  // Prerequisite chains must end somewhere.
  const byId = new Map(techs.map((t) => [t.id, t]));
  for (const t of techs) {
    const path = [t.id];
    for (let cur = byId.get(t.requiresTech); cur; cur = byId.get(cur.requiresTech)) {
      if (cur.id === t.id) {
        ctx.errors.push(`${S}!A${t._row}: prerequisite loop: ${[...path, t.id].join(' -> ')}`);
        break;
      }
      if (path.includes(cur.id)) break; // a loop not involving t; reported from its own row
      path.push(cur.id);
    }
  }
  return techs.map(({ _row, ...t }) => t);
}

function readEconomy(ctx) {
  const S = SHEET.economy;
  const sheet = ctx.sheet(S);

  const rateRow = findRow(sheet, (a) => typeof a === 'string' && /^instant-finish cost/i.test(a));
  let instantFinishGemsPerMinute = null;
  if (!rateRow) ctx.errors.push(`${S}: no "Instant-finish cost" row in column A`);
  else instantFinishGemsPerMinute = parse(ctx, S, rateRow, 2, sheet.cell(rateRow, 2).v, { type: 'num' });

  const speedUps = readSubTable(ctx, sheet, 'Item', {
    columns: [
      { header: 'Item', key: 'name', type: 'name' },
      { header: 'Applies to', key: 'appliesTo', type: 'enum' },
      { header: 'Minutes skipped', key: 'minutes', type: 'num', min: 1 },
      { header: 'Gem price', key: 'gems', type: 'int' },
    ],
  }).map(({ v }) => ({ id: slug(v.name), name: v.name, appliesTo: v.appliesTo, skipSeconds: Math.round(v.minutes * 60), gems: v.gems }));

  const gemPacks = readSubTable(ctx, sheet, 'Pack', {
    columns: [
      { header: 'Pack', key: 'name', type: 'name' },
      { header: 'Price (£)', key: 'price', type: 'num' },
      { header: 'Gems', key: 'gems', type: 'int', min: 1 },
    ],
  }).map(({ v }) => ({ id: slug(v.name), name: v.name, pricePence: Math.round(v.price * 100), gems: v.gems }));

  return { instantFinishGemsPerMinute, speedUps, gemPacks };
}

/** A table inside a sheet that holds several: header found by its first cell, ends at a blank row. */
function readSubTable(ctx, sheet, firstHeader, spec) {
  const headerRow = findRow(sheet, (a) => typeof a === 'string' && norm(a) === norm(firstHeader));
  if (!headerRow) {
    ctx.errors.push(`${sheet.name}: no table with a "${firstHeader}" header in column A`);
    return [];
  }
  const rows = readTable(ctx, sheet.name, { ...spec, headerRow, stopAtBlank: true });
  uniqueIds(ctx, sheet.name, rows);
  return rows;
}

// --- Generic table reading -------------------------------------------------------

/**
 * Reads the table whose header is on `headerRow`. Returns one entry per non-blank row:
 * { r, v: {key: parsed}, cost: {resourceId: number | {cell, c}}, col: {key: columnIndex} }
 */
function readTable(ctx, sheetName, { columns, headerRow = 1, costColumns, rawCost = false, stopAtBlank = false }) {
  const sheet = ctx.sheet(sheetName);
  const headers = new Map(); // norm(header) -> column
  for (let c = 1; c <= sheet.colCount; c++) {
    const h = sheet.cell(headerRow, c).v;
    if (typeof h === 'string') headers.set(norm(h), c);
  }

  const col = {};
  let missing = false;
  for (const spec of columns) {
    const c = headers.get(norm(spec.header));
    if (c === undefined) {
      if (spec.required === false) continue;
      ctx.errors.push(`${sheetName}: missing column "${spec.header}" (header row ${headerRow})`);
      missing = true;
    } else col[spec.key] = c;
  }
  if (missing) throw new Fatal();

  const used = new Set(Object.values(col));
  const costCols = []; // [resourceId, column]
  for (const [h, c] of headers) {
    if (used.has(c)) continue;
    const res = costColumns?.(h);
    if (res) {
      costCols.push([res, c]);
      used.add(c);
    } else if (!IGNORED_HEADERS.has(h)) {
      ctx.warn(sheetName, headerRow, c, `column "${sheet.cell(headerRow, c).v}" is not exported`);
    }
  }

  const out = [];
  for (let r = headerRow + 1; r <= sheet.rowCount; r++) {
    const blank = [...used].every((c) => sheet.cell(r, c).v === null);
    if (blank) {
      if (stopAtBlank) break;
      continue;
    }
    const v = {};
    for (const spec of columns) {
      if (col[spec.key] === undefined) continue;
      const cell = sheet.cell(r, col[spec.key]);
      v[spec.key] = spec.type === 'raw' ? cell : parse(ctx, sheetName, r, col[spec.key], valueOf(ctx, sheetName, r, col[spec.key], cell), spec);
    }
    const cost = {};
    for (const [res, c] of costCols) {
      const cell = sheet.cell(r, c);
      cost[res] = rawCost ? { cell, c } : parse(ctx, sheetName, r, c, valueOf(ctx, sheetName, r, c, cell), { type: 'num', blank: 0 });
    }
    out.push({ r, v, cost, col });
  }
  return out;
}

/** Inputs may be formulas too; then the saved result is the value. */
function valueOf(ctx, sheet, r, c, cell) {
  if (cell.f !== null && cell.v === null) {
    ctx.error(sheet, r, c, `formula =${cell.f} has no saved result; open the workbook so it recalculates, then download it again`);
    return undefined;
  }
  return cell.v;
}

function parse(ctx, sheet, r, c, value, spec) {
  if (value === undefined) return null; // already reported
  if (value === null) {
    if ('blank' in spec) return spec.blank;
    ctx.error(sheet, r, c, 'is blank');
    return null;
  }
  if (typeof value === 'object' && 'error' in value) {
    ctx.error(sheet, r, c, `shows ${value.error}`);
    return null;
  }
  switch (spec.type) {
    case 'name': {
      const s = String(value);
      if (!slug(s)) ctx.error(sheet, r, c, `"${s}" has no letters or digits to make an id from`);
      return s;
    }
    case 'ref':
    case 'enum': {
      const s = slug(String(value));
      if (spec.values && !spec.values.includes(s)) {
        ctx.error(sheet, r, c, `"${value}" is not one of ${spec.values.join(', ')}`);
      }
      return s;
    }
    case 'int':
    case 'num':
    case 'growth': {
      const n = toNumber(value);
      const min = spec.min ?? 0;
      if (n === null) ctx.error(sheet, r, c, `expected a number, got ${JSON.stringify(value)}`);
      else if (spec.type === 'int' && !Number.isInteger(n)) ctx.error(sheet, r, c, `expected a whole number, got ${n}`);
      else if (spec.type === 'growth' && n <= 0) ctx.error(sheet, r, c, `growth must be > 0, got ${n}`);
      else if (n < min) ctx.error(sheet, r, c, `must be ≥ ${min}, got ${n}`);
      else return n;
      return null;
    }
    default:
      throw new Error(`unknown column type ${spec.type}`);
  }
}

// --- Helpers ---------------------------------------------------------------------

/** ROUND(base * growth^(level-1), 0), matching spreadsheet rounding. */
export function curve(base, growth, level) {
  return roundLikeSheet(base * Math.pow(growth, level - 1));
}

/**
 * Spreadsheets compute in doubles but round to 15 significant digits first,
 * and ROUND goes half away from zero. Without the first step 50*1.13 is
 * 56.49999999999999 and would round to 56 where the Sheet shows 57.
 */
export function roundLikeSheet(x) {
  const y = Number(x.toPrecision(15));
  return Math.sign(y) * Math.round(Math.abs(y)) + 0; // + 0 turns -0 into 0
}

function powerOf(cost) {
  return roundLikeSheet(Object.values(cost).reduce((a, b) => a + b, 0) / 100);
}

export function slug(name) {
  return String(name)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function norm(s) {
  return String(s).trim().replace(/\s+/g, ' ').toLowerCase();
}

function toNumber(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v);
  return null;
}

function resourceFor(resources, header, enabled) {
  if (!enabled) return null;
  const r = resources.find((x) => norm(x.name) === norm(header));
  return r ? r.id : null;
}

function uniqueIds(ctx, sheet, rows) {
  const seen = new Map();
  for (const { r, v } of rows) {
    if (!v.name) continue;
    const id = slug(v.name);
    if (seen.has(id)) ctx.error(sheet, r, 1, `"${v.name}" has the same id (${id}) as row ${seen.get(id)}`);
    else seen.set(id, r);
  }
}

function findRow(sheet, pred) {
  for (let r = 1; r <= sheet.rowCount; r++) if (pred(sheet.cell(r, 1).v)) return r;
  return null;
}

function mapValues(obj, fn) {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, fn(v)]));
}

function fatal(ctx, msg) {
  ctx.errors.push(msg);
  throw new Fatal();
}
