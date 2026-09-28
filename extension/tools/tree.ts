// extension 扩展：目录树列表 —— 路径/深度/行数/大小，辅助 coding 实时域选型。

import { readdirSync, statSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { toolOk, toolError, type ToolCapability } from '../../src/core/tools/index.ts'

const MAX_ENTRIES = 400

export function createTreeTool(): ToolCapability {
  return {
    name: 'tree',
    description:
      'List a directory tree with file sizes and line counts. Use before coding_watch to choose path/mode/maxLines.',
    kind: 'extension',
    registerAccess: 'hidden',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'root directory; default cwd' },
        depth: { type: 'number', description: 'max depth; default 2' },
        glob: { type: 'string', description: 'substring filter on relative path' },
      },
    },
    execute: (input: unknown) => {
      const args = (input ?? {}) as { path?: string; depth?: number; glob?: string }
      const root = args.path ?? process.cwd()
      const maxDepth = Number.isFinite(args.depth) ? Math.max(0, args.depth as number) : 2
      try {
        const lines: string[] = []
        walk(root, root, 0, maxDepth, args.glob ?? '', lines)
        return toolOk(lines.slice(0, MAX_ENTRIES).join('\n') || '(empty)')
      } catch (e) {
        return toolError(e instanceof Error ? e.message : 'tree failed', 'execution_failed')
      }
    },
  }
}

function walk(root: string, dir: string, depth: number, maxDepth: number, filter: string, out: string[]): void {
  if (out.length >= MAX_ENTRIES) return
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  entries.sort()
  for (const name of entries) {
    if (out.length >= MAX_ENTRIES) return
    if (name === 'node_modules' || name === '.git' || name === '.stem' || name === 'dist') continue
    const full = join(dir, name)
    const rel = relative(root, full).split(sep).join('/')
    if (filter && !rel.includes(filter)) {
      let isDir = false
      try {
        isDir = statSync(full).isDirectory()
      } catch {
        continue
      }
      if (!isDir || depth >= maxDepth) continue
    }
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    const pad = '  '.repeat(depth)
    if (st.isDirectory()) {
      out.push(`${pad}${name}/`)
      if (depth < maxDepth) walk(root, full, depth + 1, maxDepth, filter, out)
    } else {
      const lines = countLines(full)
      out.push(`${pad}${name}  ${st.size}B  ${lines}L`)
    }
  }
}

function countLines(path: string): number {
  try {
    const text = readFileSync(path, 'utf8')
    if (text.length === 0) return 0
    const lines = text.split('\n')
    // 去掉末尾空行（POSIX 文本约定）
    if (lines[lines.length - 1] === '') lines.pop()
    return lines.length
  } catch {
    return -1
  }
}
