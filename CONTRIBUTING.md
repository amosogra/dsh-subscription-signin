# Contributing

Thanks for wanting to help. This is a small plugin with a narrow scope, so the
most useful contributions are usually bug reports with good diagnostics rather
than features.

## Before you start

Read [`docs/FINDINGS.md`](docs/FINDINGS.md). It records what has actually been
measured, and several plausible-sounding "bugs" are explained there as
deliberate behaviour — a pinned route that offers a model your plan lacks, an
unofficial backend, a client half that needs a restart. It will save you time.

If you are changing behaviour rather than fixing a defect, open an issue first so
we can agree on the shape before you write code.

## Running the tests

Five dependency-free suites. **There is no `npm install`** — the package has zero
dependencies and the tests use only the standard library. Run them from the
repository root:

```sh
node smoketest/render.mjs     # every UI branch, rendered in Node
node smoketest/accounts.mjs   # the shipped account list
node smoketest/run.mjs        # the tool and shared-service paths
node smoketest/http.mjs       # the route, including its trust gate
node smoketest/bundles.mjs    # is the client half in the boot graph?
```

All five must pass. CI runs them on Node 20, 22 and 24, so a local pass on one
version is a good sign but not the whole story.

## What the tests are for

Two of them exist because a failure is otherwise **invisible** — worth knowing
before you decide a change needs no test:

- `render.mjs` — a component that throws during render blanks its whole slot
  silently. Without this you get a blank page and no error.
- `bundles.mjs` — a client half missing from the boot graph is equally silent.
  From the user's side, "the section was never registered" and "the section
  threw" look identical.

If you add a branch to the panel, add it to `render.mjs`. If you touch anything
about how the bundle is loaded or reported, add it to `bundles.mjs`.

## House rules

- **No new dependencies.** Not in the plugin, not in the tests. `host.js` must
  stay zero-import, and `client.js` may `require('react')` and nothing else. This
  is not stylistic: the Host half runs in a context where a bare specifier cannot
  resolve, and the whole safety argument rests on the code being small enough to
  audit in two files.
- **Never read a secret.** The plugin may ask *whether* a credential exists, and
  may delete one on explicit `signout`. Reading, logging, or forwarding a token
  value is a defect, not a shortcut.
- **Keep the trust gate.** The route's Host/Origin and browser-auth check, its
  JSON-`POST`-only rule for mutations, its response headers and its body cap are
  load-bearing. Do not relax them to make something easier.
- **Do not add anything that circumvents a vendor's terms of service**, beyond the
  pre-existing and documented case of the unofficial ChatGPT backend that the
  Harness itself targets. That one is inherited and documented; new ones are not
  welcome.

## Pull requests

- One logical change per pull request.
- Explain *why* in the description, not just what. If you fixed something
  subtle, say what the failure looked like, so the next person recognises it.
- Update the docs when behaviour changes. `docs/FINDINGS.md` is the record of
  what is verified; if you verify something previously listed as unknown, move
  it.
- Do not paste credentials, tokens, device codes, or your
  `$DSH_HOME/.credentials.yaml` into an issue, a commit, or a pull request.

## Security

Do not report security problems in a public issue. See
[SECURITY.md](SECURITY.md), which also states what is and is not in scope.

## Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).
