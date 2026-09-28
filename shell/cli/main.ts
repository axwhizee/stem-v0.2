// CLI 参考壳 —— 终端对话；空间 = cwd 或位置参数。
// pilot.callTool 暴露 user#0 完整工具面（与普通 agent 同权）。

import { createInterface } from 'node:readline/promises'
import { bootStem, resolveProjectRoot } from '../host/index.ts'

async function main(): Promise<void> {
  const projectRoot = resolveProjectRoot()
  const boot = await bootStem({
    projectRoot,
    onEvent: (e) => {
      if (e.type === 'stream' && e.event.type === 'text-delta') process.stdout.write(e.event.text)
      if (e.type === 'stream' && e.event.type === 'finish') process.stdout.write('\n')
      if (e.type === 'error') console.error(`\n[error] ${e.message}`)
    },
  })
  console.log(`stem shell @ ${projectRoot}`)
  console.log('输入对话；/quit 退出，/agents 查看实例，/tools 列出工具，/tool <name> <json> 调用工具。')

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  for (;;) {
    const line = (await rl.question('> ')).trim()
    if (!line) continue
    if (line === '/quit') break
    if (line === '/agents') {
      const node = boot.system.lineage.get(boot.pilot.actAs)
      console.log(JSON.stringify(node?.attrs, null, 2))
      continue
    }
    if (line === '/tools') {
      const names = boot.system.tools.names()
      for (const n of names) {
        const t = boot.system.tools.get(n)
        console.log(`- ${n}  [${t?.registerAccess ?? '?'}]  ${t?.description ?? ''}`)
      }
      continue
    }
    if (line.startsWith('/tool ')) {
      const rest = line.slice(6).trim()
      const sp = rest.indexOf(' ')
      const name = sp < 0 ? rest : rest.slice(0, sp)
      const argText = sp < 0 ? '{}' : rest.slice(sp + 1).trim()
      let input: unknown = {}
      try {
        input = argText ? JSON.parse(argText) : {}
      } catch {
        console.error('参数需为 JSON 对象，例：/tool bash {"command":"echo hi"}')
        continue
      }
      const r = await boot.pilot.callTool(name, input)
      console.log(JSON.stringify(r, null, 2))
      continue
    }
    await boot.pilot.send(line)
    // 等合并窗口 + 轮结束：简单等待一小段，真正 UI 靠事件流
    await new Promise((r) => setTimeout(r, 50))
  }
  rl.close()
  await boot.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
