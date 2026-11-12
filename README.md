# Nakama dev stack

Local game backend: **Nakama 3.42.0 + Postgres 16** via Docker Compose, a
**TypeScript runtime module**, and a **Unity client** that authenticates against it.

```
docker-compose.yml          postgres + nakama (migrations run on start)
docker-compose.dev.yml      dev override: tsc --watch + module mounted into nakama
.env.example                dev keys/passwords -> copy to .env
server/
  Dockerfile                builds the TS module, bakes it into the Nakama image
  config/local.yml          non-secret server config
  modules/src/main.ts       InitModule: registers RPC + hook
  modules/src/hello.ts      "hello_world" RPC, after-device-auth hook
unity/Assets/Scripts/Nakama/
  NakamaBootstrap.cs        MonoBehaviour: builds the client, runs the flow, stores tokens
  NakamaAuthFlow.cs         engine-agnostic flow (auth -> account -> RPC -> socket -> refresh)
client-check/               .NET console harness that compiles NakamaAuthFlow.cs and asserts on it
```

## Run the stack

```bash
cp .env.example .env
```

```bash
docker compose up -d --build
```

| Port | What |
|------|------|
| 7350 | HTTP + WebSocket API (Unity client) |
| 7349 | gRPC API |
| 7351 | Developer console: http://127.0.0.1:7351 (admin / password) |

When it's up, the logs should show the module loading:

```bash
docker compose logs nakama | grep -E "module loaded|Registered JavaScript"
```

## Module development (live reload)

Start the stack with the dev override:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

This adds a `modules` container that runs `tsc --watch` on `server/modules/src`
and writes the bundle to `server/modules/build/`, which is mounted into Nakama.
After saving a `.ts` file, reload it with:

```bash
docker compose restart nakama
```

That takes a few seconds and needs no image rebuild. To see compile errors, run
`docker compose -f docker-compose.yml -f docker-compose.dev.yml logs -f modules`.
If the code doesn't compile, the last good build stays in place.

Without the dev override, Nakama uses the module baked into the image, so rebuild
after changes with `docker compose up -d --build nakama`.

For editor type-checking, run `npm install` once in `server/modules`, then `npm run typecheck`.

## Unity client

1. Add the SDK. In the Unity editor, open **Window > Package Manager**, click **+ > Add package
   from git URL…**, and paste:
   ```
   https://github.com/heroiclabs/nakama-unity.git?path=/Packages/Nakama#v3.23.0
   ```
   Alternatively, add this line under `"dependencies"` in `<YourUnityProject>/Packages/manifest.json`:
   ```json
   "com.heroiclabs.nakama-unity": "https://github.com/heroiclabs/nakama-unity.git?path=/Packages/Nakama#v3.23.0",
   ```
2. Copy `unity/Assets/Scripts/Nakama/` into your project's `Assets/`.
3. Add `NakamaBootstrap` to a GameObject in your first scene and press Play.
   The Console should show `authenticated`, `rpc hello_world: {"message":"Hello, Unity!",...}`,
   `socket connected: True` and `refresh ok: True`.

Host by target: editor/desktop `127.0.0.1`; Android emulator `10.0.2.2`; a physical
device needs your machine's LAN IP. iOS and Android block cleartext HTTP by default,
so put TLS in front of the stack before testing on device.

## Prove auth without the Unity editor

`client-check` builds the exact `NakamaAuthFlow.cs` that Unity compiles, against
`NakamaClient` 3.23.0 (the .NET client inside Unity SDK v3.23.0). It also checks
that a wrong server key and a tampered token are both rejected.

```bash
cd client-check && dotnet run
```

The run exits 0 and prints `RESULT: PASS` when all checks pass.

## Before anything other than local dev

Change every value in `.env`. In particular, the server key and the session and
refresh encryption keys are the published Nakama defaults. Keep port 7351 (console)
off the public internet.

## Building behind a TLS-intercepting proxy

If `npm ci` fails during the image build because of certificate errors, pass your proxy's CA:

```bash
docker build --secret id=extra_ca,src=/path/to/ca.pem -t nakama-dev/nakama:local server
```

Then run `docker compose up -d --no-build`.
