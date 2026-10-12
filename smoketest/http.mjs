// HTTP-route smoke test for the Host half: exercises the browser-facing
// handler directly, with fakes for req/res and for the Connection trust check.
// Nothing here touches the real Harness or the network.
import * as plugin from '../dsh-subscription-signin/host.js'

const KEY = 'llm-pi-ai/openai-codex'
const ROUTE = '/plugins/subscription-signin'
let pass = 0
const ok = (label) => { pass += 1; console.log(`  ok  ${label}`) }
const fail = (label, extra) => { console.log(`  FAIL ${label}${extra ? ` — ${extra}` : ''}`); process.exitCode = 1 }

// ---- fakes ------------------------------------------------------------------
function fakeReq({ method = 'GET', url = `${ROUTE}/state`, headers = {}, body = null } = {}) {
  const chunks = body === null ? [] : [Buffer.from(body, 'utf8')]
  return {
    method,
    url,
    headers,
    async *[Symbol.asyncIterator]() { for (const chunk of chunks) yield chunk },
  }
}
function fakeRes() {
  const out = { status: null, headers: null, body: null }
  return {
    out,
    writeHead(status, headers) { out.status = status; out.headers = headers; return this },
    setHeader() { return this },
    end(body) { out.body = body === undefined ? null : body; return this },
  }
}
const json = (res) => { try { return JSON.parse(res.out.body) } catch { return null } }

// ---- harness stub -----------------------------------------------------------
let registeredRoute = null
let rejectWith
const stored = new Map()

const webServer = { register: (route) => { registeredRoute = route; return () => { registeredRoute = null } } }
const connection = { requestRejection: () => rejectWith }
const creds = {
  async listRecords() { return [...stored.entries()].map(([key, kind]) => ({ key, kind })) },
  async deleteRecord(key) { stored.delete(key) },
}
const typert = { register: () => async () => {} }

const base = {
  logger: { warn: (m) => console.log(`  [harness] warn: ${m}`) },
  tools: { register: () => () => {} },
  effect: (fn) => fn(),
  provide: (key, value) => { base._provided.set(key, value); return () => {} },
  _provided: new Map(),
  authorization: {
    describe: (key) => (key === KEY ? { label: 'OpenAI Codex', methods: [{ id: 'oauth' }], inFlight: false } : undefined),
    cancel: () => {},
    async begin({ interaction }) {
      await interaction.prompt({
        kind: 'select',
        options: [{ id: 'browser' }, { id: 'device_code' }],
        message: 'Select login method:',
      })
      interaction.notify({
        message: 'Enter this code.',
        url: 'https://auth.openai.com/codex/device',
        code: 'HTTP-TEST-99',
      })
      await new Promise((r) => setTimeout(r, 50))
      stored.set(KEY, 'grant')
      return { status: 'authorized' }
    },
  },
}

const ctx = {
  ...base,
  get(name) {
    if (name === 'credentials') return creds
    if (name === 'typert') return typert
    if (name === 'webServer') return webServer
    if (name === 'connection') return connection
    if (name === 'clientModules') return undefined
    return base._provided.get(name)
  },
  inject(deps, callback) {
    callback({ webServer, get: (n) => ctx.get(n), effect: (fn) => fn() })
  },
}
ctx.effect = base.effect

plugin.apply(ctx, {})

if (registeredRoute === null) { fail('route registered'); process.exit(1) }
if (registeredRoute.path !== ROUTE) fail('route path', registeredRoute.path)
else ok(`route registered: kind=${registeredRoute.kind} path=${registeredRoute.path}`)

const handler = registeredRoute.handler
const send = async (req) => { const res = fakeRes(); await handler(req, res); return res }

// ---- trust gate -------------------------------------------------------------
rejectWith = 403
{
  const res = await send(fakeReq({ url: `${ROUTE}/state` }))
  if (res.out.status !== 403) fail('trust rejection', `got ${res.out.status}`)
  else ok('connection.requestRejection(403) is honoured')
  const body = json(res)
  if (!body || body.ok !== false) fail('rejection body')
}
rejectWith = undefined

// ---- routing ----------------------------------------------------------------
{
  const res = await send(fakeReq({ url: `${ROUTE}/nope` }))
  if (res.out.status !== 404) fail('unknown endpoint -> 404', `got ${res.out.status}`)
  else ok('unknown endpoint -> 404')
}
{
  const res = await send(fakeReq({ method: 'POST', url: `${ROUTE}/state`, headers: { 'content-type': 'application/json' }, body: '{}' }))
  if (res.out.status !== 405) fail('GET-only endpoint -> 405', `got ${res.out.status}`)
  else ok('GET-only endpoint rejects POST with 405')
}
{
  const res = await send(fakeReq({ method: 'POST', url: `${ROUTE}/begin`, headers: { 'content-type': 'text/plain' }, body: 'x' }))
  if (res.out.status !== 415) fail('non-JSON mutation -> 415', `got ${res.out.status}`)
  else ok('non-JSON mutation rejected with 415 (CSRF hardening)')
}
{
  const res = await send(fakeReq({ method: 'POST', url: `${ROUTE}/begin`, headers: { 'content-type': 'application/json' }, body: '{not json' }))
  if (res.out.status !== 400) fail('malformed body -> 400', `got ${res.out.status}`)
  else ok('malformed JSON body -> 400')
}
{
  const res = await send(fakeReq({ url: `${ROUTE}/state` }))
  const body = json(res)
  if (res.out.status !== 200 || !body || body.status !== 'idle') fail('state', `status=${res.out.status} body=${res.out.body}`)
  else ok(`state -> 200 with status=${body.status}`)
}
{
  const res = await send(fakeReq({ url: `${ROUTE}/diagnostics` }))
  const body = json(res)
  const d = body && body.diagnostics ? JSON.parse(body.diagnostics) : null
  if (!d || d.routeRegistered !== true) fail('diagnostics reports the route', JSON.stringify(d))
  else ok(`diagnostics -> routeRegistered=${d.routeRegistered}, servedRequests=${d.servedRequests}`)
}

// ---- the real flow over HTTP ------------------------------------------------
{
  const res = await send(fakeReq({ method: 'POST', url: `${ROUTE}/begin`, headers: { 'content-type': 'application/json' }, body: '{}' }))
  const body = json(res)
  if (res.out.status !== 200 || !body || body.code !== 'HTTP-TEST-99') {
    fail('begin over HTTP surfaces the code', `status=${res.out.status} body=${res.out.body}`)
  } else ok(`begin -> 200, code=${body.code} status=${body.status}`)
}
{
  const res = await send(fakeReq({ method: 'POST', url: `${ROUTE}/signout`, headers: { 'content-type': 'application/json' }, body: '{}' }))
  const body = json(res)
  if (!body || body.ok !== false) fail('signout without confirm refused')
  else ok('signout without confirm refused over HTTP')
}
{
  const res = await send(fakeReq({ method: 'POST', url: `${ROUTE}/signout`, headers: { 'content-type': 'application/json' }, body: '{"confirm":true}' }))
  const body = json(res)
  if (!body || body.ok !== true) fail('signout with confirm', JSON.stringify(body))
  else ok('signout with confirm -> 200')
  if (stored.has(KEY)) fail('credential deleted')
  else ok('credential record deleted')
}
{
  const res = await send(fakeReq({ method: 'POST', url: `${ROUTE}/cancel`, headers: { 'content-type': 'application/json' }, body: '{}' }))
  const body = json(res)
  if (!body || body.ok !== true) fail('cancel', JSON.stringify(body))
  else ok('cancel -> 200')
}

// ---- security headers -------------------------------------------------------
{
  const res = await send(fakeReq({ url: `${ROUTE}/state` }))
  const h = res.out.headers ?? {}
  if (h['cache-control'] !== 'no-store') fail('cache-control')
  else ok('responses are no-store with nosniff')
  if (h['content-type'] !== 'application/json; charset=utf-8') fail('content-type', h['content-type'])
  else ok('responses are application/json')
}

console.log(`\n${process.exitCode ? 'FAILURES PRESENT' : `ALL HTTP TESTS PASSED (${pass} assertions)`}`)
