// extension 扩展：网络工具。

import { toolOk, toolError, type ToolCapability } from '../../src/core/tools/index.ts'

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
