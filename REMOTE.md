# Remote Access Setup

Use this when you want to open Synara from another device (phone, tablet, another laptop).

## CLI ↔ Env option map

The Synara CLI accepts the following configuration options, available either as CLI flags or environment variables:

| CLI flag                                 | Env var                        | Notes                                                                    |
| ---------------------------------------- | ------------------------------ | ------------------------------------------------------------------------ |
| `--mode <web\|desktop>`                  | `SYNARA_MODE`                  | Runtime mode.                                                            |
| `--port <number>`                        | `SYNARA_PORT`                  | HTTP/WebSocket port.                                                     |
| `--host <address>`                       | `SYNARA_HOST`                  | Bind interface/address. Defaults to `127.0.0.1`.                         |
| `--home-dir <path>`                      | `SYNARA_HOME`                  | Base directory.                                                          |
| `--dev-url <url>`                        | `VITE_DEV_SERVER_URL`          | Dev web URL redirect/proxy target. Cannot be combined with remote binds. |
| `--public-url <https-origin>`            | `SYNARA_PUBLIC_URL`            | HTTPS root origin terminated by a reverse proxy in front of the server.  |
| `--allow-insecure-remote`                | `SYNARA_ALLOW_INSECURE_REMOTE` | Explicitly allow unencrypted remote access on a trusted LAN.             |
| `--no-browser`                           | `SYNARA_NO_BROWSER`            | Disable auto-open browser.                                               |
| `--auth-token <token>` (alias `--token`) | `SYNARA_AUTH_TOKEN`            | Startup gate token required before any remote bind is allowed.           |

> TIP: Use the `--help` flag to see all available options and their descriptions.

## Security model

Remote binds fail closed at startup. Binding to a non-loopback host (e.g. `0.0.0.0`, a LAN IP, or a Tailnet IP) or setting `--public-url` requires:

- `--auth-token` — without it the server refuses to start. Note the token is a **startup gate, not a client credential**: the legacy `?token=` query parameter is only honored on loopback binds with no `--public-url`, so you cannot log a remote device in with it.
- Additionally, a non-loopback bind requires either `--public-url <https origin>` (TLS terminated by a reverse proxy) or `--allow-insecure-remote` (explicit opt-in to plaintext on a trusted LAN).

The actual credential is a **one-time pairing link** printed in the startup log whenever remote access is configured:

```
pairingUrl: 'https://<host>/pair#token=...'
```

The link carries a 12-character credential in the URL fragment (so it never reaches the server as a query parameter). It expires after 5 minutes and is consumed on first use — if it lapses, restart the server for a fresh one, or mint a new pairing credential from an already-paired owner session (`POST /api/auth/pairing-token`, or the equivalent in Settings).

After pairing:

- **Browsers** get an `HttpOnly` session cookie valid for 30 days (`Secure` when `--public-url` is configured).
- **Native/headless clients** exchange the credential directly and hold a bearer session instead:
  1. `POST /api/auth/bootstrap/bearer` with `{ "credential": "<pairing token>" }` → `{ sessionToken, expiresAt }` (30-day session, sent as `Authorization: Bearer <sessionToken>`).
  2. `POST /api/auth/ws-token` with the bearer token → a single-use, ~5-minute WebSocket ticket. Re-issue for every connect; never cache it.
  3. Connect `ws(s)://<host>/ws?wsToken=<ticket>`.

Once paired, devices stay logged in across server restarts until the session expires or is revoked.

## 1) Tailscale (recommended)

`tailscale serve` terminates HTTPS on your tailnet and proxies to the loopback server, so the Synara process itself stays on `127.0.0.1`:

```bash
bun run build
TOKEN="$(openssl rand -hex 24)"
bun run --cwd apps/server start -- \
  --port 3773 \
  --auth-token "$TOKEN" \
  --public-url "https://<machine>.<tailnet>.ts.net" \
  --no-browser
tailscale serve --bg 3773
```

Open the pairing URL from the startup log on any device in your tailnet. `tailscale serve` advertises the machine's `https://<machine>.<tailnet>.ts.net` origin, which must match `--public-url` exactly (HTTPS root origin, no path/query/credentials).

Why HTTPS matters:

- The session cookie is marked `Secure` when `--public-url` is set, and browsers only send `Secure` cookies over HTTPS.
- OS notifications and other web capabilities require a secure context.
- iOS App Transport Security blocks cleartext `http://` loads, which breaks the web UI and the mobile app on plain HTTP.

Any other TLS-terminating reverse proxy works the same way — point `--public-url` at its external HTTPS origin.

## 2) Plain LAN (trusted networks only)

```bash
bun run build
TOKEN="$(openssl rand -hex 24)"
bun run --cwd apps/server start -- \
  --host 0.0.0.0 --port 3773 \
  --auth-token "$TOKEN" \
  --allow-insecure-remote \
  --no-browser
```

The startup log prints the pairing URL with a reachable interface address substituted in (Tailscale address preferred, then LAN). All traffic — including the pairing credential and session tokens — is unencrypted; use only on a network you trust.

You can also bind a specific interface (e.g. `--host "$(tailscale ip -4)"`) instead of `0.0.0.0` to limit exposure.

## Pair a phone

1. Start the server with remote access as above.
2. Find `pairingUrl:` in the startup log — it looks like `http://192.168.1.42:3773/pair#token=...`.
3. Get it onto the phone: generate a QR code from the link (e.g. `qrencode`, or any online generator on a trusted LAN) and scan it, or copy the link over a secure channel.
4. Open it in the phone's browser for the web UI, or paste it into the **Synara mobile app** (`apps/mobile`), which consumes the same `/pair#token=...` link and then talks to the bearer/ws-token endpoints described above.

Each link is single-use and expires in 5 minutes. To pair more devices later, mint a new credential from an owner session.

## Synara.app (desktop) coexistence

The desktop app binds loopback on an ephemeral port and holds an exclusive lock on its home dir (`~/.synara` by default). A standalone remote server must therefore run with a different `--home-dir`, or be started while the desktop app is closed — otherwise it will fail to acquire the state database lock.

## Troubleshooting

- **`426 WS_SERVER_GENERATION_CHANGED`** — the server restarted and the client's cached server-instance id is stale. Reload the app/browser tab; the session itself is still valid.
- **Expired or consumed pairing link** — the link is single-use with a 5-minute TTL. Restart the server to print a new one, or mint a fresh credential from an existing owner session.
- **`localhost` in the pairing URL on a `0.0.0.0` bind** — current builds substitute a detected LAN/Tailscale address; if you still see `localhost` (no external interface was found), replace it manually with the server's reachable hostname or IP.
- **Refused at startup** — a non-loopback `--host` without `--auth-token` fails closed; additionally pick `--public-url` (HTTPS proxy) or `--allow-insecure-remote` (plaintext LAN).
- **Firewall** — ensure the OS firewall allows inbound TCP on the selected port for direct LAN binds. Tailscale setups need no inbound port on the LAN.
