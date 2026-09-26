# ports —— 宿主端口契约

> 落实 `docs/architecture.md` 2.3。core 纯逻辑、零平台依赖；平台能力只以**契约**出现，实现住 shell/宿主。

---

## 1. 存储端口

### MessageStore

| 方法 | 语义 |
|---|---|
| `append(envelope)` | 语料行写穿 |
| `list(agentId)` | 该实例信封（含 invalid，可审计） |
| `invalidate(agentId, envelopeId, tag?)` | 作废标记 |

### InstanceStore

| 方法 | 语义 |
|---|---|
| `upsert(row)` | 实例行写穿 |
| `load` / `loadAll` | 载入 |
| `archive(id)` | 墓碑归档 |

`InstanceRow = { id, attrs, runtime, tombstone? }`。  
**信封语义、归档、恢复算法**在 architecture 3.3 规定；本文件只定形状。

### 内存实现

`MemoryMessageStore` / `MemoryInstanceStore`：单测与无库冒烟。  
SQLite 实现住 shell（`node:sqlite`），与内存实现共契约，可做双实现一致性测试。

---

## 2. 其它宿主端口（契约见各消费模块）

| 端口 | 定义处 | 典型实现 |
|---|---|---|
| TimerPort | `post` | 宿主 timer |
| ModelGateway | `gateway` | openaiCompatible |
| ShellRunner | `tools`（bash） | child_process |
| ToolInitFs | `tools` | node fs |
| LogSink | `logging` | 文件/内存 |

文件窄口、动态加载、类/策略/工具回写随 shell/boot 扩展；**core 不读 env、不碰进程**。

---

## 3. 不变量

1. core 只 import 接口，不 import SQLite/fs。
2. 写穿：内存生效后落行（持久化端口可同步，对齐 node:sqlite）。
3. schema 不符拒载；开发期零兼容包袱。

## 4. 文件

| 文件 | 内容 |
|---|---|
| `store.ts` | MessageStore / InstanceStore + Memory* |
| `index.ts` | 唯一出口 |
