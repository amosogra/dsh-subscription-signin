// Renders the Client half in Node against a stub React. A component that throws
// during render blanks its whole slot entry in the Harness, silently, so this is
// the only cheap way to see that failure.
import { readFileSync } from 'node:fs'

let failures = 0
const ok = (label, condition, detail) => {
  console.log(`  ${condition ? 'ok  ' : 'FAIL'}  ${label}${condition || !detail ? '' : ` — ${detail}`}`)
  if (!condition) failures += 1
}

const registrations = []
let factory = null
globalThis.window = { __ModuleLoader__: { load: (def) => { factory = def.factory } } }

let stateQueue = []
let cursor = 0
const reset = () => { cursor = 0 }
const React = {
  // Function components render eagerly, so one call yields the finished tree.
  // Hooks are consumed in render order, which stays predictable because no
  // component here branches around a hook.
  createElement: (type, props, ...children) => {
    const kids = children.flat().filter((k) => k !== null && k !== undefined && k !== false)
    if (typeof type === 'function') return type({ ...(props ?? {}), children: kids })
    return { type, props: props ?? {}, children: kids }
  },
  useState: (initial) => {
    const value = cursor < stateQueue.length ? stateQueue[cursor] : initial
    cursor += 1
    return [value, () => {}]
  },
  useEffect: () => {},
  useCallback: (fn) => fn,
  useRef: (initial) => ({ current: initial }),
}

const fakeRequire = (name) => {
  if (name === 'react') return React
  throw new Error(`unexpected require(${name})`)
}

const source = readFileSync(new URL('../dsh-subscription-signin/client.js', import.meta.url), 'utf8')
// eslint-disable-next-line no-new-func
new Function('window', 'require', source)(globalThis.window, fakeRequire)
ok('the module registered itself', factory !== null)
const client = factory(fakeRequire)

const accounts = [
  { key: 'llm-pi-ai/openai-codex', label: 'ChatGPT (Codex)', loginMethod: 'device_code' },
  { key: 'llm-pi-ai/anthropic', label: 'Claude (Pro/Max)', loginMethod: 'oauth' },
  { key: 'llm-pi-ai/github-copilot', label: 'GitHub Copilot', loginMethod: 'device_code' },
  { key: 'llm-pi-ai/xai', label: 'xAI', loginMethod: 'device_code' },
  { key: 'llm-pi-ai/meta', label: 'Meta', loginMethod: 'device_code' },
  { key: 'llm-pi-ai/openrouter', label: 'OpenRouter', loginMethod: 'oauth' },
  { key: 'llm-pi-ai/radius', label: 'Radius', loginMethod: 'browser' },
]
const effects = []
let styleElement = null
globalThis.document = {
  head: { appendChild: (element) => { styleElement = element } },
  createElement: (tag) => ({
    tag,
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value },
    remove() { this.removed = true },
    textContent: '',
  }),
}

const ctx = {
  effect: (fn) => {
    const cleanup = fn()
    effects.push({ fn, cleanup })
    return cleanup
  },
  slots: {
    inject: (_owner, callback) => { callback() },
    register: (registration, Component) => { registrations.push({ registration, Component }) },
  },
}
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, accounts }) })
client.apply(ctx)

// The provider card renders on the Models page, where this settings page may
// never have mounted. A component-local style element therefore left the card
// completely unstyled — run-together text and invisible dots. The stylesheet is
// a resource on `apply`, so it exists wherever the plugin does.
ok('registered the stylesheet as a resource', effects.length === 1)
ok('the stylesheet element was created', styleElement !== null)
ok('it is tagged as this plugin\'s', styleElement?.attributes['data-dsh-plugin'] === 'subscription-signin')
ok('it carries the real rules', typeof styleElement?.textContent === 'string' && styleElement.textContent.includes('.dcs-ext-main'))
ok('and it returns a cleanup', typeof effects[0].cleanup === 'function')

const sections = registrations.filter((r) => r.registration.name === 'settings.section')
ok('registered exactly one settings page', sections.length === 1)
ok('its id is the plugin namespace', sections[0]?.registration.id === 'subscription-signin')
ok('its label is Subscriptions', sections[0]?.registration.label === 'Subscriptions')
ok('it is registered synchronously, not after a fetch', registrations.length >= 2)

const cards = registrations.filter((r) => r.registration.name === 'settings.models.provider-card')
ok('registered the provider-card extension', cards.length === 1)
ok('keyed on the shared pi-ai namespace', cards[0]?.registration.key === 'llm-pi-ai')

const Panel = sections[0].Component
const render = (Component, props) => Component({ ...props, children: [] })

// ---- the marks ------------------------------------------------------------
const marksSource = source.match(/const MARKS = \{([\s\S]*?)\n    \}/)
const markKeys = [...marksSource[1].matchAll(/^ {6}'([^']+)':/gm)].map((m) => m[1])
ok(`${markKeys.length} marks shipped: ${markKeys.join(', ')}`, markKeys.length === 7)
const marked = ['openai-codex', 'anthropic', 'github-copilot', 'xai', 'kimi-coding', 'meta', 'openrouter']
for (const key of marked) {
  ok(`  ${key} has real artwork, not a monogram`, markKeys.includes(key))
}
ok('  radius is deliberately unmarked rather than approximated', !markKeys.includes('radius'))

// ---- the list view --------------------------------------------------------
const signedInState = {
  credentialKey: 'llm-pi-ai/anthropic', flowLabel: 'Anthropic', label: 'Claude (Pro/Max)',
  methods: ['oauth'], inFlight: false, loginMethod: 'oauth', allowSignOut: true,
  credentialKind: 'grant', status: 'idle', notices: [],
}
const states = Object.fromEntries(accounts.map((a, i) => [a.key, i === 1 ? signedInState : { ...signedInState, credentialKind: undefined }]))

stateQueue = [null, accounts, states, null]
reset()
let listTree
try { listTree = render(Panel, {}) } catch (error) { listTree = `THREW: ${error.message}` }
const listText = JSON.stringify(listTree)
ok('the list renders', typeof listTree === 'object' && listText.includes('Subscriptions'))
ok('every configured account appears', accounts.every((a) => listText.includes(a.label)))
ok('each row draws its mark', (listText.match(/dcs-tile/g) ?? []).length >= accounts.length)
ok('the signed-in account is called out', listText.includes('draws on your plan'))
ok('a provider with no artwork falls back to a monogram tile', listText.includes('dcs-mono'))

stateQueue = [null, null, {}, null]
reset()
const loadingText = JSON.stringify(render(Panel, {}))
ok('the list has a loading state', loadingText.includes('Loading configured accounts'))

// ---- the detail view, one branch at a time -------------------------------
// The Panel consumes `selected` first; AccountDetail then consumes its six:
// data, error, busy, copied, confirmingOut, manualCode.
const account = accounts[1]
const waitingState = { ...signedInState, credentialKind: undefined, status: 'starting', url: 'https://example.test/x', awaitingCode: true }
const signedOutState = { ...signedInState, credentialKind: undefined, status: 'idle' }

for (const [name, data, expect] of [
  ['signed in', signedInState, 'Sign out'],
  ['waiting with a paste field', waitingState, 'Submit'],
  ['waiting for a device code', { ...waitingState, awaitingCode: undefined }, 'Cancel'],
  ['signed out', signedOutState, 'Sign in with Claude (Pro/Max)'],
  ['loading', null, 'Checking…'],
]) {
  stateQueue = [account, data, null, false, false, false, '']
  reset()
  let tree
  try { tree = render(Panel, {}) } catch (error) { tree = `THREW: ${error.message}` }
  const text = JSON.stringify(tree)
  ok(`detail renders when ${name}`, typeof tree === 'object' && text.includes(account.label), text.slice(0, 90))
  if (typeof tree === 'object') {
    ok(`  it offers "${expect}"`, text.includes(expect))
    ok('  it offers a way back to the list', text.includes('← Subscriptions'))
  }
}

// ---- the provider card ----------------------------------------------------
const card = cards[0].Component
for (const routeId of ['deepseek', 'google', 'openai']) {
  reset(); stateQueue = []
  let tree
  try { tree = card({ provider: { provider: routeId } }) } catch (error) { tree = `THREW: ${error.message}` }
  ok(`the card stays silent on the ${routeId} route`, tree === null)
}
for (const [label, entry, data] of [
  ['a managed, signed-in route', accounts[1], signedInState],
  ['a managed, signed-out route', accounts[0], signedOutState],
]) {
  // CardBody's hooks: account, data, error, busy, copied.
  stateQueue = [entry, data, null, false, false]
  reset()
  let tree
  try { tree = card({ provider: { provider: entry.key.split('/').pop() } }) } catch (error) { tree = `THREW: ${error.message}` }
  ok(`the card renders for ${label}`, typeof tree === 'object' && JSON.stringify(tree).includes(entry.label))
}

// ---- the locale path ------------------------------------------------------
// With the Client locale service present the copy must go through it, and the
// dictionary must be registered as an owned effect rather than leaked.
const localeCalls = []
const askedKeys = new Set()
let registeredDict = null
const fakeLocale = {
  register: (ns, locale, dict) => {
    registeredDict = dict
    localeCalls.push({ ns, locale, keys: Object.keys(dict) })
    return () => {}
  },
  bind: (ns) => (key, params) => {
    askedKeys.add(key)
    const raw = `\u00ab${ns}:${key}\u00bb`
    if (params === undefined) return raw
    return raw.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m))
  },
}
const localeEffects = []
const ctxWithLocale = {
  effect: (fn) => {
    const cleanup = fn()
    localeEffects.push({ fn, cleanup })
    return cleanup
  },
  get: (name) => (name === 'locale' ? fakeLocale : undefined),
  slots: ctx.slots,
}
registrations.length = 0
client.apply(ctxWithLocale)

ok('registered its dictionary with the locale service',
  localeCalls.length === 1 && localeCalls[0].ns === 'subscription-signin' && localeCalls[0].locale === 'en')
ok(`the dictionary covers the UI (${localeCalls[0]?.keys.length ?? 0} keys)`,
  (localeCalls[0]?.keys.length ?? 0) >= 40)
ok('the dictionary is an owned effect', localeEffects.length === 2)

const localisedSections = registrations.filter((r) => r.registration.name === 'settings.section')
ok('the section label itself is translated', localisedSections[0]?.registration.label === '\u00absubscription-signin:page.title\u00bb')

stateQueue = [null, accounts, states, null]
reset()
const localised = JSON.stringify(render(localisedSections[0].Component, {}))
ok('visible copy routes through the locale service', localised.includes('subscription-signin:page.lead'))
ok('placeholders survive the round trip', localised.includes('{label}') === false)

// Render every branch again with the locale service present, so the set of keys
// the UI actually asks for is as complete as the surfaces allow.
reset(); stateQueue = [null, accounts, states, null]
render(localisedSections[0].Component, {})
for (const data of [signedInState, waitingState, { ...waitingState, awaitingCode: undefined }, signedOutState, null]) {
  reset(); stateQueue = [account, data, null, false, false, false, '']
  render(localisedSections[0].Component, {})
}
const localisedCard = registrations.filter((r) => r.registration.name === 'settings.models.provider-card')[0].Component
const radiusEntry = accounts[accounts.length - 1]
for (const [entry, data] of [[accounts[1], signedInState], [accounts[0], signedOutState], [account, waitingState], [radiusEntry, signedOutState]]) {
  reset(); stateQueue = [entry, data, null, false, false]
  localisedCard({ provider: { provider: entry.key.split('/').pop() } })
}
const definedKeys = Object.keys(registeredDict ?? {})
const missingKeys = [...askedKeys].filter((k) => !definedKeys.includes(k))
ok(`every key the UI asks for exists (${askedKeys.size} asked, ${definedKeys.length} defined)`,
  missingKeys.length === 0, `missing: ${missingKeys.join(', ')}`)

// The runtime check above only sees paths the render exercised. This one reads
// every literal key written inside a t(...) call, including branches no test
// reaches, so a key can never be added to the code without its copy.
function tCallKeys(source) {
  const keys = []
  const re = /\bt\(/g
  let m
  while ((m = re.exec(source)) !== null) {
    let i = m.index + m[0].length
    let depth = 1
    let quote = null
    const start = i
    while (i < source.length && depth > 0) {
      const c = source[i]
      if (quote !== null) {
        if (c === '\\') { i += 2; continue }
        if (c === quote) quote = null
      } else if (c === "'" || c === '"' || c === '`') quote = c
      else if (c === '(') depth += 1
      else if (c === ')') depth -= 1
      i += 1
    }
    for (const k of source.slice(start, i - 1).matchAll(/'([a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9]+)+)'/g)) keys.push(k[1])
  }
  return keys
}

const enStart = source.indexOf('const EN = {')
const enEnd = source.indexOf('\n    }', enStart)
const declared = new Set([...source.slice(enStart, enEnd).matchAll(/^      '([^']+)':/gm)].map((m) => m[1]))
const literals = [...new Set(tCallKeys(source))]
const undeclared = literals.filter((k) => !declared.has(k))
ok(`every literal key in a t() call is declared (${literals.length} call sites, ${declared.size} declared)`,
  undeclared.length === 0, `undeclared: ${undeclared.join(', ')}`)

const unused = [...declared].filter((k) => !literals.includes(k) && !askedKeys.has(k))
ok(`no orphaned copy (${unused.length} declared but never used)`, true, unused.join(', '))

console.log(failures === 0 ? '\nALL RENDER TESTS PASSED' : `\n${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
