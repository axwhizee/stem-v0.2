// 类文件写回 —— 运行期创建/更新的 custom 类落盘 `.stem/agent/`（目录即真相）。

import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ClassGenes, ToolAccessMap } from '../../src/core/model/index.ts'

export function serializeAgentClass(name: string, genes: ClassGenes, body?: string): string {
  const lines: string[] = ['---', `name: ${name}`]
  if (genes.description) lines.push(`description: ${genes.description}`)
  if (genes.classRef && genes.classRef !== name) lines.push(`classRef: ${genes.classRef}`)
  if (genes.ctxStrategy) lines.push(`ctxStrategy: ${genes.ctxStrategy}`)
  if (genes.model) lines.push(`model: ${genes.model}`)
  if (genes.sendCountdown !== undefined) lines.push(`sendCountdown: ${genes.sendCountdown}`)
  if (genes.temperature !== undefined) lines.push(`temperature: ${genes.temperature}`)
  if (genes.effort) lines.push(`effort: ${genes.effort}`)
  if (genes.maxSteps !== undefined) lines.push(`maxSteps: ${genes.maxSteps}`)
  if (genes.tools) lines.push(`tools: ${formatTools(genes.tools)}`)
  lines.push('---')
  const prompt = body ?? genes.sysPrompt ?? ''
  return lines.join('\n') + '\n' + prompt + '\n'
}

function formatTools(map: ToolAccessMap): string {
  const parts = Object.entries(map).map(([k, v]) => `${k}: ${v}`)
  return `{ ${parts.join(', ')} }`
}

/** 写入 stem 空间 agent 目录；下次 boot 由发现段读入。 */
export function writeAgentClassFile(agentDir: string, name: string, genes: ClassGenes, body?: string): string {
  if (!existsSync(agentDir)) mkdirSync(agentDir, { recursive: true })
  const file = join(agentDir, `${name}.md`)
  writeFileSync(file, serializeAgentClass(name, genes, body), 'utf8')
  return file
}
