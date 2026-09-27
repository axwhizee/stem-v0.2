# post —— 邮局（入库 · 策略 · 快递员）

> 落实 `docs/architecture.md` 3.4。  
> 邮局是唯一的上下文大模块：一封信从进入系统到被「快递员」取走，中间的预处理、入库、策略编排、合并窗口、投递都在这里。它**不**仲裁族谱、**不**执行工具、**不** spawn 实例。

---

## 1. 全链路时序

```text
进入邮局（信件 | 工具结果 | 运行时写回 | 兑现回填）
  → 预处理：代数校验 · from 确定 · 打戳采集 · 未决登记/兑现
  → 入库（顺序 = classic 基线；write-through 存储端口）
  → 策略编排（触发才 process → orchestrate 投影）
  → 通知快递员（就绪 + 原因）
  → 快递员合并窗口 → 取快照 → onDelivery
  → Runtime 送网关 → 写回只 deposit、不重投
```

| 子单元 | 文件 | 管什么 |
|---|---|---|
| 收发面 | `PostOffice.ts` | 信箱、未决兑现、合并窗口、广播 |
| 管道 | `pipeline.ts` | `enter` / `snapshot` / 作废重投影 |
| 策略 | `strategies/` | `classic` / `none`；契约 `ContextStrategy` |
| 打戳 | `stamp.ts` | 采集（信封）与投影（LLM 可见）分离 |

---

## 2. 核心对象

### 2.1 信箱与未决

每个 agent 一封收件箱：`Map<AgentID, Envelope[]>`。`deposit` 只追加；作废信仍留箱（可审计）。

```text
PendingCall { callId, owner, tool, deadline? }
```

唯一延迟机制载体（3.4.4），无通用 Waiter。兑现三路：本地返回 / 定时自填 / abort 摘取后合成合法 tool 结果。`fillPending` 未命中不误入库。

### 2.2 合并窗口（快递员）

每个 agent 独立 `WindowState`：`notifyReady` 累积信件并重置倒计时，到点一次性 `onDelivery`。倒计时来自 `sendCountdown`（实例属性，组合根注入）。**自身写回不重投递**，防自激。

### 2.3 策略契约

```ts
interface ContextStrategy {
  name: string
  orchestrate(view, trigger): { messages: Message[]; ready?: Trigger }
  ownedTools?: ToolCapability[]
  note?: string
  process?(view, trigger): Promise<OrchestrateResult | undefined>
}
```

| 约定 | 说明 |
|---|---|
| `orchestrate` | 纯投影；返回值必须过 Message 后继表 |
| `process` | 异步整理；fail-soft，绝不 throw 到送信链路 |
| `ownedTools` | 并入工具表（如 cortex 笔记工具） |
| `note` | 实例化时拼进 system 贡献者 |

core 只内置 `classic` / `none`；extension 策略（cortex 等）住 `extension/strategy`，参数来自 `stem.jsonc → extensions.strategy`。策略操作面 = 已入库合法上下文；整理经 **complete**（ToolAgent），禁止 spawn 实例。

---

## 3. 管道 API

### 3.1 `enter(envelope, trigger)`

```text
① 形状预检  ② collectStamp  ③ post.deposit
④ 策略 process（若有，fail-soft）  ⑤ notifyReady(agentId, trigger, [stamped])
```

`Trigger`：`user_prompt | tool | manual | watermark | fill`。

### 3.2 `snapshot(agentId)`

策略 `orchestrate(view, 'manual')` 投影；序列非法返回 `[]`——绝不把未闭合前缀送网关。

### 3.3 `invalidateAndReproject`

信封 `valid=false` 后重投影；Message 本体不变。

---

## 4. 打戳

```text
stem.jsonc → stamp = { source?, timestamp?, delay?, tokens? }
```

**采集**写进 `Envelope.stamp`（`from` 必采集）；**投影**可选在 Content 前插 `[from=…]` 等。二者分离，审计与提示词互不绑架。

---

## 5. classic 细节

**orchestrate**：有效序直出 → `validateSequence`。仍有未闭合 call → 空投影（等 fill）。  
**process**：`ctxTokens ≥ window` 时基线压缩（占位 user 段保后继合法）；真摘要压缩经 ToolAgent `complete`。

---

## 6. 不变量

1. 策略输出必须过 3.2.2；snapshot 再验一次。
2. 未决未闭合 → 不形成完整快照。
3. 自身写回历史不自动重投递。
4. 策略 `process` 失败 fail-soft。
5. 无通用 Waiter；延迟只经 pending toolCall。
6. 邮局无族谱引用、不执行工具；多 agent 窗口互不共享状态。

---

## 7. 依赖

`model`（Message 校验 / Envelope）、`tools`（ownedTools 类型）。不依赖 kernel / gateway / lineage。

---

## 8. 文件

| 文件 | 内容 |
|---|---|
| `PostOffice.ts` | 信箱、未决、合并窗口、广播 |
| `pipeline.ts` | ContextPipeline |
| `types.ts` | Trigger / CorpusView / ContextStrategy |
| `stamp.ts` | 采集与投影 |
| `strategies/` | classic / none |
| `PostOffice.test.ts` | 窗口、兑现、广播 |
| `context.test.ts` | 打戳与策略投影 |
| `index.ts` | 唯一出口 |
