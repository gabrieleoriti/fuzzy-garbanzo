# Fantasy SLG — project context

Hobby project: a mobile 4X/SLG strategy game (Game of War / Whiteout Survival style) with a generic high-fantasy theme (Keep, Knights, Battle Mages — inspired by Lord of the Rings but no Tolkien names or IP).

## Decisions so far
- **Server-authoritative from day one.** Timers, resources, marches and combat are computed on the server; the client only displays state. Mostly event scheduling ("upgrade finishes at T", "march arrives at T").
- **Backend:** Nakama, with game rules as server-side modules in **TypeScript** (bundled into one JS file Nakama loads). Move hot paths to Go only if needed.
- **Client:** Unity (current LTS) with the official Nakama Unity SDK. Target **Android only** for now (dev machine is Windows).
- **Economy as data.** All tuning lives in config, not code. The source of truth is the Claude Sheets workbook "Fantasy SLG Core Loop" (https://claude.ai/artifact/XvW316wxQTg2BzDUadcJei), to be exported to JSON in `config/`.

## Repo layout (monorepo)
- `docker-compose.yml` (+ `docker-compose.dev.yml` for `tsc --watch` live reload) — Nakama 3.42.0 + Postgres 16
- `server/` — Dockerfile, `config/local.yml`, `modules/src/*.ts` (Nakama TypeScript modules)
- `unity/Assets/Scripts/Nakama/` — client scripts (`NakamaBootstrap`, `NakamaAuthFlow`); no full Unity project committed yet
- `client-check/` — .NET console harness that runs `NakamaAuthFlow.cs` headlessly against the stack (needs .NET SDK)
- `config/` — JSON exported from the core-loop sheet (generated; see `config/README.md`)
- `tools/export-config/` — Node exporter: Sheet downloaded as `.xlsx` → validated JSON in `config/`. The Sheet has no API a script can call, so the `.xlsx` download is the input.

## Core-loop sheet structure
- **Resources:** Food, Timber, Stone, Iron, Gold (basic) + Gems (premium). Columns: starting amount, base storage cap, produced by.
- **Buildings:** base cost per resource, base build time (s), time growth/lvl, cost growth/lvl, base output/hr, output growth/lvl, unlock Keep level, max level. Keep caps all other buildings.
- **Building Levels:** one row per building per level, derived by `base * growth^(level-1)`; individual levels can be hand-overridden.
- **Units:** tier, type (Infantry/Archer/Cavalry/Mage), trained at, costs, train time, upkeep, attack/defence/HP/speed/load/power. Counter triangle: Infantry > Cavalry > Archer > Infantry; Mages hit all but are fragile.
- **Research:** Academy techs, effect + value per level, costs, growth, prerequisites.
- **Speed-ups & Gems:** instant-finish rate (gems per remaining minute), speed-up items, gem packs (£).
- All times in seconds; ids are the names in column A.

## Dev environment (Windows)
WSL2, Docker Desktop, Git (`core.autocrlf input`), Node.js LTS, Unity Hub + Unity LTS with Android Build Support (OpenJDK + SDK/NDK), VS Code.

## Build order
1. Scaffold Docker Compose stack + hello-world TS module; prove a Unity client can authenticate against it. — **done** (verified via HTTP, `client-check` and the Unity editor).
2. Sheet → JSON export script into `config/`. — **done** (`tools/export-config`; ids are snake_case slugs of column-A names; full level tables are derived from the curves, and typed cells on Building Levels override).
3. Vertical slice: one city, three buildings, one resource, upgrade timers, speed-up. ← **next step**
4. Shared tile map with marching armies.
5. Alliances, heroes, events.
