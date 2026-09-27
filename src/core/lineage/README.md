# lineage —— 族谱资源面

> 落实 `docs/architecture.md` 3.1.4 与 3.1.1 收敛落地。  
> 族谱是实例之间的**唯一组织事实来源**：谁生了谁、属性落地成什么样、工具能力生效到哪一档。它像是「户口本 + 能力台账」，**不**调度、**不**发消息、**不**跑记忆策略。

---

## 1. 为什么需要它

场景压力（`scenarios.md`）里的「族谱协作体」要求：树即组织，分工/汇报/职权从位置得出。对应到实现就是三件事，全部落在本模块：

1. **拓扑**：id 即出生路径，父可推导；兄弟默认互不越界。
2. **属性落地**：出生时收敛链算完，此后是快照；改父不级联子。
3. **能力物化**：工具权限的生效值 = 族谱位置的函数（清单 → raise → 注册封顶）。

kernel 拥有 LineageTree（聚合），工具/邮局经门面查询；**禁止**模块外另搞一张权限表。

---

## 2. 树是怎么长出来的

### 2.1 节点登记

```text
attach(id, NodeConfig) 
  → 查重、查父存在
  → 写入 LineageNode { id, attrs, runtime, tombstone? }
  → materializeAccess(config) 得到 AccessProfile
  → 更新父的「下一序号」
```

`NodeConfig`：

```text
{
  attrs: EffectiveAttrs      // 已由 model 收敛链算好（继承→类→实例）
  raise?: ToolAccessMap      // 策略声明的只抬不封
  registerAccess?: ToolAccessMap  // 工具注册声明的封顶
}
```

**出生顺序**：kernel 用 `nextChildID(parent)` 发号 → 得到 `0.2` 这类路径 → `attach`。序号单调递增，**销毁不回收**（见墓碑）。

### 2.2 拓扑查询

| 调用 | 语义 | 实现要点 |
|---|---|---|
| `children(p)` | 活子清单 | 扫节点表，`parentIdOf(child)===p` 且非墓碑，按 DFS 序 |
| `ancestors(id)` | 祖先链 | 从父指针逐级上溯（路径截尾） |
| `canReach(from, target)` | 辖区 | **from 为 target 自身或祖先**——父可管子，兄弟不可 |

部门墙由此而来：`canReach(brotherA, brotherB) === false`，销毁/读语料/中断等跨实例操作都必须先过这一谓词。

### 2.3 启动重放

存储里只有持久行，内存树要重建：

```text
replay(entries)  // entries = 各节点的 id + NodeConfig
  → 按 compareAgentID 拓扑序排序（父先于子）
  → 逐个 attach
  → 重复/缺父进 issues（拒启或留痕由 boot 决定）
```

重放**只重建派生态**（能力物化、序号）。`status/turnCount/tokens` 等运行时账目由 kernel 从实例表载入后写回 `runtime` 字段——账目真相在库，不在拓扑算法里。

---

## 3. 能力物化（AccessProfile）

### 3.1 输入是什么

```text
declared = attrs.tools     // 落地表里的工具映射（键=工具名，值=hidden|allow|deny）
lift     = raise           // 策略 raise，只抬 hidden→allow
register = registerAccess  // 工具自报宽度，可封顶
```

### 3.2 折叠公式

对每个出现过的键：

```text
state = raiseAccess(declared[key] ?? 'hidden', lift[key] ?? 'hidden')
若 register[key] === 'deny'  → 强制 deny
若 register[key] === 'allow' → 再 raise 一次（允许抬到 allow）
```

没出现的键：**不在 explicit 里**，`effectiveAccess` 返回 `hidden`。

### 3.3 语义直觉

| 情况 | 结果 | 含义 |
|---|---|---|
| 清单写了 `bash: allow` | allow | 可见、可执行 |
| 清单写了 `bash: hidden` + 策略 raise allow | allow | 启用 |
| 清单写了 `rm: deny` + 任何 raise | deny | 铁律 |
| 注册声明 deny，清单想 allow | deny | 封顶锁死 |
| 键未出现 | hidden | 未启用（不是 deny！） |
| 清单为 `{}` | 全部 hidden | 本地封闭 |

**继承去哪了？**  
「未设 tools = 继承父生效档案」发生在 **AttributeTable 收敛**（`inherit` / `applyClass` / `applyInstance`）。族谱在 `attach` 时看到的已是落地映射，因此这里不需要再爬树。

### 3.4 hidden ≠ deny

两者都不执行、都不可见；差别是**收敛图上能否再启用**：

- `hidden → allow`：raise / 显式启用可以。
- `deny`：吸收元，永远不能回到 allow/hidden。

---

## 4. 属性落地如何被使用

`LineageNode.attrs: EffectiveAttrs` 是出生快照。运行期：

```text
kernel.updateAgent(id, patch)
  → model.canWrite(patch) 预检
  → 写 attrs 中的 name/model/temperature/effort
```

族谱本身不提供散点 setter。派生字段：

| 字段 | 住哪 |
|---|---|
| 父 id | **不存**，`parentIdOf` |
| childList | **不存**，`children()` 推导 |
| status / turnCount / ctxTokens / totalTokens | `node.runtime`，kernel 写 |

---

## 5. 墓碑（tombstone）

```text
tombstone(id)
  → 标记节点；id 与 name 仍占用
  → children() 不再列出
  → nextChildID 继续递增（不复用旧序号）
```

审计需要「她曾经有过这个子节点」；若删 id，出生路径会歧义。销毁整棵子树时由上层递归 tombstone。

---

## 6. 完整示例

```text
boot:
  attach('0', { attrs: rootEffective(userGenes, 'root') })
  nextChildID('0') → '0.0'
  attach('0.0', { attrs: workerAttrs, raise: { bash: 'allow' }, registerAccess: { rm: 'deny' } })

查询:
  canReach('0', '0.0')   → true
  canReach('0.0', '0')   → false
  effectiveAccess('0.0', 'bash') → 'allow'   // declared hidden + raise
  effectiveAccess('0.0', 'rm')   → 'deny'    // register 封顶
  effectiveAccess('0.0', 'net')  → 'hidden'  // 未点名
```

---

## 7. 不变量

1. 无调度权、不发消息、不持策略状态、不跑工具。
2. 状态单主人：拓扑与能力台账只在本实例内；运行时账目也是单主人（kernel 写）。
3. 门面封闭：外部只 import `LineageTree`，无第二入口。
4. `canReach` 是唯一辖区谓词，跨 agent 操作必须经过它。

---

## 8. 文件

| 文件 | 内容 |
|---|---|
| `LineageTree.ts` | 门面 + 能力物化 |
| `LineageTree.test.ts` | 登记、物化、墓碑、缺父 |
| `index.ts` | 唯一出口 |

## 9. 依赖

`model`（id / EffectiveAttrs / AccessState）。不依赖 kernel、tools、post。
