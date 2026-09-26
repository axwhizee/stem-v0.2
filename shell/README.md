# shell —— 面向用户的延伸

> shell = **平台适配 + UI**，不是领域模型。经 pilot 扮演 + 只读查询 + 事件订阅 + 宿主端口实现与 stem 世界交互。  
> extension 管能力；shell 管「人怎么用」。

## 分层

```text
shell/host     平台装配（各 shell 复用）
  platform.ts  bootStem：配置 → 网关 → createSystem → Runtime
  config.ts    空间定位 + stem.jsonc
  gateway.ts   providers 路由 + 厂商头（core 零感知）
  store.ts     SQLite MessageStore/InstanceStore
  bash.ts      ShellRunner
shell/cli      终端参考壳
shell/webui    浏览器单页（HTTP + SSE）
（后续）dashboard / feishu
```

依赖：`shell/*` → `src/core/*`。core 不依赖 shell。

## 交互面

| 形态 | 交互 |
|---|---|
| cli | stdin/stdout + pilot |
| webui | HTTP + SSE（EventHub） |
| dashboard | 只读查询 |
| feishu | 长连接 + 身份闸门 |

共同不变量：第一视角 = 扮演；一进程一空间；写入口径经 pilot/kernel；UI 细节住各 shell README。

## 文件

| 文件 | 内容 |
|---|---|
| `host/*` | 装配与端口实现 |
| `cli/main.ts` | 最小对话环 |
