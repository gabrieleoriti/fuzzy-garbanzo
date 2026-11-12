# config/ — generated, do not edit

Exported from the **Fantasy SLG Core Loop** Sheet by `tools/export-config`.
Change values in the Sheet, then re-export (see the main README).

| File | Holds |
|------|-------|
| `resources.json` | `id, name, type (basic\|premium), starting, storageCap` (`null` = no cap) |
| `buildings.json` | per building: `category, maxLevel, unlockKeepLevel, produces` and a `levels` table with every level's `cost`, `buildTimeSec`, `outputPerHour`, `keepLevelRequired`, `power` |
| `units.json` | `tier, type, trainedAt, buildingLevelRequired, cost, trainTimeSec, upkeepFoodPerHour`, combat stats, `strongVs` (a unit type or `all`) |
| `research.json` | per tech: `branch, effect, valuePerLevel, academyLevelRequired, requiresTech` and a `levels` table with `cost`, `timeSec` |
| `economy.json` | `instantFinishGemsPerMinute`, `speedUps` (`appliesTo`, `skipSeconds`, `gems`), `gemPacks` (`pricePence`, `gems`) |

Conventions:
- **ids** are snake_case slugs of the names in column A (`Lumber Mill` → `lumber_mill`); every
  reference between files uses ids. Renaming something in the Sheet changes its id.
- **`cost`** is keyed by resource id and has one entry per cost column in the Sheet.
- **All times are seconds**; prices are integer pence.
- Level tables are complete (level 1 to max). They come from `ROUND(base × growth^(level−1))`
  on the Buildings and Research sheets, except where a value was typed over a formula on
  Building Levels.
