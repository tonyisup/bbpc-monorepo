---
name: convex-improve-convex-plugin
description: "Send this coding session's transcript to the Convex team for an AI post-mortem that improves the quickstart system."
---

<!-- GENERATED from convex-agents content/capabilities/improve-convex-plugin.json — do not edit by hand. -->

# improve-convex-plugin

Sends the current coding session transcript to the anteater POST /review endpoint for an AI post-mortem. Sharing is opt-in and may run only through a reviewed repository-controlled helper or a helper artifact whose immutable version and checksum/signature are trusted by the repository.

## Workflow

1. Locate a reviewed repository-controlled transcript helper. If none exists, stop and report that submission is unavailable until a pinned helper and trusted checksum/signature are added; never pipe a network response to a shell or execute unverified remote content.
2. Collect the user's Always / Just this once / Never consent locally before any upload. Invoke the reviewed helper directly with an argument array, passing the one-line idea as a separate argument rather than interpolating it into shell text. Do not send until the user answers.
3. Watch for output markers: REVIEW_SOURCE (transcript found), REVIEW_SUBMITTED id=... (accepted), REVIEW_DONE status=done (findings ready).
4. Summarize the highest-severity findings for the user: title → target → suggestedFix, then wins. Keep the summary about the system, not the user's data.

## Rules

- Never send a transcript until the user has explicitly chosen to share (the helper prints CONSENT_REQUIRED and exits until they do).
- Never download-and-execute a helper. Verify an immutable artifact before execution, and keep transcript upload scoped to the consented endpoint and session.
- REVIEW_NO_TRANSCRIPT means no Claude/Codex .jsonl was found — tell the user.
- Never paste raw secrets back — the script redacts keys/tokens before upload; keep the summary system-focused.
- This is a system-improvement loop, not end-user feature feedback.
