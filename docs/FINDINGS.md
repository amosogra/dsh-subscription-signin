# Findings

What was measured, what was inferred, and what is still unknown. Kept separate
from the README so the README can be read by someone deciding whether to install
this, and this can be read by someone deciding whether to trust a claim.

Everything below was observed on a real DSH desktop install. Nothing here is a
guess dressed as a fact; where a statement is inferred from source rather than
observed at runtime, it says so.

## Do the shipped flows exist?

Yes — eight of them, and this plugin adds none. `@deepseek-ai/dsh-llm-pi-ai`
registers an authorization flow for every catalog provider that declares a login,
by reading each provider's own `auth` definition rather than a barrel file. An
earlier revision of this project wrongly claimed ChatGPT was the only one; the
error came from reading the barrel instead of the per-provider definitions. The
lesson is recorded because it is a repeatable mistake: **check the per-provider
definition.**

## What "signed in" does and does not mean

A credential record in `$DSH_HOME/.credentials.yaml` with `kind: grant`,
`type: oauth` proves the token exchange completed and the store wrote a result.
It does **not** prove the route serves. Those are different claims, and this
project conflated them once.

To settle serving without spending credits, the session logs are enough. They are
zstd-compressed NDJSON at `$DSH_HOME/sessions/*/session.v4.jsonl.zstd`:

```sh
zstdcat session.v4.jsonl.zstd | grep '"provider":"<route>"'
```

Useful record types: `request/header` (carries `header.config.provider` and
`.model`), `llm/retry` (carries `failure.code` and `.message`), and `turn/end`
(carries `reason.kind` and `reason.error`).

That method produced these results across every session on the machine:

| Route | Ever requested? | Result |
|---|---|---|
| `openai-codex` | yes | **Serves.** Clean turns with real token counts |
| `anthropic` | yes | **Authenticates, then 429** — see below |
| `github-copilot`, `xai`, `meta`, `openrouter`, `radius`, `kimi-coding` | **never** | credential only |

### A 429 is not a credential failure

```json
429 {"type":"rate_limit_error",
     "message":"This request would exceed your account's rate limit. Please try again later.",
     "request_id":"req_…"}
```

The `request_id` is issued by the vendor's API, so the OAuth grant **was
accepted** and the request reached the account. The rejection is about quota.
Reading this as a broken credential would send you debugging the wrong layer.

### Entitlement errors name the model

```
Codex error: The 'gpt-6-astra' model is not supported when using Codex with a ChatGPT account
Codex error: The usage limit has been reached
```

The first is a plan-entitlement answer. This is the argument for leaving
catalog routes **unpinned**: the vendor enforces entitlements per request, so an
unpinned route self-corrects as a plan changes, while a pinned route freezes a
snapshot that can rot.

## A pinned route does not filter by subscription

pi-ai lets a provider declare `filterModels(models, credential)`; GitHub Copilot
uses it to drop models the account does not include. **The DSH adapter does not
carry that function across.** It builds a catalog route as:

```js
getModels: () => spec.models,
stream: (model, context, options) => base.stream(model, context, options)
```

— `@deepseek-ai/dsh-llm-pi-ai/lib/index.js`, `reuseCatalogProvider`. The base
provider's API implementations, compatibility quirks and credential discovery are
preserved; catalog-owned dynamic refresh and `filterModels` are dropped on
purpose ("this route's catalog is the settings document").

So on a catalog route the route's own `models:` list is the whole truth, and a
model the subscription cannot serve is still offered and fails only when
requested. Pinning is therefore the only subscription filter available, and it
has to be maintained by hand.

Concretely: a Copilot route pinned to eight models, where the account's own
`availableModelIds` — re-fetched by pi-ai on every token refresh, so it is live
rather than a snapshot — contained only three of them. The other five are outside
the subscription and are **not** enableable by the login flow, which enables a
model only when its policy state is exactly `unconfigured`.

There is one possible route back for models in that state: a vendor's own model
settings page can move a model out of `unconfigured`, after which a fresh
sign-in re-reads `/models` and the new list includes it. **This is inferred from
the flow's source and has not been attempted.**

## The client half can be missing with no error

A whole settings page disappeared — no nav row, no error, no blank panel. Every
instinct says "the component threw", and that is a different failure.

`dsh-client-modules` memoizes a package's `dsh.client` declaration per loader
**source key**, including the negative answer, and the cache comments say "until
restart":

```js
const cached = this.pkgMeta.get(sourceKey)
if (cached !== void 0) return cached
const decl = parseDshClient(packageName, dsh?.client)
if (decl === void 0 || decl.platform !== 'web') {
  this.pkgMeta.set(sourceKey, null)   // cached for the life of the process
  return null
}
```

Nothing invalidates it. `processOne()` → `resolveSource()` → `resolveMeta()`
returns the cached `null`, the source is dropped, and `reconcilePackage()`
**deletes** the row from the bundle table. The bundle never enters the boot
graph, so the browser is never told it exists — and a section that was never
registered cannot render *or* fail.

Re-installing does not help: the loader name is unchanged, so the same poisoned
source key is consulted. `rebuilt()` re-reads bundle *content*; it does not
re-run `resolveMeta`. **A restart is the only fix.**

There are therefore two caches with different remedies, and confusing them costs
an afternoon:

| Half | Cached by | Cleared by |
|---|---|---|
| `host.js` | the module import cache | re-import the module (e.g. install from a different directory) |
| `client.js` | the client-modules negative | **restart only** |

`host.js` here reports `bundleInGraph`, `composedPackages` and `clientPath`
precisely so this is one call to diagnose instead of a bisect. The browser side
can be asked independently and authoritatively through the client `Slots`
inspect provider: an occupant list is the ground truth for "is my page
registered".

## `host.call` and `styles.insert` are not available to a `dsh.client` bundle

DSH advertises both to a **dynamic** Client half, and the live `Builtin` inspect
provider enumerates them:

```
host   — Package-private JSON RPC from Client to this Package's Host half.
         host.call(method: string, args?: JsonValue): Promise<JsonValue>
styles — Package-owned stylesheet insertion cleaned up with the Client run.
         styles.insert(css: string): () => void
```

They are bound by `dsh-cordis-client-runner`, the runtime for **Cordis packages**
— the artifact `cordis_define` / `cordis_run` creates, addressed by a
`pluginId` **and** a `pluginRunId`:

```js
invoke: (method, args) => this.env.invoke(half.pluginId, half.pluginRunId, method, args)
```

That runner never reads `dsh.client` manifests. It evaluates a package's browser
half as a function body with positional parameters
(`React, console, styles, host, harness, …`) and requires the body to `return` a
plugin.

A bundle loaded through the boot graph — the form declared by `dsh.client` and
written as `window.__ModuleLoader__.load({ id, factory(require) })` — receives
`require` and nothing else. `host.call` is never bound.

| | Shipped bundle (this plugin) | Cordis package |
|---|---|---|
| Declared by | `dsh.client` in `package.json` | created at runtime |
| Loaded through | the boot graph | `dsh-cordis-client-runner` |
| Entry shape | `load({ factory(require) })` | body that `return`s a plugin |
| Injected | `require` only | `React`, `styles`, `host`, `harness`, … |

So adopting them is **not a refactor — it is a change of package kind.**
Reaching them means shipping the Client half as a runtime-defined package, which
is a different distribution model. The HTTP route and the `ctx.effect`
stylesheet stay, and both are covered by tests.

## Kimi Code's regional login

Kimi Code is an RFC 8628 device grant against `https://auth.kimi.com`. Both hosts
implement the protocol identically — each returns a complete grant from
`POST /api/oauth/device_authorization`:

| Host | Landing page |
|---|---|
| `auth.kimi.com` | `www.kimi.com/code/authorize_device` — mainland (phone / WeChat) |
| `auth.kimi.ai` | `www.kimi.ai/code/authorize_device` — overseas |

The `.ai` page is the **overseas** login surface, not the mainland one: its
bundle's CSS class is `login-desktop-oversea`, it carries an `exclude-region-codes`
field, and its `en-US` dictionary ships `"Continue with Google"`,
`"Sign in with SSO"`, `phoneLogin`, `email` and `wechatQrLogin`. So
`KIMI_CODE_OAUTH_HOST=https://auth.kimi.ai` is the correct setting for
international users, and removing it sends them to the mainland page.

**Still unknown:** whether the *token* exchange succeeds. pi-ai sends none of the
`X-Msh-Platform` / `X-Msh-Version` / `X-Msh-Device-Id` device headers that
Moonshot's KLIP-14 marks as required by the backend. Only a completed sign-in
settles it, and it is not patchable from a plugin, because the requests are
pi-ai's.
