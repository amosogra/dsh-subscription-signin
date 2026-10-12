// Client-bundle presence suite: drives the Host half's graph diagnostics
// against a stubbed `clientModules` service.
//
// Why this exists. The Subscriptions page once vanished from Settings with no
// error anywhere: `dsh-client-modules` memoizes a package's `dsh.client`
// declaration per loader source key, including the *negative* answer, "until
// restart", and nothing invalidates it. When that negative is cached the bundle
// never enters the boot graph, so the browser is never told it exists — the
// section cannot render and cannot report a failure. `diagnostics()` is the
// only place that difference is visible, so its fields are tested here.
//
// Imports `../host.js` directly, like every other suite here, so no suite can
// ever test a stale copy. It never touches the real installation, credential
// store, or network.
import * as plugin from '../dsh-subscription-signin/host.js'

const log = []
let failures = 0
const record = (line) => { log.push(line); console.log(line) }
const ok = (line) => record(`  ok   ${line}`)
const check = (condition, line) => {
  if (condition) { ok(line); return }
  failures += 1
  record(`  FAIL ${line}`)
}

const OUR_ID = 'dsh-subscription-signin'
const tool = { value: null }

/**
 * Mount the plugin against a stubbed harness whose `clientModules` is whatever
 * the caller supplies — the point of the suite is how the plugin reacts to
 * each shape, including a hostile one.
 * @param clientModules - the stub, or `undefined` for "no such service".
 */
function mount(clientModules) {
  tool.value = null
  const ctx = {
    logger: { warn: (message) => record(`  [harness] warn: ${message}`) },
    tools: { register: (registered) => { tool.value = registered; return () => { tool.value = null } } },
    effect: (fn) => fn(),
    inject: (_deps, callback) => callback({ webServer: { register: () => () => {} }, get: (name) => ctx.get(name), effect: (fn) => fn() }),
    provide: () => () => {},
    get: (name) => (name === 'clientModules' ? clientModules : undefined),
    authorization: { describe: () => undefined, cancel: () => {} },
  }
  plugin.apply(ctx, { accounts: [{ key: 'llm-pi-ai/openai-codex', label: 'ChatGPT (Codex)' }] })
  if (tool.value === null) throw new Error('FAIL: no tool was registered')
  return tool.value
}

/** The diagnostics payload the tool returns, parsed back out of its JSON. */
async function diagnosticsOf(clientModules) {
  const registered = mount(clientModules)
  const result = await registered.execute({ action: 'diagnostics' })
  return JSON.parse(result.diagnostics)
}

/** A graph stub in the shape `dsh-client-modules` serves as `__DSH_BOOT__`. */
function graphOf(ids) {
  return { rev: 'stub', entries: ids.map((id) => ({ id, rev: 'r1' })), batches: [] }
}

record('=== the bundle IS composed ===')
{
  const ids = ['@deepseek-ai/dsh-client-ui-settings-shell', OUR_ID, '@deepseek-ai/dsh-client-ui-goal']
  const info = await diagnosticsOf({
    graph: () => graphOf(ids),
    clientPath: (id) => (id === OUR_ID ? '/tmp/stub/client.js' : undefined),
    onGraphChanged: () => () => {},
  })
  check(info.bundleId === OUR_ID, `bundleId is reported: ${info.bundleId}`)
  check(info.composedCount === 3, `composedCount counts the rows: ${info.composedCount}`)
  check(info.bundleInGraph === true, 'bundleInGraph is true when the row is present')
  check(info.composedPackages.includes(OUR_ID), 'composedPackages names the row')
  check(Array.isArray(info.composedPackages) && info.composedPackages[0] < info.composedPackages[1], 'composedPackages is sorted')
  check(info.composedPackagesError === undefined, 'no error is reported for a healthy graph')
  check(info.clientPath === '/tmp/stub/client.js', 'clientPath still resolves')
}

record('\n=== the bundle is NOT composed (the failure this suite exists for) ===')
{
  const ids = ['@deepseek-ai/dsh-client-ui-settings-shell', '@deepseek-ai/dsh-client-ui-goal']
  const info = await diagnosticsOf({
    graph: () => graphOf(ids),
    clientPath: () => undefined,
    onGraphChanged: () => () => {},
  })
  check(info.bundleInGraph === false, 'bundleInGraph is false when the row is absent')
  check(info.composedCount === 2, `composedCount excludes it: ${info.composedCount}`)
  check(!info.composedPackages.includes(OUR_ID), 'composedPackages does not name the row')
  check(info.clientPath === null, 'clientPath is null, which is the other half of the signal')
  // The two signals must agree, because the whole diagnosis is "in the table"
  // versus "serveable", and a reader compares them.
  check(info.bundleInGraph === (info.clientPath !== null), 'bundleInGraph and clientPath agree')
}

record('\n=== no clientModules service on this composition ===')
{
  const info = await diagnosticsOf(undefined)
  check(info.clientModulesService === false, 'clientModulesService is false')
  check(info.bundleInGraph === false, 'bundleInGraph is false rather than undefined')
  check(Array.isArray(info.composedPackages) && info.composedPackages.length === 0, 'composedPackages degrades to an empty array')
  check(info.composedPackagesError !== undefined, 'the absence is recorded as a reason')
  check(info.composedPackagesError.includes('clientModules'), `the reason names the service: ${info.composedPackagesError}`)
}

record('\n=== a graph that cannot be read does not break the tool ===')
{
  const broken = await diagnosticsOf({
    graph: () => { throw new Error('graph is unavailable') },
    clientPath: () => undefined,
    onGraphChanged: () => () => {},
  })
  check(broken.composedPackagesError === 'graph is unavailable', `the thrown message is surfaced: ${broken.composedPackagesError}`)
  check(broken.bundleInGraph === false, 'bundleInGraph stays false instead of throwing')

  const malformed = await diagnosticsOf({ graph: () => null, clientPath: () => undefined, onGraphChanged: () => () => {} })
  check(malformed.composedCount === 0, 'a null graph yields no rows rather than a crash')

  const junk = await diagnosticsOf({ graph: () => ({ entries: [{ id: 42 }, null, { id: 'ok' }, 'nope'] }), clientPath: () => undefined, onGraphChanged: () => () => {} })
  check(junk.composedPackages.length === 1 && junk.composedPackages[0] === 'ok', 'non-string and malformed rows are skipped')
}

record('\n=== a graph change is observed, not guessed ===')
{
  let listener = null
  let disposed = 0
  const info = await diagnosticsOf({
    graph: () => graphOf([OUR_ID]),
    clientPath: () => '/tmp/stub/client.js',
    onGraphChanged: (fn) => { listener = fn; return () => { disposed += 1 } },
  })
  check(info.graphChanges === 0, 'graphChanges starts at zero')
  check(typeof listener === 'function', 'the plugin subscribed to graph changes')
  listener()
  const after = await (async () => {
    const registered = mount({ graph: () => graphOf([OUR_ID]), clientPath: () => '/tmp/stub/client.js', onGraphChanged: (fn) => { listener = fn; return () => { disposed += 1 } } })
    listener()
    const result = await registered.execute({ action: 'diagnostics' })
    return JSON.parse(result.diagnostics)
  })()
  check(after.graphChanges === 1, `graphChanges counts a recomposition: ${after.graphChanges}`)
}

record('\n=== a clientModules service without onGraphChanged still works ===')
{
  const info = await diagnosticsOf({ graph: () => graphOf([OUR_ID]), clientPath: () => '/x/client.js' })
  check(info.bundleInGraph === true, 'the snapshot is still read from graph()')
  check(info.graphChanges === 0, 'graphChanges stays zero without a subscription')
}

record('')
if (failures > 0) {
  record(`BUNDLE SUITE FAILED (${failures} failed)`)
  process.exit(1)
}
record('ALL BUNDLE TESTS PASSED')
