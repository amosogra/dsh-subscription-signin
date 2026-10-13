# dsh-subscription-signin

[![tests](https://github.com/amosogra/dsh-subscription-signin/actions/workflows/tests.yml/badge.svg)](https://github.com/amosogra/dsh-subscription-signin/actions/workflows/tests.yml)

**The sign-in button the DeepSeek Harness never shipped.**

Use the AI subscriptions you already pay for — ChatGPT Plus/Pro, Claude Pro/Max,
GitHub Copilot, and more — as model routes inside the
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). Adds a
**Subscriptions** settings page plus a compact extension on every provider card
in **Settings → Models**.

```text
Settings → Subscriptions → ChatGPT (Codex) → [ Sign in with ChatGPT (Codex) ]
                                    ↓
                    github.com/login/device  ·  code ABCD-1234
                                    ↓
                    ✓ Signed in — draws on your plan
```

No password is ever collected or stored by this plugin. The vendor runs the
sign-in on its own page; the Harness credential store writes the token.

## Repository layout

The **installable package is the `dsh-subscription-signin/` directory.** The
tests, license and documentation sit beside it and are not part of the package:

```text
dsh-subscription-signin/   ← the package; this is what you install
  host.js                  ← the Host half (tool + HTTP route)
  client.js                ← the Client half (settings page + provider card)
  cordis.patch.yml         ← the accounts, as configuration
  locale/en.json           ← package metadata strings
  package.json
smoketest/                 ← five dependency-free suites (run from the root)
docs/FINDINGS.md           ← what was measured vs inferred
```

---

## Why this exists

The Harness already ships everything needed to *use* a subscription as a model
route. Its LLM adapter registers OAuth flows for eight providers — the transport
works, the token exchange works, the credential store works.

What it has no surface for is **starting** one. Nothing in the GUI or CLI ever
calls the authorization seam's `begin()`. This plugin is that missing surface.

It implements **no OAuth**. It does not touch PKCE, state, device codes, or token
parsing — all of that lives in `@earendil-works/pi-ai`, shipped by DeepSeek. This
plugin asks the Harness to begin a flow, shows you the URL and code, and reports
the result.

## Supported providers

Configured out of the box, driven through the Harness's own authorization seam:

| Provider | Credential | Login style |
|---|---|---|
| ChatGPT (Codex) | `llm-pi-ai/openai-codex` | device code |
| Claude (Pro/Max) | `llm-pi-ai/anthropic` | OAuth |
| GitHub Copilot | `llm-pi-ai/github-copilot` | device code |
| xAI | `llm-pi-ai/xai` | device code |
| Meta | `llm-pi-ai/meta` | device code |
| OpenRouter | `llm-pi-ai/openrouter` | OAuth + paste fallback |
| Radius | `llm-pi-ai/radius` | browser callback |
| Kimi For Coding | `llm-pi-ai/kimi-coding` | device code |

**Honest status.** Sign-in is verified end to end for **ChatGPT (Codex)** and
**Claude (Pro/Max)**; Claude's route was observed authenticating successfully and
then being rate-limited by the account (HTTP 429 with Anthropic's own
`request_id` — a quota answer, not a credential failure). Copilot's flow is
verified and completes. xAI, Meta, OpenRouter, Radius and Kimi hold credentials
that have been written successfully, but **no request has been served on those
routes in the session where this was verified**, so treat them as untested rather
than broken. `docs/FINDINGS.md` records what is measured versus inferred.

## Install

**Requirements.** DeepSeek Harness `0.2.0-rc.2` or later. Developed and verified
against `0.2.0-rc.2`, the release this plugin's two seams were checked on
(`ctx.authorization` from `@deepseek-ai/dsh-authorization`, and the client
`slots` service). Every Harness service it consumes is reached with a defensive
`ctx.get(...)` plus an undefined check, so a missing one degrades to a reported
message instead of a crash — but a Harness that has moved a seam will still need
a matching plugin release.

The plugin is installed into a Harness **profile** as a bundle. Point the plugin
manager at this directory:

```text
install_bundle: link:/absolute/path/to/dsh-subscription-signin
```

Or, if you publish/consume it as a package, install by name and add it to your
profile's bundle list:

```jsonc
// $DSH_PROFILE_DIR/package.json
"dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-subscription-signin"] } }
```

Then **restart DSH once.** This matters and is explained under
[Troubleshooting](#troubleshooting) — the client half is composed into the
browser's boot graph at startup, so a freshly installed bundle has no page until
the process restarts.

## Use

From the GUI: **Settings → Subscriptions**, pick an account, press *Sign in*.

For an agent, or a headless harness, the same implementation is exposed as a tool
with actions `status`, `start`, `poll`, `cancel`, `signout`, `submitCode` and
`diagnostics`. Read `status` first; `start` returns the URL and, for device
grants, the code you enter on the vendor's page.

## Safety

This section is the reason to trust the plugin, so it is specific rather than
reassuring.

**It never sees a secret.** No password, token, API key or refresh token is read,
written, logged, or forwarded. The token is produced and stored by the Harness
credential seam (`ctx.authorization` / `ctx.credentials`), not by this code.
Audit it yourself — it is two files:

- **`host.js`** — zero imports. No filesystem access, no network requests, no
  child processes. It asks the credential store *whether* a record exists, and
  can delete one on explicit `signout` with `confirm: true`; it never reads a
  token value. The one `process.env` write is the documented per-account `env`
  field (used so a provider that selects its endpoint from the environment can be
  configured per account), and it is restored when the attempt settles.
- **`client.js`** — one dependency, `react`, supplied by the page. Its only
  `fetch` calls go to the plugin's own `/plugins/subscription-signin` route on
  your local Harness. Nothing is rendered from a credential.

**The one network-bearing route is trust-gated.** The panel reaches the Host half
over an HTTP route that inherits the Harness's own checks
(`connection.requestRejection`: Host/Origin validation and browser
authentication). On top of that, every mutating call must be a JSON `POST`, which
forces a CORS preflight and blocks form-based CSRF; bodies are capped at 64 KiB;
responses are `no-store` + `nosniff`.

**Not sanctioned by the vendors — read this.** For ChatGPT-plan usage, the
Harness targets the ChatGPT/Codex backend
(`chatgpt.com/backend-api/codex`), which OpenAI's developer documentation tells
third-party apps not to target for plan usage. **This plugin surfaces behaviour
the Harness already ships; it does not introduce it and cannot change it.** The
sanctioned path for third-party apps is *Sign in with ChatGPT*, which the Harness
does not implement. Using a subscription outside a vendor's intended client may
conflict with that vendor's terms, and vendors may rate-limit or block such
traffic. You are choosing to do that with your own account. Do not use this to
resell access, and do not use it to reach credentials that are not yours.

**No credentials are in this repository.** If you ever find one here, that is a
bug — please open an issue. The repository was scanned for tokens, private keys,
home paths and email addresses before its first commit. `docs/FINDINGS.md` does
cite exact package versions and source symbols from the Harness, which is
deliberate: a claim about a specific build is only useful if it names the build.

**Found a vulnerability?** Report it privately via
[SECURITY.md](SECURITY.md) rather than a public issue. That file also lists what
is and is not in scope — worth reading first, because the unofficial-backend
caveat above is a documented trade-off rather than a defect, and the two are easy
to confuse.

## Configuration

Accounts are configured, not hardcoded. They live in this package's own
[`cordis.patch.yml`](dsh-subscription-signin/cordis.patch.yml) and a profile may
override that row.

| Field | Meaning |
|---|---|
| `accounts[].key` | Credential key the seam already has a flow for, e.g. `llm-pi-ai/anthropic` |
| `accounts[].label` | Display name |
| `accounts[].loginMethod` | Pin a method when a provider offers several (`oauth`, `device_code`, `browser`, `api-key`) |
| `accounts[].env` | Environment overrides for the flow, e.g. Kimi's regional OAuth host |
| `accounts[].textAnswer` | Answer to a blocking free-text question the flow raises (blank is often the right answer) |
| `timeoutSeconds` | Attempt timeout, default `900` |
| `allowSignOut` | Set `false` to remove the sign-out control entirely |

**Adding a provider** is one row — as long as the Harness already registers a
flow for its credential key. List them with the tool's `status` action or in the
panel; a key with no flow reports *No sign-in flow registered* rather than
failing silently.

Kimi For Coding is the subtle one. Kimi Code *is* OAuth — an RFC 8628 device
grant — but its login **page** is regional: `auth.kimi.com` is the mainland
service (phone or WeChat) and points international users at `.ai`. The host is
env-selectable, so the account names it:

```yaml
- key: llm-pi-ai/kimi-coding
  env:
    KIMI_CODE_OAUTH_HOST: https://auth.kimi.ai
```

The `.ai` host is **verified** to answer the device-authorization endpoint and to
serve the overseas login page (Google, email, international phone, SSO) — not the
mainland page. The token exchange itself is unverified.

## Troubleshooting

**The Subscriptions page is missing from Settings after installing.** Restart
DSH. This is not a bug you can fix by re-installing, and it is worth knowing why:
`dsh-client-modules` memoizes a package's `dsh.client` declaration per loader
source key, *including the negative answer*, "until restart". If the bundle was
ever resolved before its manifest declared `dsh.client`, that `null` is cached
for the life of the process, the bundle never enters the boot graph, and the
section cannot render **or** report an error — it simply does not exist. A
re-install reuses the same loader name and consults the same poisoned key. Only a
restart clears it. The `diagnostics` action reports `bundleInGraph`,
`composedPackages` and `clientPath`, which is how to tell a missing bundle from a
throwing component.

**A provider says "No sign-in flow registered".** The Harness LLM plugin that
registers that flow is not mounted, or the credential key is misspelled. Keys are
`llm-pi-ai/<provider>`.

**A model from a pinned route fails when selected.** Pinning `models:` bounds a
route; it does not check your subscription. On a catalog route the route's own
list is authoritative, so a model your plan does not include is still offered and
fails only when requested. Unpinned routes self-correct, because the vendor
enforces entitlements per request.

**An attempt blocks another.** One attempt per credential key at a time,
mirroring the seam. Cancel before switching accounts.

## Tests

Five dependency-free suites drive both halves against stubbed Harness services —
no network, no credential store, no real installation touched. Run them **from
the repository root**:

```sh
node smoketest/render.mjs     # renders every UI branch in Node
node smoketest/accounts.mjs   # the shipped account list + multi-account paths
node smoketest/run.mjs        # tool and shared-service paths
node smoketest/http.mjs       # the route: 15 assertions incl. the trust gate
node smoketest/bundles.mjs    # is the client half actually in the boot graph?
```

`render` exists because a component that throws during render blanks its whole
slot *silently* — this is the only cheap way to see that failure. `bundles`
exists because a missing client bundle is equally silent, and the two look
identical from the user's side. Every suite imports the package's real modules
directly, so no suite can pass against a stale copy.

CI runs all five on Node 20, 22 and 24 for every push and pull request, plus a
check that the manifest still declares a web client half whose export resolves to
a real file — the failure mode described in `docs/FINDINGS.md`. Note what the
workflow does *not* do: **no `npm install`.** The package has zero dependencies
and the tests import nothing outside the standard library. If that ever stops
being true, CI fails, which is the signal we want.

## Contributing

- **Found a security problem?** Please report it privately — see
  [SECURITY.md](SECURITY.md). That file also states what *is* in scope, which
  matters here: the unofficial-backend caveat below is a deliberate documented
  trade-off, not a vulnerability.
- **A page is missing, or a sign-in fails?** Open a bug report. Please include
  the `diagnostics` output (it contains no secrets) and which of the two silent
  failure modes you are seeing — a *missing* page and a *throwing* page look
  identical but have different causes.
- **A provider's flow is wrong or absent?** That is upstream in the Harness, not
  this plugin — it implements no OAuth. A plugin-side workaround may still be
  possible, so do open an issue.
- This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).
- See [CONTRIBUTING.md](CONTRIBUTING.md) for the house rules — no new
  dependencies, never read a secret, keep the trust gate.

## Support

This plugin is free and stays MIT. There is no paid tier, no gated feature, and
nothing here is withheld behind a sponsorship — sponsorship funds maintenance,
not access.

If it is useful to you and you would like to say so financially,
[GitHub Sponsors](https://github.com/sponsors/amosogra) is the way. It is
entirely optional, and it does not buy priority or influence over the roadmap.

**Non-financial support is genuinely as useful**, and often more so:

- a bug report with the `diagnostics` output attached;
- confirming that a route works, or does not, on a provider you pay for — the
  six unverified routes in the status table above are the biggest gap in this
  project, and one report closes part of it;
- telling someone the plugin exists.

## License

MIT — see [LICENSE](LICENSE).

Not affiliated with, endorsed by, or sponsored by DeepSeek, OpenAI, Anthropic,
GitHub, xAI, Meta, Moonshot or any other vendor named here. Product names are
used only to identify the subscriptions being connected.
