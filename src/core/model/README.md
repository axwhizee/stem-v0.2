# model —— 基础模型（纯代数）

> 落实 `docs/architecture.md`：统一 Message（3.2）、语料信封（3.3）、属性表（3.1.1）、权限三态（3.6.2）、id/族谱路径（3.5）。  
> **零 IO、零平台依赖**；不 import 其它 core 模块。跨模块只经 `index.ts` 导出。

---

## 1. id —— 出生路径（`id.ts`）

### 1.1 类型

| 符号 | 形状 | 说明 |
|---|---|---|
| `AgentID` | branded `string` | 出生路径，编译期不可与普通 string 混用 |
| `ROOT_AGENT_ID` | `'0'` | 拓扑原点；**不是特权码** |

### 1.2 路径语法

```text
id      ::= "0" | "0" ("." n)+        n ∈ ℕ，无前导零（禁止 "01"、"0.02"）
```

- 根 = `0`；子 = `<父>.<序号>`（含根之子 `0.0`、`0.1`…）。
- **规则单一**：不采用「根之子裸号」旧形态，避免与根撞号。
- **序号不回收**：销毁留墓碑，同父下一个出生序号继续递增。
- **父 id 纯推导**，不冗余存储。

### 1.3 函数

| 函数 | 语义 |
|---|---|
| `makeAgentID(value)` | 校验并收窄为 `AgentID`；非法抛错 |
| `isAgentID(value)` | 语法判定（不抛错） |
| `parentIdOf(id)` | 父路径；根返回 `null` |
| `childAgentID(parent, ordinal)` | 生成 `parent.ordinal`；ordinal 须为 ≥0 整数 |
| `isAncestorOf(ancestor, node)` | 自身或真祖先 |
| `canReach(from, target)` | **≡ target 为 from 的自身或祖先**（architecture 3.5） |
| `compareAgentID(a, b)` | 族谱 **DFS 自然序**（段号数值比较；短前缀在前） |

### 1.4 不变量

1. `parentIdOf(childAgentID(p, n)) === p`。
2. `canReach` 只沿「自身 ∨ 祖先」向上，不横向看兄弟、不向下看子孙（管辖与可见由族谱资源面在更高层组合）。
3. 自然序等价于树的 DFS 先序（父先于子，子按序号）。

---

## 2. 权限三态（`access.ts`）

### 2.1 状态

| 状态 | 模型可见 | 执行 | 收敛语义 |
|---|---|---|---|
| `hidden` | 否 | 否 | **未启用**（默认档）；可被 raise/显式启用抬为 `allow` |
| `allow` | 是 | 是 | 启用 |
| `deny` | 否 | 否 | **锁死**；后序不可放宽为 allow/hidden |

**`hidden ≠ deny`**：运行期都不执行；差别在收敛图上是否还能启用。

### 2.2 运算

| 函数 | 语义 |
|---|---|
| `raiseAccess(current, declared)` | 只抬 `hidden→allow`；`allow`/`deny` 粘滞 |
| `convergeAccess(states)` | 链上收敛：出现 `deny` 则吸收为 deny；否则有 `allow` 则 allow；全 hidden 则 hidden |
| `canTransition(from, to)` | 合法转移：同态、任意→deny、hidden→allow |
| `transitionAccess(from, to)` | 合法则返回新态，否则 `{ kind: 'access_illegal_transition', from, to }` |
| `isExecutable` / `isModelVisible` | 当且仅当 `allow` |
| `parseAccessState(value)` | 解析外部字面量；非法返回 `undefined` |

### 2.3 偏序

```text
hidden → allow → deny
   └──────────→ deny
（deny 为吸收元；无 ask；只紧不松）
```

---

## 3. Message（`message.ts`）

只表达**模型协议意义**。`tag` / `valid` / `turn` / `from` / `tokens` 等打戳字段**不进 Message**。

### 3.1 ContentPart（多模态，不改 kind）

| type | 字段 | 说明 |
|---|---|---|
| `text` | `text: string` | 主文本 |
| `image` | `ref`, `mime?`, `detail?` | `detail`: `low\|high\|auto` |
| `audio` | `ref`, `mime?`, `durationMs?` | 字节在空间资产，此处只存 `ref` |
| `video` | `ref`, `mime?`, `durationMs?` | 同上 |
| `file` | `ref`, `mime?`, `name?` | 同上 |

策略整理默认 `textContent(message)` 投影（仅拼接 `text` part）。

### 3.2 Message

| 字段 | 约束 |
|---|---|
| `kind` | `system \| user \| assistant \| tool` |
| `content` | `ContentPart[]` |
| `toolCalls?` | **仅 assistant 且非空时**；`[{ id, name, arguments }]`；组内 `id` 唯一 |
| `toolCallId?` | **仅 tool**；恰好兑现一条前置未兑现 call |

### 3.3 五型与后继表（写入 = 快照）

| 前驱 | 合法后继 | 附加约束 |
|---|---|---|
| （起始） | `system` \| `user` | |
| `system` | `user` | 其后不再追加 system |
| `user` | `assistant`（可带 calls） | |
| `assistant`（无 calls） | `user` | |
| `assistant`（有 calls） | `tool`（逐条配对） | call 须为前驱声明的未兑现 id |
| `tool` | 未兑现的下一 `tool`，或 `assistant` | `tool` → `user` 必须隔 `assistant` |

### 3.4 不变量（`validateSequence`）

1. 每个 `toolCallId` 恰好由前置未兑现 call 声明，且只兑现一次。
2. 无悬空调用、无孤儿结果进入合法序列。
3. 存在未闭合槽位时，不得插入非 `tool` 消息；**未闭合槽位不得形成完整快照送网关**。
4. 形状自检（`shapeOk`）：`tool` 必有 `toolCallId` 且不得再声明 `toolCalls`；非 `tool` 不得携带 `toolCallId`。

### 3.5 函数

| 函数 | 语义 |
|---|---|
| `textContent(message)` | 文本投影 |
| `hasToolCalls(message)` | 是否声明工具调用 |
| `nextLegal(from)` | 后继槽位列表（`from === null` 为起始） |
| `validateSuccessor(prev, next)` | 单步后继 + 形状；合法返回 `undefined` |
| `validateSequence(messages)` | 整段前缀校验（含未决闭合） |
| `makeTextMessage(kind, text)` | 单文本便捷构造 |

槽位类型：`Slot = MessageKind | 'assistant+calls'`（带调用的 assistant 在后继表上单独占位）。

---

## 4. Envelope（`envelope.ts`）

持久化/审计外罩；**作废不改 Message**。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `string` | 信封 id |
| `agentId` | `AgentID` | 归属实例 |
| `at` | `number` | 时间戳 |
| `tokens?` | `number` | 占用/消耗 |
| `valid` | `boolean` | 作废标记 |
| `tag?` | `string` | 审计标签 |
| `turn` | `number` | 轮次 |
| `indexInTurn` | `number` | 轮内序 |
| `from?` | `AgentID \| 'user' \| 'system' \| 'tool'` | **来源必采集** |
| `stamp?` | `Stamp` | 打戳配置：`timestamp?` / `delay?` / `tokens?` |
| `message` | `Message` | 载荷 |

| 函数 | 语义 |
|---|---|
| `invalidate(envelope, tag?)` | 返回 `valid: false` 的新信封（原对象不变） |
| `isValid(envelope)` | 当前是否有效 |

采集（信封）与投影（LLM 可见）分离；`Stamp` 开关决定投影时是否打戳。

---

## 5. AttributeTable（`attributeTable.ts`）

### 5.1 类属性（ClassGenes）

| 字段 | 必填 | 说明 |
|---|---|---|
| `classRef` | 是 | 基类挂载点 |
| `description?` | | 类描述 |
| `sysPrompt?` | | 系统提示词；实例化时收敛进生效配置（非沿族谱自由继承文本） |
| `ctxStrategy?` | | 记忆策略名 |
| `tools?` | | `ToolAccessMap` |
| `sendCountdown?` | | 合并窗口 ms |
| `model?` | | 模型选择 |
| `temperature?` | | 采样温度（0..2） |
| `effort?` | | `none\|low\|medium\|high` |
| `maxSteps?` | | 单轮步数上限；0 = 无限 |

### 5.2 实例入参（InstanceIncoming）

`name` / `ctxStrategy` / `tools` / `sendCountdown` / `model` / `temperature` / `effort` / `maxSteps`  
——全部可选；提供则在收敛②优先。

### 5.3 落地生效表（EffectiveAttrs）

| 字段 | 继承 | 运行期可写 | 说明 |
|---|---|---|---|
| `id` | — | 否 | 出生路径 |
| `name?` | 否 | **是** | 全局唯一称呼 |
| `classRef` | — | 否 | 出生即定 |
| `description?` / `sysPrompt?` | 否* | 否 | 类写；sysPrompt 实例化收敛 |
| `ctxStrategy` | 是 | 否 | 缺省 `classic` |
| `tools` | 是（会收敛） | 否 | `Record<工具名, AccessState>`；未设键 = 继承 |
| `sendCountdown` | 是 | 否 | 缺省 0 |
| `model?` | 是 | **是** | |
| `temperature?` | 是 | **是** | |
| `effort?` | 是 | **是** | |
| `maxSteps` | 是 | 否 | 缺省 0 |

\* `sysPrompt` 不沿族谱逐代自由继承，而是类基因/实例化时收敛进生效表。

### 5.4 运行时账目（RuntimeAttrs，不参与继承）

| 字段 | 说明 |
|---|---|
| `status` | `idle \| thinking \| tooling \| interrupted \| holding` |
| `turnCount` | 运行轮数 |
| `ctxTokens` | 上下文占用（反馈账） |
| `totalTokens` | 累积消耗（不受压缩回滚） |
| `lastActive?` | 最近活跃时间 |

**明确不在属性表**：`assemble`、面板标签、userPrompt、父 id（父 = `parentIdOf` 纯推导）、`childList`（拓扑查询面推导）。

### 5.5 收敛链与写面

```text
父生效属性表（inherit）
  → 类基因（applyClass，收敛①）
  → 实例化入参（applyInstance，收敛②）
  → 节点落地表（快照；改父不级联子）

解析序：实例显式 > 类 > 父
```

| 函数 | 语义 |
|---|---|
| `validateGenes(genes)` | 值域/互斥/必填；返回 `AttrIssue[]` |
| `inherit(parent, id)` | 严格父子；子名置空，其余继承父生效值 |
| `applyClass(base, genes)` | 类基因覆盖（显式类值优先于继承值） |
| `applyInstance(base, incoming)` | 实例化入参最优先 |
| `canWrite(patch)` | 写面预检；仅 `name/model/temperature/effort` 允许 |
| `effective(table)` | 落地表快照 |
| `rootEffective(genes, name?)` | 根落地；与任意实例同路径，无特权 |

`RUNTIME_WRITABLE = ['name', 'model', 'temperature', 'effort']` —— 唯一运行期写通道的字段全集。

### 5.6 Issue 形状

```ts
type AttrIssue =
  | { kind: 'attr_invalid'; field: string; detail: string }
  | { kind: 'attr_write_forbidden'; field: string }
```

---

## 6. 文件与测试

| 文件 | 职责 |
|---|---|
| `id.ts` | 出生路径代数 |
| `access.ts` | 权限三态 |
| `message.ts` | Message / ContentPart / 后继表 |
| `envelope.ts` | 信封 |
| `attributeTable.ts` | 属性收敛与写面 |
| `index.ts` | 唯一出口 |
| `*.test.ts` | 同目录契约测试（`node:test`） |

## 7. 依赖方向

叶子模块。被族谱、邮局、工具、kernel 等消费；**本模块不得反向依赖任何业务模块**。
