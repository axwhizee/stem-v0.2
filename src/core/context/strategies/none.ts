// none —— 面板态：不形成 agent 快照。

import type { ContextStrategy, OrchestrateResult } from '../types.ts'

export function createNoneStrategy(): ContextStrategy {
  return {
    name: 'none',
    orchestrate(): OrchestrateResult {
      return { messages: [] }
    },
    note: undefined,
  }
}
