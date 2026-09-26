// CLI 参考壳 —— 终端对话；空间 = cwd 或位置参数。

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
  console.log('输入对话，/quit 退出，/agents 查看族谱。')

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  for (;;) {
    const line = (await rl.question('> ')).trim()
    if (!line) continue
    if (line === '/quit') break
    if (line === '/agents') {
      const root = boot.system.lineage.get(
        boot.pilot.actAs
      )
      console.log(JSON.stringify(root?.attrs, null, 2))
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
