// extension 扩展：文件写/改/搜。

import { writeFileSync, readFileSync, mkdirSync, globSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { toolOk, toolError, type ToolCapability } from '../../src/core/tools/index.ts'

const SCAN_CAP = 200

export function createWriteTool(): ToolCapability {
  return {
    name: 'write',
    description: 'Write a UTF-8 text file (creates parent dirs)',
    kind: 'extension',
    registerAccess: 'hidden',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['path', 'content'],
    },
    execute: (input: unknown) => {
      const args = (input ?? {}) as { path?: string; content?: string }
      if (!args.path) return toolError('path required', 'invalid_args')
      try {
        mkdirSync(dirname(args.path), { recursive: true })
        writeFileSync(args.path, args.content ?? '', 'utf8')
        return toolOk(`wrote ${args.path}`)
      } catch (e) {
        return toolError(e instanceof Error ? e.message : 'write failed', 'execution_failed')
      }
    },
  }
}

export function createEditTool(): ToolCapability {
  return {
    name: 'edit',
    description: 'Replace an exact string in a text file (must match exactly once)',
    kind: 'extension',
    registerAccess: 'hidden',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        oldText: { type: 'string' },
        newText: { type: 'string' },
      },
      required: ['path', 'oldText', 'newText'],
    },
    execute: (input: unknown) => {
      const args = (input ?? {}) as { path?: string; oldText?: string; newText?: string }
      if (!args.path || args.oldText === undefined) {
        return toolError('path/oldText required', 'invalid_args')
      }
      try {
        const text = readFileSync(args.path, 'utf8')
        const parts = text.split(args.oldText)
        const hits = parts.length - 1
        if (hits === 0) return toolError('oldText not found', 'not_found')
        if (hits > 1) {
          return toolError(`oldText must be unique (found ${hits})`, 'invalid_args')
        }
        writeFileSync(args.path, parts.join(args.newText ?? ''), 'utf8')
        return toolOk('edited')
      } catch (e) {
        return toolError(e instanceof Error ? e.message : 'edit failed', 'execution_failed')
      }
    },
  }
}

export function createGrepTool(): ToolCapability {
  return {
    name: 'grep',
    description: 'Search file contents by regex (or literal) under a directory',
    kind: 'extension',
    registerAccess: 'hidden',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'regex; wrap /.../ for explicit regex, else literal substring' },
        dir: { type: 'string' },
      },
      required: ['pattern'],
    },
    execute: (input: unknown) => {
      const args = (input ?? {}) as { pattern?: string; dir?: string }
      if (!args.pattern) return toolError('pattern required', 'invalid_args')
      const root = args.dir ?? process.cwd()
      const matcher = compilePattern(args.pattern)
      if (matcher instanceof Error) return toolError(matcher.message, 'invalid_args')
      try {
        const files = globSync('**/*.{ts,tsx,js,jsx,mjs,cjs,md,json,jsonc,txt,yml,yaml,css,html}', {
          cwd: root,
        })
        const hits: string[] = []
        for (const f of files.slice(0, SCAN_CAP)) {
          if (isIgnoredPath(f)) continue
          try {
            const text = readFileSync(join(root, f), 'utf8')
            if (matcher.test(text)) hits.push(f)
          } catch {
            // skip binary/unreadable
          }
        }
        return toolOk(hits.join('\n') || '(no hits)')
      } catch (e) {
        return toolError(e instanceof Error ? e.message : 'grep failed', 'execution_failed')
      }
    },
  }
}

export function createGlobTool(): ToolCapability {
  return {
    name: 'glob',
    description: 'List files under a directory by glob pattern',
    kind: 'extension',
    registerAccess: 'hidden',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string' },
        dir: { type: 'string' },
      },
      required: ['pattern'],
    },
    execute: (input: unknown) => {
      const args = (input ?? {}) as { pattern?: string; dir?: string }
      if (!args.pattern) return toolError('pattern required', 'invalid_args')
      try {
        const files = globSync(args.pattern, { cwd: args.dir ?? process.cwd() })
        const kept = files.filter((f) => !isIgnoredPath(f))
        return toolOk(kept.slice(0, SCAN_CAP).join('\n') || '(none)')
      } catch (e) {
        return toolError(e instanceof Error ? e.message : 'glob failed', 'execution_failed')
      }
    },
  }
}

/** `/re/flags` → RegExp；否则按字面子串转义。 */
function compilePattern(pattern: string): RegExp | Error {
  const wrapped = pattern.match(/^\/(.*)\/([gimsuy]*)$/)
  if (wrapped) {
    try {
      return new RegExp(wrapped[1] ?? '', wrapped[2]?.replace('g', '') ?? '')
    } catch (e) {
      return e instanceof Error ? e : new Error('invalid regex')
    }
  }
  return new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
}

function isIgnoredPath(rel: string): boolean {
  return /(^|\/)(node_modules|\.stem|dist)(\/|$)/.test(rel.replace(/\\/g, '/'))
}
