// 遥测只读查询 —— 事件/工具痕迹摘要。

import type { ToolCapability } from '../../tools/types.ts'
import { toolOk } from '../../tools/output.ts'

export type TelemetryPort = {
  readonly recent?: () => readonly string[]
}

export function createTelemetryQueryTool(port: TelemetryPort = {}): ToolCapability {
  return {
    name: 'telemetry_query',
    description: 'Query recent system telemetry lines',
    kind: 'internal',
    registerAccess: 'hidden',
    parameters: {
      type: 'object',
      properties: { limit: { type: 'number' } },
    },
    execute: (input: unknown) => {
      const limit = ((input as { limit?: number })?.limit ?? 20) as number
      const lines = port.recent?.() ?? []
      return toolOk(lines.slice(-limit).join('\n') || '(no telemetry)')
    },
  }
}
