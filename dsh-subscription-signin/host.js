/**
 * ChatGPT (Codex) sign-in for the DeepSeek Harness — Host half.
 *
 * Ships two faces over one implementation:
 *   - an agent tool `subscription_signin`, and
 *   - an HTTP route at `/plugins/subscription-signin`, which the Client half
 *     (client.js) renders as a settings page.
 *
 * What this plugin deliberately does NOT do:
 *   - it implements no OAuth, no PKCE, no state, no token parsing;
 *   - it never reads, writes, logs or forwards a credential value;
 *   - it makes no network calls of its own;
 *   - it opens no files.
 *
 * The OAuth handshake is performed by `@earendil-works/pi-ai`, which ships
 * inside DeepSeek's own `@deepseek-ai/dsh-base` bundle. The credential is
 * committed by the Harness credential store through the `ctx.authorization`
 * seam. This plugin only presses the button.
 *
 * Dependency note — this module imports NOTHING, and that is deliberate.
 * A bundle installed into a profile resolves bare specifiers through the
 * Harness module router, which does not serve `@deepseek-ai/*` to a
 * profile-installed package. `@deepseek-ai/dsh-tools` cannot be vendored at
 * all (eleven Harness peers), and even `@deepseek-ai/schemastery` makes the
 * entry fail to import. See README.md.
 *
 * Reaching the Client half is a plain HTTP route, not a typed remote
 * namespace: the Client's namespace table is generated at DSH build time and
 * compiled into `@deepseek-ai/dsh-api-remotes` as a literal descriptor list, so
 * a third-party namespace is unaddressable by the page however it is
 * registered. The route inherits the Harness's own Host/Origin and browser
 * authentication checks through `connection.requestRejection`.
 *
 * @module dsh-subscription-signin
 */

export const name = 'subscription-signin'

/** `authorization` owns the sign-in; `tools` publishes it to the agent. */
export const inject = ['tools', 'authorization']

const ACTIONS = ['status', 'start', 'poll', 'cancel', 'signout', 'submitCode', 'diagnostics']
const LOGIN_METHODS = ['device_code', 'browser', 'oauth']

/** The terminal states an attempt can settle into. */
const SETTLED = new Set(['authorized', 'cancelled', 'error'])

/** Service key for the shared implementation, provided by this plugin. */
const SERVICE_KEY = 'subscriptionSigninService'
/** Path prefix of the HTTP route the Client half calls. */
const ROUTE_PATH = '/plugins/subscription-signin'
/** Largest request body accepted, in bytes. */
const MAX_BODY_BYTES = 64 * 1024

const DESCRIPTION =
  'Sign in to (or out of) a subscription model route that the DeepSeek Harness already ships ' +
  'an authorization flow for — OpenAI Codex (ChatGPT) and Anthropic (Claude Pro/Max) by default. ' +
  'The vendor runs the sign-in on its own page; no password is ever collected here. ' +
  'Use action "status" first, then "start", then "poll" until the status is "authorized" or ' +
  '"error". If the flow offers a paste fallback and the browser cannot reach its callback, ' +
  'use action "submitCode".'

/** JSON Schema for the tool's arguments, as the registry publishes it. */
const PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  required: ['action'],
  properties: {
    action: {
      type: 'string',
      enum: ACTIONS,
      description:
        'status: report the flow and any stored credential. start: begin a sign-in and return its URL/code. ' +
        'poll: re-read the running attempt. cancel: withdraw it. signout: delete the stored credential. ' +
        'diagnostics: report whether the Client half of the panel has loaded and called in.',
    },
    loginMethod: {
      type: 'string',
      enum: LOGIN_METHODS,
      description:
        'Optional per-call override of the method the flow offers. OpenAI Codex offers "device_code" ' +
        '(no local port) and "browser" (binds 127.0.0.1:1455); Anthropic offers "oauth" and "api-key". ' +
        'The value is matched against what the flow actually offers.',
    },
    credentialKey: {
      type: 'string',
      description:
        'Optional per-call override of the credential record to drive. Defaults to the row config, ' +
        'which defaults to "llm-pi-ai/openai-codex".',
    },
    code: {
      type: 'string',
      description:
        'Required for action "submitCode": the authorization code, or the full redirect URL, that the ' +
        'vendor page produced. Only flows with a paste fallback accept it; OpenAI\'s device flow does not.',
    },
    confirm: {
      type: 'boolean',
      description: 'Required as true for action "signout"; without it the tool refuses to delete the credential.',
    },
  },
}

/** JSON Schema for the result object. */
const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: true,
  properties: {
    ok: { type: 'boolean' },
    action: { type: 'string' },
    credentialKey: { type: 'string' },
    status: { type: 'string' },
    message: { type: 'string' },
    url: { type: 'string' },
    code: { type: 'string' },
    error: { type: 'string' },
    flowLabel: { type: 'string' },
    credentialKind: { type: 'string' },
    inFlight: { type: 'boolean' },
    awaitingCode: { type: 'boolean' },
    label: { type: 'string' },
    accounts: { type: 'array', items: { type: 'object', additionalProperties: true } },
    methods: { type: 'array', items: { type: 'string' } },
    notices: { type: 'array', items: { type: 'object', additionalProperties: true } },
    hints: { type: 'array', items: { type: 'string' } },
    diagnostics: { type: 'string' },
  },
}

/**
 * Flatten one tool result into display text.
 *
 * @param {object} value - the tool's result object.
 * @returns {string} human-readable lines, most actionable first.
 */
function format(value) {
  const lines = []
  if (value.url !== undefined) lines.push(`Sign-in URL: ${value.url}`)
  if (value.code !== undefined) lines.push(`Code to enter: ${value.code}`)
  if (value.message !== undefined) lines.push(value.message)
  if (value.status !== undefined) lines.push(`Status: ${value.status}`)
  if (value.flowLabel !== undefined) lines.push(`Flow: ${value.flowLabel}`)
  if (value.methods !== undefined && value.methods.length > 0) lines.push(`Methods: ${value.methods.join(', ')}`)
  if (value.credentialKind !== undefined) lines.push(`Stored credential: ${value.credentialKind}`)
  if (value.awaitingCode === true) lines.push('Waiting for a pasted authorization code (use action "submitCode").')
  if (value.label !== undefined) lines.push(`Account: ${value.label}`)
  if (value.error !== undefined) lines.push(`Error: ${value.error}`)
  if (Array.isArray(value.notices) && value.notices.length > 0) {
    lines.push('Log:')
    for (const notice of value.notices) lines.push(`  - ${notice.message}`)
  }
  if (Array.isArray(value.hints)) for (const hint of value.hints) lines.push(`Note: ${hint}`)
  if (value.diagnostics !== undefined) lines.push(`Diagnostics: ${value.diagnostics}`)
  return lines.length > 0 ? lines.join('\n') : JSON.stringify(value)
}

/**
 * Mount the sign-in tool, the Client-callable namespace, and their shared
 * implementation.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - the plugin context.
 * @param {object} config - the row's config.
 */
export function apply(ctx, config = {}) {
  const timeoutMs = (config.timeoutSeconds ?? 900) * 1000
  const allowSignOut = config.allowSignOut !== false

  /**
   * The accounts on offer, as configuration rather than code. Each entry names a
   * credential key the seam has a flow for. A legacy single `credentialKey` +
   * `loginMethod` pair is still honoured as a one-account list.
   */
  const accounts = (() => {
    const declared = Array.isArray(config.accounts) ? config.accounts : []
    const cleaned = declared
      .filter((entry) => entry !== null && typeof entry === 'object'
        && typeof entry.key === 'string' && entry.key.length > 0)
      .map((entry) => ({
        key: entry.key,
        label: typeof entry.label === 'string' && entry.label.length > 0 ? entry.label : entry.key,
        loginMethod: typeof entry.loginMethod === 'string' && entry.loginMethod.length > 0
          ? entry.loginMethod
          : undefined,
        // Optional, and dropped when absent so an account stays minimal.
        ...(typeof entry.textAnswer === 'string' ? { textAnswer: entry.textAnswer } : {}),
        ...(entry.env !== null && typeof entry.env === 'object' ? { env: entry.env } : {}),
      }))
    if (cleaned.length > 0) return cleaned
    return [{
      key: typeof config.credentialKey === 'string' && config.credentialKey.length > 0
        ? config.credentialKey
        : 'llm-pi-ai/openai-codex',
      label: typeof config.label === 'string' && config.label.length > 0 ? config.label : 'ChatGPT (Codex)',
      loginMethod: typeof config.loginMethod === 'string' && config.loginMethod.length > 0
        ? config.loginMethod
        : 'device_code',
    }]
  })()

  const defaultKey = accounts[0].key

  /** The login method configured for one account. */
  const methodFor = (key) => {
    const account = accounts.find((entry) => entry.key === key)
    return account?.loginMethod ?? accounts[0].loginMethod ?? 'device_code'
  }

  /** The human label for one account. */
  const labelFor = (key) => {
    const account = accounts.find((entry) => entry.key === key)
    return account === undefined ? key : account.label
  }

  /**
   * Resolve the account a browser request names. Anything absent or malformed
   * falls back to the first configured account rather than inventing a key.
   */
  const keyOf = (args) => {
    const requested = args !== null && typeof args === 'object' ? args.key : undefined
    if (typeof requested === 'string' && requested.length > 0 && !/\s/.test(requested)) return requested
    return defaultKey
  }

  /**
   * One live attempt per credential key. The seam allows only one at a time,
   * so this map mirrors rather than extends that rule.
   * @type {Map<string, object>}
   */
  const attempts = new Map()

  /** Evidence that the Client half loaded and reached us; for diagnostics. */
  const clientCalls = { first: null, last: null, count: 0, lastMethod: null, errors: [] }

  /** Whether the browser-facing route mounted, and why not if it did not. */
  let routeRegistered = false
  let routeError = null
  let servedRequests = 0

  /**
   * The client boot graph's composed package ids, refreshed on every graph
   * change.
   *
   * This exists because a missing row is invisible from here. `clientPath()`
   * answers `undefined` for a package whose `dsh.client` declaration was ever
   * resolved as absent — `dsh-client-modules` memoizes that negative per loader
   * source key "until restart", and nothing invalidates it. The page then never
   * receives the bundle, so it cannot render and cannot error: the settings
   * section simply does not appear. Naming the composed set here turns that
   * into a one-line diagnosis.
   * @type {string[]}
   */
  let composedPackages = []
  let graphChanges = 0

  /** Write one JSON response. */
  function sendJson(res, status, payload) {
    const body = JSON.stringify(payload)
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(body),
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    })
    res.end(body)
  }

  /** Read and parse a bounded JSON request body. */
  async function readJson(req) {
    const chunks = []
    let size = 0
    for await (const chunk of req) {
      size += chunk.length
      if (size > MAX_BODY_BYTES) throw new Error('request body too large')
      chunks.push(chunk)
    }
    if (chunks.length === 0) return {}
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  }

  /**
   * Build the browser-facing handler.
   *
   * Trust is inherited, never hand-rolled: `connection.requestRejection`
   * applies the same Host/Origin checks and browser authentication the Web
   * application itself uses. Mutations must additionally be JSON POSTs, so a
   * cross-origin caller has to survive a CORS preflight.
   *
   * @param {() => object} resolve - resolves the backing service per request.
   */
  function makeHttpHandler(resolve) {
    const endpoints = {
      accounts: { method: 'GET', run: (service) => service.accounts() },
      state: { method: 'GET', run: (service, body, query) => service.state({ key: query.get('key') ?? undefined }) },
      diagnostics: { method: 'GET', run: (service) => service.diagnostics() },
      begin: { method: 'POST', run: (service, body) => service.begin(body) },
      submitCode: { method: 'POST', run: (service, body) => service.submitCode(body) },
      cancel: { method: 'POST', run: (service, body) => service.cancel(body) },
      signout: { method: 'POST', run: (service, body) => service.signout(body) },
    }

    return async function handler(req, res) {
      servedRequests += 1

      const connection = ctx.get('connection')
      if (connection !== undefined && typeof connection.requestRejection === 'function') {
        let rejection
        try {
          rejection = connection.requestRejection(req)
        } catch {
          rejection = 403
        }
        if (rejection !== undefined) {
          sendJson(res, rejection, { ok: false, error: 'Refused by the Harness connection trust checks.' })
          return
        }
      }

      const requested = String(req.url ?? '/')
      const path = requested.split('?')[0]
      const query = new URLSearchParams(requested.includes('?') ? requested.slice(requested.indexOf('?') + 1) : '')
      const name = path.startsWith(`${ROUTE_PATH}/`) ? path.slice(ROUTE_PATH.length + 1).replace(/\/+$/, '') : ''
      const endpoint = endpoints[name]
      if (endpoint === undefined) {
        sendJson(res, 404, { ok: false, error: `Unknown endpoint "${name}".` })
        return
      }

      const method = String(req.method ?? 'GET').toUpperCase()
      if (method !== endpoint.method) {
        res.setHeader?.('allow', endpoint.method)
        sendJson(res, 405, { ok: false, error: `${name} requires ${endpoint.method}.` })
        return
      }

      let body = {}
      if (endpoint.method === 'POST') {
        const contentType = String(req.headers?.['content-type'] ?? '')
        if (!contentType.toLowerCase().startsWith('application/json')) {
          sendJson(res, 415, { ok: false, error: 'Mutations must be sent as application/json.' })
          return
        }
        try {
          body = await readJson(req)
        } catch (error) {
          sendJson(res, 400, { ok: false, error: `Malformed request body: ${error?.message ?? error}` })
          return
        }
      }

      try {
        const service = resolve()
        if (service === undefined) {
          sendJson(res, 503, { ok: false, error: 'The sign-in service is not mounted.' })
          return
        }
        sendJson(res, 200, await endpoint.run(service, body, query))
      } catch (error) {
        sendJson(res, 500, { ok: false, error: String(error?.message ?? error) })
      }
    }
  }

  const credentials = () => {
    try {
      return ctx.get('credentials')
    } catch {
      return undefined
    }
  }

  /** A detached view of one attempt, safe to serialise. */
  /** Environment a provider's flow reads to pick its endpoint, per account. */
  function envFor(key) {
    const account = accounts.find((entry) => entry.key === key)
    const env = account === undefined ? undefined : account.env
    if (env === null || typeof env !== 'object') return {}
    const picked = {}
    for (const [envName, envValue] of Object.entries(env)) {
      if (typeof envValue === 'string') picked[envName] = envValue
    }
    return picked
  }

  /**
   * Set that environment for one attempt and hand back its undo.
   *
   * Some providers choose their endpoint from the environment rather than from
   * the request — Kimi Code reads `KIMI_CODE_OAUTH_HOST` for its regional OAuth
   * hosts. Applying it around the attempt keeps the choice with the account
   * instead of with the Harness process, and restoring it means a later sign-in
   * cannot inherit an endpoint nobody asked for.
   */
  function applyEnv(env) {
    const names = Object.keys(env)
    if (names.length === 0) return () => {}
    const previous = new Map()
    for (const envName of names) {
      previous.set(envName, process.env[envName])
      process.env[envName] = env[envName]
    }
    return () => {
      for (const [envName, envValue] of previous) {
        if (envValue === undefined) delete process.env[envName]
        else process.env[envName] = envValue
      }
    }
  }

  /** The configured answer to a flow's blocking text question; '' by default. */
  function textAnswerFor(key) {
    const account = accounts.find((entry) => entry.key === key)
    const value = account === undefined ? undefined : account.textAnswer
    return typeof value === 'string' ? value : ''
  }

  function snapshot(key) {
    const record = attempts.get(key)
    if (record === undefined) return { status: 'idle', notices: [] }
    return {
      status: record.status,
      ...(record.url === undefined ? {} : { url: record.url }),
      ...(record.code === undefined ? {} : { code: record.code }),
      ...(record.error === undefined ? {} : { error: record.error }),
      ...(record.pendingPrompt === undefined ? {} : {
        awaitingCode: true,
        prompt: {
          kind: record.pendingPrompt.kind,
          message: record.pendingPrompt.message,
          ...(record.pendingPrompt.placeholder === undefined
            ? {}
            : { placeholder: record.pendingPrompt.placeholder }),
        },
      }),
      notices: record.notices.slice(),
    }
  }

  /**
   * Present the seam's interaction to a caller that cannot be interrupted
   * mid-call: notices accumulate into the attempt, the login-method question
   * is answered from config, and the browser flow's manual-code question is
   * held open rather than settled.
   *
   * Holding that question matters. pi-ai races it against its localhost
   * callback and cancels the callback wait the moment the question settles, so
   * answering it early — including by failing it — makes the browser flow fail
   * even when the browser would have completed. The flow withdraws the
   * question itself, via the signal it hands us.
   */
  function interactionFor(record, method, key) {
    return {
      notify(notice) {
        record.notices.push({
          message: notice.message,
          ...(notice.url === undefined ? {} : { url: notice.url }),
          ...(notice.code === undefined ? {} : { code: notice.code }),
        })
        if (notice.url !== undefined) record.url = notice.url
        if (notice.code !== undefined) record.code = notice.code
      },
      prompt(prompt) {
        if (prompt.kind === 'select') {
          const offered = prompt.options.find((option) => option.id === method)
          const chosen = offered ?? prompt.options[0]
          if (chosen === undefined) throw new Error('subscription-signin: the flow offered no login method')
          record.notices.push({ message: `${prompt.message} -> ${chosen.id} (chosen by configuration)` })
          return Promise.resolve(chosen.id)
        }
        // A question the flow cannot proceed without carries no `signal`.
        // GitHub Copilot asks for its Enterprise domain — blank for github.com —
        // before it will issue a device code at all. A racing paste-the-code
        // fallback always carries one, because the flow withdraws it the moment
        // its browser callback wins. Holding the first kind hangs the flow
        // forever with no URL and no code; settling the second kills a callback
        // that would have succeeded. So the signal, not the kind, decides.
        if (prompt.signal === undefined) {
          const answer = textAnswerFor(key)
          record.notices.push({
            message: `${prompt.message} -> ${answer.length === 0 ? '(accepted the flow default)' : answer}`,
          })
          return Promise.resolve(answer)
        }
        // Needs a human: hold it open, keeping the resolver so a deliberate
        // answer through submitCode() can settle it.
        return new Promise((resolve, reject) => {
          const settle = (value) => {
            record.pendingPrompt = undefined
            resolve(value)
          }
          record.pendingPrompt = {
            kind: prompt.kind ?? prompt.type,
            message: prompt.message,
            placeholder: prompt.placeholder,
            submit: settle,
          }
          const signal = prompt.signal
          const withdraw = () => {
            record.pendingPrompt = undefined
            reject(new Error('withdrawn'))
          }
          if (signal.aborted) {
            withdraw()
            return
          }
          signal.addEventListener('abort', withdraw, { once: true })
        })
      },
    }
  }

  /** Begin one attempt; resolves once the first actionable notice lands. */
  async function begin(key, method) {
    const flow = ctx.authorization.describe(key)
    if (flow === undefined) {
      throw new Error(`subscription-signin: no authorization flow is registered for "${key}"`)
    }
    const controller = new AbortController()
    const record = { status: 'starting', notices: [], url: undefined, code: undefined, error: undefined, controller }
    attempts.set(key, record)
    const restoreEnv = applyEnv(envFor(key))

    ctx.authorization
      .begin({ key, method: 'oauth', interaction: interactionFor(record, method, key), signal: controller.signal })
      .then((outcome) => {
        record.status = outcome.status
      })
      .catch((error) => {
        record.status = 'error'
        record.error = error instanceof Error ? error.message : String(error)
      })
      .finally(restoreEnv)

    const deadline = Date.now() + 15_000
    while (
      record.url === undefined &&
      record.code === undefined &&
      record.status === 'starting' &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 250))
    }

    const timer = setTimeout(() => {
      if (!SETTLED.has(record.status)) {
        record.controller.abort()
        record.status = 'cancelled'
        record.error = record.error ?? 'timed out waiting for the sign-in to finish'
      }
    }, timeoutMs)
    if (typeof timer.unref === 'function') timer.unref()

    return snapshot(key)
  }

  /** Read the flow, the stored credential's kind, and any live attempt. */
  async function state(key = defaultKey) {
    const flow = ctx.authorization.describe(key)
    const record = attempts.get(key)
    let credentialKind
    try {
      const records = (await credentials()?.listRecords?.()) ?? []
      credentialKind = records.find((entry) => String(entry.key) === String(key))?.kind
    } catch {
      credentialKind = undefined
    }
    const inFlight = flow?.inFlight === true || (record !== undefined && !SETTLED.has(record.status))
    return {
      credentialKey: key,
      ...(flow === undefined ? {} : { flowLabel: flow.label }),
      methods: flow?.methods?.map((entry) => entry.id) ?? [],
      inFlight,
      label: labelFor(key),
      loginMethod: methodFor(key),
      allowSignOut,
      ...(credentialKind === undefined ? {} : { credentialKind }),
      ...snapshot(key),
    }
  }

  /**
   * Answer the flow's paste-the-code question.
   *
   * Only meaningful while that question is outstanding. Every flow that asks it
   * treats the answer as a complete alternative to catching the callback.
   */
  function submitCode(key = defaultKey, code) {
    const record = attempts.get(key)
    if (record === undefined) throw new Error('subscription-signin: no attempt is in flight for that account')
    const pending = record.pendingPrompt
    if (pending === undefined) throw new Error('subscription-signin: this flow is not waiting for a pasted code')
    const value = typeof code === 'string' ? code.trim() : ''
    if (value.length === 0) throw new Error('subscription-signin: no code was supplied')
    record.notices.push({ message: 'Authorization code submitted by the operator.' })
    pending.submit(value)
    return snapshot(key)
  }

  /** Withdraw the running attempt, locally and through the seam. */
  function cancel(key = defaultKey) {
    const record = attempts.get(key)
    if (record === undefined) return { status: 'idle', notices: [] }
    record.controller.abort()
    try {
      ctx.authorization.cancel(key)
    } catch {
      // A withdrawn attempt is the outcome we wanted either way.
    }
    record.status = 'cancelled'
    return snapshot(key)
  }

  /** Delete the stored credential record. */
  async function signout(key = defaultKey) {
    const store = credentials()
    if (store === undefined) throw new Error('subscription-signin: no credential store is mounted')
    await store.deleteRecord(key)
    attempts.delete(key)
    return { status: 'signed-out', credentialKey: key }
  }

  /**
   * Refresh the composed-package snapshot from the client module graph.
   *
   * Read-only and defensive: the graph is another package's data structure, so
   * every step is guarded and a failure is recorded rather than thrown. The
   * entry ids are package names, which is exactly what `clientPath()` is keyed
   * by.
   * @returns {string|undefined} a message when the snapshot could not be read.
   */
  function refreshComposedPackages() {
    try {
      const cm = ctx.get('clientModules')
      if (cm === undefined || typeof cm.graph !== 'function') {
        composedPackages = []
        return 'no clientModules service on this composition'
      }
      const graph = cm.graph()
      const entries = graph !== null && typeof graph === 'object' && Array.isArray(graph.entries)
        ? graph.entries
        : []
      composedPackages = entries
        .map((entry) => (entry !== null && typeof entry === 'object' ? entry.id : undefined))
        .filter((id) => typeof id === 'string')
        .sort()
      return undefined
    } catch (error) {
      return String(error?.message ?? error)
    }
  }

  /** What the Host can see about the Client half; used to debug the bridge. */
  function diagnostics() {
    const info = { ...clientCalls }
    info.routePath = ROUTE_PATH
    info.routeRegistered = routeRegistered
    info.routeError = routeError
    info.servedRequests = servedRequests

    info.bundleId = 'dsh-subscription-signin'
    info.graphChanges = graphChanges
    const snapshotError = refreshComposedPackages()
    if (snapshotError !== undefined) {
      info.composedPackagesError = snapshotError
      info.composedPackages = []
      info.composedCount = 0
      info.bundleInGraph = false
    } else {
      info.composedPackages = composedPackages.slice()
      info.composedCount = composedPackages.length
      info.bundleInGraph = composedPackages.includes('dsh-subscription-signin')
    }

    try {
      const cm = ctx.get('clientModules')
      info.clientModulesService = cm !== undefined
      if (cm !== undefined) {
        try { info.clientPath = cm.clientPath('dsh-subscription-signin') ?? null } catch (error) { info.clientPathError = String(error?.message) }
        try {
          const graph = JSON.stringify(cm.graph())
          info.graphMentionsBundle = graph.includes('dsh-subscription-signin')
          info.graphLength = graph.length
        } catch (error) { info.graphError = String(error?.message) }
      }
    } catch (error) {
      info.clientModulesError = String(error?.message)
    }
    return info
  }

  const noteClientCall = (method) => {
    clientCalls.count += 1
    clientCalls.lastMethod = method
    clientCalls.last = new Date().toISOString()
    if (clientCalls.first === null) clientCalls.first = clientCalls.last
  }

  // ---- shared dispatch, used by BOTH the tool and the Client namespace ------

  async function dispatch(args) {
    const action = args.action
    const credentialKey =
      typeof args.credentialKey === 'string' && args.credentialKey.length > 0 ? args.credentialKey : defaultKey

    if (action === 'status') return { ok: true, action, credentialKey, ...(await state(credentialKey)) }

    if (action === 'diagnostics') {
      return { ok: true, action, credentialKey, diagnostics: JSON.stringify(diagnostics()) }
    }

    if (action === 'poll') {
      const fields = await state(credentialKey)
      const hints = []
      if (fields.status === 'authorized') hints.push('The credential is stored; the route is ready to use.')
      if (fields.status === 'starting') {
        hints.push("Still waiting for the human to approve on the vendor's page for " + labelFor(credentialKey) + '.')
      }
      if (fields.status === 'idle') hints.push('No attempt has been started in this process.')
      return { ok: true, action, credentialKey, ...fields, ...(hints.length === 0 ? {} : { hints }) }
    }

    if (action === 'start') {
      const live = attempts.get(credentialKey)
      if (live !== undefined && !SETTLED.has(live.status)) {
        return {
          ok: false, action, credentialKey, ...snapshot(credentialKey),
          message: 'An attempt is already in flight; use action "poll" or "cancel" instead.',
        }
      }
      const method = typeof args.loginMethod === 'string' && args.loginMethod.length > 0
        ? args.loginMethod
        : methodFor(credentialKey)
      const fields = await begin(credentialKey, method)
      const hints = []
      if (fields.code !== undefined && fields.url !== undefined) {
        hints.push(`Open ${fields.url} and enter the code ${fields.code}, then poll for the result.`)
      } else if (fields.url !== undefined) {
        hints.push(`Open ${fields.url} to continue, then poll for the result.`)
      }
      if (fields.status === 'error') hints.push('Nothing was stored. Check the error above before retrying.')
      return { ok: fields.status !== 'error', action, credentialKey, ...fields, ...(hints.length === 0 ? {} : { hints }) }
    }

    if (action === 'submitCode') {
      try {
        const fields = submitCode(credentialKey, args.code)
        return {
          ok: true, action, credentialKey, ...fields,
          hints: ['The code was handed to the flow; poll for the result.'],
        }
      } catch (error) {
        return { ok: false, action, credentialKey, error: String(error?.message ?? error) }
      }
    }

    if (action === 'cancel') return { ok: true, action, credentialKey, ...cancel(credentialKey) }

    if (!allowSignOut) {
      return { ok: false, action, credentialKey, message: 'Sign-out is disabled by this plugin\'s configuration.' }
    }
    if (args.confirm !== true) {
      return { ok: false, action, credentialKey, message: 'Refused: pass confirm: true to delete the stored credential record.' }
    }
    await signout(credentialKey)
    return {
      ok: true, action, credentialKey, status: 'signed-out',
      message: 'The credential record was deleted.',
      hints: ['This removed the local credential only. To revoke the grant itself, sign out of all sessions in your vendor account settings.'],
    }
  }

  // ---- Client-callable namespace -------------------------------------------

  /**
   * The plain object the HTTP route drives.
   * Every method takes and returns JSON-serialisable values only, and every
   * one that concerns the sign-in is the same code path the agent tool uses.
   */
  const service = {
    /** The configured accounts, so the Client can render one page per account. */
    accounts() {
      noteClientCall('accounts')
      return {
        ok: true,
        accounts: accounts.map((entry) => ({
          key: entry.key,
          label: entry.label,
          loginMethod: entry.loginMethod ?? accounts[0].loginMethod ?? 'device_code',
        })),
      }
    },
    async state(args) {
      noteClientCall('state')
      const key = keyOf(args)
      try {
        return { ok: true, ...(await state(key)) }
      } catch (error) {
        return { ok: false, error: String(error?.message ?? error) }
      }
    },
    async begin(args) {
      noteClientCall('begin')
      const key = keyOf(args)
      try {
        const method = typeof args?.loginMethod === 'string' && args.loginMethod.length > 0
          ? args.loginMethod
          : methodFor(key)
        const live = attempts.get(key)
        if (live !== undefined && !SETTLED.has(live.status)) {
          return { ok: false, error: 'A sign-in is already in flight.', ...(await state(key)) }
        }
        const fields = await begin(key, method)
        return { ok: fields.status !== 'error', ...(await state(key)) }
      } catch (error) {
        return { ok: false, error: String(error?.message ?? error) }
      }
    },
    async submitCode(args) {
      noteClientCall('submitCode')
      const key = keyOf(args)
      try {
        submitCode(key, args?.code)
        return { ok: true, ...(await state(key)) }
      } catch (error) {
        return { ok: false, error: String(error?.message ?? error) }
      }
    },
    async cancel(args) {
      noteClientCall('cancel')
      const key = keyOf(args)
      cancel(key)
      return { ok: true, ...(await state(key)) }
    },
    async signout(args) {
      noteClientCall('signout')
      const key = keyOf(args)
      if (!allowSignOut) return { ok: false, error: 'Sign-out is disabled by this plugin\'s configuration.' }
      if (args?.confirm !== true) return { ok: false, error: 'Sign-out requires explicit confirmation.' }
      try {
        await signout(key)
        return { ok: true, ...(await state(key)) }
      } catch (error) {
        return { ok: false, error: String(error?.message ?? error) }
      }
    },
    async diagnostics() {
      noteClientCall('diagnostics')
      return { ok: true, diagnostics: JSON.stringify(diagnostics()) }
    },
  }

  ctx.effect(() => {
    try {
      const disposer = ctx.provide(SERVICE_KEY, service)
      return typeof disposer === 'function' ? disposer : undefined
    } catch (error) {
      ctx.logger?.warn?.(`subscription-signin: could not provide the Client service: ${error?.message ?? error}`)
      return undefined
    }
  })

  // ---- the Client half's composed presence ---------------------------------
  //
  // Read-only observation, kept in an owned effect so it is withdrawn with the
  // plugin. The section above explains why a missing row is worth surfacing:
  // it is the difference between "the page is broken" and "the page was never
  // sent", and only this side can tell them apart.
  ctx.effect(() => {
    refreshComposedPackages()
    const cm = ctx.get('clientModules')
    if (cm === undefined || typeof cm.onGraphChanged !== 'function') return undefined
    let dispose
    try {
      dispose = cm.onGraphChanged(() => {
        graphChanges += 1
        refreshComposedPackages()
      })
    } catch (error) {
      ctx.logger?.warn?.(`subscription-signin: could not observe the client graph: ${error?.message ?? error}`)
      return undefined
    }
    return typeof dispose === 'function' ? dispose : undefined
  })

  // ---- the Client's route to us --------------------------------------------
  //
  // A `ctx.typert.register(...)` namespace does NOT reach the browser. The
  // Client's whole namespace table is generated at DSH build time and compiled
  // into `@deepseek-ai/dsh-api-remotes` as a literal list of descriptors, each
  // carrying schema factories imported from a shipped package. There is no
  // dynamic proxy, so a third-party namespace is unreachable through
  // `ctx.remote` no matter how it is registered. (The registration itself
  // succeeds — it is simply unaddressable.) That was verified live: the panel
  // rendered and reported `ctx.remote.codexSignin not found`.
  //
  // So the Client half talks to this route instead. It inherits the Harness's
  // own trust checks rather than hand-rolling them: `connection.requestRejection`
  // applies the Host/Origin checks and browser authentication the Web
  // application already uses, and is documented as the way to "apply
  // Connection's Host/Origin checks and browser authentication to another Web
  // route". On top of that every mutating call must be a POST carrying
  // `Content-Type: application/json`, which forces a CORS preflight on any
  // cross-origin caller and so blocks simple form-based CSRF.
  ctx.inject(['webServer'], (webCtx) => {
    const webServer = webCtx.webServer ?? webCtx.get('webServer')
    if (webServer === undefined) return
    // The service is resolved per request, so activation order cannot matter.
    const resolve = () => ctx.get(SERVICE_KEY) ?? service
    webCtx.effect(() => {
      try {
        routeRegistered = true
        return webServer.register({ kind: 'prefix', path: ROUTE_PATH, handler: makeHttpHandler(resolve) })
      } catch (error) {
        routeError = String(error?.message ?? error)
        ctx.logger?.warn?.(`subscription-signin: could not register ${ROUTE_PATH}: ${routeError}`)
        return undefined
      }
    })
  })

  // ---- agent tool ----------------------------------------------------------

  ctx.effect(() => {
    const dispose = ctx.tools.register({
      name: 'subscription_signin',
      description: DESCRIPTION,
      parameters: PARAMETERS,
      output: {
        schema: OUTPUT_SCHEMA,
        render: (_args, value) => [{ type: 'text', text: format(value) }],
      },
      async execute(args) {
        const action = args?.action
        if (typeof action !== 'string' || action.length === 0) {
          throw new Error('subscription_signin: "action" is required')
        }
        if (!ACTIONS.includes(action)) {
          return { ok: false, action, credentialKey: args?.credentialKey ?? defaultKey, message: `Unknown action "${action}".` }
        }
        return dispatch(args)
      },
    })
    return () => {
      if (typeof dispose === 'function') dispose()
      for (const record of attempts.values()) record.controller.abort()
      attempts.clear()
    }
  })
}
