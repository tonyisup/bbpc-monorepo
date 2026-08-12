# BBPC Recording

Browser-based podcast recording for one host plus invited guests. Session state and metadata are stored in Convex; audio blobs stay in Azure storage.

## Development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

Useful commands:

```bash
npm run lint
npm test
npm run build
```

Copy `.env.example` to `.env.local`. Point `NEXT_PUBLIC_CONVEX_URL` at the
shared `bbpc-convex` deployment, and configure the same Clerk application used
by the primary BBPC applications. Clerk must have a JWT template named
`convex` with audience `convex`.

Creating a session requires a linked BBPC Host or Administrator identity.
Invited guests do not need a Clerk account: the invite route exchanges the
one-time invite capability for a session-scoped participant capability stored
in an HTTP-only cookie. Invite and participant capabilities are never stored
in plaintext by Convex.

The old standalone `SESSION_ADMIN_SECRET` maintenance boundary is retired.
Sounder/template administration and ended-session retention use the shared
Convex Administrator mutations and the global cutover write gate. Linked
administrators can run those bounded operations from `/admin`.

After deploying this consumer, set `NEXT_PUBLIC_BBPC_RECORDING_URL` in
`bbpc-admin` to its public HTTP(S) root URL. In Convex mode the admin `/record`
route and administrator sidebar then hand off to this app. If the variable is
absent, the admin route remains fail-closed behind its unavailable-page flow.

This repository intentionally contains no deployable Convex function directory.
All recording schema and server functions live under `convex/recording` in the
shared `bbpc-convex` project. The legacy standalone deployment is retained only
through its approved private backup archive and must not receive new deployments
or imports.

## Merge Bundle Workflow

After a recording session, use the app's `Download Merge Bundle` button. The bundle includes the manifest, Audacity labels, uploaded recording URLs, participant join/leave intervals, and sounder asset URLs.

To merge locally:

```bash
npm run merge-session -- --bundle ./EP-merge-bundle.json --out ./merged/EP
```

Options:

```bash
npm run merge-session -- --help
npm run merge-session -- --bundle ./EP-merge-bundle.json --format=mp3
npm run merge-session -- --bundle ./EP-merge-bundle.json --sounders=reconstruct
npm run merge-session -- --bundle ./EP-merge-bundle.json --dry-run
```

Sounder modes:

- `auto`: use uploaded sounder tracks if present, otherwise reconstruct from sounder asset URLs.
- `recorded`: use uploaded sounder tracks only.
- `reconstruct`: download sounder assets and place them using manifest timestamps.
- `both`: include uploaded sounder tracks and reconstructed sounders.
- `none`: mix participant mic tracks only.

The merge script requires `ffmpeg` on your PATH. Sounder asset URLs point at the app's `/api/sounders/play` route, so keep the app running when using `--sounders=reconstruct` unless those URLs are replaced with direct blob URLs.

## TURN Server

Peer-to-peer mesh audio is enabled by default. Set `NEXT_PUBLIC_RTC_AUDIO_ENABLED=false` to hide the audio room controls and fall back to the pre-existing local recording behavior.

The mesh room uses WebRTC audio only. V1 targets Chrome on Windows 10 and Chrome on iOS; Chrome on iOS uses the iOS WebKit runtime, so autoplay and mic permission must be verified on a real iPhone before relying on it for a live show.

The app expects a coturn-compatible TURN server using short-lived REST credentials:

```bash
STUN_URLS=stun:turn.example.com:3478
TURN_URLS=turn:turn.example.com:3478?transport=udp,turn:turn.example.com:3478?transport=tcp
TURN_STATIC_AUTH_SECRET=replace-me
TURN_TTL_SECONDS=3600
```

`TURN_STATIC_AUTH_SECRET` is used only by `/api/sessions/[sessionId]/rtc/ice`; browsers receive temporary usernames and HMAC credentials, never the static secret. See [docs/turn-server.md](docs/turn-server.md) for local setup and production firewall rules.
