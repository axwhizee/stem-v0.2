// agent 类文件装载 —— extension/ 与 .stem/agent/ 同构目录真相。
// 形状：Markdown 前置元数据（name/description/sysPrompt…）+ 正文 = sysPrompt 补充。

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ClassGenes, ToolAccessMap, EffortLevel } from '../../src/core/model/index.ts'
import { parseAccessState } from '../../src/core/model/index.ts'

export type AgentClassFile = {
  readonly name: string
  readonly genes: ClassGenes
  readonly source: string
}

export type LoadIssue = {
  readonly kind: 'class_parse_error'
  readonly file: string
  readonly detail: string
}

/** 解析 `---\n...\n---\n正文`；无 frontmatter 时全文作 sysPrompt，name 取文件名。 */
export function parseAgentClassFile(
  file: string,
  text: string,
): AgentClassFile | LoadIssue {
  const name = file.replace(/\.(md|ts|js|json)$/i, '')
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text)
  if (!m) {
    return {
      name,
      genes: { classRef: name, sysPrompt: text.trim(), description: name },
      source: file,
    }
  }
  const header = m[1] ?? ''
  const body = (m[2] ?? '').trim()
  const fields = parseSimpleYaml(header)
  const tools = parseTools(fields.tools)
  const genes: ClassGenes = {
    classRef: fields.classRef ?? name,
    description: fields.description,
    sysPrompt: fields.sysPrompt ?? (body || undefined),
    ctxStrategy: fields.ctxStrategy,
    tools,
    sendCountdown: num(fields.sendCountdown),
    model: fields.model,
    temperature: num(fields.temperature),
    effort: isEffort(fields.effort) ? fields.effort : undefined,
    maxSteps: num(fields.maxSteps),
  }
  return { name: fields.name ?? name, genes, source: file }
}

function isEffort(v: string | undefined): v is EffortLevel {
  return v === 'none' || v === 'low' || v === 'medium' || v === 'high'
}

function num(v: string | undefined): number | undefined {
  if (v === undefined || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

function parseSimpleYaml(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf(':')
    if (i <= 0) continue
    const k = line.slice(0, i).trim()
    let v = line.slice(i + 1).trim()
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1)
    }
    out[k] = v
  }
  return out
}

/** `tools: { bash: allow, rm: deny }` 或 `tools: {}` */
function parseTools(raw: string | undefined): ToolAccessMap | undefined {
  if (raw === undefined) return undefined
  const body = raw.trim()
  if (body === '{}') return {}
  const inner = /^\{(.*)\}$/.exec(body)?.[1] ?? body
  const map: Record<string, 'hidden' | 'allow' | 'deny'> = {}
  for (const part of inner.split(',')) {
    const [k, v] = part.split(':').map((s) => s.trim())
    if (!k || !v) continue
    const state = parseAccessState(v)
    if (state) map[k] = state
  }
  return map
}

/** 扫描目录：`.md` 类文件；与 `.stem/agent/` 同构。 */
export function loadAgentClassDir(dir: string): {
  readonly classes: readonly AgentClassFile[]
  readonly issues: readonly LoadIssue[]
} {
  if (!existsSync(dir)) return { classes: [], issues: [] }
  const classes: AgentClassFile[] = []
  const issues: LoadIssue[] = []
  for (const f of readdirSync(dir).sort()) {
    if (!/\.(md|json)$/i.test(f)) continue
    const parsed = parseAgentClassFile(f, readFileSync(join(dir, f), 'utf8'))
    if ('kind' in parsed) issues.push(parsed)
    else classes.push(parsed)
  }
  return { classes, issues }
}
