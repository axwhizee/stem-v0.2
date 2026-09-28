# stem 接口清单（api）

> **实现公开面**全量；设计不变量见 `docs/architecture.md`，纪律见 `docs/contributor.md`。  
> 只收录各模块 `index.ts` 出口；跨模块禁直引内部文件。  
> 正式 tag 前统一总定稿；日常改动随出口同步。

---

## 1. 模块公开面

### 1.1 `src/core/model`

| 符号 | 摘要 |
|---|---|
| `AgentID` `makeAgentID` `ROOT_AGENT_ID` | 出生路径 |
| `parentIdOf` `childAgentID` `isAncestorOf` `canReach` `compareAgentID` | 拓扑代数 |
| `AccessState` `raiseAccess` `convergeAccess` `transitionAccess` | 权限三态 |
| `Message` `ContentPart` `ToolCall` `MessageIssue` | 统一消息 |
| `validateSuccessor` `validateSequence` `nextLegal` `textContent` | 后继表 |
| `Envelope` `Stamp` `invalidate` | 信封 |
| `ClassGenes` `InstanceIncoming` `EffectiveAttrs` `RuntimeAttrs` | 属性表 |
| `inherit` `applyClass` `applyInstance` `canWrite` `rootEffective` | 收敛 |
| `RUNTIME_WRITABLE` | 写面字段全集 |

### 1.2 `src/core/lineage`

| 符号 | 摘要 |
|---|---|
| `LineageTree` | 门面：attach/replay/children/canReach/profileOf/tombstone |
| `NodeConfig` `AccessProfile` `LineageNode` | 配置与档案 |

### 1.3 `src/core/post`

| 符号 | 摘要 |
|---|---|
| `PostOffice` | deposit/notifyReady/fillPending/broadcast |
| `Delivery` `PendingCall` `TimerPort` | 投递与定时端口 |
| `ContextStrategy` `CorpusView` `Trigger` | 策略契约 |
| `ContextPipeline` | enter/snapshot |
| `createClassicStrategy` `createNoneStrategy` `createStrategyRegistry` | 内置策略 |
| `collectStamp` `projectMessages` | 打戳 |

### 1.4 `src/core/gateway`

| 符号 | 摘要 |
|---|---|
| `ModelGateway` `LLMRequest` `LLMEvent` | 网关契约 |
| `toChatMessage` `toProtocolContent` | Message→协议 |
| `createOpenAiCompatibleGateway` `FakeGateway` `GatewayError` | 实现与替身 |

### 1.5 `src/core/tools`

| 符号 | 摘要 |
|---|---|
| `ToolCapability` `ToolContext` `ToolResult` | 工具契约 |
| `ToolCapabilityRegistry` | drain/materialize/execute |
| `toolOk` `toolError` `fromThrown` `validateArgs` | 输出与校验 |

### 1.6 `src/core/toolagent` / `pilot` / `runtime` / `kernel` / `boot` / `ports` / `events` / `logging` / `config`

| 模块 | 典型出口 |
|---|---|
| toolagent | `createToolAgent` `createInvokeTool` |
| pilot | `createPilot` |
| runtime | `DefaultRuntime` |
| kernel | `Kernel` `KernelIssue` |
| boot | `createSystem` `restoreInstances` `restoreEnvelopes` |
| ports | `MessageStore` `InstanceStore` `MemoryMessageStore` `MemoryInstanceStore` |
| events | `EventHub` `PilotEvent` |
| logging | `Logger` `LogSink` `MemoryLogSink` |
| config | `StemConfig` `parseStemConfig` `defaultStemConfig` |

### 1.7 `extension`

| 路径 | 出口 |
|---|---|
| `extension/agent` | `loadAgentClassDir` `parseAgentClassFile` |
| `extension/strategy` | `createCortexStrategy` `spliceNoteSlot` |
| `extension/tools` | `createReadTool` `createWriteTool` `createEditTool` `createGrepTool` `createGlobTool` `createBashTool` `createSkillTool` `createWebfetchTool` `createWebsearchTool` `loadMcpTools` `parseMcpConfig` |

---

## 2. 高价值端口速查

| 端口 | 注入方 | 消费者 |
|---|---|---|
| `ModelGateway` | shell/host | Runtime / ToolAgent |
| `TimerPort` | shell/host | PostOffice |
| `MessageStore` / `InstanceStore` | shell/host SQLite | boot restore / write-through |
| `AccessResolver` | lineage | tools.execute |
| `LogSink` | shell/host | Logger |
| `ShellRunner` | shell/host | extension bash |

---

## 3. 装配面

```text
shell/host/bootStem
  → ensureSpace + loadStemConfig + buildGateway
  → loadAgentClassDir(extension/agent + .stem/agent)
  → createSystem(HostPorts)          // 唯一 new
  → DefaultRuntime + restore + write-through
  → createPilot
```

宿主入口：`bootStem`。core 不读 env/fs。

---

## 4. 文件契约（stem 空间）

```text
<projectRoot>/.stem/
  stem.jsonc     唯一配置
  agent/         custom 类（与 extension/agent 同构）
  strategy/      custom 策略（与 extension/strategy 同构）
  tools/         custom 工具（读入默认 hidden）
  home/<id>/     agent 私有面（笔记等）
  assets/        多模态资产
  stem.db        SQLite（宿主实现）
```

`stem.jsonc` 要点：`user.model` 必填；`providers.*.key_env` 密钥只经 env 名；`stamp`；`user.sendCountdown`；extension 点名进 `extensions`。

---

## 5. HTTP / shell 面

| 入口 | 协议 |
|---|---|
| `npm run shell` | stdin/stdout + pilot |
| `npm run web` | `/` `/api/health` `/api/events` (SSE) `/api/send` |
| `npm run dashboard` | 只读 `/api/health` `/api/instances` `/api/tools` `/api/messages/:id` |

写口一律经 pilot；dashboard 无扮演写口。

---

## 6. 对拍保真

- 出口消失/改名：更新本表 + 契约测试锚点。  
- 机械事实以 `index.ts` 为准；本表只增语义。
