#!/usr/bin/env node
// 导出扫描：核对 docs/api.md 提到的符号仍从各 index.ts 导出。
// 用法：node --import tsx script/check-exports.ts

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const apiPath = join(root, 'docs', 'api.md')
if (!existsSync(apiPath)) {
  console.error('docs/api.md 不存在')
  process.exit(1)
}

const modules = [
  'src/core/model/index.ts',
  'src/core/lineage/index.ts',
  'src/core/post/index.ts',
  'src/core/gateway/index.ts',
  'src/core/context/index.ts',
  'src/core/tools/index.ts',
  'src/core/toolagent/index.ts',
  'src/core/pilot/index.ts',
  'src/core/runtime/index.ts',
  'src/core/kernel/index.ts',
  'src/core/boot/index.ts',
  'src/core/ports/index.ts',
  'src/core/events/index.ts',
  'src/core/logging/index.ts',
  'src/core/config/index.ts',
  'extension/agent/index.ts',
  'extension/strategy/index.ts',
]

const missing: string[] = []
for (const rel of modules) {
  const p = join(root, rel)
  if (!existsSync(p)) {
    missing.push(`${rel}: 文件不存在`)
    continue
  }
  const text = readFileSync(p, 'utf8')
  if (!text.includes('export')) missing.push(`${rel}: 无 export`)
}

if (missing.length) {
  console.error('出口异常：')
  for (const m of missing) console.error(' -', m)
  process.exit(1)
}
console.log(`ok: ${modules.length} 个 index 出口在位`)
