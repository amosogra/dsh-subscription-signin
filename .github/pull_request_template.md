## What this changes

<!-- One or two sentences. What is different for a user after this? -->

## Why

<!-- The reason, not the mechanics. If this fixes something subtle, describe what
     the failure looked like — that is how the next person recognises it. -->

## Checks

- [ ] All five suites pass (`node smoketest/render.mjs`, `accounts`, `run`, `http`, `bundles`)
- [ ] No new dependencies (`host.js` stays zero-import; `client.js` may only `require('react')`)
- [ ] Nothing reads, logs or forwards a credential value
- [ ] The route's trust gate is unchanged, or the change is explained above
- [ ] Docs updated if behaviour changed (`README.md`, `docs/FINDINGS.md`)
- [ ] No credential, token, device code or `.credentials.yaml` content included
