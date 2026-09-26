# context —— 上下文簇（管道 + 策略 + 打戳）

> 落实 `docs/architecture.md` 3.4。  
> 上下文 = **策略对有效语料的投影**。本模块把「一封信如何变成模型眼前的一段对话」写清楚：管道负责时序，策略负责整理，打戳负责可审计的投影。

与邻接模块的分工（上下文簇三件套）：

| 成分 | 模块 | 管什么 |
|---|---|---|
| 邮局 | `post` | 收集、未决、合并窗口、投递 |
| 管道 | `context/pipeline` | 预处理→入库→编排→通知 |
| 策略 | `context/strategies` | `orchestrate` 投影与记忆整理 |

依赖单向：pipeline → post；pipeline → 策略契约；**策略不拥有邮局/族谱**。

---

## 1. 全链路时序（收件 → 快递员）

```text
┌─────────────┐
│  信件到达    │  user 敲入 / 工具结果 / 运行时写回 / 兑现回填
└──────┬──────┘
       ▼
┌─────────────┐
│  预处理      │  代数校验 · from 确定 · 打戳采集 · 未决登记/兑现（与 post 协作）
└──────┬──────┘
       ▼
┌─────────────┐
│  入库        │  post.deposit（顺序 = classic 基线）
└──────┬──────┘
       ▼
┌─────────────┐
│  策略编排    │  触发才 process（compact/dream）→ orchestrate 投影
└──────┬──────┘
       ▼
┌─────────────┐
│  通知快递员  │  post.notifyReady(agentId, reason, [env])
└──────┬──────┘
       ▼
┌─────────────┐
│  合并窗口    │  post 倒计时，窗口内信件累积
└──────┬──────┘
       ▼
┌─────────────┐
│  取快照出模  │  Runtime 调 pipeline.snapshot → 网关
└─────────────┘
```

`ContextPipeline.enter()` 一次调用覆盖「预处理→入库→（可选 process）→通知」；合并窗口与真正送出在 post/Runtime。

---

## 2. 管道 API

### 2.1 `enter(envelope, trigger)`

```text
① 形状预检（toolCallId 等）
② collectStamp：按 stamp 配置打戳
③ post.deposit
④ 若策略有 process → 可跑整理（不抛到送信链路）
⑤ post.notifyReady(agentId, trigger, [stamped])
```

`Trigger`：`user_prompt | tool | manual | watermark | fill`——即「为什么现在要送」。

### 2.2 `snapshot(agentId)`

取策略 `orchestrate(view, 'manual')` 的投影；若序列非法返回 `[]`（绝不把未闭合前缀送网关）。

### 2.3 `invalidateAndReproject`

信封 `valid=false` 后重投影；Message 本体不变（审计友好）。

---

## 3. 策略契约

```ts
interface ContextStrategy {
  name: string
  orchestrate(view, trigger): { messages: Message[]; ready?: Trigger }
  ownedTools?: ToolCapability[]
  note?: string                    // system 贡献者
  process?(view, trigger): Promise<OrchestrateResult | undefined>
}
```

| 约定 | 说明 |
|---|---|
| `orchestrate` | 纯投影；返回值**必须**过 Message 后继表 |
| `process` | 异步整理；**绝不 throw 到送信链路**；失败只影响整理 |
| `ownedTools` | 并入工具表（如 cortex 笔记工具） |
| `note` | 实例化时拼进 system 贡献者 |

`CorpusView` 只读：`agentId / envelopes / ctxTokens / stamp`。策略**不能** spawn 实例、不能直调邮局；要延迟只用未决 toolCall（如 `agent_pause`）。

### 内置策略

| 名 | 投影 | process |
|---|---|---|
| `classic` | 有效序直出 | 水位 `compactAt` 触发基线压缩 |
| `none` | 空（面板态） | 无 |
| `cortex` | （后续）LTM∥STM∥上下文+笔记清单 | 两段 dream |

---

## 4. 打戳（stamp.ts）

```text
stem.jsonc → context.stamp = { source?, timestamp?, delay?, tokens? }
```

| 阶段 | 行为 |
|---|---|
| **采集** | `collectStamp` 写进 Envelope.stamp；时间可重写 at |
| **投影** | `projectStamp` 可选在 Content 前插 `[from=… at=… tokens=…]` |

信封必采集 `from`；是否让 LLM 看见由 `source` 开关控制。采集与投影**分离**，审计与提示词互不绑架。

---

## 5. classic 细节

**orchestrate**：`projectMessages` → `validateSequence`。  
若语料仍有未闭合 call → 返回空投影（上层继续等 fill），避免非法快照。

**process（基线 compact）**：`ctxTokens ≥ compactAt` 时：

```text
[m0 m1 m2] [mid 占位] [tn-2 tn-1 tn0]
```

占位是 `user` 文本，保证后继合法。真正摘要式压缩（LLM 调 `complete`）在 ToolAgent 就绪后升级；基线保证系统可跑、可测。

---

## 6. 不变量

1. 策略输出必须过 3.2.2；管道在 snapshot 再验一次。
2. 未决未闭合 → 不形成完整快照。
3. 自身写回历史不自动重投递（enter 的 notify 由调用方按来源决定）。
4. 策略 `process` 失败 fail-soft。
5. 无通用 Waiter；延迟只经 pending toolCall。

---

## 7. 文件

| 文件 | 内容 |
|---|---|
| `types.ts` | Trigger / CorpusView / ContextStrategy |
| `stamp.ts` | 采集与投影 |
| `pipeline.ts` | ContextPipeline |
| `strategies/classic.ts` | 直出 + 基线 compact |
| `strategies/none.ts` | 空投影 |
| `strategies/index.ts` | 策略注册表 |
| `index.ts` | 唯一出口 |

## 8. 依赖

`model`（Message 校验）、`post`（deposit/notifyReady）、`tools`（ownedTools 类型）。不依赖 kernel/gateway。
