# @synara/mobile

Expo (SDK 57) iOS client for Synara. **WP0 foundation spike**: it proves the
protocol end to end — pair, authenticate, negotiate, open the WebSocket, drive
the orchestration RPC/stream API, and render a live thread list on a phone.

It runs in **Expo Go**. There are no custom native modules, no `expo-dev-client`,
no push notifications, and no Xcode/CocoaPods/signing requirement.

---

## Run it

### 1. Start a Synara server the phone can reach

The dev/test server lives at `http://100.109.152.38:3775` (the Mac's Tailscale
IP, plaintext HTTP). Its launcher is `apps/mobile-dev/dev-server.sh`:

```sh
cd /Users/damian/workspace/synara
nohup zsh apps/mobile-dev/dev-server.sh > /tmp/synara-mobile-dev/launcher.log 2>&1 & disown
```

> Port **3775**, not 3774 — 3774 is a debugging proxy that forwards to the
> user's _live_ Synara. See `/tmp/synara-mobile-dev/README.md`.

### 2. Start Metro

```sh
cd /Users/damian/workspace/synara
bun run --cwd apps/mobile dev          # expo start --lan
```

### 3. Open it on the iPhone

Install **Expo Go** from the App Store, open it, and scan the QR code Metro
printed in the terminal.

LAN mode requires the phone to reach the Mac's IP directly. If the Wi-Fi network
has client isolation (most guest/corporate networks, and some mesh routers), the
phone will show "Could not connect to the server". Two ways out:

```sh
bun run --cwd apps/mobile dev:tunnel   # expo start --tunnel  (works anywhere, slower)
```

Or use Tailscale on the phone. `--lan` advertises the Mac's _Wi-Fi_ address
(`en0`), not the Tailscale one, so point Metro at the tailnet address explicitly:

```sh
REACT_NATIVE_PACKAGER_HOSTNAME=100.109.152.38 bun run --cwd apps/mobile dev
```

### 4. Smoke test the transport without a phone

```sh
bun apps/mobile/scripts/smoke.ts \
  --base-url http://100.109.152.38:3775 \
  --session-token "$(cat /tmp/synara-mobile-dev/session-token.txt)"

# or, with a one-time pairing link:
bun apps/mobile/scripts/smoke.ts --pairing-url 'http://100.109.152.38:3775/pair#token=<credential>'
```

The script runs the exact modules the app uses (`src/transport/*`) under bun.

---

## How pairing works

1. The server prints a **one-time pairing link** on startup when it binds to a
   non-loopback address: `http://HOST:3775/pair#token=<credential>`. The
   credential lives in the URL _fragment_, so it is never sent to a server as a
   query parameter. It is single-use and expires in ~5 minutes. A fresh one can
   be minted at any time by an owner session:

   ```sh
   curl -s -X POST http://100.109.152.38:3775/api/auth/pairing-token \
     -H "Authorization: Bearer $(cat /tmp/synara-mobile-dev/session-token.txt)"
   ```

2. The app parses the link (QR scan or paste), then
   `POST /api/auth/bootstrap/bearer {"credential": ...}` exchanges it for a
   **30-day bearer session token**, which is stored in the iOS keychain via
   `expo-secure-store` (`src/state/credentials.ts`).

3. On **every** connect attempt the app:
   - `GET /ws/negotiate?...` — protocol epoch/revision + required capabilities.
     A `426` is a terminal verdict (`update-client` / `update-server`) and the
     app stops retrying; anything else is retried with backoff. React Native
     cannot read a body off a failed WebSocket upgrade, so negotiation always
     happens here over plain HTTP.
   - `POST /api/auth/ws-token` — a **single-use, 5-minute** ticket. Never cached
     across reconnects.
   - opens `ws://HOST/ws?wsToken=<ticket>&x-synara-client-build=...&x-synara-protocol-epoch=1&x-synara-protocol-revision=<negotiated>&x-synara-server-instance=<instance>`.
     RN sends either no `Origin` or a same-origin one (its iOS WebSocket
     descends from SocketRocket); the server's origin gate accepts both for
     bearer-authenticated upgrades. If the upgrade 403s on a device, grep the
     server log for the origin rejection.

4. When `serverInstanceId` changes, every `afterSequence` cursor the app holds is
   dropped: sequences are only comparable within the journal that issued them.

Bearer HTTP calls must **not** send an `Origin` header — the mutation routes
reject untrusted origins but accept an absent one. The transport never sets one.
Note that SDK 57 replaces global `fetch` with `expo/fetch` (native URLSession);
if the bearer POSTs come back `403 Trusted request origin required` on device,
that implementation is adding an `Origin` and `EXPO_PUBLIC_USE_RN_FETCH=1`
switches back to RN's XHR-based fetch.

---

## What's in v1

- `src/transport/` — a platform-agnostic Synara client. No React, no Effect; only
  `fetch`, `WebSocket` and `URL`, so it runs under bun/node _and_ Hermes.
  - `protocolConstants.ts` — runtime copies of the wire constants, each annotated
    with the `packages/contracts` / `apps/server` file it was copied from.
    `@synara/contracts` and `@synara/shared` are **type-only** dependencies; the
    Effect runtime never enters the RN bundle (verified: 0 matches for
    `effect/unstable` in the exported bundle).
  - `rpcFrames.ts` — pure codec for the Effect-RPC JSON frames.
  - `rpcSocket.ts` — request/stream multiplexing, **an `Ack` after every `Chunk`**
    (the server blocks its stream fiber until it arrives), `Ping` keepalive,
    `Interrupt` on unsubscribe/timeout, clean close.
  - `synaraAuth.ts` — pairing/bootstrap/ws-token/negotiate + URL builders.
  - `synaraClient.ts` — typed orchestration wrappers.
  - `connectionManager.ts` — `idle → authenticating → negotiating → connecting →
connected → reconnecting` with full-jitter exponential backoff, fresh
    ws-token per connect, server-identity change handling, and automatic
    resubscribe-with-cursors after a reconnect. `pause()`/`resume()` are
    AppState-agnostic; `app/_layout.tsx` is the only file that knows about iOS
    lifecycle.
- `src/state/` — one zustand v5 store plus two pure projections (shell list,
  thread messages).
- `app/` — three thin screens: connect (QR / pairing URL / host + token),
  threads (projects → threads, live), thread detail (raw messages + status pill).

## What's deferred

- **Push notifications.** Expo Go cannot receive them for a custom project on
  iOS; they need a dev build and an APNs key.
- **Terminal.** No xterm equivalent; the terminal WS channels are untouched.
- **Rich diffs.** `orchestration.getTurnDiff` is reachable from the transport but
  nothing renders it.
- **Desktop-app remote mode.** No `synara://` bridge, no local-server discovery.
- **Composer / sending turns.** `dispatchCommand` works (the smoke test uses it)
  but there is no compose UI yet.
- **Approvals and user-input prompts.** The commands are documented in the
  transport but no UI surfaces them.
- **Offline cache.** Nothing is persisted except the credentials.

### Known gaps in what _is_ here

- **No Pong-timeout watchdog.** The socket sends `Ping` on a keepalive interval
  but nothing fails the connection when `Pong` stops arriving, so a half-dead
  socket (phone slept, NAT entry expired) is only noticed when iOS eventually
  fires `onclose`.
- **`resume()` retries after a fatal verdict.** Foregrounding the app re-runs
  the connect loop even when the last verdict was `update-client`; it will just
  fail again and re-report, but it is wasted work.
- **`app.json`'s `infoPlist` block is inert under Expo Go.** `NSAppTransportSecurity`
  and `NSCameraUsageDescription` only take effect in a build that has its own
  Info.plist. Expo Go's own plist governs instead — it does allow arbitrary
  loads, but if pairing fails with "App Transport Security policy requires the
  use of a secure connection", that is the cause and only a dev build fixes it.
  The keys are kept because they are correct for the eventual dev build.

---

## Package decisions

- **tsconfig** extends `["expo/tsconfig.base", "../../tsconfig.base.json"]` (array
  extends, later wins). Expo's RN-specific options survive (`jsx`, `lib`,
  `customConditions: ["react-native"]`), and the repo's strictness settings
  (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `strict`) apply on
  top. This typechecks clean, so no standalone fallback was needed.
- **`typecheck`, `typecheck:native`, `typecheck:legacy` are all plain `tsc
--noEmit`.** The other workspaces point `typecheck` at
  `@typescript/native` (TS 7 preview); it is not wired to resolve
  `expo/tsconfig.base`'s `customConditions`/`${configDir}` the way this package
  needs, and an RN app gains nothing from the faster checker. Turbo's three
  tasks therefore all run the same (fast, ~2s) check.
- **No `metro.config.js`.** Bun's isolated linker (`bunfig.toml`,
  `linker = "isolated"`) resolves fine for Metro out of the box — `expo export
-p ios` bundles 1101 modules with the stock config. If that ever breaks, the
  fix is `watchFolders` = repo root + `nodeModulesPaths`.
- **Versions** come from the `default@sdk-57` Expo template (`expo ~57.0.22`,
  `react-native 0.86.3`, `react 19.2.3`), plus `expo-camera ~57.0.5`,
  `expo-secure-store ~57.0.4` and `zustand ^5.0.11` (same major as `apps/web`).
  `typescript` and `vitest` come from the workspace catalog, so `expo install
--check` reports `typescript@5.9.3 - expected version: ~6.0.3`. That is
  deliberate: the monorepo pins TypeScript through its catalog, this package
  typechecks clean on 5.9.3, and `expo export` + `hermesc` both succeed. Revisit
  only if a future RN type declaration actually needs TS 6.
- **No `crypto` usage.** Hermes has no `crypto` global and Expo's WinterCG patch
  does not install one, so ids are generated in `src/transport/ids.ts` from
  timestamp + counter + `Math.random`. Synara ids are trimmed non-empty strings,
  not UUIDs (`packages/contracts/src/baseSchemas.ts`).

## Verification

```sh
bun run --cwd apps/mobile typecheck
bun run --cwd apps/mobile test
bunx oxlint apps/mobile
bunx oxfmt --check apps/mobile
bun run --cwd apps/mobile export:ios     # or: expo export -p ios --no-bytecode
```
