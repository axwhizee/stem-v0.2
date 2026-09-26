# logging —— 只追加观测

> 落实 `docs/architecture.md` 横切日志。  
> 日志是**旁路摄像头**：谁都可以写一笔，但没有任何业务分支依赖它。出错时帮助回答「当时发生了什么」，正确时几乎感觉不到它存在。

---

## 1. 在运行链路里的位置

```text
工具 init 失败     → Logger.warn(scope, msg, data)     // 不炸启动
工具 execute 抛错  → Logger.error(...) + 结果回模型
网关非 2xx        → Logger.error('gateway', ...)
合并窗口投递      → Logger.debug('post', ...)          // 可选
```

**不是接口**：装载期问题正式通道是 `init.issues`（组合根收集）；日志是补充。读日志不能成为其它模块的正确性依赖。

---

## 2. 写入模型

### LogEvent

```text
{
  at: number          // 毫秒时间戳；Logger.log 可显式传，默认 Date.now()
  level: debug|info|warn|error
  scope: string       // 来源模块名，如 'tools' / 'gateway'
  message: string     // 短句，稳定可 grep
  data?: unknown      // 结构化补充；禁止塞密钥
}
```

### LogSink

```ts
type LogSink = { write(event: LogEvent): void }
```

宿主决定去向：内存、文件、stdout、遥测系统。core 不写文件、不起流。

### Logger

```text
bind(sink)           // 组合根注入
log / info / warn / error
```

- 未 `bind` 时全部丢弃（可空跑）。
- 无缓冲、无重试、**同步** `write`；sink 自己负责 IO 策略。

### MemoryLogSink

收集到 `events[]`，单测直接断言，例如「工具 init 失败留下 warn」。

---

## 3. 与错误模型的分工

| 通道 | 用途 |
|---|---|
| 判别联合 Issue / KernelError | 程序可分支处理的失败 |
| 工具结果文本 | 回给模型的可行动信息 |
| Logger | 给**人**事后看的观测 |

高频通道 fail-soft：extension 缺依赖 → 返回文本给模型 + 一条 warn，不抛栈炸轮。

---

## 4. 使用约定

1. `scope` 用模块名，便于过滤。
2. `message` 写「事实」（`tool init failed: mcp`），不写流水账故事。
3. `data` 可给错误 kind、工具名、耗时；**禁止** API Key、Authorization、用户隐私正文。
4. 不在热路径每 token 打日志；usage 事件级即可。

---

## 5. 不变量

1. 只追加，无读取 API（读侧是宿主/仪表盘的事）。
2. 失败安全：sink 抛错不应打断业务——由调用方包 try 或 sink 自身保证。
3. 无全局单例强制；Logger 经构造器/组合根传递。

---

## 6. 文件

| 文件 | 内容 |
|---|---|
| `Logger.ts` | LogEvent / LogSink / Logger / MemoryLogSink |
| `index.ts` | 唯一出口 |

## 7. 依赖

无。任意层可注入使用。
