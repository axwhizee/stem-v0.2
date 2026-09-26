import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { ToolCapabilityRegistry, allowAll, denyAll } from './ToolCapabilityRegistry.ts'
import { toolOk, toolError, fromThrown } from './output.ts'
import { validateArgs } from './validate.ts'
import type { ToolCapability } from './types.ts'

function echoTool(overrides: Partial<ToolCapability> = {}): ToolCapability {
  return {
    name: 'echo',
    description: 'echo',
    kind: 'custom',
    parameters: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
    },
    registerAccess: 'hidden',
    execute: (input) => toolOk(JSON.stringify(input)),
    ...overrides,
  }
}

describe('ToolCapabilityRegistry', () => {
  it('drain 冻结后拒绝追加', async () => {
    const reg = new ToolCapabilityRegistry()
    await reg.drain(
      [
        echoTool({
          init: (ctx) => {
            ctx.registerMore(echoTool({ name: 'late' }))
          },
        }),
      ],
      {},
    )
    assert.equal(reg.frozen, true)
    assert.equal(reg.has('echo'), true)
    assert.equal(reg.has('late'), true)
  })

  it('init 失败 fail-soft 留痕', async () => {
    const reg = new ToolCapabilityRegistry()
    await reg.drain(
      [
        echoTool({
          init: () => {
            throw new Error('boom')
          },
        }),
        echoTool({ name: 'ok' }),
      ],
      {},
    )
    assert.ok(reg.issues.some((i) => i.includes('init failed')))
    assert.equal(reg.has('ok'), true)
  })

  it('execute 三态：hidden/deny 拒绝，allow 执行', async () => {
    const reg = new ToolCapabilityRegistry()
    await reg.drain([echoTool()], {})
    const denied = await reg.execute('0', 'echo', { text: 'x' }, denyAll(), {})
    assert.ok(typeof denied === 'object' && denied.kind === 'tool_access_denied')
    const hidden = await reg.execute(
      '0',
      'echo',
      { text: 'x' },
      { effective: () => 'hidden' },
      {},
    )
    assert.ok(typeof hidden === 'object' && hidden.kind === 'tool_access_denied')
    const ok = await reg.execute('0', 'echo', { text: 'x' }, allowAll(), {})
    assert.ok(typeof ok === 'object' && ok.kind === 'tool_ok')
  })

  it('参数校验与 materialize', async () => {
    const reg = new ToolCapabilityRegistry()
    await reg.drain([echoTool()], {})
    const bad = await reg.execute('0', 'echo', {}, allowAll(), {})
    assert.ok(typeof bad === 'object' && bad.kind === 'tool_invalid_args')
    assert.deepEqual(reg.materialize('0', allowAll()).map((t) => t.name), ['echo'])
    assert.deepEqual(reg.materialize('0', denyAll()), [])
  })

  it('结构化错误透传，杂讯收口', () => {
    const structured = fromThrown({ kind: 'access_denied', message: 'no' }, 'x')
    assert.equal(structured.kind, 'tool_error')
    assert.equal(structured.kind === 'tool_error' && structured.code, 'access_denied')
    const noisy = fromThrown(new Error('e'), 'x')
    assert.equal(noisy.kind === 'tool_error' && noisy.code, 'execution_failed')
    assert.equal(toolError('bad', 'code').kind, 'tool_error')
  })

  it('参数子集校验', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        n: { type: 'number' as const },
        s: { type: 'string' as const, enum: ['a', 'b'] },
      },
      required: ['n'],
    }
    assert.equal(validateArgs(schema, { n: 1 }), undefined)
    assert.equal(validateArgs(schema, { n: 1, s: 'a' }), undefined)
    assert.ok(validateArgs(schema, { n: 1, s: 'c' }))
    assert.ok(validateArgs(schema, { s: 'a' }))
    assert.ok(validateArgs(schema, { n: 'x' }))
  })
})
