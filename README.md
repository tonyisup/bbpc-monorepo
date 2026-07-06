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
npm run seed:segment-templates
npm run cleanup:ended-sessions -- --days=30 --limit=25
```

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
RTC_CLEANUP_ADMIN_SECRET=replace-me
```

`TURN_STATIC_AUTH_SECRET` is used only by `/api/sessions/[sessionId]/rtc/ice`; browsers receive temporary usernames and HMAC credentials, never the static secret. See [docs/turn-server.md](docs/turn-server.md) for local setup and production firewall rules.
