// extension 扩展：bash 工具（对外操作面，注册声明可收紧）。

import type { ToolCapability, ToolContext } from '../../src/core/tools/index.ts'
import { toolOk, toolError } from '../../src/core/tools/index.ts'
import type { ShellRunner } from '../../shell/host/bash.ts'

export function createBashTool(runner: ShellRunner): ToolCapability {
  return {
    name: 'bash',
    description: 'Run a shell command',
    kind: 'extension',
    registerAccess: 'allow',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        cwd: { type: 'string' },
      },
      required: ['command'],
    },
    execute: async (input: unknown, ctx: ToolContext) => {
      const args = input as { command?: string; cwd?: string }
      if (!args.command) return toolError('command required', 'invalid_args')
      const r = await runner.run(args.command, {
        ...(args.cwd ? { cwd: args.cwd } : {}),
        ...(ctx.signal ? { signal: ctx.signal } : {}),
      })
      if (r.code !== 0) return toolError(r.stderr || `exit ${r.code}`, 'exit_nonzero')
      return toolOk(r.stdout)
    },
  }
}
