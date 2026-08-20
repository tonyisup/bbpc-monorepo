---
name: convex-auth
description: "Add authentication (passkeys/OAuth) to the current Convex app, including the auth.config.ts wiring."
---

<!-- GENERATED from convex-agents content/capabilities/auth.json — do not edit by hand. -->

# Add sign-in to the app

Install and wire @convex-dev/auth for the current app: a provider (passkeys by default, or OAuth/password), the server config, the client hooks, and a sign-in UI — correctly, including the auth.config.ts that's the #1 real-world auth footgun.

## Workflow

1. Install @convex-dev/auth (pinned build) and add it to convex.config.ts. With pnpm, also `pnpm add jose` (it won't hoist otherwise); you need it for step 3.
2. Add the provider in convex/auth.ts (Passkey by default; Password or OAuth like Google on request).
3. Generate the auth keys HEADLESSLY. Do NOT run the interactive `npx @convex-dev/auth` wizard: it needs a login/TTY and hangs in non-interactive, anonymous, or CI runs (the #1 auth time-sink). Create a protected temporary directory outside the worktree (`AUTH_KEYS_DIR=$(mktemp -d)`, `chmod 700 "$AUTH_KEYS_DIR"`) and immediately register `trap 'rm -rf "$AUTH_KEYS_DIR"' EXIT`; set `AUTH_KEYS_FILE="$AUTH_KEYS_DIR/.auth-keys.json"`, generate JWT_PRIVATE_KEY + JWKS deterministically with `jose` into that file, and `chmod 600 "$AUTH_KEYS_FILE"`:
   `node -e 'import("jose").then(async({generateKeyPair,exportPKCS8,exportJWK})=>{const k=await generateKeyPair("RS256",{extractable:true});const priv=await exportPKCS8(k.privateKey);const pub=await exportJWK(k.publicKey);process.stdout.write(JSON.stringify({JWT_PRIVATE_KEY:priv.trimEnd().replace(/\n/g," "),JWKS:JSON.stringify({keys:[{use:"sig",...pub}]})}))})' > "$AUTH_KEYS_FILE"`
   Parse the file before using its values: `JWT=$(node -e 'const v=require(process.argv[1]); process.stdout.write(v.JWT_PRIVATE_KEY)' "$AUTH_KEYS_FILE")` and `JWKS=$(node -e 'const v=require(process.argv[1]); process.stdout.write(v.JWKS)' "$AUTH_KEYS_FILE")`; fail if either is empty. Then set JWT_PRIVATE_KEY, JWKS, and SITE_URL on the explicitly selected deployment. Prefer the Convex MCP `envSet` tool, one call per variable. CLI fallback must take secret values from stdin or a protected `--from-file`, never a command-line argument. The EXIT trap guarantees cleanup on success or failure.
4. Write convex/auth.config.ts (the silently-always-signed-out bug lives here if it's wrong).
5. Wire the client: ConvexAuthProvider, the sign-in component, and route guards. If you import shadcn/ui primitives (button, input, textarea, label, and so on), add them first with `npx shadcn@4.18.0 add <name>`; a missing @/components/ui/* is a hard build error.
6. Verify a sign-in round-trips before declaring done.

## Rules

- Generate JWT_PRIVATE_KEY/JWKS with `jose` (extractable RS256; PKCS8 newlines to spaces; JWKS = {keys:[{use:"sig", ...publicJwk}]}). Do NOT run the interactive `npx @convex-dev/auth` wizard: it hangs headless/anonymous. Set the vars via the MCP `envSet` tool or the NAME=VALUE CLI form.
- Always write auth.config.ts: a missing/incorrect one makes the app silently always-signed-out with no error.
- Passkeys by default; only switch to password/OAuth on explicit request.
- Install any shadcn/ui primitive you import up front (`npx shadcn@4.18.0 add ...`); a missing @/components/ui/* is a hard build failure.
- Verify a real sign-in works before finishing.
