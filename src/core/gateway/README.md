# gateway —— 模型网关

> 落实 `docs/architecture.md` 2.3 / 3.1.2。  
> 网关是 core 里**唯一**接触「外部模型服务」的边界：把领域 Message 送到 OpenAI 兼容接口，再把 SSE 流收成统一事件。它不管记忆、不管工具执行、不读 `process.env`、不写死任何 URL——端点与密钥由宿主装配时注入。

---

## 1. 调用链上它做什么

```text
Runtime（单轮）
  → 组装 LLMRequest（model + system + messages + tools + 采样参数）
  → gateway.chat(request, { signal })
  → for await (事件)：
        text-delta / reasoning-delta  → 流式展示或缓冲
        tool-call                     → 登记未决、并行执行
        usage                         → 记账 ctxTokens/totalTokens
        finish                        → 闭合本轮
```

**单向出口**：领域 Message →（`mapping.ts`）→ 协议 ChatMessage → 线上 JSON。反向不自动还原 Message——回写由 Runtime 按事件拼 assistant/tool 消息（并过 Message 后继表）。

---

## 2. 两层消息形状

### 2.1 领域 Message（model 模块）

`kind + ContentPart[] + toolCalls? + toolCallId?`，语义见 `src/core/model/README.md`。

### 2.2 协议 ChatMessage（本模块）

| 字段 | 说明 |
|---|---|
| `role` | 与 kind 同名四型 |
| `content` | `string \| ProtocolContentPart[]` |
| `toolCalls?` | `arguments` 为 **JSON 字符串**（线上形状） |
| `toolCallId?` | tool 结果对应 id |

`ProtocolContentPart`：

| type | 字段 | 线上形态 |
|---|---|---|
| `text` | `text` | `{type:'text',text}` |
| `image` | `url?` / `data?` / `mime?` / `detail?` | `{type:'image_url',image_url:{url,detail}}`；`data` 先编 data URL |

audio/video/file：**先**由宿主/策略投影成文本占位再进网关（architecture 允许非 text 投影为占位），避免协议无限膨胀。

### 2.3 mapping.ts

```text
toProtocolContent(parts)  ContentPart[] → ProtocolContentPart[]
toChatMessage(message)    Message → ChatMessage（含 toolCalls 序列化）
```

只投影协议字段；`tag/valid/from/turn` 等信封字段绝不进请求体。

---

## 3. 契约与事件

```ts
interface ModelGateway {
  chat(request: LLMRequest, options?: { signal?: AbortSignal }): AsyncIterable<LLMEvent>
}
```

### LLMRequest

| 字段 | 必填 | 说明 |
|---|---|---|
| `model` | 是 | `{provider, id}`；`parseModelRef('openai/gpt-x')` |
| `messages` | 是 | 协议消息数组 |
| `system?` | | 单独字段，实现里编成 `role:system` 置顶 |
| `tools?` | | `ToolDefinition[]`（name/description/parameters） |
| `maxTokens?` / `temperature?` / `reasoningEffort?` | | 采样与思考强度 |

### LLMEvent（判别联合）

| type | 载荷 | 消费方 |
|---|---|---|
| `text-delta` | `text` | 拼 assistant 文本 |
| `reasoning-delta` | `text` | 思维链展示/折叠 |
| `tool-call` | `id,name,input`（input 已 parse） | 登记 pending、开工具轮 |
| `usage` | `inputTokens,outputTokens,cache*` | 账目 |
| `finish` | `reason: stop\|tool_calls\|length` | 本轮收束 |

---

## 4. OpenAI 兼容实现（考古自旧库，按新契约改写）

### 4.1 配置（宿主注入）

```ts
createOpenAiCompatibleGateway({
  baseUrl,          // 必填；POST {base}/chat/completions
  apiKey?,          // Bearer；缺省匿名，不发 Authorization
  models?,          // 白名单；空=全开；未命中 → model_not_allowed
  requestTimeoutMs?, // 首包超时，默认 300_000
  fetch?,           // 测试可注
})
```

零端点常量、零 env：多 provider 路由与厂商头（UA、session）在 **shell 宿主** `buildGateway` 完成，core 不感知。

### 4.2 请求体

```text
model = request.model.id          // provider 是路由概念，不进协议
messages = [system?] + messages
stream = true
stream_options.include_usage = true
tools / max_tokens / temperature / reasoning_effort（none 不发送）
```

### 4.3 SSE 解析状态机

```text
读流 → 按行拆 → 取 'data:' → JSON
  ├─ chunk.error           → 抛 GatewayError
  ├─ delta.content         → text-delta
  ├─ delta.reasoning_content | delta.reasoning → reasoning-delta
  ├─ delta.tool_calls[]    → 按 index 累积 {id,name,argsBuffer}
  ├─ finish_reason         → 冲刷 tool-call 事件 + finish
  └─ usage                 → usage 事件（常在末包）
```

**tool_calls 增量拼接**（实测教训）：

- 同一 `index` 的多片：`name`/`arguments` 字符串拼接。
- **空 `id` 尾片不得覆盖首片真 id**，否则整个工具链静默失败。

**finish_reason 归一**：`tool_calls`→`tool_calls`；`length|max_tokens`→`length`；其余→`stop`。

### 4.4 错误分类

| 条件 | kind | retryable |
|---|---|---|
| 模式集命中「过长/超窗」且非限流文案 | `context_overflow` | 否 |
| 413 或溢出 | `context_overflow` | 否 |
| 408/409/429/5xx | `api_error` | **是** |
| 其它 HTTP 非 2xx | `api_error` | 否 |
| body 无流 / JSON 坏 | `invalid_response` | 否 |
| 网络/中止 | `request_failed` | 否 |
| 空 baseUrl | `provider_unwired` | 否 |
| 不在 models 白名单 | `model_not_allowed` | 否 |
| 缺鉴权（宿主） | `auth_missing` | 否 |

`GatewayError` 是带 `kind/retryable/statusCode` 的 Error 子类；类型守卫 `isGatewayError`。中断用 `isAbortError`。

---

## 5. FakeGateway（测试替身）

```text
new FakeGateway(handler)   // handler 返回事件数组或异步迭代器
.textEvents(text, usage?)  // 标准纯文本回复脚本
```

- 记录 `requests[]` 供断言。
- `signal` 已中止 → 立刻 `AbortError`；流式产出中中止亦然。
- 与真网关同一 `ModelGateway` 接口，组合测试里可整棵替换。

---

## 6. 中断与超时

```text
外部 signal ──abort──► 内部 AbortController
requestTimeoutMs ──到点──► 同上（首包保护）
finally: clearTimeout + 解绑 + ctl.abort()
```

消费方标准姿势：

```ts
for await (const ev of gateway.chat(req, { signal: ctl.signal })) { ... }
```

---

## 7. 不变量

1. core 零厂商、零 env、零固定 URL。
2. 流式只以 `AsyncIterable` 暴露。
3. 协议 `arguments` 恒为字符串；领域层才用 `unknown` 对象。
4. 映射单向：Message → 协议，不反向还原审计字段。

---

## 8. 文件

| 文件 | 内容 |
|---|---|
| `types.ts` | 协议形状、LLMEvent、GatewayError |
| `ModelGateway.ts` | 接口 |
| `mapping.ts` | Message → 协议 |
| `providers/openaiCompatible.ts` | SSE 客户端 |
| `FakeGateway.ts` | 测试替身 |
| `index.ts` | 唯一出口 |

## 9. 依赖

`model`（仅 mapping）。不依赖 lineage/post/kernel。
