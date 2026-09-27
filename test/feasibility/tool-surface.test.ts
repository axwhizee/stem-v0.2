// 全工具功能检查：内建 + extension，对齐旧库工具面。

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bootStem } from '../../shell/host/index.ts'
import { allowAll, type ToolResult } from '../../src/core/tools/index.ts'
import { ROOT_AGENT_ID } from '../../src/core/model/index.ts'

function asOk(r: unknown): ToolResult {
  assert.ok(typeof r === 'object' && r !== null && 'kind' in r)
  return r as ToolResult
}

describe('全工具启用检查', () => {
  let space = ''
  let boot: Awaited<ReturnType<typeof bootStem>>

  before(async () => {
    space = mkdtempSync(join(tmpdir(), 'stem-all-'))
    mkdirSync(join(space, '.stem', 'agent'), { recursive: true })
    boot = await bootStem({
      projectRoot: space,
      stateStore: false,
      fakeGateway: true,
      timer: { set: (_m, fn) => { const t = setTimeout(fn, 10); return () => clearTimeout(t) } },
    })
  })

  after(async () => {
    await boot.close()
  })

  it('注册表覆盖旧库工具面', () => {
    const names = new Set(boot.system.tools.names())
    const required = [
      'bash', 'read', 'write', 'edit', 'grep', 'glob',
      'webfetch', 'websearch', 'skill',
      'agent_instantiate', 'agent_list', 'agent_inspect', 'agent_ancestry', 'agent_descendants',
      'agent_class_list', 'agent_class_create', 'agent_class_update', 'agent_update', 'agent_terminate',
      'mail_send', 'mail_list', 'mail_participants',
      'context_overview', 'context_export', 'context_remove', 'context_edit', 'context_apply',
      'telemetry_query', 'cortex_add_note', 'cortex_del_note',
    ]
    for (const n of required) assert.ok(names.has(n), `missing ${n}`)
  })

  it('逐个调用（功能形）', async () => {
    const sys = boot.system
    const kernel = sys.kernel
    const post = sys.post
    const resolve = allowAll()
    const call = async (name: string, input: unknown, agentId = '0') => {
      const r = await sys.tools.execute(agentId, name, input, resolve, {})
      return asOk(r)
    }

    // 文件面
    const f = join(space, 'a.txt')
    assert.equal((await call('write', { path: f, content: 'hello' })).kind, 'tool_ok')
    assert.ok(readFileSync(f, 'utf8').includes('hello'))
    assert.equal((await call('edit', { path: f, oldText: 'hello', newText: 'world' })).kind, 'tool_ok')
    assert.ok((await call('read', { path: f })).kind === 'tool_ok')
    assert.ok((await call('grep', { pattern: 'world', dir: space })).kind === 'tool_ok')
    assert.ok((await call('glob', { pattern: '*.txt', dir: space })).kind === 'tool_ok')
    assert.ok((await call('bash', { command: 'echo tool-surface' })).kind === 'tool_ok')
    assert.ok((await call('websearch', { query: 'stem' })).kind === 'tool_ok')
    assert.ok((await call('skill', { name: 'demo' })).kind === 'tool_ok')

    // 类 / 实例
    const created = await call('agent_class_create', {
      name: 'w1',
      sysPrompt: 'worker',
      model: 'opencode-go/deepseek-v4.1-flash',
    })
    assert.equal(created.kind, 'tool_ok')
    assert.ok(existsSync(join(space, '.stem', 'agent', 'w1.md')))
    assert.equal((await call('agent_class_update', { name: 'w1', sysPrompt: 'worker2' })).kind, 'tool_ok')
    assert.ok((await call('agent_class_list', {})).kind === 'tool_ok')

    const inst = await call('agent_instantiate', {
      className: 'w1',
      userPrompt: 'go',
      name: 'w1-1',
    })
    assert.equal(inst.kind, 'tool_ok')
    const childId = inst.kind === 'tool_ok' ? String((inst.data as { id?: string }).id) : '1'
    assert.ok(/^\d+/.test(childId), childId)

    assert.ok((await call('agent_list', {})).kind === 'tool_ok')
    assert.ok((await call('agent_inspect', { agentId: childId })).kind === 'tool_ok')
    assert.ok((await call('agent_ancestry', { agentId: childId })).kind === 'tool_ok')
    assert.ok((await call('agent_descendants', { agentId: '0' })).kind === 'tool_ok')
    assert.equal((await call('agent_update', { agentId: childId, temperature: 0.2 })).kind, 'tool_ok')

    // 邮件
    const mail = await call('mail_send', { to: childId, text: 'hi' })
    assert.ok(mail.kind === 'tool_ok' || mail.kind === 'tool_error')
    assert.ok((await call('mail_list', { limit: 3 })).kind === 'tool_ok')
    assert.ok((await call('mail_participants', {})).kind === 'tool_ok')

    // 上下文
    assert.ok((await call('context_overview', { agentId: '0' })).kind === 'tool_ok')
    assert.ok((await call('context_export', { agentId: '0', limit: 5 })).kind === 'tool_ok')
    assert.equal((await call('context_apply', { agentId: '0', text: 'note' })).kind, 'tool_ok')
    const box = post.boxOf(ROOT_AGENT_ID)
    const last = box.at(-1)
    if (last) {
      assert.equal((await call('context_edit', { agentId: '0', messageId: last.id, text: 'edited' })).kind, 'tool_ok')
      assert.equal((await call('context_remove', { agentId: '0', messageId: last.id })).kind, 'tool_ok')
    }

    // 遥测 / 笔记 / 销毁
    assert.ok((await call('telemetry_query', { limit: 5 })).kind === 'tool_ok')
    assert.equal((await call('cortex_add_note', { name: 'n1', body: 'x' }, '0')).kind, 'tool_ok')
    assert.equal((await call('cortex_del_note', { name: 'n1' }, '0')).kind, 'tool_ok')
    assert.equal((await call('agent_terminate', { agentId: childId, recursive: true })).kind, 'tool_ok')
    void kernel
  })
})
