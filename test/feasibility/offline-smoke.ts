// 离线冒烟：FakeGateway 走通 pilot → 管道 → Runtime → 写回。
// 用法：node --import tsx test/feasibility/offline-smoke.ts

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSystem } from '../../src/core/boot/index.ts'
import { DefaultRuntime } from '../../src/core/runtime/index.ts'
import { FakeGateway, textEvents } from '../../src/core/gateway/index.ts'
import { allowAll, ToolCapabilityRegistry, toolOk, type ToolCapability } from '../../src/core/tools/index.ts'
import { createPilot } from '../../src/core/pilot/index.ts'
import { makeTextMessage, ROOT_AGENT_ID } from '../../src/core/model/index.ts'
import type { TimerPort } from '../../src/core/post/index.ts'

const space = mkdtempSync(join(tmpdir(), 'stem-smoke-'))
const timer: TimerPort = { set: (ms, fn) => { const t = setTimeout(fn, Math.min(ms, 10)); return () => clearTimeout(t) } }

const ping: ToolCapability = {
  name: 'ping',
  description: 'ping',
  kind: 'extension',
  parameters: { type: 'object', properties: {} },
  registerAccess: 'allow',
  execute: () => toolOk('pong'),
}

const events: string[] = []
const gw = new FakeGateway(() => textEvents('【冒烟】链路已通：邮局 → 策略 → 网关 → 写回。'))

let runtime!: DefaultRuntime

const system = await createSystem({
  gateway: gw,
  timer,
  access: allowAll(),
  tools: [ping],
  logSink: { write: (e) => events.push(`${e.level}:${e.message}`) },
  onDelivery: (d) => {
    void runtime.processDelivery(d)
  },
})

runtime = new DefaultRuntime({
  gateway: gw,
  tools: system.tools,
  access: allowAll(),
  post: system.post,
  events: system.events,
  snapshotOf: (id) => system.pipeline.snapshot(id),
  materializeTools: (id) => system.tools.materialize(id, allowAll()),
  parseModel: (s) => {
    const i = s.indexOf('/')
    return { provider: s.slice(0, i), id: s.slice(i + 1) }
  },
  modelOf: () => 'fake/smoke',
  systemOf: () => undefined,
  maxStepsOf: () => 4,
})

system.events.on((e) => {
  if (e.type === 'stream') events.push(`stream:${e.text}`)
  if (e.type === 'letter') events.push(`letter:${e.agentId}`)
})

const pilot = createPilot({
  send: async (as, text) => {
    await system.pipeline.enter(
      {
        id: `u-${Date.now()}`,
        agentId: as,
        at: Date.now(),
        valid: true,
        turn: 0,
        indexInTurn: 0,
        from: 'user',
        message: makeTextMessage('user', text),
      },
      'user_prompt',
    )
  },
  peek: (as) => system.post.boxOf(as).map((e) => e.message),
})

console.log('== stem offline smoke ==')
console.log('space:', space)
console.log('init issues:', system.init.issues)

await pilot.send('你好，做一次端到端冒烟')
// 等合并窗口 + 轮
await new Promise((r) => setTimeout(r, 50))
// 若 onDelivery 未接 runtime，这里手动跑一轮
if (system.post.boxOf(ROOT_AGENT_ID).length < 2) {
  await runtime.processDelivery({ agentId: ROOT_AGENT_ID, reason: 'manual', envelopes: [] })
}

const box = system.post.boxOf(ROOT_AGENT_ID)
console.log('mailbox kinds:', box.map((e) => e.message.kind).join(' → '))
for (const e of box) {
  const text = e.message.content.map((p) => (p.type === 'text' ? p.text : '')).join('')
  console.log(`- [${e.message.kind}] ${text.slice(0, 80)}`)
}
console.log('events:', events.slice(0, 12).join(' | '))
console.log('tools:', system.tools.names().join(', '))
const snap = system.pipeline.snapshot(ROOT_AGENT_ID)
console.log('snapshot length:', snap.length)
await system.dispose()
console.log('== smoke done ==')
