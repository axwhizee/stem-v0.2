// shell 宿主：bash 执行端口的 node 实现。

import { spawn } from 'node:child_process'

export type ShellRunner = {
  readonly run: (
    command: string,
    options?: { cwd?: string; signal?: AbortSignal },
  ) => Promise<{ code: number; stdout: string; stderr: string }>
}

export type NodeShellRunnerOptions = {
  readonly defaultCwd?: string
  readonly timeoutMs?: number
}

export function createNodeShellRunner(opts: NodeShellRunnerOptions = {}): ShellRunner {
  return {
    run(command, options) {
      return new Promise((resolve) => {
        const child = spawn(command, {
          shell: true,
          cwd: options?.cwd ?? opts.defaultCwd ?? process.cwd(),
          signal: options?.signal,
        })
        let stdout = ''
        let stderr = ''
        child.stdout.on('data', (d: Buffer) => {
          stdout += d.toString()
        })
        child.stderr.on('data', (d: Buffer) => {
          stderr += d.toString()
        })
        child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }))
        child.on('error', (e) => resolve({ code: -1, stdout, stderr: e.message }))
      })
    },
  }
}
