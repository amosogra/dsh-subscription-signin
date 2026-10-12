// Exercises the multi-account and paste-the-code paths against a stub harness.
import { readFileSync } from 'node:fs'

let failures = 0
const ok = (label, condition) => {
  console.log(`  ${condition ? 'ok ' : 'FAIL'}  ${label}`)
  if (!condition) failures += 1
}

const plugin = await import('../dsh-subscription-signin/host.js')

const routes = []
const tools = []
const provided = new Map()
const store = { records: [], listRecords: async () => store.records, deleteRecord: async (key) => { store.records = store.records.filter((r) => r.key !== key) } }
const webServer = { register: (route) => { routes.push(route); return () => {} } }

// A flow shaped like Anthropic's: it notifies a URL, then asks for a pasted code.
let sawPrompt = false
let sawDomain
let capturedEnv
let capturedAnswer
const authorization = {
  describe: (key) => (key === 'llm-pi-ai/anthropic'
    ? { label: 'Anthropic', methods: [{ id: 'oauth' }], inFlight: false }
    : key === 'llm-pi-ai/xai' ? { label: 'xAI', methods: [{ id: 'oauth' }], inFlight: false }
    : key === 'llm-pi-ai/github-copilot'
      ? { label: 'GitHub Copilot', methods: [{ id: 'oauth' }], inFlight: false }
      : key === 'llm-pi-ai/openai-codex' ? { label: 'OpenAI Codex', methods: [{ id: 'oauth' }], inFlight: false } : undefined),
  begin: async ({ key, interaction }) => {
    if (key === 'llm-pi-ai/xai') {
      capturedEnv = process.env.DSH_TEST_OAUTH_HOST
      capturedAnswer = await interaction.prompt({ kind: 'text', message: 'Which host?' })
      return { status: 'authorized' }
    }
    if (key === 'llm-pi-ai/github-copilot') {
      // Copilot's real first interaction: a question the flow cannot proceed
      // without, and therefore one that carries no signal.
      sawDomain = await interaction.prompt({
        kind: 'text',
        message: 'GitHub Enterprise URL/domain (blank for github.com)',
        placeholder: 'company.ghe.com',
      })
      interaction.notify({
        type: 'device_code',
        message: 'Enter this code on the verification page to finish signing in.',
        url: 'https://github.com/login/device',
        code: 'ABCD-1234',
      })
      return { status: 'authorized' }
    }
    interaction.notify({ type: 'auth_url', url: 'https://example.test/authorize', message: 'Open this page.' })
    const answer = await interaction.prompt({ kind: 'manual_code', message: 'Paste the code:', signal: new AbortController().signal })
    sawPrompt = answer
    interaction.notify({ type: 'progress', message: 'Exchanging authorization code for tokens...' })
    return { status: 'authorized' }
  },
  cancel: () => {},
}

const ctx = {
  get: (name) => (name === 'credentials' ? store : name === 'webServer' ? webServer : name === 'connection' ? undefined : undefined),
  provide: (name, value) => provided.set(name, value),
  inject: (deps, callback) => { callback(ctx) },
  tools: { register: (tool) => tools.push(tool) },
  effect: (fn) => { fn(); return () => {} },
  on: () => {},
  authorization,
}

plugin.apply(ctx, {
  accounts: [
    { key: 'llm-pi-ai/openai-codex', label: 'ChatGPT (Codex)', loginMethod: 'device_code' },
    { key: 'llm-pi-ai/anthropic', label: 'Claude (Pro/Max)', loginMethod: 'oauth' },
    { key: 'llm-pi-ai/github-copilot', label: 'GitHub Copilot', loginMethod: 'device_code' },
    { key: 'llm-pi-ai/xai', label: 'xAI', loginMethod: 'device_code',
      textAnswer: 'company.ghe.com', env: { DSH_TEST_OAUTH_HOST: 'https://auth.example.ai' } },
  ],
})

const service = provided.get('subscriptionSigninService')
ok('service is provided', service !== undefined)
ok('the route mounted', routes.length === 1)
ok('the tool registered', tools.length === 1 && tools[0].name === 'subscription_signin')

console.log('\n--- account list comes from configuration ---')
const list = service.accounts()
ok('four accounts', list.ok === true && list.accounts.length === 4)
ok('labels preserved', list.accounts[1].label === 'Claude (Pro/Max)')
ok('per-account method', list.accounts[0].loginMethod === 'device_code' && list.accounts[1].loginMethod === 'oauth')

console.log('\n--- state is per account ---')
const claude = await service.state({ key: 'llm-pi-ai/anthropic' })
ok('anthropic flow resolved', claude.flowLabel === 'Anthropic')
ok('label reported', claude.label === 'Claude (Pro/Max)')
const codex = await service.state({ key: 'llm-pi-ai/openai-codex' })
ok('the other account is independent', codex.flowLabel === 'OpenAI Codex' && codex.label === 'ChatGPT (Codex)')

console.log('\n--- an unknown key falls back rather than inventing one ---')
const odd = await service.state({ key: 'not a key' })
ok('falls back to the first account', odd.credentialKey === 'llm-pi-ai/openai-codex')

console.log('\n--- the paste-the-code path ---')
const begun = await service.begin({ key: 'llm-pi-ai/anthropic' })
ok('begin reports awaitingCode', begun.awaitingCode === true)
ok('begin surfaces the vendor URL', begun.url === 'https://example.test/authorize')
const tooEarly = await service.submitCode({ key: 'llm-pi-ai/openai-codex', code: 'x' })
ok('submitting against a flow with no question is refused', tooEarly.ok === false)
const empty = await service.submitCode({ key: 'llm-pi-ai/anthropic', code: '   ' })
ok('an empty code is refused', empty.ok === false && /no code/i.test(empty.error))
const submitted = await service.submitCode({ key: 'llm-pi-ai/anthropic', code: 'CODE-123' })
ok('a real code is accepted', submitted.ok === true && submitted.awaitingCode === undefined)
await new Promise((resolve) => setTimeout(resolve, 30))
ok('the flow received the pasted code', sawPrompt === 'CODE-123')
const settled = await service.state({ key: 'llm-pi-ai/anthropic' })
ok('the attempt settled as authorized', settled.status === 'authorized')

console.log('\n--- a blocking question is answered, not held ---')
// GitHub Copilot asks for its Enterprise domain before it will issue a device
// code. Holding that question — as an earlier revision did with every non-select
// prompt — hangs the flow with no URL and no code, and the panel then fell back
// to a hardcoded OpenAI URL. A question with no signal must be answered.
const copilotBegin = await service.begin({ key: 'llm-pi-ai/github-copilot' })
ok('the blocking question did not hang the flow', copilotBegin.url === 'https://github.com/login/device')
ok('the device code is surfaced for it', copilotBegin.code === 'ABCD-1234')
ok('the answer reached the flow', sawDomain === '')
ok('the answer is visible as a notice',
  (copilotBegin.notices ?? []).some((n) => /accepted the flow default/.test(n.message)))
const settledCopilot = await service.state({ key: 'llm-pi-ai/github-copilot' })
ok('no stale pending question is left behind', settledCopilot.awaitingCode === undefined)
ok('no provider-specific URL fallback is invented', !JSON.stringify(settledCopilot).includes('openai.com'))

console.log('\n--- a per-account environment override reaches the flow ---')
// A provider that selects its endpoint from the environment (Kimi Code's
// regional OAuth hosts) is configured per account. It must be visible while the
// flow runs and gone afterwards, and textAnswer must survive the same builder.
const xai = await service.begin({ key: 'llm-pi-ai/xai' })
ok('the configured env var was visible to the flow', capturedEnv === 'https://auth.example.ai')
ok('textAnswer survived the account builder and answered the question', capturedAnswer === 'company.ghe.com')
await new Promise((resolve) => setTimeout(resolve, 30))
ok('the env var was restored once the attempt settled', process.env.DSH_TEST_OAUTH_HOST === undefined)

console.log('\n--- this package ships a valid account list ---')
// The eight accounts live in this package's OWN cordis.patch.yml, not in a
// profile patch, so this check is the same on every machine. It asserts the
// shape the Host half's account builder requires, so a bad edit to the shipped
// config fails here rather than as a missing row in Settings.
const patchText = readFileSync(new URL('../dsh-subscription-signin/cordis.patch.yml', import.meta.url), 'utf8')
const inserted = []
for (const line of patchText.split('\n')) {
  const m = /^\s*-\s+id:\s*(\S+)\s*$/.exec(line)
  if (m) inserted.push(m[1])
  const k = /^\s*-\s+key:\s*(\S+)\s*$/.exec(line)
  if (k) inserted.push(`key:${k[1]}`)
}
const accountKeys = inserted.filter((s) => s.startsWith('key:')).map((s) => s.slice(4))
const expectedKeys = [
  'llm-pi-ai/openai-codex', 'llm-pi-ai/anthropic', 'llm-pi-ai/github-copilot',
  'llm-pi-ai/xai', 'llm-pi-ai/meta', 'llm-pi-ai/kimi-coding',
  'llm-pi-ai/openrouter', 'llm-pi-ai/radius',
]
ok(`the row inserts under the plugin id`, inserted.includes('subscription-signin'))
ok(`all ${expectedKeys.length} accounts are configured`, expectedKeys.every((k) => accountKeys.includes(k)))
ok('no unexpected account was added', accountKeys.every((k) => expectedKeys.includes(k)))
ok('every account key is namespaced to the pi-ai adapter', accountKeys.every((k) => k.startsWith('llm-pi-ai/')))

// Kimi Code's login page is regional, and the host is env-selectable, so this
// one account names it. Dropping the override sends international users to the
// mainland phone/WeChat page — see the README before changing it.
ok('the Kimi regional override is still set',
  /KIMI_CODE_OAUTH_HOST:\s*https:\/\/auth\.kimi\.ai/.test(patchText))

// A bare `- id:` row is an OVERRIDE of an existing row and silently does
// nothing when no such row exists. Every account here must be an inserted list
// item, or the row goes missing with no error anywhere.
ok('the accounts are declared as an insert, not a bare override',
  /^\s*-\s+insert:\s*$/m.test(patchText))

console.log(failures === 0 ? '\nALL ACCOUNT TESTS PASSED' : `\n${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
