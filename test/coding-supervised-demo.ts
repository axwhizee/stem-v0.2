// coding 监督 demo：脚本化网关指挥 agent 走 watch → edit → 回复。
// 用法：node --import tsx test/coding-supervised-demo.ts
// 目的：验证实时域投影、滚动失效、工具轮，收集测试经验。

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bootStem } from '../shell/host/index.ts'
import type { LLMEvent, ModelGateway } from '../src/core/gateway/index.ts'
import type { PilotEvent } from '../src/core/events/index.ts'
import { CODING_SLOT_PREFIX } from '../extension/strategy/coding.ts'
import { ROOT_AGENT_ID } from '../src/core/model/index.ts'
import { isKernelIssue } from '../src/core/kernel/index.ts'

/** 脚本化轮次：每轮由「已见工具结果」决定下一步。 */
function scriptedGateway(script: LLMEvent[][]): ModelGateway {
  let round = 0
  return {
    async *chat() {
      const events = script[Math.min(round, script.length - 1)] ?? []
      round++
      for (const e of events) yield e
    },
  }
}

function extractToolNames(events: PilotEvent[]): string[] {
  const names: string[] = []
  for (const e of events) {
    if (e.type === 'tool' && e.phase === 'called') names.push(e.tool)
  }
  return names
}

async function main(): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'stem-coding-demo-'))
  const fileRel = 'src/add.ts'
  const fileAbs = join(root, fileRel)
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(
    fileAbs,
    `export function add(a: number, b: number): number {\n  return a + b\n}\n`,
    'utf8',
  )

  const log: PilotEvent[] = []
  const script: LLMEvent[][] = [
    // 轮1：看树 + watch 文件
    [
      { type: 'tool-call', id: 'c1', name: 'tree', input: { path: root, depth: 2 } },
      { type: 'tool-call', id: 'c2', name: 'coding_watch', input: { path: fileRel, mode: 'full', maxLines: 50 } },
      { type: 'finish', reason: 'tool_calls' },
    ],
    // 轮2：编辑文件（触发实时域刷新）
    [
      {
        type: 'tool-call',
        id: 'c3',
        name: 'edit',
        input: {
          path: fileAbs,
          oldText: 'return a + b',
          newText: 'return a + b + 0',
        },
      },
      { type: 'finish', reason: 'tool_calls' },
    ],
    // 轮3：汇报
    [
      {
        type: 'text-delta',
        text: '已完成：tree 查看目录，coding_watch 纳入 add.ts，edit 修改加法实现。实时域应显示最新文件快照。',
      },
      { type: 'finish', reason: 'stop' },
    ],
  ]

  mkdirSync(join(root, '.stem'), { recursive: true })
  writeFileSync(
    join(root, '.stem', 'stem.jsonc'),
    JSON.stringify({
      user: {
        model: 'demo/none',
        tools: {
          tree: 'allow',
          coding_watch: 'allow',
          coding_unwatch: 'allow',
          coding_mode: 'allow',
          coding_status: 'allow',
          read: 'allow',
          write: 'allow',
          edit: 'allow',
        },
      },
      extensions: {
        tools: {
          tree: 'allow',
          read: 'allow',
          write: 'allow',
          edit: 'allow',
          bash: 'allow',
        },
        strategy: { coding: { keepTail: 2 } },
      },
    }),
    'utf8',
  )

  const boot = await bootStem({
    projectRoot: root,
    stateStore: false,
    gateway: scriptedGateway(script),
    onEvent: (e) => log.push(e),
    timer: {
      set: (_ms, fn) => {
        const t = setTimeout(fn, 5)
        return () => clearTimeout(t)
      },
    },
  })

  // 配 coding 策略的 worker
  const reg = boot.system.kernel.registerClass({
    name: 'coder',
    genes: {
      classRef: 'coder',
      description: 'coding worker',
      sysPrompt: 'You are a coding agent. Use tree/coding_watch; keep snapshots fresh.',
      model: 'demo/none',
      ctxStrategy: 'coding',
      tools: {
        tree: 'allow',
        coding_watch: 'allow',
        coding_unwatch: 'allow',
        coding_status: 'allow',
        coding_mode: 'allow',
        read: 'allow',
        write: 'allow',
        edit: 'allow',
      },
      sendCountdown: 0,
    },
  })
  if (reg) {
    console.error('registerClass failed', reg)
    process.exitCode = 1
    await boot.close()
    rmSync(root, { recursive: true, force: true })
    return
  }

  const inst = await boot.system.kernel.instantiate({
    className: 'coder',
    userPrompt: 'Please inspect the project and make the add() function safer (document the edge case of overflow).',
    name: 'coder-1',
    parentId: ROOT_AGENT_ID,
  })
  if (isKernelIssue(inst)) {
    console.error('instantiate failed', inst)
    process.exitCode = 1
    await boot.close()
    rmSync(root, { recursive: true, force: true })
    return
  }
  const agentId = inst.id
  console.log(`[demo] agent=${agentId} root=${root}`)

  // pump 投递
  await new Promise((r) => setTimeout(r, 80))

  const box = boot.system.post.boxOf(agentId)
  console.log(`[debug] box=${box.length} valid=${box.filter((e) => e.valid).length}`)
  for (const e of box) {
    console.log(`[debug] env ${e.id} ${e.message.kind} valid=${e.valid}`)
  }
  const node = boot.system.lineage.get(agentId)
  console.log(`[debug] ctxStrategy=${node?.attrs.ctxStrategy}`)

  const snap = boot.system.pipeline.snapshot(agentId)
  console.log(`[debug] snap=${snap.length}`)
  const slotMsgs = snap.filter(
    (m) => m.toolCallId?.startsWith(CODING_SLOT_PREFIX) || m.toolCalls?.some((c) => c.id.startsWith(CODING_SLOT_PREFIX)),
  )
  console.log('--- tools called ---')
  console.log(extractToolNames(log).join(' → '))
  console.log(`--- snapshot messages: ${snap.length}, domain slots: ${slotMsgs.length} ---`)
  for (const m of snap) {
    if (m.kind === 'tool' && m.toolCallId?.startsWith(CODING_SLOT_PREFIX)) {
      const body = m.content.map((p) => (p.type === 'text' ? p.text : '')).join('')
      console.log(`[slot ${m.toolCallId}]\n${body.split('\n').slice(0, 8).join('\n')}`)
    }
    if (m.kind === 'user') {
      const t = m.content.map((p) => (p.type === 'text' ? p.text : '')).join('')
      console.log(`[user] ${t.slice(0, 80)}…`)
    }
    if (m.kind === 'assistant' && !m.toolCalls?.length) {
      const t = m.content.map((p) => (p.type === 'text' ? p.text : '')).join('')
      if (t) console.log(`[assistant] ${t.slice(0, 120)}`)
    }
  }

  const disk = readFileSync(fileAbs, 'utf8')
  console.log('--- file on disk ---')
  console.log(disk)

  await boot.close()
  rmSync(root, { recursive: true, force: true })
  console.log('[demo] ok')
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
