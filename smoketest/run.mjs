// Pre-install smoke test: drives the Host half against a stubbed Harness.
// Nothing here touches the real DSH installation, credential store, or network.
import * as plugin from '../dsh-subscription-signin/host.js'

const KEY = 'llm-pi-ai/openai-codex'
const SERVICE_KEY = 'subscriptionSigninService'
const log = []
const record = (line) => { log.push(line); console.log(line) }

// ---- fake harness -----------------------------------------------------------
let registered = null
let beginCalls = 0
let committed = null
let typertContribution = null
const provided = new Map()
const stored = new Map()

const creds = {
  async listRecords() { return [...stored.entries()].map(([key, kind]) => ({ key, kind })) },
  async deleteRecord(key) { stored.delete(key) },
}

const typert = {
  register(contribution) {
    // Mirror the real registry's atomic rejection rules we care about.
    if (typeof contribution.package !== 'string' || contribution.package.length === 0) throw new Error('package required')
    if (contribution.face !== 'host') throw new Error('face must be host')
    if (!Array.isArray(contribution.invocations) || contribution.invocations.length === 0) throw new Error('invocations required')
    const ids = new Set()
    for (const inv of contribution.invocations) {
      if (ids.has(inv.id)) throw new Error(`duplicate invocation id ${inv.id}`)
      ids.add(inv.id)
      for (const field of ['id', 'service', 'namespace', 'method']) {
        if (typeof inv[field] !== 'string' || inv[field].length === 0) throw new Error(`invocation.${field} required`)
      }
      if (inv.result?.mode !== 'src-json') throw new Error('result codec must be src-json')
      for (const p of inv.parameters ?? []) {
        if (p.source !== 'json') throw new Error('parameter.source must be json')
        if (p.codec?.mode !== 'src-json') throw new Error('parameter codec must be src-json')
      }
    }
    typertContribution = contribution
    return async () => {}
  },
}

const flow = { key: KEY, label: 'OpenAI Codex', methods: [{ id: 'oauth', label: 'OpenAI (ChatGPT Plus/Pro)' }] }

const ctx = {
  logger: { warn: (m) => record(`  [harness] warn: ${m}`) },
  tools: { register: (tool) => { registered = tool; return () => { registered = null } } },
  effect: (fn) => fn(),
  inject: (deps, callback) => callback({ webServer: { register: () => () => {} }, get: (n) => ctx.get(n), effect: (fn) => fn() }),
  provide: (key, value) => { provided.set(key, value); return () => { provided.delete(key) } },
  get: (name) => {
    if (name === 'credentials') return creds
    if (name === 'typert') return typert
    if (name === 'clientModules') return undefined
    return provided.get(name)
  },
  authorization: {
    describe: (key) => (key === KEY ? { ...flow, inFlight: beginCalls > 0 && committed === null } : undefined),
    cancel: () => record('  [harness] ctx.authorization.cancel called'),
    async begin({ key, method, interaction, signal }) {
      beginCalls += 1
      record(`  [harness] begin(key=${key}, method=${method}, signal=${Boolean(signal)})`)
      const chosen = await interaction.prompt({
        kind: 'select',
        message: 'Select OpenAI Codex login method:',
        options: [
          { id: 'browser', label: 'Browser login (default)' },
          { id: 'device_code', label: 'Device code login (headless)' },
        ],
      })
      record(`  [harness] login method chosen by plugin: ${chosen}`)
      interaction.notify({
        message: 'Enter this code on the verification page to finish signing in.',
        url: 'https://auth.openai.com/codex/device',
        code: 'TEST-CODE-1234',
      })
      await new Promise((resolve) => setTimeout(resolve, 300))
      if (signal?.aborted) return { status: 'cancelled' }
      committed = { type: 'oauth', access: 'REDACTED', refresh: 'REDACTED' }
      stored.set(KEY, 'grant')
      record('  [harness] credential committed by the store (simulated)')
      return { status: 'authorized' }
    },
  },
}

// ---- mount ------------------------------------------------------------------
plugin.apply(ctx, {})
if (registered === null) throw new Error('FAIL: no tool was registered')
record(`registered tool: ${registered.name}`)
record(`declared parameters: ${Object.keys(registered.parameters).join(', ')}`)

// ---- the Client-callable namespace -----------------------------------------
record('\n=== shared service ===')
const service = provided.get(SERVICE_KEY)
if (service === undefined) throw new Error('FAIL: the backing service was not provided')
record(`backing service provided: ${SERVICE_KEY}`)
for (const method of ['state', 'begin', 'cancel', 'signout', 'diagnostics']) {
  if (typeof service[method] !== 'function') throw new Error(`FAIL: service.${method} missing`)
}
record('every service method the HTTP route needs is present')

const call = (args) => registered.execute(args)
const show = (label, value) => {
  record(`\n--- ${label} ---`)
  record(registered.output.render({}, value).map((part) => part.text).join('\n'))
}

// ---- exercise the agent tool ------------------------------------------------
const status1 = await call({ action: 'status' })
show('status (before)', status1)
if (status1.flowLabel !== 'OpenAI Codex') throw new Error('FAIL: flow label not read')
if (status1.credentialKind !== undefined) throw new Error('FAIL: no credential should exist yet')

const started = await call({ action: 'start' })
show('start', started)
if (started.url !== 'https://auth.openai.com/codex/device') throw new Error('FAIL: url not surfaced')
if (started.code !== 'TEST-CODE-1234') throw new Error('FAIL: device code not surfaced')
if (!log.some((l) => l.includes('login method chosen by plugin: device_code'))) {
  throw new Error('FAIL: plugin did not answer the select from configured loginMethod')
}

const dup = await call({ action: 'start' })
if (dup.ok !== false || !dup.message.includes('already in flight')) throw new Error('FAIL: duplicate start not refused')
record('\n--- duplicate start correctly refused ---')

await new Promise((resolve) => setTimeout(resolve, 500))
const after = await call({ action: 'poll' })
show('poll (after approval)', after)
if (after.status !== 'authorized') throw new Error(`FAIL: expected authorized, got ${after.status}`)
if (after.credentialKind !== 'grant') throw new Error('FAIL: credential kind not reported')

const refused = await call({ action: 'signout' })
if (refused.ok !== false) throw new Error('FAIL: signout without confirm was not refused')
record('\n--- signout without confirm correctly refused ---')

const signedOut = await call({ action: 'signout', confirm: true })
show('signout (confirmed)', signedOut)
if (signedOut.ok !== true) throw new Error('FAIL: confirmed signout failed')
if (stored.has(KEY)) throw new Error('FAIL: credential record not deleted')

if ((await call({ action: 'nonsense' })).ok !== false) throw new Error('FAIL: unknown action not rejected')

// ---- exercise the Client namespace (same code paths) ------------------------
record('\n=== Client-callable namespace behaviour ===')
const s0 = await service.state()
if (s0.status !== 'idle') throw new Error(`FAIL: client state expected idle, got ${s0.status}`)
record(`client state: status=${s0.status} loginMethod=${s0.loginMethod} allowSignOut=${s0.allowSignOut}`)

const s1 = await service.begin({})
if (!s1.ok) throw new Error(`FAIL: client begin failed: ${s1.error}`)
if (s1.code !== 'TEST-CODE-1234') throw new Error('FAIL: client begin did not surface the code')
if (s1.status !== 'starting') throw new Error(`FAIL: expected starting, got ${s1.status}`)
record(`client begin: status=${s1.status} code=${s1.code}`)

const s2 = await service.begin({})
if (s2.ok !== false || !String(s2.error).includes('already in flight')) {
  throw new Error('FAIL: client double-begin not refused')
}
record('client double-begin correctly refused')

const s3 = await service.cancel()
if (s3.status !== 'cancelled') throw new Error(`FAIL: client cancel expected cancelled, got ${s3.status}`)
record(`client cancel: status=${s3.status}`)

const s4 = await service.signout({})
if (s4.ok !== false) throw new Error('FAIL: client signout without confirm was not refused')
const s5 = await service.signout({ confirm: true })
if (!s5.ok) throw new Error(`FAIL: client signout failed: ${s5.error}`)
record('client signout: confirmation enforced, then succeeded')

const s6 = await service.diagnostics()
const diag = JSON.parse(s6.diagnostics)
if (diag.count < 5) throw new Error('FAIL: client calls were not counted for diagnostics')
record(`client diagnostics: counted ${diag.count} calls, last=${diag.lastMethod}`)
if (diag.clientModulesService !== false) throw new Error('FAIL: clientModules diagnostic unexpected')

console.log('\nALL SMOKE TESTS PASSED')
