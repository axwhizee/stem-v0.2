// 统一输出成形：成功与失败同入口，避免各工具各说各话。

import type { ToolResult } from './types.ts'

const MAX_CONTENT = 8000

export function toolOk(content: string, data?: unknown): ToolResult {
  return { kind: 'tool_ok', content: clip(content), data }
}

export function toolError(
  content: string,
  code?: string,
  data?: unknown,
): ToolResult {
  return { kind: 'tool_error', content: clip(content), code, data }
}

/** 领域错误原样透传；非结构化异常收口为 execution_failed。 */
export function fromThrown(error: unknown, fallback: string): ToolResult {
  if (
    typeof error === 'object' &&
    error !== null &&
    'kind' in error &&
    typeof (error as { kind: unknown }).kind === 'string'
  ) {
    const e = error as { kind: string; message?: string }
    return toolError(e.message ?? e.kind, e.kind, e)
  }
  const message = error instanceof Error ? error.message : fallback
  return toolError(message, 'execution_failed', error)
}

export function clip(text: string): string {
  return text.length <= MAX_CONTENT ? text : text.slice(0, MAX_CONTENT) + '\n…'
}
