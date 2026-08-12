# TURN Server

`peer-to-peer-mesh-audio.md` expects a coturn-compatible TURN server using TURN REST credentials. The browser receives short-lived usernames and HMAC credentials from the app; it must never receive `TURN_STATIC_AUTH_SECRET`.

## Local Development

This machine uses Homebrew coturn:

```bash
brew install coturn
brew services start coturn
```

The local config lives at `/opt/homebrew/etc/turnserver.conf`. The generated secret is also stored in ignored app env files:

```txt
TURN_URLS=turn:<local-lan-ip>:3478?transport=udp,turn:<local-lan-ip>:3478?transport=tcp
STUN_URLS=stun:<local-lan-ip>:3478
TURN_STATIC_AUTH_SECRET=<same secret as coturn>
TURN_TTL_SECONDS=3600
```

If the Mac LAN IP changes, update `TURN_URLS` and `STUN_URLS` in `.env.local`, then restart `npm run dev`. Coturn itself can continue using the same shared secret.

Local coturn is useful for implementation and same-LAN device testing. It is not a production substitute unless ports are forwarded and the advertised URL is reachable from the public internet.

## Production VPS

Use `ops/turn/turnserver.prod.conf.example` as the starting point.

Required DNS and firewall:

```txt
turn.example.com A/AAAA -> VPS public IP
3478/tcp
3478/udp
49160-49260/udp
```

App environment:

```txt
TURN_URLS=turn:turn.example.com:3478?transport=udp,turn:turn.example.com:3478?transport=tcp
STUN_URLS=stun:turn.example.com:3478
TURN_STATIC_AUTH_SECRET=<same secret as coturn>
TURN_TTL_SECONDS=3600
NEXT_PUBLIC_RTC_AUDIO_ENABLED=true
```

For `turns:` URLs on port `5349`, install a valid TLS certificate and set `cert=` and `pkey=` in the coturn config.

## Smoke Test

Generate a temporary REST credential and run a TURN allocation test:

```bash
SECRET="$(grep '^TURN_STATIC_AUTH_SECRET=' .env.local | cut -d= -f2-)"
turnutils_uclient -v -W "$SECRET" -u "bbpc-smoke-test" -n 1 -y 127.0.0.1
```

For the VPS, replace `127.0.0.1` with the TURN hostname. A successful allocation confirms REST auth and the TURN listener; the WebRTC implementation still needs a browser stats check to confirm relay candidates are selected on a forced-relay path.
