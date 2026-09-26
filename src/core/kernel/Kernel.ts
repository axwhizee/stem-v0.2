// kernel —— 调度入口与属性写裁决。不拥有服务内部态；组合根唯一装配。

import {
  applyClass,
  applyInstance,
  canWrite,
  inherit,
  makeAgentID,
  rootEffective,
  validateGenes,
  type AgentID,
  type ClassGenes,
  type EffectiveAttrs,
  type InstanceIncoming,
  type Message,
  type ToolAccessMap,
  ROOT_AGENT_ID,
} from '../model/index.ts'
import type { LineageTree } from '../lineage/index.ts'
import type { AgentClass, AgentInstance, InstantiateOptions, KernelIssue } from './types.ts'

export type KernelPorts = {
  readonly lineage: LineageTree
  /** 首信入管道 */
  readonly deliverFirst: (id: AgentID, message: Message) => void | Promise<void>
  /** 运行期状态写（可选观察） */
  readonly onStatus?: (id: AgentID, status: string) => void
}

export class Kernel {
  readonly #classes = new Map<string, AgentClass>()
  readonly #names = new Map<string, AgentID>()
  readonly #ports: KernelPorts

  constructor(ports: KernelPorts) {
    this.#ports = ports
  }

  registerClass(cls: AgentClass): KernelIssue | undefined {
    const issues = validateGenes(cls.genes)
    const first = issues[0]
    if (first) {
      return {
        kind: 'attr_invalid',
        field: first.field,
        detail: first.kind === 'attr_invalid' ? first.detail : 'invalid',
      }
    }
    if (this.#classes.has(cls.name)) {
      return { kind: 'name_taken', name: cls.name }
    }
    this.#classes.set(cls.name, cls)
    return undefined
  }

  updateClassGenes(name: string, genes: ClassGenes): KernelIssue | undefined {
    const existing = this.#classes.get(name)
    if (!existing) return { kind: 'class_not_found', className: name }
    const issues = validateGenes(genes)
    const first = issues[0]
    if (first) {
      return {
        kind: 'attr_invalid',
        field: first.field,
        detail: first.kind === 'attr_invalid' ? first.detail : 'invalid',
      }
    }
    // 类 tools 收敛硬门禁在此写入面
    this.#classes.set(name, { name, genes })
    return undefined
  }

  classOf(name: string): AgentClass | undefined {
    return this.#classes.get(name)
  }

  classNames(): readonly string[] {
    return [...this.#classes.keys()]
  }

  listAgents(): { id: AgentID; name?: string; classRef: string; status: string }[] {
    const out: { id: AgentID; name?: string; classRef: string; status: string }[] = []
    for (const id of this.#ports.lineage.allIds()) {
      const n = this.#ports.lineage.get(id)
      if (!n || n.tombstone) continue
      out.push({
        id: n.id,
        name: n.attrs.name,
        classRef: n.attrs.classRef,
        status: n.runtime.status,
      })
    }
    return out
  }

  ancestry(id: AgentID): AgentID[] {
    return [id, ...this.#ports.lineage.ancestors(id)]
  }

  descendants(id: AgentID): AgentID[] {
    const out: AgentID[] = []
    const walk = (parent: AgentID) => {
      for (const c of this.#ports.lineage.children(parent)) {
        out.push(c)
        walk(c)
      }
    }
    walk(id)
    return out
  }

  /**
   * 实例化：类解析 → 属性收敛 → 族谱登记 → 首信入管道。
   * 根与普通实例同路径；user#0 无特权。
   */
  async instantiate(opts: InstantiateOptions): Promise<AgentInstance | KernelIssue> {
    const cls = this.#classes.get(opts.className)
    if (!cls) return { kind: 'class_not_found', className: opts.className }

    const parentId = opts.parentId === undefined ? ROOT_AGENT_ID : opts.parentId
    const isRoot = parentId === null
    if (!isRoot && !this.#ports.lineage.has(parentId)) {
      return { kind: 'lineage_missing_node', id: parentId }
    }

    const id = isRoot
      ? ROOT_AGENT_ID
      : this.#ports.lineage.nextChildID(parentId)

    if (opts.name && this.#names.has(opts.name)) {
      return { kind: 'name_taken', name: opts.name }
    }

    const parentAttrs = isRoot
      ? undefined
      : this.#ports.lineage.get(parentId)?.attrs

    let attrs: EffectiveAttrs
    if (isRoot) {
      attrs = rootEffective(cls.genes, opts.name)
      attrs = applyInstance(attrs, opts.incoming ?? {})
    } else if (parentAttrs) {
      attrs = applyInstance(
        applyClass(inherit(parentAttrs, id), cls.genes),
        opts.incoming ?? {},
      )
    } else {
      return { kind: 'instantiate_failed', detail: 'missing parent attrs' }
    }

    const attachIssue = this.#ports.lineage.attach(id, {
      attrs,
      raise: opts.raise,
    })
    if (attachIssue) return attachIssue

    if (attrs.name) this.#names.set(attrs.name, id)

    const first: Message = {
      kind: 'user',
      content: [{ type: 'text', text: opts.userPrompt }],
    }
    await this.#ports.deliverFirst(id, first)

    return this.require(id)
  }

  require(id: AgentID): AgentInstance {
    const node = this.#ports.lineage.get(id)
    if (!node) throw new Error(`instance_not_found: ${id}`)
    return { id, attrs: node.attrs, runtime: node.runtime }
  }

  /** 运行期唯一写通道。 */
  updateAgent(id: AgentID, patch: Partial<EffectiveAttrs>): KernelIssue | undefined {
    const issues = canWrite(patch)
    const first = issues[0]
    if (first) return first
    const node = this.#ports.lineage.get(id)
    if (!node) return { kind: 'instance_not_found', id }
    // name 全局唯一
    if (patch.name && patch.name !== node.attrs.name) {
      if (this.#names.has(patch.name)) return { kind: 'name_taken', name: patch.name }
      if (node.attrs.name) this.#names.delete(node.attrs.name)
      this.#names.set(patch.name, id)
    }
    const next = { ...node.attrs, ...patch }
    this.#ports.lineage.rewriteAttrs(id, next)
    return undefined
  }

  terminate(id: AgentID, recursive = false): KernelIssue | undefined {
    if (recursive) {
      for (const d of this.descendants(id)) {
        const err = this.#ports.lineage.tombstone(d)
        if (err) return err
        const node = this.#ports.lineage.get(d)
        if (node?.attrs.name) this.#names.delete(node.attrs.name)
      }
    }
    const issue = this.#ports.lineage.tombstone(id)
    if (issue) return issue
    const node = this.#ports.lineage.get(id)
    if (node?.attrs.name) this.#names.delete(node.attrs.name)
    this.#ports.onStatus?.(id, 'idle')
    return undefined
  }

  interrupt(id: AgentID): KernelIssue | undefined {
    const node = this.#ports.lineage.get(id)
    if (!node) return { kind: 'instance_not_found', id }
    this.#ports.lineage.rewriteRuntime(id, { ...node.runtime, status: 'interrupted' })
    this.#ports.onStatus?.(id, 'interrupted')
    return undefined
  }

  setStatus(id: AgentID, status: AgentInstance['runtime']['status']): void {
    const node = this.#ports.lineage.get(id)
    if (!node) return
    this.#ports.lineage.rewriteRuntime(id, { ...node.runtime, status })
    this.#ports.onStatus?.(id, status)
  }
}
