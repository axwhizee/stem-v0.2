# post —— 邮局

> 落实 `docs/architecture.md` 3.4（邮局时序、未决兑现、合并窗口）。  
> 邮局是上下文簇的**运输面**：一封信从进入系统到被「快递员」取走，中间的收集、登记、倒计时、分发都在这里完成。它**不**决定记忆怎么整理（那是 strategy），**不**拼模型快照（那是 pipeline），也**不**执行工具。

---

## 1. 它在整个链路里的位置

架构里的上下文管道是：

```text
进入邮局（信件 | 工具结果 | 运行时写回 | 兑现回填）
  → 预处理：代数校验 · from 确定 · 打戳采集 · 未决登记/兑现
  → 入库（顺序 = classic 基线）
  → 策略编排（触发才重投影）
  → 通知快递员（就绪 + 原因）
  → 快递员合并窗口 → 取快照 → 出模块
```

本模块实际承担的是其中与**运输**直接相关的几段：

| 管道阶段 | 谁做 | 本模块提供的能力 |
|---|---|---|
| 收件（入口归一） | pipeline 调用方把信交给邮局 | `deposit` / `fillPending` |
| 预处理中的未决登记/兑现 | 与 pipeline 协作 | `registerPending` / `takePending` / `fillPending` |
| 入库 | 邮局持有信箱 | `boxOf`（按 agent 的有序信封表） |
| 策略调度触发 | **pipeline / strategy**，不在本模块 | —— |
| 快递员发送 | 邮局的合并窗口 + `onDelivery` 回调 | `notifyReady` + `TimerPort` |

一句话：**策略决定「信变成什么」；邮局决定「何时、以哪一批信交给谁」。**

---

## 2. 核心对象

### 2.1 信箱（box）

每个 agent 一封「收件箱」：`Map<AgentID, Envelope[]>`。

- `deposit(envelope)` 只做**追加**，保持到达顺序（classic 基线顺序）。
- 信封自带 `valid`：作废的信仍在箱里（可审计），是否进入语料由上层过滤。
- `boxOf(agentId)` 返回当前箱内全部信封；上层策略从这里（或经存储端口）读语料。

### 2.2 未决工具调用（PendingCall）

```text
PendingCall { callId, owner, tool, deadline? }
```

这是架构中**唯一**的延迟机制载体（3.4.4），没有通用 Waiter。

生命周期：

```text
模型返回 assistant(toolCalls)
  → 上层为每个 call 构造 PendingCall → registerPending
  → 三条兑现路径（见 §3.2）
  → fillPending(callId, toolResultEnvelope)
       命中：删未决 + 结果 deposit 进 owner 信箱
       未命中：返回 false（孤儿结果，上层应拒绝入库）
```

`takePending(callId)` 是「摘取」：取出但不自动入库。用于 **abort/超时**——上层摘走后自己合成合法的 `tool` 结果（文本写 `timeout`/`aborted`），再 `fillPending` 或直接 `deposit`，从而**合法闭合**槽位。

### 2.3 合并窗口（WindowState）

```text
WindowState {
  cancelTimer    // 当前倒计时的取消函数
  pendingReason  // 最近一次 notifyReady 的原因
  pendingEnvelopes  // 窗口内累积、尚未投递的信
}
```

每个 agent 独立窗口。倒计时长度：

```text
countdown(agent) = sendCountdownOf(agent) ?? defaultCountdown
```

由 `setSendCountdown` / `setDefaultCountdown` 写入（组合根从属性表/配置注入）。

---

## 3. 端到端时序

### 3.1 用户来信 → 快递员送走

```text
① 用户敲入 / 外部信件到达
   pipeline 预处理后得到 Envelope
   post.deposit(env)                         // 入库
   post.notifyReady(agentId, 'user_prompt', [env])

② notifyReady 内部
   若窗口已有倒计时（cooling 累积态）：
       取消旧 timer，把新信 append 进 pendingEnvelopes
       重新起 timer（同一窗口内多封 userPrompt 叠加成一批）
   若窗口空闲：
       建 WindowState，起 timer

③ timer 到点
   一次性取走 pendingEnvelopes + reason
   调 hooks.onDelivery({ agentId, reason, envelopes })
   // 此时快递员（上层 runtime）才被唤醒

④ 上层 onDelivery
   调策略 orchestrate 投影完整快照
   检查未决 call 已全部闭合 → 送网关
```

要点：

- **冷却期重置**：倒计时未到又来新信 → 重新计时，信累积。这样连续输入不会拆成多轮打扰。
- **空投递**：`notifyReady` 带空信封且 reason 为 `user_prompt` 时，到点仍会回调（上层可决定是否空转）；其它 reason 用于工具回流、手动、水位等，即使没有新信也表示「有事要送」。
- **自身写回不重投**：agent 的 assistant 结果只 `deposit`，不调用 `notifyReady`，避免自激。

### 3.2 未决 call 的三条兑现路

```text
本地返回     工具同步/异步执行完 → 构造 tool 信封 → fillPending
定时自填     agent_pause 等自带定时的工具到点 → 合成 tool 结果 → fillPending
abort 闭合   轮被中断 → takePending → 合成 aborted tool 结果 → 入库
```

跨 agent 回信也走配对兑现：对方的回信作为 `tool` 结果（或后续 user 信）到达时，由 pipeline 判断能否 `fillPending`。

### 3.3 广播

```text
post.broadcast(from, [idA, idB], message, 'msg-1')
  → 对每个目标生成独立 Envelope（id = 'msg-1.0', 'msg-1.1', …）
  → 各自 deposit 进目标信箱
```

广播是**点对点复制**，不是全局大喇叭：部门墙仍然生效，目标列表由调用方按族谱/队伍算好。语料里每人都有一份可审计的信，而不是一条共享引用。

---

## 4. 对外 API 行为细节

| 方法 | 行为 | 失败/边界 |
|---|---|---|
| `deposit(env)` | 追加到 `boxes[env.agentId]` | 同 id 不去重（信任上游） |
| `boxOf(id)` | 只读快照视图 | 无箱时 `[]` |
| `registerPending(call)` | 同 `callId` **覆盖**旧登记 | 上游应保证 id 唯一 |
| `pendingOf(owner)` | 过滤 owner 的未决清单 | 稳定按插入序 |
| `fillPending(id, result)` | 命中才 deposit result | 未命中 `false`，**不**误入库 |
| `takePending(id)` | 摘走，不入库 | 无则 `undefined` |
| `notifyReady(id, reason, envs?)` | 累计 + 重置倒计时 | 倒计时 0 = 下一 timer tick |
| `broadcast(...)` | 复制投递 | `from` 只写进 `from` 字段 |
| `setSendCountdown` / `setDefaultCountdown` | 窗口长度 | 负值由上层拒绝 |

### TimerPort

```ts
type TimerPort = { set(ms: number, fn: () => void): () => void }
```

宿主注入（生产 = 真 timer；测试 = 手动 pump）。邮局**不**使用全局 `setTimeout`，便于测合并窗口而不真等。

测试里 `flush()` 触发全部到期任务：注意若还有 `waitForReply` 类长等待，应先 pump 有进展的路径，再 flush（避免长短超时互踩）。

---

## 5. 状态机（单 agent 窗口）

```text
        notifyReady                 timer fire
  idle ───────────► countdown ─────────────────► delivering → idle
   ▲                   │  ▲
   │                   │  │ notifyReady（重置并累积）
   └───────────────────┘  └────────────────────┘
```

- `idle`：无 timer、无积压。
- `countdown`：timer 已挂，`pendingEnvelopes` 在涨。
- `delivering`：同步调用 `onDelivery`（回调内可再 deposit/notifyReady，不会丢当前批）。

---

## 6. 不变量

1. 快照**不是**邮局的责任：`Delivery.envelopes` 只是本窗口收到的信；完整合法前缀由策略投影并用 Message 后继表校验。
2. 未闭合 toolCall 不得形成完整快照——上层在 `onDelivery` 里查 `pendingOf`。
3. 邮局无族谱引用、无策略引用、无工具执行。
4. 可并行：多 agent 窗口互不共享状态。

---

## 7. 与相邻模块的边界

```text
        pipeline / strategy（L3）
              │ deposit / notifyReady
              ▼
           PostOffice          ── onDelivery ──►  Runtime / 快递员
              │ fillPending
              ▼
           model.Envelope
```

- **pipeline**：预处理、打戳、调策略、决定何时 `notifyReady`。
- **strategy**：`orchestrate` 变信为上下文；不碰邮局。
- **runtime**：在 `onDelivery` 里取快照、调网关、写回结果。

---

## 8. 文件

| 文件 | 内容 |
|---|---|
| `PostOffice.ts` | 信箱、未决、合并窗口、广播 |
| `PostOffice.test.ts` | 窗口累积、兑现、广播 |
| `index.ts` | 唯一出口 |
