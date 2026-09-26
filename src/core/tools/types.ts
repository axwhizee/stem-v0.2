// 工具领域类型 —— 模型唯一的行动面；能力先成工具才可被调用。

import type { AccessState } from '../model/index.ts'
import type { LogSink } from '../logging/index.ts'

export type ToolKind = 'internal' | 'extension' | 'custom'

export type ToolPropertySchema = {
  readonly type: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'null'
  readonly description?: string
  readonly enum?: readonly (string | number)[]
  readonly items?: ToolPropertySchema
}

export type ToolParametersSchema = {
  readonly type: 'object'
  readonly properties: Readonly<Record<string, ToolPropertySchema>>
  readonly required?: readonly string[]
  readonly [key: string]: unknown
}

export type ToolInvocation = {
  readonly id: string
  readonly name: string
  readonly input: unknown
}

/** init 期文件窄口；execute 不可再得。 */
export type ToolInitFs = {
  readonly listFiles: (dir: string) => Promise<readonly string[]>
  readonly readText: (file: string) => Promise<string>
}

export type ToolInitContext = {
  readonly fs?: ToolInitFs
  readonly projectRoot?: string
  readonly log?: LogSink
  /** 仅 drain 期间有效：init 可追加注册 */
  readonly registerMore: (tool: ToolCapability) => void
}

export type ToolContext = {
  readonly agentId: string
  readonly callId?: string
  readonly signal?: AbortSignal
}

export type ToolResult =
  | { readonly kind: 'tool_ok'; readonly content: string; readonly data?: unknown }
  | { readonly kind: 'tool_error'; readonly content: string; readonly code?: string; readonly data?: unknown }

export type ToolCapability = {
  readonly name: string
  readonly description: string
  readonly kind: ToolKind
  readonly parameters: ToolParametersSchema
  /** 注册声明：收敛链全局封顶 */
  readonly registerAccess: AccessState
  readonly init?: (ctx: ToolInitContext) => void | Promise<void>
  readonly execute: (input: unknown, ctx: ToolContext) => ToolResult | Promise<ToolResult>
  readonly dispose?: () => void | Promise<void>
}

export type ToolPhase = 'called' | 'success' | 'error'

export type ToolEvent = {
  readonly phase: ToolPhase
  readonly name: string
  readonly agentId: string
  readonly callId?: string
  readonly result?: ToolResult
  readonly error?: unknown
}

export type ToolEventSink = {
  readonly emit: (event: ToolEvent) => void
}

export type ExecuteIssue =
  | { readonly kind: 'tool_not_found'; readonly name: string }
  | { readonly kind: 'tool_access_denied'; readonly name: string; readonly state: AccessState }
  | { readonly kind: 'tool_invalid_args'; readonly name: string; readonly detail: string }
  | { readonly kind: 'tool_execution_failed'; readonly name: string; readonly detail: string }
