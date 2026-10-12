# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for a security problem. Use GitHub's
[private vulnerability reporting](https://github.com/amosogra/dsh-subscription-signin/security/advisories/new)
instead, which keeps the report visible only to the maintainer until a fix is
out.

Useful reports include what you did, what you expected, what happened, and the
DSH version (`0.2.0-rc.2` was the verified build). A proof of concept is welcome
but not required.

**Never include a real credential, token, device code, or the contents of
`$DSH_HOME/.credentials.yaml` in a report.** Redact it. If you believe a
credential has already leaked, revoke it with the vendor first — that matters
more than telling us.

## What is in scope

This plugin's own code, in this repository. Concretely, a genuine vulnerability
would be one of:

- **A way for a web page you visit to reach the plugin's route without the
  Harness's trust checks applying** — i.e. a bypass of the Host/Origin and
  browser-auth gate, or a CSRF path that avoids the JSON-`POST` preflight.
- **A path where the plugin reads, logs, forwards, or stores a token value.**
  It is designed to ask only whether a credential exists, and to delete one on
  explicit `signout`. Any observation of a secret in a log, an error message,
  a response body, or a file it writes is a real finding.
- **An authentication bypass in the panel's bridge** — reaching a mutating
  action (`start`, `cancel`, `signout`, `submitCode`) without being the
  authenticated Harness client.
- **A way to make the plugin act on a credential that is not the user's.**

## What is out of scope

- **Anything in the DeepSeek Harness, `@deepseek-ai/*`, or
  `@earendil-works/pi-ai` itself.** Those are separate projects; report there.
  This plugin implements no OAuth and does not perform the token exchange.
- **The fact that a route targets an unofficial vendor backend.** For
  ChatGPT-plan usage the Harness targets `chatgpt.com/backend-api/codex`, which
  OpenAI's documentation tells third-party apps not to target for plan usage.
  That is shipped Harness behaviour that this plugin *surfaces* and cannot
  change. It is a terms-of-service consideration, documented under "Safety" in
  the README — it is not a vulnerability in this code. Please do not file it as
  one.
- **A vendor rate-limiting, blocking, or banning an account** used this way.
- **The absence of a credential-revocation call on sign-out.** `signout` deletes
  the local record; revoking the grant requires the token, which this plugin
  deliberately never handles. The panel says so in-place.
- **Reports produced only by a scanner** with no demonstrated impact.

## Design intent, so you can judge a finding

The security posture is deliberate and small enough to audit in two files:

- `host.js` — **zero imports**; no filesystem, network, or child-process access.
  Its route inherits `ctx.get('connection').requestRejection(...)` (Host/Origin
  validation plus browser authentication), accepts only JSON `POST` for mutating
  actions, caps bodies at 64 KiB, and sets `no-store` + `nosniff`.
- `client.js` — one dependency (`react`), and its only `fetch` targets the
  plugin's own local route.

If you can show that either statement is false, that is a finding and we would
like to hear it.

## Supported versions

The latest release on `main`. This is a small plugin tracking a release-candidate
Harness, so fixes land on `main` rather than in backported branches.
