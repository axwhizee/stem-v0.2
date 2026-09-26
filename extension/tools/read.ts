// extension 扩展：文件读工具（对 core 的能力补充）。

import { readFileSync, existsSync, statSync } from 'node:fs'
import { toolOk, toolError, type ToolCapability } from '../../src/core/tools/index.ts'

export function createReadTool(): ToolCapability {
  return {
    name: 'read',
    description: 'Read a UTF-8 text file',
    kind: 'extension',
    registerAccess: 'hidden',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'absolute or cwd-relative path' },
      },
      required: ['path'],
    },
    execute: (input: unknown) => {
      const path = (input as { path?: string }).path
      if (!path) return toolError('path required', 'invalid_args')
      try {
        if (!existsSync(path)) return toolError(`not found: ${path}`, 'not_found')
        if (statSync(path).isDirectory()) return toolError(`is directory: ${path}`, 'is_directory')
        return toolOk(readFileSync(path, 'utf8'))
      } catch (e) {
        return toolError(e instanceof Error ? e.message : 'read failed', 'execution_failed')
      }
    },
  }
}
