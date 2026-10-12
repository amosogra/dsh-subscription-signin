/**
 * Subscription sign-in — Client half.
 *
 * One settings page, **Subscriptions**: every configured account as a row with
 * its mark and live status. Choosing a row opens that account's sign-in detail.
 * The page is registered once and synchronously; the account list is fetched
 * from the Host, so the rows follow configuration rather than a list here.
 *
 * Every visible string comes from this plugin's locale namespace. The dictionary
 * below is the single source of the English copy: it is registered with the
 * Client locale service when that service is present, and used directly as the
 * fallback when it is not, so the two paths can never drift apart.
 *
 * Driving the Host half happens over the HTTP route it mounts — reads are GETs,
 * mutations are JSON POSTs — because the Harness bridge (`ctx.remote`) is a
 * build-time-generated namespace table that a profile-installed bundle cannot
 * join. The route carries its own trust checks through the Host's
 * `connection.requestRejection`.
 *
 * Plain JavaScript: no JSX, no build step, and no dependency beyond the `react`
 * the browser module table already provides. Per the Harness UI rules this
 * module requires no other Harness Client package, writes its own controls
 * instead of borrowing primitives, and styles only with `--dsw-alias-*` tokens
 * so it follows light and dark.
 */
window.__ModuleLoader__.load({
  id: 'dsh-subscription-signin',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useRef, useState } = React

    /** Poll cadence while an attempt is in flight. */
    const POLL_MS = 2000

    /** Where the Host mounted this plugin's route. */
    const BASE = '/plugins/subscription-signin'

    /** This plugin's locale namespace. */
    const NS = 'subscription-signin'

    /**
     * The English copy, keyed. Registered with the locale service and used as
     * the fallback dictionary, so a page without that service still reads
     * correctly and neither copy can drift from the other.
     */
    const EN = {
      'page.title': 'Subscriptions',
      'page.lead': 'Sign in with a plan you already pay for. The Harness stores the credential; '
        + 'this panel never sees a password.',
      'list.loading': 'Loading configured accounts…',
      'list.empty': "No accounts are configured. Add them to this plugin's accounts list.",
      'list.pending': '…',

      'status.checking': 'Checking…',
      'status.signedIn': 'Signed in — draws on your plan',
      'status.waitingCode': 'Waiting for a pasted code',
      'status.waiting': 'Waiting for approval',
      'status.failed': 'Last attempt failed',
      'status.signedOut': 'Not signed in',
      'status.noFlow': 'No sign-in flow registered',
      'pill.active': 'Active',

      'state.signedIn': 'Signed in',
      'state.waiting': 'Waiting for approval',
      'state.failed': 'Sign-in failed',
      'state.checking': 'Checking…',
      'state.signedOut': 'Signed out',

      'detail.back': '← Subscriptions',
      'detail.noFlow': 'No authorization flow is registered for "{key}". '
        + 'Check that the Harness LLM plugin is mounted.',
      'detail.okLead': 'Your {label} credential now backs this route. Choose which models to expose on the '
        + 'Models page — a plan usually grants a subset of the advertised catalog.',
      'detail.meta': 'credential: {kind} · {key}',
      'detail.signOut': 'Sign out',
      'detail.signOutConfirm': 'Yes, sign out',
      'detail.signOutKeep': 'Keep it',
      'detail.revokeNote': 'Signing out deletes the local credential record. It does not revoke the grant at '
        + 'the vendor — for that, sign out of all sessions in your account settings there.',

      'wait.lead': "Finish signing in on the vendor's own page. Nothing is stored until you approve there.",
      'wait.leadPending': 'The Harness is waiting on the vendor. If it has asked you something, answer it below.',
      'wait.openStep': 'Open the verification page: ',
      'wait.enterCode': 'Enter this code:',
      'wait.copy': 'Copy',
      'wait.copied': 'Copied',
      'wait.open': 'Open verification page ↗',
      'wait.cancel': 'Cancel',
      'wait.manualNote': 'The vendor is waiting for a pasted code. Use this if the browser could not reach '
        + 'the local callback — paste the code, or the whole redirect URL you landed on.',
      'wait.codeLabel': 'Answer',
      'wait.codePlaceholder': 'code or redirect URL',
      'wait.submit': 'Submit',

      'start.lead': 'Use your {label} subscription for this route instead of paying per token. '
        + "You approve on the vendor's own page in your own browser — this panel never receives your "
        + 'password, and the token is written by the Harness credential store.',
      'start.begin': 'Sign in with {label}',
      'start.starting': 'Starting…',
      'start.cancelled': 'Previous attempt cancelled.',

      'error.retry': 'Retry',
      'error.copy': 'Could not copy automatically — select the code and copy it manually.',
      'error.unreachable': 'Could not reach the Harness at {base}: {reason}',
      'error.trust': '{detail} (HTTP {status}) — this is the Harness connection trust check, which also '
        + 'covers browser authentication. Try reloading the page.',
      'error.refused': 'The Harness refused the request (HTTP {status}).',
      'error.malformed': 'The Harness returned a malformed response.',

      'card.signedIn': 'Signed in — this route draws on your plan.',
      'card.signedOut': 'Not signed in — use your plan rather than API credits.',
      'card.signIn': 'Sign in',
      'card.signOut': 'Sign out',
      'card.starting': 'Starting…',
      'card.waiting': 'Waiting for approval',
      'card.open': 'Open page ↗',
      'card.cancel': 'Cancel',
      'card.copy': 'Copy',
      'card.copied': 'Copied',
    }

    const MARKS = {
      'openai-codex':
        'M22.418 9.822a5.903 5.903 0 0 0-.52-4.91 6.1 6.1 0 0 0-2.822-2.513 6.204 6.204 0 0 0-3.78-.389A6.055 6.055 0 0 0 13.232.518 6.129 6.129 0 0 0 10.726 0a6.185 6.185 0 0 0-3.615 1.153A6.052 6.052 0 0 0 4.88 4.187a6.102 6.102 0 0 0-2.344 1.018A6.008 6.008 0 0 0 .828 7.087a5.981 5.981 0 0 0 .754 7.09 5.904 5.904 0 0 0 .52 4.911 6.101 6.101 0 0 0 2.821 2.513 6.205 6.205 0 0 0 3.78.389 6.057 6.057 0 0 0 2.065 1.492 6.13 6.13 0 0 0 2.505.518 6.185 6.185 0 0 0 3.617-1.154 6.052 6.052 0 0 0 2.232-3.035 6.101 6.101 0 0 0 2.343-1.018 6.009 6.009 0 0 0 1.709-1.883 5.981 5.981 0 0 0-.756-7.088Zm-9.143 12.609a4.583 4.583 0 0 1-2.918-1.04c.037-.02.102-.056.144-.081l4.844-2.76a.783.783 0 0 0 .397-.68v-6.738L17.79 12.3a.072.072 0 0 1 .04.055v5.58a4.473 4.473 0 0 1-1.335 3.176 4.596 4.596 0 0 1-3.219 1.321Zm-9.793-4.127a4.432 4.432 0 0 1-.544-3.014c.036.021.099.06.144.085l4.843 2.76a.796.796 0 0 0 .795 0l5.913-3.369V17.1a.071.071 0 0 1-.029.062L9.708 19.95a4.617 4.617 0 0 1-3.458.447 4.556 4.556 0 0 1-2.768-2.093ZM2.208 7.872A4.527 4.527 0 0 1 4.58 5.9l-.002.164v5.52a.768.768 0 0 0 .397.68l5.913 3.369-2.047 1.166a.075.075 0 0 1-.069.006l-4.896-2.792a4.51 4.51 0 0 1-2.12-2.73 4.45 4.45 0 0 1 .452-3.411Zm16.818 3.861-5.913-3.368 2.047-1.166a.074.074 0 0 1 .07-.006l4.896 2.789a4.526 4.526 0 0 1 1.762 1.815 4.448 4.448 0 0 1-.418 4.808 4.556 4.556 0 0 1-2.049 1.494v-5.686a.767.767 0 0 0-.395-.68Zm2.038-3.025a6.874 6.874 0 0 0-.144-.085l-4.843-2.76a.797.797 0 0 0-.796 0L9.368 9.23V6.9a.072.072 0 0 1 .03-.062l4.895-2.787a4.608 4.608 0 0 1 4.885.207 4.51 4.51 0 0 1 1.599 1.955c.333.788.433 1.654.287 2.496ZM8.255 12.865 6.208 11.7a.071.071 0 0 1-.04-.056v-5.58c0-.854.248-1.69.713-2.412a4.54 4.54 0 0 1 1.913-1.658 4.614 4.614 0 0 1 4.85.616c-.037.02-.102.055-.144.08L8.657 5.452a.782.782 0 0 0-.398.68l-.004 6.734ZM9.367 10.5 12.001 9l2.633 1.5v3L12.001 15l-2.634-1.5v-3Z',
      'anthropic':
        'm4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z',
      'github-copilot':
        'M23.922 16.997C23.061 18.492 18.063 22.02 12 22.02 5.937 22.02.939 18.492.078 16.997A.641.641 0 0 1 0 16.741v-2.869a.883.883 0 0 1 .053-.22c.372-.935 1.347-2.292 2.605-2.656.167-.429.414-1.055.644-1.517a10.098 10.098 0 0 1-.052-1.086c0-1.331.282-2.499 1.132-3.368.397-.406.89-.717 1.474-.952C7.255 2.937 9.248 1.98 11.978 1.98c2.731 0 4.767.957 6.166 2.093.584.235 1.077.546 1.474.952.85.869 1.132 2.037 1.132 3.368 0 .368-.014.733-.052 1.086.23.462.477 1.088.644 1.517 1.258.364 2.233 1.721 2.605 2.656a.841.841 0 0 1 .053.22v2.869a.641.641 0 0 1-.078.256Zm-11.75-5.992h-.344a4.359 4.359 0 0 1-.355.508c-.77.947-1.918 1.492-3.508 1.492-1.725 0-2.989-.359-3.782-1.259a2.137 2.137 0 0 1-.085-.104L4 11.746v6.585c1.435.779 4.514 2.179 8 2.179 3.486 0 6.565-1.4 8-2.179v-6.585l-.098-.104s-.033.045-.085.104c-.793.9-2.057 1.259-3.782 1.259-1.59 0-2.738-.545-3.508-1.492a4.359 4.359 0 0 1-.355-.508Zm2.328 3.25c.549 0 1 .451 1 1v2c0 .549-.451 1-1 1-.549 0-1-.451-1-1v-2c0-.549.451-1 1-1Zm-5 0c.549 0 1 .451 1 1v2c0 .549-.451 1-1 1-.549 0-1-.451-1-1v-2c0-.549.451-1 1-1Zm3.313-6.185c.136 1.057.403 1.913.878 2.497.442.544 1.134.938 2.344.938 1.573 0 2.292-.337 2.657-.751.384-.435.558-1.15.558-2.361 0-1.14-.243-1.847-.705-2.319-.477-.488-1.319-.862-2.824-1.025-1.487-.161-2.192.138-2.533.529-.269.307-.437.808-.438 1.578v.021c0 .265.021.562.063.893Zm-1.626 0c.042-.331.063-.628.063-.894v-.02c-.001-.77-.169-1.271-.438-1.578-.341-.391-1.046-.69-2.533-.529-1.505.163-2.347.537-2.824 1.025-.462.472-.705 1.179-.705 2.319 0 1.211.175 1.926.558 2.361.365.414 1.084.751 2.657.751 1.21 0 1.902-.394 2.344-.938.475-.584.742-1.44.878-2.497Z',
      'xai':
        'M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z',
      'kimi-coding':
        'm1.053 16.91 9.538 2.55a21 20.981 0 0 0 .06 2.031l5.956 1.592a12 11.99 0 0 1-15.554-6.172m-1.02-5.79 11.352 3.035a21 20.981 0 0 0-.469 2.01l10.817 2.89a12 11.99 0 0 1-1.845 2.004L.658 15.918a12 11.99 0 0 1-.625-4.796m1.593-5.146L13.573 9.17a21 20.981 0 0 0-1.01 1.874l11.297 3.02a21 20.981 0 0 1-.67 2.362l-11.55-3.087L.125 10.26a12 11.99 0 0 1 1.499-4.285ZM6.067 1.58l11.285 3.016a21 20.981 0 0 0-1.688 1.719l7.824 2.091a21 20.981 0 0 1 .513 2.664L2.107 5.218a12 11.99 0 0 1 3.96-3.638M21.68 4.866 7.222 1.003A12 11.99 0 0 1 21.68 4.866',
      'meta':
        'M6.915 4.03c-1.968 0-3.683 1.28-4.871 3.113C.704 9.208 0 11.883 0 14.449c0 .706.07 1.369.21 1.973a6.624 6.624 0 0 0 .265.86 5.297 5.297 0 0 0 .371.761c.696 1.159 1.818 1.927 3.593 1.927 1.497 0 2.633-.671 3.965-2.444.76-1.012 1.144-1.626 2.663-4.32l.756-1.339.186-.325c.061.1.121.196.183.3l2.152 3.595c.724 1.21 1.665 2.556 2.47 3.314 1.046.987 1.992 1.22 3.06 1.22 1.075 0 1.876-.355 2.455-.843a3.743 3.743 0 0 0 .81-.973c.542-.939.861-2.127.861-3.745 0-2.72-.681-5.357-2.084-7.45-1.282-1.912-2.957-2.93-4.716-2.93-1.047 0-2.088.467-3.053 1.308-.652.57-1.257 1.29-1.82 2.05-.69-.875-1.335-1.547-1.958-2.056-1.182-.966-2.315-1.303-3.454-1.303zm10.16 2.053c1.147 0 2.188.758 2.992 1.999 1.132 1.748 1.647 4.195 1.647 6.4 0 1.548-.368 2.9-1.839 2.9-.58 0-1.027-.23-1.664-1.004-.496-.601-1.343-1.878-2.832-4.358l-.617-1.028a44.908 44.908 0 0 0-1.255-1.98c.07-.109.141-.224.211-.327 1.12-1.667 2.118-2.602 3.358-2.602zm-10.201.553c1.265 0 2.058.791 2.675 1.446.307.327.737.871 1.234 1.579l-1.02 1.566c-.757 1.163-1.882 3.017-2.837 4.338-1.191 1.649-1.81 1.817-2.486 1.817-.524 0-1.038-.237-1.383-.794-.263-.426-.464-1.13-.464-2.046 0-2.221.63-4.535 1.66-6.088.454-.687.964-1.226 1.533-1.533a2.264 2.264 0 0 1 1.088-.285z',
      'openrouter':
        'M16.778 1.844v1.919q-.569-.026-1.138-.032-.708-.008-1.415.037c-1.93.126-4.023.728-6.149 2.237-2.911 2.066-2.731 1.95-4.14 2.75-.396.223-1.342.574-2.185.798-.841.225-1.753.333-1.751.333v4.229s.768.108 1.61.333c.842.224 1.789.575 2.185.799 1.41.798 1.228.683 4.14 2.75 2.126 1.509 4.22 2.11 6.148 2.236.88.058 1.716.041 2.555.005v1.918l7.222-4.168-7.222-4.17v2.176c-.86.038-1.611.065-2.278.021-1.364-.09-2.417-.357-3.979-1.465-2.244-1.593-2.866-2.027-3.68-2.508.889-.518 1.449-.906 3.822-2.59 1.56-1.109 2.614-1.377 3.978-1.466.667-.044 1.418-.017 2.278.02v2.176L24 6.014Z',
    }

    const CSS = `
.dcs-root { max-width: 640px; display: flex; flex-direction: column; gap: 14px; }
.dcs-head { display: flex; align-items: center; gap: 11px; }
.dcs-tile {
  flex: none; width: 34px; height: 34px; border-radius: 9px; display: grid; place-items: center;
  background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1);
  color: var(--dsw-alias-label-primary);
}
.dcs-tile-sm { width: 26px; height: 26px; border-radius: 7px; }
.dcs-mark { display: block; }
.dcs-mono { font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-secondary); }
.dcs-title { font-size: 15px; font-weight: 600; color: var(--dsw-alias-label-primary); margin: 0; }
.dcs-sub { font-size: 13px; line-height: 1.5; color: var(--dsw-alias-label-secondary); margin: 0; }
.dcs-list { display: flex; flex-direction: column; gap: 8px; }
.dcs-item {
  display: flex; align-items: center; gap: 12px; width: 100%; text-align: left; font: inherit;
  cursor: pointer; padding: 11px 13px; border-radius: 10px;
  border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1);
  transition: background .12s ease, border-color .12s ease, transform .1s ease;
}
.dcs-item:hover { background: var(--dsw-alias-bg-layer-2); border-color: var(--dsw-alias-border-l2); }
.dcs-item:active { transform: scale(.996); }
.dcs-item:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.dcs-item-body { display: flex; flex-direction: column; gap: 3px; flex: 1; min-width: 0; }
.dcs-item-label { font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.dcs-item-sub {
  font-size: 12px; color: var(--dsw-alias-label-secondary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dcs-item-end { display: flex; align-items: center; gap: 9px; flex: none; }
.dcs-chev { color: var(--dsw-alias-label-secondary); font-size: 15px; line-height: 1; }
.dcs-back {
  align-self: flex-start; display: inline-flex; align-items: center; gap: 5px; font: inherit;
  font-size: 12px; cursor: pointer; padding: 5px 9px 5px 7px; border-radius: 7px;
  border: 1px solid transparent; background: transparent; color: var(--dsw-alias-label-secondary);
}
.dcs-back:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dcs-back:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.dcs-card {
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
  border-radius: 10px; padding: 16px; display: flex; flex-direction: column; gap: 12px;
}
.dcs-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dcs-pill {
  display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 500;
  padding: 3px 9px 3px 7px; border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-secondary);
}
.dcs-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--dsw-alias-state-idle-primary); }
.dcs-dot-ok { background: var(--dsw-alias-state-success-primary); }
.dcs-dot-wait { background: var(--dsw-alias-state-warn-primary); animation: dcs-pulse 1.4s ease-in-out infinite; }
.dcs-dot-err { background: var(--dsw-alias-state-error-primary); }
@keyframes dcs-pulse { 0%,100% { opacity: 1 } 50% { opacity: .35 } }
.dcs-btn {
  font: inherit; font-size: 13px; line-height: 1; padding: 8px 14px; border-radius: 8px; cursor: pointer;
  border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary); transition: filter .12s ease, opacity .12s ease;
}
.dcs-btn:hover:not(:disabled) { filter: brightness(1.06); }
.dcs-btn:disabled { opacity: .5; cursor: default; }
.dcs-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.dcs-btn-primary {
  background: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); color: #fff;
}
.dcs-btn-danger { color: var(--dsw-alias-state-error-primary); border-color: var(--dsw-alias-state-error-primary); }
.dcs-link { color: var(--dsw-alias-brand-primary); text-decoration: none; font-size: 13px; }
.dcs-link:hover { text-decoration: underline; }
.dcs-code { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.dcs-code-value {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 20px; letter-spacing: .14em;
  font-weight: 600; color: var(--dsw-alias-label-primary); user-select: all;
  padding: 8px 14px; border-radius: 8px; border: 1px dashed var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2);
}
.dcs-steps { margin: 0; padding-left: 18px; font-size: 13px; line-height: 1.7; color: var(--dsw-alias-label-secondary); }
.dcs-error { font-size: 12px; color: var(--dsw-alias-state-error-primary); word-break: break-word; }
.dcs-note { font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-secondary); }
.dcs-meta { font-size: 12px; color: var(--dsw-alias-label-secondary); font-family: ui-monospace, Menlo, monospace; }
.dcs-manual { display: flex; flex-direction: column; gap: 8px; }
.dcs-input {
  font: inherit; font-size: 13px; padding: 7px 10px; border-radius: 8px; min-width: 220px; flex: 1;
  border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
}
.dcs-input:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.dcs-ext {
  display: flex; flex-direction: column; gap: 9px; margin-top: 12px; padding: 10px 12px;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 9px;
  background: var(--dsw-alias-bg-layer-2);
}
.dcs-ext-row {
  display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap;
}
.dcs-ext-main { display: flex; align-items: center; gap: 8px; flex: 1 1 auto; min-width: 0; }
.dcs-ext-label { font-size: 12px; line-height: 1.4; color: var(--dsw-alias-label-secondary); }
.dcs-ext-actions { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; }
.dcs-ext-code {
  font-family: ui-monospace, Menlo, monospace; font-size: 13px; font-weight: 600;
  letter-spacing: .1em; color: var(--dsw-alias-label-primary);
}
.dcs-btn-sm { padding: 5px 10px; font-size: 12px; }
`

    /** The provider segment of a credential key; also the mark's map key. */
    function sectionId(key) {
      const parts = String(key).split('/')
      const last = parts[parts.length - 1]
      return last.length > 0 ? last : 'account'
    }

    /** One letter for a provider with no mark, rather than an invented logo. */
    function initialOf(label, key) {
      const text = String(label === undefined || label === '' ? sectionId(key) : label).trim()
      return text.length > 0 ? text.charAt(0).toUpperCase() : '?'
    }

    /** `{name}` substitution, matching the locale service's own rule exactly. */
    function fill(template, params) {
      if (params === undefined || params === null) return template
      return String(template).replace(/\{(\w+)\}/g, (match, name) => (
        Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
      ))
    }

    /**
     * The plugin's translate function.
     *
     * Registers the dictionary with the Client locale service when it is there,
     * and falls back to the same dictionary when it is not — so the copy has one
     * source either way, and a missing service degrades to readable English
     * rather than to raw keys. The bound function keeps a stable identity per
     * namespace, which is what lets it ride props without defeating memoization.
     */
    function createTranslator(ctx) {
      const fromDictionary = (key, params) => fill(
        Object.prototype.hasOwnProperty.call(EN, key) ? EN[key] : key,
        params,
      )
      const locale = typeof ctx.get === 'function' ? ctx.get('locale') : undefined
      if (locale === undefined || locale === null) return { t: fromDictionary, locale: undefined }
      if (typeof locale.register === 'function') {
        ctx.effect(
          () => locale.register(NS, 'en', EN),
          'subscription-signin: english dictionary',
        )
      }
      if (typeof locale.bind !== 'function') return { t: fromDictionary, locale }
      try {
        const bound = locale.bind(NS)
        return { t: (key, params) => fill(bound(key), params), locale }
      } catch (cause) {
        return { t: fromDictionary, locale }
      }
    }

    /**
     * Call the Host half.
     *
     * Reads are GET; mutations are JSON POSTs, which the Host insists on — the
     * JSON content type makes any cross-origin caller survive a CORS preflight,
     * on top of the Harness's own Host/Origin trust checks.
     */
    function makeCaller(t) {
      return async function call(method, args) {
        const isRead = method === 'state' || method === 'diagnostics' || method === 'accounts'
        // Reads carry the account in the query string; mutations carry it in the body.
        const query = isRead && args !== undefined && typeof args.key === 'string' && args.key.length > 0
          ? `?key=${encodeURIComponent(args.key)}`
          : ''
        let response
        try {
          response = await fetch(`${BASE}/${method}${query}`, {
            method: isRead ? 'GET' : 'POST',
            headers: isRead ? { accept: 'application/json' } : { 'content-type': 'application/json' },
            body: isRead ? undefined : JSON.stringify(args === undefined ? {} : args),
            credentials: 'same-origin',
            cache: 'no-store',
          })
        } catch (cause) {
          throw new Error(t('error.unreachable', {
            base: BASE,
            reason: cause && cause.message ? cause.message : cause,
          }))
        }
        let payload = null
        try {
          payload = await response.json()
        } catch (cause) {
          payload = null
        }
        if (!response.ok) {
          const detail = payload && payload.error
          if (response.status === 401 || response.status === 403) {
            throw new Error(t('error.trust', {
              detail: detail || t('error.refused', { status: response.status }),
              status: response.status,
            }))
          }
          throw new Error(detail || t('error.refused', { status: response.status }))
        }
        if (payload === null) throw new Error(t('error.malformed'))
        return payload
      }
    }

    /**
     * A provider's mark, or a monogram tile when no vector could be verified.
     * Artwork only: it carries nothing the label does not already say.
     */
    function Mark(props) {
      const small = props.small === true
      const size = small ? 15 : 19
      const path = MARKS[props.markKey]
      return h('span', { className: `dcs-tile${small ? ' dcs-tile-sm' : ''}`, 'aria-hidden': 'true' },
        path === undefined
          ? h('span', { className: 'dcs-mono' }, initialOf(props.label, props.markKey))
          : h('svg', {
            className: 'dcs-mark', width: size, height: size, viewBox: '0 0 24 24',
            fill: 'currentColor', focusable: 'false',
          }, h('path', { d: path })),
      )
    }

    function Pill(props) {
      const tone = props.tone === undefined ? '' : props.tone
      return h('span', { className: 'dcs-pill' },
        h('span', { className: `dcs-dot ${tone}` }),
        props.children,
      )
    }

    function Button(props) {
      const variant = props.variant === undefined ? '' : props.variant
      return h('button', {
        type: 'button',
        className: `dcs-btn ${variant}`.trim(),
        onClick: props.onClick,
        disabled: props.disabled === true,
      }, props.children)
    }

    /** Human status for one account, from its `state` payload. */
    function describeStatus(data, t) {
      if (data === null || data === undefined) return { text: t('status.checking'), tone: '' }
      if (data.flowLabel === undefined) return { text: t('status.noFlow'), tone: 'dcs-dot-err' }
      if (data.credentialKind !== undefined) return { text: t('status.signedIn'), tone: 'dcs-dot-ok' }
      if (data.status === 'starting') {
        return {
          text: t(data.awaitingCode === true ? 'status.waitingCode' : 'status.waiting'),
          tone: 'dcs-dot-wait',
        }
      }
      if (data.status === 'error') return { text: t('status.failed'), tone: 'dcs-dot-err' }
      return { text: t('status.signedOut'), tone: '' }
    }

    /**
     * The settings page: the list, or one account's detail.
     *
     * Built per apply so the components close over this run's translate function
     * and caller rather than reaching for module state.
     */
    function makePanel(call, t) {
      /** The per-account sign-in detail. */
      function AccountDetail(props) {
        const account = props.account
        const [data, setData] = useState(null)
        const [error, setError] = useState(null)
        const [busy, setBusy] = useState(false)
        const [copied, setCopied] = useState(false)
        const [confirmingOut, setConfirmingOut] = useState(false)
        const [manualCode, setManualCode] = useState('')
        const alive = useRef(true)

        useEffect(() => () => { alive.current = false }, [])

        const refresh = useCallback(async () => {
          try {
            const next = await call('state', { key: account.key })
            if (alive.current) setData(next)
            return next
          } catch (cause) {
            if (alive.current) setError(String(cause && cause.message ? cause.message : cause))
            return null
          }
        }, [account.key])

        useEffect(() => { refresh() }, [refresh])

        const waiting = Boolean(data) && data.credentialKind === undefined && data.status === 'starting'

        // Poll only while an attempt is live.
        useEffect(() => {
          if (!waiting) return undefined
          const timer = setInterval(() => { refresh() }, POLL_MS)
          return () => { clearInterval(timer) }
        }, [waiting, refresh])

        const run = useCallback(async (method, args) => {
          setBusy(true)
          setError(null)
          setCopied(false)
          try {
            const next = await call(method, { ...(args === undefined ? {} : args), key: account.key })
            if (!alive.current) return
            if (next && next.ok === false && next.error) setError(String(next.error))
            setData(next)
          } catch (cause) {
            if (alive.current) setError(String(cause && cause.message ? cause.message : cause))
          } finally {
            if (alive.current) setBusy(false)
          }
        }, [account.key])

        const copyCode = useCallback(async () => {
          const code = data && data.code
          if (!code) return
          try {
            await navigator.clipboard.writeText(code)
            setCopied(true)
          } catch (cause) {
            setError(t('error.copy'))
          }
        }, [data])

        const signedIn = Boolean(data) && data.credentialKind !== undefined
        const status = data ? data.status : 'loading'
        const tone = signedIn ? 'dcs-dot-ok' : waiting ? 'dcs-dot-wait' : status === 'error' ? 'dcs-dot-err' : ''
        const label = signedIn ? t('state.signedIn')
          : waiting ? t('state.waiting')
            : status === 'error' ? t('state.failed')
              : data === null ? t('state.checking')
                : t('state.signedOut')

        const children = []
        children.push(h(Pill, { key: 'pill', tone }, label))

        if (data && data.flowLabel === undefined) {
          children.push(h('p', { key: 'noflow', className: 'dcs-error' },
            t('detail.noFlow', { key: data.credentialKey ?? account.key })))
        }

        if (signedIn) {
          children.push(h('p', { key: 'ok', className: 'dcs-sub' },
            t('detail.okLead', { label: account.label })))
          children.push(h('div', { key: 'meta', className: 'dcs-meta' },
            t('detail.meta', { kind: data.credentialKind, key: data.credentialKey })))
          children.push(h('div', { key: 'actions', className: 'dcs-row' },
            confirmingOut
              ? [
                h(Button, {
                  key: 'yes',
                  variant: 'dcs-btn-danger',
                  disabled: busy,
                  onClick: () => { setConfirmingOut(false); run('signout', { confirm: true }) },
                }, t('detail.signOutConfirm')),
                h(Button, {
                  key: 'no',
                  disabled: busy,
                  onClick: () => setConfirmingOut(false),
                }, t('detail.signOutKeep')),
              ]
              : h(Button, {
                key: 'out',
                variant: 'dcs-btn-danger',
                disabled: busy,
                onClick: () => setConfirmingOut(true),
              }, t('detail.signOut')),
          ))
          children.push(h('p', { key: 'revoke', className: 'dcs-note' }, t('detail.revokeNote')))
        } else if (waiting) {
          const url = data.url
          children.push(h('p', { key: 'lead', className: 'dcs-sub' },
            url === undefined ? t('wait.leadPending') : t('wait.lead')))
          if (url !== undefined) {
            children.push(h('ol', { key: 'steps', className: 'dcs-steps' },
              h('li', null, t('wait.openStep'),
                h('a', { className: 'dcs-link', href: url, target: '_blank', rel: 'noreferrer noopener' }, url)),
              data.code === undefined ? null : h('li', null, t('wait.enterCode')),
            ))
          }
          if (data.code) {
            children.push(h('div', { key: 'code', className: 'dcs-code' },
              h('span', { className: 'dcs-code-value' }, data.code),
              h(Button, { onClick: copyCode, disabled: busy }, copied ? t('wait.copied') : t('wait.copy')),
            ))
          }
          children.push(h('div', { key: 'actions', className: 'dcs-row' },
            url === undefined ? null : h('a', {
              key: 'open',
              className: 'dcs-link',
              href: url,
              target: '_blank',
              rel: 'noreferrer noopener',
            }, t('wait.open')),
            h(Button, { key: 'cancel', disabled: busy, onClick: () => run('cancel') }, t('wait.cancel')),
          ))
          if (data.awaitingCode === true) {
            // Ask what the flow actually asked, rather than assuming a pasted
            // code: a blocking question (Copilot's Enterprise domain) and the
            // racing paste fallback both arrive as text.
            const asked = data.prompt
            children.push(h('div', { key: 'manual', className: 'dcs-manual' },
              h('p', { className: 'dcs-note' }, asked ? asked.message : t('wait.manualNote')),
              h('div', { className: 'dcs-row' },
                h('input', {
                  className: 'dcs-input',
                  type: 'text',
                  value: manualCode,
                  spellCheck: false,
                  'aria-label': asked ? asked.message : t('wait.codeLabel'),
                  placeholder: asked && asked.placeholder ? asked.placeholder : t('wait.codePlaceholder'),
                  onChange: (event) => setManualCode(event.target.value),
                }),
                h(Button, {
                  disabled: busy || manualCode.trim().length === 0,
                  onClick: async () => {
                    await run('submitCode', { code: manualCode })
                    setManualCode('')
                  },
                }, t('wait.submit')),
              ),
            ))
          }
        } else {
          children.push(h('p', { key: 'lead', className: 'dcs-sub' },
            t('start.lead', { label: account.label })))
          children.push(h('div', { key: 'actions', className: 'dcs-row' },
            h(Button, { variant: 'dcs-btn-primary', disabled: busy, onClick: () => run('begin') },
              busy ? t('start.starting') : t('start.begin', { label: account.label })),
            status === 'cancelled'
              ? h('span', { key: 'c', className: 'dcs-note' }, t('start.cancelled'))
              : null,
          ))
        }

        if (error) {
          children.push(h('div', { key: 'err' },
            h('p', { className: 'dcs-error' }, error),
            h(Button, { onClick: () => { setError(null); refresh() } }, t('error.retry')),
          ))
        }

        return h('div', { className: 'dcs-root' },
          h('button', { type: 'button', className: 'dcs-back', onClick: props.onBack }, t('detail.back')),
          h('div', { className: 'dcs-head' },
            h(Mark, { label: account.label, markKey: sectionId(account.key) }),
            h('div', { className: 'dcs-item-body' },
              h('h2', { className: 'dcs-title' }, account.label),
              h('p', { className: 'dcs-sub' }, account.key),
            ),
          ),
          h('div', { className: 'dcs-card' }, children),
        )
      }

      /** The account list, each row carrying live status. */
      function SubscriptionList(props) {
        const [accounts, setAccounts] = useState(null)
        const [states, setStates] = useState({})
        const [error, setError] = useState(null)
        const alive = useRef(true)

        useEffect(() => () => { alive.current = false }, [])

        useEffect(() => {
          ;(async () => {
            try {
              const answer = await call('accounts')
              const list = answer !== null && Array.isArray(answer.accounts) ? answer.accounts : []
              if (!alive.current) return
              setAccounts(list)
              const pairs = await Promise.all(list.map(async (entry) => {
                try {
                  return [entry.key, await call('state', { key: entry.key })]
                } catch (cause) {
                  return [entry.key, null]
                }
              }))
              if (alive.current) setStates(Object.fromEntries(pairs))
            } catch (cause) {
              if (alive.current) setError(String(cause && cause.message ? cause.message : cause))
            }
          })()
        }, [])

        const rows = []
        if (error !== null) {
          rows.push(h('p', { key: 'err', className: 'dcs-error' }, error))
        } else if (accounts === null) {
          rows.push(h('p', { key: 'loading', className: 'dcs-note' }, t('list.loading')))
        } else if (accounts.length === 0) {
          rows.push(h('p', { key: 'none', className: 'dcs-note' }, t('list.empty')))
        } else {
          for (const entry of accounts) {
            const known = Object.prototype.hasOwnProperty.call(states, entry.key)
            const info = describeStatus(known ? states[entry.key] : undefined, t)
            rows.push(h('button', {
              key: entry.key,
              type: 'button',
              className: 'dcs-item',
              onClick: () => props.onSelect(entry),
            },
            h(Mark, { label: entry.label, markKey: sectionId(entry.key) }),
            h('span', { className: 'dcs-item-body' },
              h('span', { className: 'dcs-item-label' }, entry.label),
              h('span', { className: 'dcs-item-sub' }, info.text),
            ),
            h('span', { className: 'dcs-item-end' },
              h(Pill, { tone: info.tone }, known ? t('pill.active') : t('list.pending')),
              h('span', { className: 'dcs-chev', 'aria-hidden': 'true' }, '›'),
            )))
          }
        }

        return h('div', { className: 'dcs-root' },
          h('div', { className: 'dcs-head' },
            h('div', { className: 'dcs-item-body' },
              h('h2', { className: 'dcs-title' }, t('page.title')),
              h('p', { className: 'dcs-sub' }, t('page.lead')),
            ),
          ),
          h('div', { className: 'dcs-list' }, rows),
        )
      }

      return function SubscriptionsPanel() {
        const [selected, setSelected] = useState(null)
        if (selected !== null) {
          return h(AccountDetail, { account: selected, onBack: () => setSelected(null) })
        }
        return h(SubscriptionList, { onSelect: setSelected })
      }
    }

    /**
     * The provider-card extension: the same state, compact, on a provider row of
     * Settings → Models.
     *
     * That slot is keyed by the provider's settings namespace, which every pi-ai
     * provider shares, so it is dispatched on each of their cards. The route id
     * decides whether there is anything to say, and the split between the outer
     * filter and `CardBody` keeps hooks unconditional per instance.
     */
    function makeCard(call, t) {
      function CardBody(props) {
        const key = `llm-pi-ai/${props.routeId}`
        const [account, setAccount] = useState(undefined)
        const [data, setData] = useState(null)
        const [error, setError] = useState(null)
        const [busy, setBusy] = useState(false)
        const [copied, setCopied] = useState(false)
        const alive = useRef(true)

        useEffect(() => () => { alive.current = false }, [])

        // Offer sign-in only on routes this plugin is actually configured for.
        useEffect(() => {
          call('accounts').then((answer) => {
            if (!alive.current) return
            const list = answer !== null && Array.isArray(answer.accounts) ? answer.accounts : []
            setAccount(list.find((entry) => entry.key === key) ?? null)
          }).catch(() => { if (alive.current) setAccount(null) })
        }, [key])

        const refresh = useCallback(async () => {
          try {
            const next = await call('state', { key })
            if (alive.current) setData(next)
            return next
          } catch (cause) {
            if (alive.current) setError(String(cause && cause.message ? cause.message : cause))
            return null
          }
        }, [key])

        useEffect(() => {
          if (account === undefined || account === null) return
          refresh()
        }, [account, refresh])

        const waiting = Boolean(data) && data.credentialKind === undefined && data.status === 'starting'

        useEffect(() => {
          if (!waiting) return undefined
          const timer = setInterval(() => { refresh() }, POLL_MS)
          return () => { clearInterval(timer) }
        }, [waiting, refresh])

        const run = useCallback(async (method, args) => {
          setBusy(true)
          setError(null)
          setCopied(false)
          try {
            const next = await call(method, { ...(args === undefined ? {} : args), key })
            if (!alive.current) return
            if (next && next.ok === false && next.error) setError(String(next.error))
            setData(next)
          } catch (cause) {
            if (alive.current) setError(String(cause && cause.message ? cause.message : cause))
          } finally {
            if (alive.current) setBusy(false)
          }
        }, [key])

        const copyCode = useCallback(async () => {
          const code = data && data.code
          if (!code) return
          try {
            await navigator.clipboard.writeText(code)
            setCopied(true)
          } catch (cause) {
            setError(t('error.copy'))
          }
        }, [data])

        // Still loading, or a route this plugin does not manage.
        if (account === undefined || account === null) return null

        const signedIn = Boolean(data) && data.credentialKind !== undefined
        const status = data ? data.status : 'loading'
        const main = []
        const actions = []

        if (signedIn) {
          main.push(h(Pill, { key: 'pill', tone: 'dcs-dot-ok' }, account.label))
          main.push(h('span', { key: 'txt', className: 'dcs-ext-label' }, t('card.signedIn')))
          actions.push(h('button', {
            key: 'out',
            type: 'button',
            className: 'dcs-btn dcs-btn-danger dcs-btn-sm',
            disabled: busy,
            onClick: () => run('signout', { confirm: true }),
          }, t('card.signOut')))
        } else if (waiting) {
          main.push(h(Pill, { key: 'pill', tone: 'dcs-dot-wait' }, t('card.waiting')))
          if (data.code) {
            main.push(h('span', { key: 'code', className: 'dcs-ext-code' }, data.code))
            actions.push(h('button', {
              key: 'copy', type: 'button', className: 'dcs-btn dcs-btn-sm', onClick: copyCode,
            }, copied ? t('card.copied') : t('card.copy')))
          }
          if (data.url !== undefined) {
            actions.push(h('a', {
              key: 'open',
              className: 'dcs-link',
              href: data.url,
              target: '_blank',
              rel: 'noreferrer noopener',
            }, t('card.open')))
          }
          actions.push(h('button', {
            key: 'cancel', type: 'button', className: 'dcs-btn dcs-btn-sm', disabled: busy,
            onClick: () => run('cancel'),
          }, t('card.cancel')))
        } else {
          main.push(h(Pill, { key: 'pill', tone: status === 'error' ? 'dcs-dot-err' : '' }, account.label))
          main.push(h('span', { key: 'txt', className: 'dcs-ext-label' }, t('card.signedOut')))
          actions.push(h('button', {
            key: 'in',
            type: 'button',
            className: 'dcs-btn dcs-btn-primary dcs-btn-sm',
            disabled: busy,
            onClick: () => run('begin'),
          }, busy ? t('card.starting') : t('card.signIn')))
        }

        return h('div', { className: 'dcs-ext' },
          h('div', { className: 'dcs-ext-row' },
            h('div', { className: 'dcs-ext-main' }, main),
            h('div', { className: 'dcs-ext-actions' }, actions),
          ),
          error === null ? null : h('p', { className: 'dcs-error' }, error),
        )
      }

      return function SubscriptionProviderCard(props) {
        const entry = props === undefined ? undefined : props.provider
        const routeId = entry === undefined ? undefined : entry.provider
        if (typeof routeId !== 'string' || routeId.length === 0) return null
        return h(CardBody, { routeId })
      }
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const { t } = createTranslator(ctx)
        const call = makeCaller(t)

        // One stylesheet for every surface this plugin draws on, registered as a
        // resource and removed with the plugin. Component-local style elements
        // were the wrong shape here: the provider card renders on the Models
        // page, where the settings page may never have mounted, so its markup
        // arrived completely unstyled — run-together text and invisible dots.
        ctx.effect(() => {
          if (typeof document === 'undefined') return () => {}
          const element = document.createElement('style')
          element.setAttribute('data-dsh-plugin', NS)
          element.textContent = CSS
          document.head.appendChild(element)
          return () => { element.remove() }
        }, 'subscription-signin: stylesheet')

        // Registered synchronously: one page, with the account list fetched by
        // the component itself. A late registration renders a section whose
        // content never appears, which is a confusing failure to debug.
        const Panel = makePanel(call, t)
        ctx.slots.inject('settings.section', () => ctx.slots.register(
          { name: 'settings.section', id: NS, order: 12, label: t('page.title') },
          Panel,
        ))

        // Keyed by the provider's settings namespace, which every pi-ai provider
        // shares; the card confirms per route whether it has anything to say.
        const Card = makeCard(call, t)
        ctx.slots.inject('settings.models.provider-card', () => ctx.slots.register(
          { name: 'settings.models.provider-card', key: 'llm-pi-ai' },
          Card,
        ))
      },
    }
  },
})
