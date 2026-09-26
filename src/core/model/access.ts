// 权限代数 —— hidden | allow | deny（architecture 3.6.2）。
// hidden = 尚未启用（可抬升为 allow）；deny = 锁死，不可逆。
// 无 ask。收敛只紧不松：deny 吸收，allow 可抬 hidden。

export type AccessState = 'hidden' | 'allow' | 'deny'

export type AccessIssue = {
  readonly kind: 'access_illegal_transition'
  readonly from: AccessState
  readonly to: AccessState
}

/** raise 只抬 hidden→allow；deny/allow 粘滞。 */
export function raiseAccess(current: AccessState, declared: AccessState): AccessState {
  if (current === 'hidden' && declared === 'allow') return 'allow'
  return current
}

/** 链上收敛：deny 吸收；allow 抬起 hidden；否则保持 hidden。 */
export function convergeAccess(states: readonly AccessState[]): AccessState {
  let out: AccessState = 'hidden'
  for (const s of states) {
    if (s === 'deny') return 'deny'
    if (s === 'allow') out = 'allow'
  }
  return out
}

export function canTransition(from: AccessState, to: AccessState): boolean {
  if (from === to || to === 'deny') return true
  return from === 'hidden' && to === 'allow'
}

export function transitionAccess(from: AccessState, to: AccessState): AccessState | AccessIssue {
  if (canTransition(from, to)) return to
  return { kind: 'access_illegal_transition', from, to }
}

export const isExecutable = (s: AccessState): boolean => s === 'allow'
export const isModelVisible = (s: AccessState): boolean => s === 'allow'

export function parseAccessState(value: unknown): AccessState | undefined {
  return value === 'hidden' || value === 'allow' || value === 'deny' ? value : undefined
}
