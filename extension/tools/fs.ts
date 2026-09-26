// extension 扩展：文件写/改/搜。

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { globSync } from 'node:fs'
import { toolOk, toolError, type ToolCapability } from '../../src/core/tools/index.ts'

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
    description: 'Replace an exact string in a text file',
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
      if (!args.path || args.oldText === undefined) return toolError('path/oldText required', 'invalid_args')
      try {
        const text = readFileSync(args.path, 'utf8')
        if (!text.includes(args.oldText)) return toolError('oldText not found', 'not_found')
        writeFileSync(args.path, text.split(args.oldText).join(args.newText ?? ''), 'utf8')
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
    description: 'Search file contents for a substring under a directory',
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
      const root = args.dir ?? process.cwd()
      try {
        const files = globSync('**/*.{ts,js,md,json,jsonc,txt}', { cwd: root })
        const hits: string[] = []
        for (const f of files.slice(0, 200)) {
          try {
            const text = readFileSync(join(root, f), 'utf8')
            if (text.includes(args.pattern)) hits.push(f)
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
        return toolOk(files.slice(0, 200).join('\n') || '(none)')
      } catch (e) {
        return toolError(e instanceof Error ? e.message : 'glob failed', 'execution_failed')
      }
    },
  }
}

export function createSkillTool(): ToolCapability {
  return {
    name: 'skill',
    description: 'Load a skill document (progressive disclosure stub)',
    kind: 'extension',
    registerAccess: 'hidden',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    },
    execute: (input: unknown) => {
      const name = String((input as { name?: string })?.name ?? '')
      if (!name || name.includes('/') || name.includes('\\')) {
        return toolError('invalid skill name', 'invalid_args')
      }
      return toolOk(`skill:${name} (stub — body loader pending)`)
    },
  }
}

export function createWebfetchTool(): ToolCapability {
  return {
    name: 'webfetch',
    description: 'Fetch a URL and return text (first 4k)',
    kind: 'extension',
    registerAccess: 'hidden',
    parameters: {
      type: 'object',
      properties: { url: { type: 'string' } },
      required: ['url'],
    },
    execute: async (input: unknown) => {
      const url = String((input as { url?: string })?.url ?? '')
      if (!/^https?:\/\//.test(url)) return toolError('invalid url', 'invalid_args')
      try {
        const res = await fetch(url)
        const text = await res.text()
        return toolOk(text.slice(0, 4000))
      } catch (e) {
        return toolError(e instanceof Error ? e.message : 'fetch failed', 'execution_failed')
      }
    },
  }
}

export function createWebsearchTool(): ToolCapability {
  return {
    name: 'websearch',
    description: 'Web search stub (returns query echo)',
    kind: 'extension',
    registerAccess: 'hidden',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
    execute: (input: unknown) => {
      const q = String((input as { query?: string })?.query ?? '')
      return toolOk(`search-stub: ${q}`)
    },
  }
}
