# toolagent —— ToolAgent 与 invoke

> 落实 `docs/architecture.md` 3.7。  
> ToolAgent 是**系统直调的单轮工具执行体**：给一段消息，在冻结的工具子集里和模型打若干回合，拿回文本与增量。它**不属于实例树**，不写语料，用来做策略整理、内部编排等「不该是一个 agent 实例」的活。

---

## 1. 为什么不是「再造一个 agent」

| | 普通实例 | ToolAgent |
|---|---|---|
| 族谱登记 | 是 | **否** |
| 语料/邮局 | 是 | **否**（系统直调） |
| 属性表/策略 | 是 | 否；只有 spec |
| 调用方式 | 送信驱动轮循环 | `complete(messages)` 同步等待 |

策略整理（compact/dream）若 spawn 实例，会污染族谱并引入权限旁路；ToolAgent 把「需要一次模型往返」收成纯函数式端口。

---

## 2. Spec 与 create

```text
createToolAgent(spec, deps)

spec = {
  system?, model, tools: string[]  // 冻结表点名
  maxSteps?                        // 默认 8
}

deps = {
  gateway, registry, access, parseModel
}
```

- **清单冻结**：`tools` 必须是注册表已有名；缺名抛 `tool_unresolvable`（创建期失败，不半死不活）。
- **身份**：execute 时 `agentId = 'toolagent'`；权限走注入的 `AccessResolver`（可绑 principal 档案或注册声明）。

---

## 3. complete 循环

```text
complete({ messages, signal? })
  transcript = copy(messages)
  for step in 0..maxSteps:
      gateway.chat({ model, system?, messages: transcript, tools })
      累积 text-delta / tool-call / usage / finish
      push assistant（带或不带 toolCalls）
      若无 toolCalls → 结束（stop|length）
      否则逐条 registry.execute → push tool 结果（toolCallId 配对）
  返回 { text, messages 增量, toolRounds, finish, usage? }
```

不变量：

1. 返回的 `messages` 必须能过 Message 后继表；若有非法尾则裁掉再交。
2. `finish`：无工具收束 → `stop`/`length`；打过工具轮 → 至少记录 `tool_calls`，长度触顶则 `length`。
3. `signal` 中止经 gateway/tools 传播；不吞 AbortError。
4. **不** deposit、**不** notifyReady——调用方自己决定是否写回实例语料。

---

## 4. invoke（internal 工具）

```text
createInvokeTool(agent) → ToolCapability
  execute({ prompt }) → complete([user: prompt]) → tool_ok(text)
```

- 外层：实例的模型看见的是**一条** `invoke` 工具记录。
- 内层：ToolAgent 用自己的清单与身份，**不**继承调用者的实例权限面。
- 用途：把「多回合工具工作」封装成一次调用，便于父代理派活而不开子实例。

---

## 5. 与策略的关系

```text
classic.process / cortex.dream
  → toolAgent.complete({ messages: [压缩指令 + 原文摘录] })
  → 拿回摘要/报告文本
  → 写回语料或 home/ 派生文件
```

策略**禁止** spawn 实例；要 LLM 只经 complete 端口。

---

## 6. 文件

| 文件 | 内容 |
|---|---|
| `ToolAgent.ts` | createToolAgent / complete / createInvokeTool |
| `index.ts` | 唯一出口 |

## 7. 依赖

`model`（Message）、`gateway`、`tools`。不依赖 kernel/post/lineage。
