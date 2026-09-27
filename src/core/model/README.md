# model —— 基础模型（纯代数）

> 落实 `docs/architecture.md`：统一 Message（3.2）、语料信封（3.3）、属性表（3.1.1）、权限三态（3.6.2）、出生路径（3.5）。  
> 本模块是全系统的**字典与法律**：其它模块都用这里的类型说话，并用这里的校验保证「什么序列合法、什么写入允许」。零 IO、零平台依赖。

---

## 0. 五块如何咬合

```text
AgentID          你是谁（出生路径）
AttributeTable   你被配成什么样（收敛后的属性 + 权限映射）
Message          对话原子（模型协议）
Envelope         这条原子的档案袋（归属、审计、打戳）
AccessState      某工具对某实例是 hidden / allow / deny
```

一封信从出生到进库：

```text
Runtime 构造 Message（必须能接在已有前缀后）
  → validateSuccessor / validateSequence
  → 包上 Envelope（agentId/turn/from/valid…）
  → 邮局 deposit
  → 策略把有效信投影成送给网关的 Message[]
```

---

## 1. id —— 出生路径（`id.ts`）

### 1.1 形状

```text
id ::= "0" | n ("." n)*     n ≥ 1，无前导零
```

| 例子 | 含义 |
|---|---|
| `0` | 根（`user#0`，拓扑原点，**无特权**） |
| `1` | user#0 实例化的首个 agent |
| `2` `3`… | 后续根之子 |
| `1.2` | `1` 的第 2 个子 |

**规则**：根之子为裸序号（自 1 起）；更深层为 `<父>.<序号>`。销毁后 id 仍保留。

### 1.2 运算

| 函数 | 过程 |
|---|---|
| `makeAgentID` / `isAgentID` | 语法校验；非法拒绝 |
| `parentIdOf` | 最后一段截掉；`0` → `null` |
| `childAgentID(parent, ordinal)` | `parent.ordinal`；ordinal 为 ≥0 整数 |
| `isAncestorOf(a, n)` | `n === a` 或 `n` 以 `a.` 开头 |
| `canReach(from, target)` | **from 为 target 自身或祖先** |
| `compareAgentID` | 段号数值比；短前缀在前 = 树 DFS 先序 |

### 1.3 辖区直觉

```text
        0
      /   \
    0.0   0.1
     |
   0.0.0

canReach(0, 0.0.0)     true   祖先管后代
canReach(0.0, 0.1)     false  兄弟越界
canReach(0.0.0, 0.0)   false  子不能代父
```

### 1.4 不变量

- 父 id 从不存储，避免双真相。
- 序号不回收（销毁见族谱墓碑）。
- `parentIdOf(childAgentID(p,n)) === p`。

---

## 2. 权限三态（`access.ts`）

### 2.1 状态含义

| 状态 | 模型可见 | 执行 | 还能启用吗 |
|---|---|---|---|
| `hidden` | 否 | 否 | 能（抬为 allow） |
| `allow` | 是 | 是 | 已启用 |
| `deny` | 否 | 否 | **不能** |

`hidden` 是「还没开」，`deny` 是「永不」。运行期表现相同，收敛行为不同。

### 2.2 代数

```text
raiseAccess(cur, declared)
  hidden + allow → allow
  其余保持 cur（allow/deny 粘滞）

convergeAccess(states)
  见 deny → deny
  否则有 allow → allow
  全 hidden → hidden

canTransition(from, to)
  同态 | to=deny | (from=hidden 且 to=allow)
```

`transitionAccess` 不合法时返回 `{ kind: 'access_illegal_transition', from, to }`（判别联合，不抛字符串）。

收敛链实际调用顺序（类清单 → 策略 raise → 实例清单 → 注册封顶）由 **lineage.materializeAccess** 编排；本文件只提供代数。

---

## 3. Message（`message.ts`）

### 3.1 ContentPart

| type | 字段 | 持久化 |
|---|---|---|
| `text` | `text` | 内联 |
| `image` | `ref,mime?,detail?` | 字节在 `assets/`，库内只存 ref |
| `audio` / `video` | `ref,mime?,durationMs?` | 同上 |
| `file` | `ref,mime?,name?` | 同上 |

`textContent(msg)` 只拼 text part，供策略默认投影；其它模态可投影为占位。

### 3.2 字段规则

```text
kind: system | user | assistant | tool
content: ContentPart[]
toolCalls?: {id,name,arguments}[]   // 仅 assistant；id 组内唯一
toolCallId?: string                 // 仅 tool；兑付一条 call
```

### 3.3 后继表（谁可以跟在谁后面）

```text
起始     → system | user
system   → user
user     → assistant（可带 toolCalls）
assistant(无 calls) → user
assistant(有 calls) → tool（逐条兑付，call 必须是它声明的）
tool     → 仍未兑付的 tool | assistant
```

因此 `tool` 后面**不能**直接跟 `user`：必须先有 assistant 收束。`system` 只出现在最前。

### 3.4 校验怎么走

**单步** `validateSuccessor(prev, next)`：

1. 形状：tool 必有 toolCallId；非 tool 不得带 toolCallId；toolCalls 仅 assistant。
2. 后继槽位是否允许（带 calls 的 assistant 占独立槽 `assistant+calls`）。
3. 若 next 是 tool 且 prev 是带 calls 的 assistant：toolCallId 必须在 prev 的未兑付集合中。

**整段** `validateSequence(messages)`：

```text
open = []
for m in messages:
  validateSuccessor(prev, m)
  if tool(m):  从 open 移除 m.toolCallId（必须先在 open 中，否则孤儿）
  if assistant+calls:  要求 open 为空，然后 open = 新 call ids
  if 其它:  要求 open 为空
最终 open 必须为空
```

这就是「未闭合槽位不得形成完整快照」的可执行版本。

### 3.5 写入语义

| 操作 | 规则 |
|---|---|
| 构造 | 必须相对前缀合法 |
| 改写 | 同 kind 内容修订；结构变 = 新消息 |
| 作废 | 改 Envelope.valid，不动 Message |
| 出口 | Message → 网关协议**单向** |

---

## 4. Envelope（`envelope.ts`）

### 4.1 字段

| 字段 | 说明 |
|---|---|
| `id` | 信封 id |
| `agentId` | 归属实例 |
| `at` / `tokens?` | 时间与用量 |
| `valid` / `tag?` | 作废与审计标签 |
| `turn` / `indexInTurn` | 轮次与轮内序 |
| `from?` | 来源：AgentID \| user \| system \| tool |
| `stamp?` | `{timestamp?, delay?, tokens?}` 投影开关 |
| `message` | 载荷 |

### 4.2 打戳

采集（进信封）与投影（LLM 可见）分离：`stem.jsonc` 的 `context.stamp` 决定策略投影时是否把时间/延迟/token 编进文本；信封侧始终可记 `from`。

### 4.3 作废

`invalidate(env, tag?)` 返回新对象 `{...env, valid:false}`。原 Message 不变——历史可审计，「她不能偷偷变成另一个人」。

---

## 5. AttributeTable（`attributeTable.ts`）

### 5.1 三类字段

**类基因 ClassGenes**（`.stem/agent` 或代码内置类的定义面）

| 字段 | 说明 |
|---|---|
| `classRef` | 必填，基类挂载点 |
| `description?` | 类描述 |
| `sysPrompt?` | 系统提示；实例化时收敛进生效表 |
| `ctxStrategy?` | 记忆策略名 |
| `tools?` | 工具权限映射 |
| `sendCountdown?` | 合并窗口 ms |
| `model?` `temperature?` `effort?` `maxSteps?` | 采样与预算 |

**实例入参 InstanceIncoming**：`name/ctxStrategy/tools/sendCountdown/model/temperature/effort/maxSteps`，皆可选。

**生效表 EffectiveAttrs**（落地快照）

| 字段 | 继承 | 运行期可写 |
|---|---|---|
| `id` | — | 否 |
| `name?` | 否 | **是** |
| `classRef` `description?` `sysPrompt?` | — | 否 |
| `ctxStrategy` | 是 | 否 |
| `tools` | 是 | 否（经 kernel 类写面另议） |
| `sendCountdown` `maxSteps` | 是 | 否 |
| `model?` `temperature?` `effort?` | 是 | **是** |

**运行时账目 RuntimeAttrs**（不参与继承）：`status / turnCount / ctxTokens / totalTokens / lastActive?`。

**刻意不进表**：父 id（推导）、childList（推导）、assemble、userPrompt、面板标签。

### 5.2 收敛走一遍

```text
父生效（inherit）          tools=父 tools，name 清空，id=新 id
  → 类基因（applyClass）   类显式字段覆盖
  → 实例入参（applyInstance）实例显式字段最优先
  → 落地表（快照；改父不影响子）
```

解析序口诀：**实例 > 类 > 父**。

### 5.3 写面

`canWrite(patch)` 只放行 `name / model / temperature / effort`（`RUNTIME_WRITABLE`）。  
`id/classRef/ctxStrategy/tools/maxSteps` 等一律 `attr_write_forbidden`。唯一写通道是 kernel.updateAgent。

### 5.4 根与人

`rootEffective(genes, name)` 与任意实例同路径：`0` 也是一张表，走同一 validate/inherit。用户在系统里 = 以 `user#0` 身份行动，无旁路。

---

## 6. Issue 一览

```text
MessageIssue   message_invalid_shape | message_illegal_successor
AccessIssue    access_illegal_transition
AttrIssue      attr_invalid | attr_write_forbidden
```

均为判别联合对象；测试用谓词断言，不在 core 里抛 Error 实例。

---

## 7. 文件与依赖

| 文件 | 内容 |
|---|---|
| `id.ts` | 出生路径 |
| `access.ts` | 权限代数 |
| `message.ts` | Message + 后继表 |
| `envelope.ts` | 信封 |
| `attributeTable.ts` | 属性收敛 |
| `index.ts` | 唯一出口 |
| `*.test.ts` | 同目录契约测试 |

叶子模块；被 lineage/post/gateway/tools/kernel 消费；**禁止** import 任何业务模块。
