// A copy of the "Fantasy SLG Core Loop" Sheet as it stood at revision 8, in the
// shape its .xlsx download has: typed values, and formulas with their saved
// results. Tests mutate a fresh copy and write it to a real .xlsx file.
import ExcelJS from 'exceljs';

const F = (formula, result) => ({ formula, result });

export function coreLoopData() {
  return {
    'Read me': [['Fantasy SLG — core loop config'], [null], ['Placeholder rows; see the live Sheet.']],

    Resources: [
      ['Resource', 'Type', 'Starting amount', 'Base storage cap', 'Produced by', 'Notes'],
      ['Food', 'Basic', 5000, 20000, 'Farm', 'Also pays troop upkeep'],
      ['Timber', 'Basic', 5000, 20000, 'Lumber Mill', null],
      ['Stone', 'Basic', 2000, 10000, 'Quarry', 'Unlocks at Keep 3'],
      ['Iron', 'Basic', 500, 5000, 'Iron Mine', 'Unlocks at Keep 6; gates higher-tier units'],
      ['Gold', 'Basic', 1000, 50000, 'Keep (taxes)', 'Spent on research and hero upgrades'],
      ['Gems', 'Premium', 200, null, 'Purchases, events, quests', 'No cap; buys speed-ups and instant finishes'],
    ],

    Buildings: [
      ['Building', 'Category', 'Max level', 'Unlocks at Keep lvl', 'Base build time (s)', 'Time growth / lvl', 'Base Food', 'Base Timber', 'Base Stone', 'Base Iron', 'Cost growth / lvl', 'Base output / hr', 'Output growth / lvl', 'Produces', 'Notes'],
      ['Keep', 'Core', 30, 0, 60, 1.6, 0, 200, 150, 0, 1.55, 100, 1.25, 'Gold', "Caps every other building's level"],
      ['Farm', 'Resource', 30, 1, 30, 1.45, 0, 100, 50, 0, 1.4, 120, 1.25, 'Food', null],
      ['Lumber Mill', 'Resource', 30, 1, 30, 1.45, 100, 0, 50, 0, 1.4, 120, 1.25, 'Timber', null],
      ['Quarry', 'Resource', 30, 3, 45, 1.45, 120, 100, 0, 0, 1.4, 90, 1.25, 'Stone', null],
      ['Iron Mine', 'Resource', 30, 6, 60, 1.45, 150, 150, 100, 0, 1.4, 60, 1.25, 'Iron', null],
      ['Warehouse', 'Economy', 30, 2, 45, 1.5, 100, 150, 100, 0, 1.45, 0, 1, null, 'Protects resources from raids'],
      ['Barracks', 'Military', 30, 1, 60, 1.5, 150, 200, 100, 0, 1.45, 0, 1, null, 'Trains Infantry'],
      ['Archery Range', 'Military', 30, 4, 60, 1.5, 150, 250, 50, 20, 1.45, 0, 1, null, 'Trains Archers'],
      ['Stables', 'Military', 30, 8, 90, 1.5, 250, 200, 100, 80, 1.45, 0, 1, null, 'Trains Cavalry'],
      ['Mage Tower', 'Military', 30, 12, 120, 1.5, 200, 150, 250, 150, 1.45, 0, 1, null, 'Trains Mages'],
      ['Infirmary', 'Military', 30, 3, 60, 1.5, 150, 150, 100, 0, 1.45, 0, 1, null, 'Heals wounded troops'],
      ['Academy', 'Research', 30, 5, 90, 1.5, 200, 250, 150, 50, 1.45, 0, 1, null, 'Unlocks Research'],
      ['City Wall', 'Defence', 30, 2, 90, 1.55, 0, 150, 300, 50, 1.45, 0, 1, null, 'Defence bonus when attacked'],
    ],

    'Building Levels': [
      ['Building', 'Level', 'Food', 'Timber', 'Stone', 'Iron', 'Build time (s)', 'Build time', 'Output / hr', 'Keep lvl required', 'Power', 'Notes'],
      // [building, level, food, timber, stone, iron, time, timeText, output, keepReq, power] as the Sheet shows them
      ...[
        ['Keep', 1, 0, 200, 150, 0, 60, '0h 1m 0s', 100, 0, 4],
        ['Keep', 2, 0, 310, 233, 0, 96, '0h 1m 36s', 125, 1, 5],
        ['Keep', 3, 0, 481, 360, 0, 154, '0h 2m 34s', 156, 2, 8],
        ['Keep', 4, 0, 745, 559, 0, 246, '0h 4m 6s', 195, 3, 13],
        ['Keep', 5, 0, 1154, 866, 0, 393, '0h 6m 33s', 244, 4, 20],
        ['Farm', 1, 0, 100, 50, 0, 30, '0h 0m 30s', 120, 1, 2],
        ['Farm', 2, 0, 140, 70, 0, 44, '0h 0m 44s', 150, 2, 2],
        ['Farm', 3, 0, 196, 98, 0, 63, '0h 1m 3s', 188, 3, 3],
        ['Farm', 4, 0, 274, 137, 0, 91, '0h 1m 31s', 234, 4, 4],
        ['Farm', 5, 0, 384, 192, 0, 133, '0h 2m 13s', 293, 5, 6],
        ['Lumber Mill', 1, 100, 0, 50, 0, 30, '0h 0m 30s', 120, 1, 2],
        ['Lumber Mill', 2, 140, 0, 70, 0, 44, '0h 0m 44s', 150, 2, 2],
        ['Lumber Mill', 3, 196, 0, 98, 0, 63, '0h 1m 3s', 188, 3, 3],
        ['Lumber Mill', 4, 274, 0, 137, 0, 91, '0h 1m 31s', 234, 4, 4],
        ['Lumber Mill', 5, 384, 0, 192, 0, 133, '0h 2m 13s', 293, 5, 6],
      ].map(([b, lvl, food, timber, stone, iron, time, text, output, keep, power], i) => {
        const r = i + 2;
        const curve = (baseCol, growthCol) =>
          `ROUND(VLOOKUP($A${r},Buildings!$A:$O,${baseCol},FALSE)*VLOOKUP($A${r},Buildings!$A:$O,${growthCol},FALSE)^($B${r}-1),0)`;
        return [
          b,
          lvl,
          F(curve(7, 11), food),
          F(curve(8, 11), timber),
          F(curve(9, 11), stone),
          F(curve(10, 11), iron),
          F(curve(5, 6), time),
          F(`INT(G${r}/3600)&"h "&INT(MOD(G${r},3600)/60)&"m "&MOD(G${r},60)&"s"`, text),
          F(curve(12, 13), output),
          F(`IF($A${r}="Keep",$B${r}-1,MAX($B${r},VLOOKUP($A${r},Buildings!$A:$O,4,FALSE)))`, keep),
          F(`ROUND(SUM(C${r}:F${r})/100,0)`, power),
          r === 2 ? 'Free tutorial level' : null,
        ];
      }),
    ],

    Units: [
      ['Unit', 'Tier', 'Type', 'Trained at', 'Building lvl req', 'Food', 'Timber', 'Stone', 'Iron', 'Train time (s)', 'Upkeep Food / hr', 'Attack', 'Defence', 'HP', 'Speed (tiles/min)', 'Load', 'Power', 'Strong vs', 'Notes'],
      ['Spearman', 1, 'Infantry', 'Barracks', 1, 40, 30, 0, 0, 12, 1, 10, 12, 100, 10, 40, 1, 'Cavalry', 'Cheap frontline'],
      ['Shortbowman', 1, 'Archer', 'Archery Range', 1, 30, 50, 0, 0, 12, 1, 14, 8, 80, 11, 30, 1, 'Infantry', null],
      ['Outrider', 1, 'Cavalry', 'Stables', 1, 50, 30, 0, 10, 15, 2, 12, 10, 110, 16, 50, 1, 'Archer', 'Fast raider, big load'],
      ['Hedge Mage', 1, 'Mage', 'Mage Tower', 1, 40, 20, 0, 20, 20, 2, 18, 6, 70, 9, 20, 2, 'All', 'Splash damage, fragile'],
      ['Halberdier', 2, 'Infantry', 'Barracks', 10, 100, 75, 0, 25, 30, 2, 25, 30, 250, 10, 100, 3, 'Cavalry', null],
      ['Longbowman', 2, 'Archer', 'Archery Range', 10, 75, 125, 0, 25, 30, 2, 35, 20, 200, 11, 75, 3, 'Infantry', null],
      ['Knight', 2, 'Cavalry', 'Stables', 10, 125, 75, 0, 50, 38, 4, 30, 25, 275, 16, 125, 3, 'Archer', null],
      ['Battle Mage', 2, 'Mage', 'Mage Tower', 10, 100, 50, 0, 75, 50, 4, 45, 15, 175, 9, 50, 5, 'All', null],
    ],

    Research: [
      ['Tech', 'Branch', 'Max level', 'Effect', 'Value per level', 'Base Food', 'Base Timber', 'Base Stone', 'Base Iron', 'Base time (s)', 'Cost & time growth / lvl', 'Academy lvl req', 'Requires tech', 'Notes'],
      ['Agriculture', 'Economy', 20, 'Food output', 0.05, 500, 500, 0, 0, 300, 1.4, 1, null, null],
      ['Forestry', 'Economy', 20, 'Timber output', 0.05, 500, 500, 0, 0, 300, 1.4, 1, null, null],
      ['Masonry', 'Economy', 20, 'Stone output', 0.05, 600, 600, 200, 0, 400, 1.4, 3, 'Forestry', null],
      ['Master Builders', 'Economy', 20, 'Construction speed', 0.03, 800, 800, 400, 100, 600, 1.45, 4, 'Masonry', 'Core speed-up sink'],
      ['Swift March', 'Military', 20, 'March speed', 0.04, 600, 400, 0, 200, 500, 1.45, 4, null, null],
      ['Iron Discipline', 'Military', 20, 'Infantry attack', 0.02, 800, 400, 0, 300, 600, 1.45, 5, 'Swift March', null],
      ['Fletching', 'Military', 20, 'Archer attack', 0.02, 800, 400, 0, 300, 600, 1.45, 5, 'Swift March', null],
      ['Field Medicine', 'Military', 20, 'Infirmary capacity', 0.05, 700, 500, 200, 100, 500, 1.45, 6, null, null],
    ],

    'Speed-ups & Gems': [
      ['Instant-finish cost (gems per remaining minute)', 1, null, null, null],
      [null],
      ['Speed-up items'],
      ['Item', 'Applies to', 'Minutes skipped', 'Gem price', 'Gems per minute'],
      ...[
        ['1-minute Speed-up', 'Any', 1, 1],
        ['5-minute Speed-up', 'Any', 5, 5],
        ['1-hour Speed-up', 'Any', 60, 50],
        ['3-hour Speed-up', 'Any', 180, 140],
        ['8-hour Speed-up', 'Any', 480, 350],
        ['24-hour Speed-up', 'Any', 1440, 950],
        ["1-hour Builder's Haste", 'Construction', 60, 40],
        ['1-hour Training Drill', 'Training', 60, 40],
      ].map((row, i) => [...row, F(`D${i + 5}/C${i + 5}`, row[3] / row[2])]),
      [null],
      [null],
      ['Gem packs'],
      ['Pack', 'Price (£)', 'Gems', 'Gems per £', 'Bonus vs smallest'],
      ...[
        ['Pouch', 0.99, 100],
        ['Satchel', 4.99, 550],
        ['Chest', 9.99, 1200],
        ['Coffer', 19.99, 2600],
        ['Vault', 49.99, 7000],
        ["Dragon's Hoard", 99.99, 15000],
      ].map((row, i) => [...row, F(`C${i + 17}/B${i + 17}`, row[2] / row[1]), F(`D${i + 17}/D$17-1`, row[2] / row[1] / (100 / 0.99) - 1)]),
    ],
  };
}

export async function writeWorkbook(data, path) {
  const wb = new ExcelJS.Workbook();
  for (const [name, rows] of Object.entries(data)) {
    const ws = wb.addWorksheet(name);
    rows.forEach((row, i) => {
      row.forEach((value, j) => {
        if (value !== null && value !== undefined) ws.getCell(i + 1, j + 1).value = value;
      });
    });
  }
  await wb.xlsx.writeFile(path);
}
