// 全量功能测试：内建 + extension 工具与 classic/none/cortex 策略。
// 只验可调用与回写形状，不追求模型效果。

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bootStem } from '../../shell/host/index.ts'
import { createSystem } from '../../src/core/boot/index.ts'
import {
  createClassicStrategy,
  createNoneStrategy,
} from '../../src/core/post/index.ts'
import { createCortexStrategy } from '../../extension/strategy/index.ts'
import { createReadTool } from '../../extension/tools/read.ts'
import { createBashTool } from '../../extension/tools/bash.ts'
import { createNodeShellRunner } from '../../shell/host/bash.ts'
import { FakeGateway, textEvents, type LLMEvent } from '../../src/core/gateway/index.ts'
import { allowAll, type ToolCapability, type ToolResult } from '../../src/core/tools/index.ts'
import {
  createMailSendTool,
  createMailListTool,
  createAgentClassCreateTool,
  createAgentClassUpdateTool,
  createAgentClassListTool,
  createAgentInstantiateTool,
  createAgentUpdateTool,
  createAgentInspectTool,
} from '../../src/core/tools/internal/index.ts'
import { writeAgentClassFile } from '../../extension/agent/writeAgentClass.ts'
import {
  makeAgentID,
  makeTextMessage,
  ROOT_AGENT_ID,
  validateSequence,
} from '../../src/core/model/index.ts'
import type { TimerPort } from '../../src/core/post/index.ts'
import type { Kernel } from '../../src/core/kernel/index.ts'

function timer(): TimerPort {
  return {
    set(ms, fn) {
      const t = setTimeout(fn, Math.min(ms, 15))
      return () => clearTimeout(t)
    },
  }
}

function ok(result: unknown): ToolResult {
  assert.ok(typeof result === 'object' && result !== null && 'kind' in result)
  const r = result as ToolResult
  return r
}

describe('全量工具与策略功能', () => {
  let space = ''
  let boot: Awaited<ReturnType<typeof bootStem>>

  before(async () => {
    space = mkdtempSync(join(tmpdir(), 'stem-tools-'))
    mkdirSync(join(space, '.stem', 'agent'), { recursive: true })
    writeFileSync(
      join(space, '.stem', 'stem.jsonc'),
      JSON.stringify({
        user: { model: 'fake/demo' },
        extensions: {
          tools: {
            read: 'allow', write: 'allow', edit: 'allow', grep: 'allow', glob: 'allow',
            tree: 'allow', bash: 'allow', webfetch: 'allow', websearch: 'allow', skill: 'allow',
          },
          strategy: { cortex: {} },
        },
      }),
      'utf8',
    )
    boot = await bootStem({
      projectRoot: space,
      stateStore: false,
      fakeGateway: true,
      timer: timer(),
    })
  })

  after(async () => {
    await boot.close()
  })

  it('read / bash', async () => {
    const file = join(space, 'hello.txt')
    writeFileSync(file, 'file-body', 'utf8')
    const read = createReadTool()
    const r1 = ok(await read.execute({ path: file }, { agentId: '0' }))
    assert.equal(r1.kind, 'tool_ok')
    assert.ok(r1.kind === 'tool_ok' && r1.content.includes('file-body'))

    const bash = createBashTool(createNodeShellRunner({ defaultCwd: space }))
    const r2 = ok(await bash.execute({ command: 'echo tool-bash-ok' }, { agentId: '0' }))
    assert.equal(r2.kind, 'tool_ok')
    assert.ok(r2.kind === 'tool_ok' && r2.content.includes('tool-bash-ok'))
  })

  it('mail_send / mail_list', async () => {
    const post = boot.system.post
    const send = createMailSendTool({ post })
    const list = createMailListTool({ post })
    const r1 = ok(
      await send.execute(
        { to: '1', text: 'hello-child' },
        { agentId: '0', callId: 'm1' },
      ),
    )
    // 目标可能未实例化：允许 access_denied 或 sent
    assert.ok(r1.kind === 'tool_ok' || r1.kind === 'tool_error')
    const r2 = ok(await list.execute({ limit: 5 }, { agentId: '0' }))
    assert.equal(r2.kind, 'tool_ok')
  })

  it('agent_class_create / update / list', async () => {
    const kernel: Kernel = boot.system.kernel
    const agentDir = join(space, '.stem', 'agent')
    const persist = (name: string, genes: Parameters<typeof writeAgentClassFile>[2]) =>
      writeAgentClassFile(agentDir, name, genes)
    const create = createAgentClassCreateTool({ getKernel: () => kernel, persist })
    const update = createAgentClassUpdateTool({ getKernel: () => kernel, persist })
    const list = createAgentClassListTool({ getKernel: () => kernel })

    const r1 = ok(
      await create.execute(
        {
          name: 'tester',
          sysPrompt: 'test class',
          model: 'fake/demo',
          tools: { bash: 'allow' },
        },
        { agentId: '0' },
      ),
    )
    assert.equal(r1.kind, 'tool_ok')
    assert.ok(existsSync(join(agentDir, 'tester.md')))

    const r2 = ok(await update.execute({ name: 'tester', sysPrompt: 'updated' }, { agentId: '0' }))
    assert.equal(r2.kind, 'tool_ok')
    assert.ok(readFileSync(join(agentDir, 'tester.md'), 'utf8').includes('updated'))

    const r3 = ok(await list.execute({}, { agentId: '0' }))
    assert.ok(r3.kind === 'tool_ok' && r3.content.includes('tester'))
  })

  it('agent_instantiate / update / inspect', async () => {
    const kernel = boot.system.kernel
    const inst = createAgentInstantiateTool({ getKernel: () => kernel })
    const upd = createAgentUpdateTool({ getKernel: () => kernel })
    const ins = createAgentInspectTool({ getKernel: () => kernel })

    const r1 = ok(
      await inst.execute(
        { className: 'tester', userPrompt: 'go', name: 'child-1' },
        { agentId: '0' },
      ),
    )
    assert.ok(r1.kind === 'tool_ok', JSON.stringify(r1))
    const childId = r1.kind === 'tool_ok' ? String((r1.data as { id?: string }).id) : '1'
    assert.ok(/^\d+/.test(childId), childId)

    const r2 = ok(await upd.execute({ agentId: childId, temperature: 0.3 }, { agentId: '0' }))
    assert.equal(r2.kind, 'tool_ok')

    const r3 = ok(await ins.execute({ agentId: childId }, { agentId: '0' }))
    assert.ok(r3.kind === 'tool_ok' && r3.content.includes('0.3'))
  })

  it('cortex_add_note / cortex_del_note', async () => {
    const cortex = createCortexStrategy({
      homeRoot: join(space, '.stem', 'home'),
      complete: async (p) => (p.includes('STM') ? 'stm' : 'ltm'),
    })
    const tools = cortex.ownedTools ?? []
    const add = tools.find((t) => t.name === 'cortex_add_note') as ToolCapability
    const del = tools.find((t) => t.name === 'cortex_del_note') as ToolCapability
    assert.ok(add && del)

    const r1 = ok(await add.execute({ name: 'topic', body: '# note' }, { agentId: '0' }))
    assert.equal(r1.kind, 'tool_ok')
    assert.ok(existsSync(join(space, '.stem', 'home', '0', 'topic.md')))

    const r2 = ok(await del.execute({ name: 'topic' }, { agentId: '0' }))
    assert.equal(r2.kind, 'tool_ok')
  })

  it('策略 classic / none / cortex 投影', () => {
    const envelopes = [
      {
        id: 'e1',
        agentId: ROOT_AGENT_ID,
        at: 0,
        valid: true,
        turn: 0,
        indexInTurn: 0,
        message: makeTextMessage('user', 'hello'),
      },
    ]
    const view = { agentId: ROOT_AGENT_ID, envelopes, ctxTokens: 0, stamp: {} }
    const classic = createClassicStrategy().orchestrate(view, 'user_prompt')
    assert.equal(classic.messages.length, 1)

    const none = createNoneStrategy().orchestrate(view, 'user_prompt')
    assert.deepEqual(none.messages, [])

    const cortex = createCortexStrategy({ homeRoot: join(space, '.stem', 'home') })
    const c = cortex.orchestrate(view, 'user_prompt')
    assert.ok(c.messages.length >= 1)
    assert.equal(validateSequence(c.messages), undefined)
  })

  it('bootStem 注册表含全部工具', () => {
    const names = boot.system.tools.names()
    for (const n of [
      'read',
      'bash',
      'mail_send',
      'mail_list',
      'agent_class_create',
      'agent_class_update',
      'agent_class_list',
      'agent_instantiate',
      'agent_update',
      'agent_inspect',
      'cortex_add_note',
      'cortex_del_note',
    ]) {
      assert.ok(names.includes(n), `missing ${n}: ${names.join(',')}`)
    }
  })

  it('假网关端到端：经 registry 真执行工具', async () => {
    const seq: LLMEvent[][] = [
      [{ type: 'tool-call', id: 't1', name: 'agent_class_list', input: {} }, { type: 'finish', reason: 'tool_calls' }],
      [{ type: 'tool-call', id: 't2', name: 'read', input: { path: join(space, 'hello.txt') } }, { type: 'finish', reason: 'tool_calls' }],
      [textEvents('all-tools-done')[0]!, textEvents('all-tools-done').at(-1)!],
    ]
    let i = 0
    const gw = new FakeGateway(() => seq[Math.min(i++, seq.length - 1)] ?? [])
    const sys = await createSystem({
      gateway: gw,
      timer: timer(),
      access: allowAll(),
      tools: [createReadTool(), createBashTool(createNodeShellRunner({ defaultCwd: space }))],
    })
    const { DefaultRuntime } = await import('../../src/core/runtime/index.ts')
    const rt = new DefaultRuntime({
      gateway: gw,
      tools: sys.tools,
      access: allowAll(),
      post: sys.post,
      events: sys.events,
      snapshotOf: () => [makeTextMessage('user', 'call tools')],
      materializeTools: () => sys.tools.materialize('0', allowAll()),
      parseModel: (s) => ({ provider: 'p', id: s }),
      modelOf: () => 'p/m',
      systemOf: () => undefined,
      maxStepsOf: () => 8,
    })
    await rt.processDelivery({ agentId: ROOT_AGENT_ID, reason: 'manual', envelopes: [] })
    const box = sys.post.boxOf(ROOT_AGENT_ID)
    assert.ok(box.some((e) => e.message.kind === 'tool'))
    await sys.dispose()
  })
})
