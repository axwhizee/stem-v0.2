// extension 扩展：MCP 客户端 —— 外部工具服务器的投影与转发。
// 机制在本文件，定义住 .stem/mcp.jsonc（mcpServers）。
// 密钥 {env:NAME}；init 连接投影 → drain 追加 → 冻结；execute 转发 tools/call。

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { toolOk, toolError, type ToolCapability } from '../../src/core/tools/index.ts'

export type McpServerConfig = {
  /** stdio：命令 */
  readonly command?: string
  readonly args?: readonly string[]
  readonly env?: Readonly<Record<string, string>>
  readonly cwd?: string
  /** http / sse */
  readonly type?: 'http' | 'sse'
  readonly url?: string
  readonly headers?: Readonly<Record<string, string>>
  readonly enabled?: boolean
  /** 投影工具注册声明 */
  readonly access?: 'hidden' | 'allow' | 'deny'
}

export type McpConfig = {
  readonly mcpServers: Readonly<Record<string, McpServerConfig>>
}

export type McpParseIssue = {
  readonly kind: 'mcp_config_error'
  readonly detail: string
}

export function parseMcpConfig(text: string): McpConfig | McpParseIssue {
  try {
    const raw = JSON.parse(stripJsonComments(text)) as Record<string, unknown>
    const servers = raw?.mcpServers
    if (!servers || typeof servers !== 'object') {
      return { kind: 'mcp_config_error', detail: 'mcpServers required' }
    }
    return { mcpServers: servers as Record<string, McpServerConfig> }
  } catch (error) {
    return {
      kind: 'mcp_config_error',
      detail: error instanceof Error ? error.message : 'invalid json',
    }
  }
}

/** `{env:NAME}` → 环境变量值；未定义则原样保留。 */
export function resolveEnvRefs(value: string, env: NodeJS.ProcessEnv = process.env): string {
  return value.replace(/\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g, (match, name: string) =>
    env[name] !== undefined ? env[name]! : match,
  )
}

type JsonRpcResponse = {
  jsonrpc?: string
  id?: number | string
  result?: unknown
  error?: { code?: number; message?: string }
}

type McpToolDesc = {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

abstract class McpSession {
  abstract request(method: string, params?: Record<string, unknown>): Promise<unknown>
  abstract close(): Promise<void>
}

class StdioMcpSession extends McpSession {
  #child: ChildProcessWithoutNullStreams
  #nextId = 1
  #pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  #buffer = ''

  constructor(child: ChildProcessWithoutNullStreams) {
    super()
    this.#child = child
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      this.#buffer += chunk
      let nl = this.#buffer.indexOf('\n')
      while (nl >= 0) {
        const line = this.#buffer.slice(0, nl).trim()
        this.#buffer = this.#buffer.slice(nl + 1)
        if (line) this.#onLine(line)
        nl = this.#buffer.indexOf('\n')
      }
    })
    child.on('exit', () => {
      for (const [, p] of this.#pending) p.reject(new Error('mcp process exited'))
      this.#pending.clear()
    })
  }

  #onLine(line: string): void {
    let msg: JsonRpcResponse
    try {
      msg = JSON.parse(line) as JsonRpcResponse
    } catch {
      return
    }
    if (msg.id === undefined) return
    const pending = this.#pending.get(Number(msg.id))
    if (!pending) return
    this.#pending.delete(Number(msg.id))
    if (msg.error) pending.reject(new Error(msg.error.message ?? 'mcp error'))
    else pending.resolve(msg.result)
  }

  async request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const id = this.#nextId++
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject })
      this.#child.stdin.write(payload)
    })
  }

  async close(): Promise<void> {
    for (const [, p] of this.#pending) p.reject(new Error('mcp session closed'))
    this.#pending.clear()
    this.#child.stdin.end()
    this.#child.kill()
  }
}

class HttpMcpSession extends McpSession {
  #url: string
  #headers: Record<string, string>
  #nextId = 1

  constructor(url: string, headers: Record<string, string>) {
    super()
    this.#url = url
    this.#headers = headers
  }

  async request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const id = this.#nextId++
    const res = await fetch(this.#url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...this.#headers },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    })
    const msg = (await res.json()) as JsonRpcResponse
    if (msg.error) throw new Error(msg.error.message ?? 'mcp error')
    return msg.result
  }

  async close(): Promise<void> {
    // HTTP 无长连接会话
  }
}

async function openSession(name: string, cfg: McpServerConfig, env: NodeJS.ProcessEnv): Promise<McpSession> {
  if (cfg.type === 'http' || cfg.type === 'sse') {
    const url = resolveEnvRefs(cfg.url ?? '', env)
    if (!url) throw new Error(`mcp ${name}: url required`)
    const headers: Record<string, string> = {}
    for (const [k, v] of Object.entries(cfg.headers ?? {})) {
      headers[k] = resolveEnvRefs(v, env)
    }
    return new HttpMcpSession(url, headers)
  }
  const command = resolveEnvRefs(cfg.command ?? '', env)
  if (!command) throw new Error(`mcp ${name}: command required`)
  const args = (cfg.args ?? []).map((a) => resolveEnvRefs(a, env))
  const childEnv: NodeJS.ProcessEnv = { ...env }
  for (const [k, v] of Object.entries(cfg.env ?? {})) {
    childEnv[k] = resolveEnvRefs(v, env)
  }
  const child = spawn(command, [...args], {
    cwd: cfg.cwd,
    env: childEnv,
    stdio: ['pipe', 'pipe', 'pipe'],
  }) as ChildProcessWithoutNullStreams
  await new Promise<void>((resolve, reject) => {
    child.once('spawn', () => resolve())
    child.once('error', reject)
  })
  return new StdioMcpSession(child)
}

export type McpLoadResult = {
  readonly tools: readonly ToolCapability[]
  readonly issues: readonly string[]
  readonly dispose: () => Promise<void>
}

/** 连接已启用服务器并投影工具；单项失败 issue 留痕，不炸启动。 */
export async function loadMcpTools(
  servers: Readonly<Record<string, McpServerConfig>>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<McpLoadResult> {
  const tools: ToolCapability[] = []
  const issues: string[] = []
  const sessions: McpSession[] = []

  for (const [name, cfg] of Object.entries(servers)) {
    if (cfg.enabled === false) continue
    try {
      const session = await openSession(name, cfg, env)
      sessions.push(session)
      await session.request('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'stem-mcp', version: '0.1.0' },
      })
      const listed = (await session.request('tools/list')) as { tools?: McpToolDesc[] }
      for (const desc of listed.tools ?? []) {
        tools.push(projectTool(name, session, desc, cfg.access))
      }
    } catch (error) {
      issues.push(`mcp ${name}: ${error instanceof Error ? error.message : 'connect failed'}`)
    }
  }

  return {
    tools,
    issues,
    dispose: async () => {
      for (const s of sessions) await s.close()
    },
  }
}

function projectTool(
  server: string,
  session: McpSession,
  desc: McpToolDesc,
  access: McpServerConfig['access'],
): ToolCapability {
  return {
    name: desc.name,
    description: `[mcp:${server}] ${desc.description ?? ''}`,
    kind: 'extension',
    registerAccess: access ?? 'hidden',
    parameters: (desc.inputSchema ?? { type: 'object' }) as ToolCapability['parameters'],
    execute: async (input: unknown) => {
      try {
        const result = await session.request('tools/call', {
          name: desc.name,
          arguments: (input ?? {}) as Record<string, unknown>,
        })
        return toolOk(typeof result === 'string' ? result : JSON.stringify(result))
      } catch (e) {
        return toolError(e instanceof Error ? e.message : 'mcp call failed', 'execution_failed')
      }
    },
  }
}

function stripJsonComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}
