# runtime —— 送信驱动的轮循环

> 落实 `docs/architecture.md` 3.1.2（单轮时序）。  
> Runtime **被动**：不自己 while(true)，由邮局投递（`onDelivery`）唤醒。多 agent 天然并行（各自独立调用）。

---

## 1. 单轮时序

```text
processDelivery(delivery)
  status → thinking
  ① 取快照 snapshotOf(id)     // 策略投影；非法则本轮作废
  ② materializeTools(id)      // 仅 allow
  ③ gateway.chat 流式
        text-delta → events.stream
        tool-call  → 收集 calls
        usage      → 记账
        finish     → stop | tool_calls | length
  ④ 写回 assistant（带或不带 toolCalls）——只 deposit，不重投
  ⑤ 若 calls ≠ ∅：
        status → tooling
        并行 registry.execute → 各写回 tool 结果（toolCallId 配对）
        status → thinking
        回到 ①（受 maxSteps 限制）
  ⑥ stop|length → onTurnEnd；status → idle
```

**未闭合槽位**：工具结果写回后才继续下一次快照；中止时 `#halt` 合成 assistant 收束，不把 open call 留给下轮。

---

## 2. 关键不变量

1. **自身写回不重投递**：assistant/tool 只 `deposit`，不 `notifyReady`，防止自激循环。
2. 快照非法（未决未闭合）→ 直接 return，等 fill。
3. 中断：`interrupt(id)` abort 控制器；下轮 `interrupted`。
4. 步数：`maxStepsOf`；0 视为默认上限 8，防失控。
5. 权限：execute 走 `AccessResolver`，与 materialize 同源。

---

## 3. 状态

```text
idle ↔ thinking ⇄ tooling
any → interrupted → idle
收束无信 → holding
```

由 `setStatus` 回写 kernel/lineage，并发 `events.status`。

---

## 4. 与邻接模块

```text
PostOffice.onDelivery ──► DefaultRuntime.processDelivery
                              │
              snapshotOf ──────┤（ContextPipeline / strategy）
              materializeTools ┤（ToolCapabilityRegistry）
              gateway.chat ────┘
                              │
                         post.deposit（写回）
```

组合根把 `onDelivery` 接到 `runtime.processDelivery`；Runtime 不 import kernel。

---

## 5. 文件

| 文件 | 内容 |
|---|---|
| `DefaultRuntime.ts` | 轮循环 |
| `index.ts` | 唯一出口 |

## 6. 依赖

`model` / `gateway` / `tools` / `post` / `events`。不依赖 kernel 实现。
