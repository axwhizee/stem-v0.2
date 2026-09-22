# stem 开发手册

> 面向开发者的唯一纪律落点：工作流、分层契约、命名与类型、错误模型、测试、提交。

## 读什么

| 你要做的事 | 先读 |
|---|---|
| 改 core / 加能力 | 本卷 §2–§5 + `architecture.md` 对应模型 + 该模块 README |
| 写/改文档 | 本卷 §2 分工与对拍表 |
| 跑测试 / 排查假绿 | 本卷 §7 |
| 提交 | 本卷 §8 + §10 自检 |
| 了解系统 | `README.md` → `docs/architecture.md` |

## 1. 开发工作流

1. **改前**：读 `architecture.md` 对应模型 + 相关模块 README；跨模块再读 `api.md` 该模块节。
2. **实现**：
   - **加法**（新能力）做完整，不留半成品；
   - **减法**（重构/审查）用通用机制替换补丁，删特判、去重复、灭死代码；
   - 新需求先问「既有机制能否自然表达」——能则强化、复用现有机制，不能才加新组件。
3. **验证**：`npm run typecheck` + `npm test`；跨模块改跑 `npm run test:feas` 离线档。
4. **文档**：按 §2.2 对拍表**整节重写**受影响卷，禁止缝补。
5. **提交**：先向用户报告增量，同意后再 commit（见 §7）。

---

## 2. 文档纪律

### 2.1 分工

| 卷 | 职责 | 更新时机 |
|---|---|---|
| `README.md` | **入门**：定位、特征速览、上手、文档索引 | 特征/上手变化 |
| `docs/architecture.md` | **设计**：不变量、关键模型、虚拟分层与依赖 | 跨模块机制变化 |
| 各模块 `README.md` | **实现**：本模块如何落实 architecture | 模块行为变化 |
| `docs/api.md` | **接口**：公开面全量、端口、装配/文件/HTTP | 出口变化；**tag 前总定稿** |
| `docs/scenarios.md` | **场景**：能力压力 | 新不可归约压力 |
| `AGENTS.md` | **实操**：命令、结构、坑 | 实操面变化 |
| 本卷 | **纪律**：工作流、契约、测试、提交 | 纪律/流程变化 |
| `plan.md`（根） | **计划**（gitignore） | 用后即删 |

关系：**architecture 定「是什么」→ 模块 README 写「怎么落实」→ api 列「对外出口」→ 本卷管「怎么改不烂」**。

- **实况卷只写「现在是什么」**；过时 = bug，**整节系统性重写**，禁止局部打补丁。
- **沿革由 git 提交历史承载**（行为变化写进 commit message）；不设日志卷。
- **plan 卷** = 仓库根 `plan.md`（gitignore，不入 `docs/`）；实现完成即删除。只写「将要做什么 + 为什么」，不写实况。
- **事实优先**：文档与代码冲突时，代码是真相，改文档。拿不准就读码或跑标本，禁止凭旧文档记忆推断。
- **死文字零容忍**：描述已不存在机制的段落，删掉或重写成活事实，二者必居其一。禁止把沿革写进实况（「X 已删除 / 曾经是 Y」）。

### 2.2 改动后对拍（提交前）

| 改了什么 | 必须审视（整节，不是那一句） |
|---|---|
| 设计不变量 / 关键模型 | `architecture.md` 对应节 |
| 模块行为 / 内部结构 | 该模块 `README.md` |
| 公开接口 / 端口 | `api.md` 对应节 + 契约测试锚点 |
| 配置 / 文件契约 | `api.md` 文件契约 + config 模块 README |
| 工具权限或 shape | `architecture.md` 权限节 + tools 模块 README + api |
| 新增/退役模块 | `architecture.md` 对照表 + api 分节 + `AGENTS.md` 结构树 |
| 流程 / 测试 | 本卷对应节 |
| 任何行为变化 | commit message 说清能力变化；相关卷整节重写 |

---

## 3. 分层与契约

### 3.1 分层与零平台（最高优先级硬规则）

- 虚拟分层与依赖方向以 `architecture.md` **L1–L5 + 宿主端口**为准。
- **core 禁止平台依赖与平台全局**；平台能力一律端口契约、**实现住宿主/shell**。
- **L2（族谱 / 邮局 / 网关 / 日志）是依赖源**：不得反向依赖 kernel、策略或工具服务。
- 每个模块一个 `index.ts` 唯一出口；跨模块**只 import index**。
- 装配只在组合根；禁止全局单例持跨层状态、禁止服务在构造器里 `new` 兄弟服务。
- `shell/`、`extension/` 豁免平台全局禁令；工具入口经工厂接空间根，不读隐式 cwd。

### 3.2 接口即契约

- 层间交互必须有显式 interface；**接口与默认实现同文件**（`interface X` + `class DefaultX`）。
- 消费方只依赖 interface；构造器/`options` 注入，不 import 具体实现。
- 接口方法用 `readonly` 属性形式声明（可解构、可转发）。

### 3.3 运行期写面（敏感）

- 实例参数唯一写通道 = `kernel.updateAgent`（`name` / `model` / `temperature` / `effort`）。禁止新增散点 setter。
- 类 tools 收敛硬门禁在 `kernel.updateAgentClass` 写入面；工具层只做 agent 友好预检。
- 权限与模型一律走 `LineageTree` 门面；`AccessLedger` 是内部实现，禁止直连。

---

## 4. 命名与类型

| 场景 | 规则 | 示例 |
|---|---|---|
| 文件 | 类 PascalCase；功能 camelCase | `LineageTree.ts`、`agentFile.ts` |
| 接口 | 名词，无 `I` 前缀 | `ModelGateway`、`ContextStrategyModule` |
| 实现类 | `Default` 前缀或语义名 | `DefaultRepository`、`AccessLedger` |
| 判别联合 | `type` / `kind` 域 | `PilotEvent`、`KernelError` |
| ID | branded string + 构造函数 | `AgentID`、`AgentClassID`、`makeAgentID` |
| 工具 id | 语义 snake/kebab | `agent_class_create`、`read` |
| 常量 | UPPER_SNAKE | `BASH_DEFAULTS` |

类型纪律：

- 多用 `readonly` / `interface` / `type`；**禁止 `any`**（未知用 `unknown` + 守卫）。
- `import type` 写类型导入；`noUncheckedIndexedAccess` 下索引取值必须判空。
- core 错误 = **判别联合对象**（`{ kind: ... }`），不是 Error 实例。测试用谓词断言，宿主 shell 可用 Error。

---

## 5. 错误与异步

- **高频通道 fail-soft**：extension 工具缺依赖回可行动文本给模型，不抛栈炸轮；装载期问题进 `init.issues`（不炸启动）。
- **流式**一律 `AsyncIterable`，消费方 `for await` + AbortSignal。
- **Runtime 主循环**必须有显式退出条件（无 tool_call / finish）。
- **策略 `process`** = 重入 guard + 失败兜底，**绝不抛出到送信链路**。
- **持久化端口同步**（对齐 node:sqlite）；写穿在内存生效后落行。
- 工具执行通道对带 `kind` 的领域错误**原样透传**（工具是通道不是转换器）；非结构化异常用 `errorBrief` / `execution_failed` 收口。

---

## 6. 工具与权限（改动敏感区）

- 权限语义以 `architecture.md` 为准（`hidden | allow | deny`；无 ask；书写面只紧不松）。
- 类 `tools`：**键即白名单**；`{}` = 本地封闭；**未设 = 完整继承父生效档案**。
- 改工具 shape（含 `registerAccess`）/ `AgentClass.tools` / `ToolContext` 时全量对拍：tools 模块、extension 工具、注册表出生面、系统工具 schema、族谱台账、config 模板、webui/dashboard。
- `grant` = 整表替换 + 逐键祖先封顶，仅策略 spawn 通道使用。
- 权限判定是静态查表：registry `execute` 对 deny 直接 `access_denied`，无消息化审批路径。

---

## 7. 测试

### 7.0 金字塔（模块测试 ≠ 系统测试）

```text
L5 场景/实景   scenarios；可选真网关
L4 组合 boot   组合根 + FakeGateway + 内存宿主端口
L3 模块契约    一模块一测试树；依赖全假件；钉 index 公开面行为
L2 端口一致性  同一契约跑双实现（如 MemoryStore vs SQLite）
L1 纯代数      Message 后继 / 属性表 / 权限偏序 …
```

- **单模块接口全绿 ≠ 系统必对**（接线、隐式时序、宿主实现、交错、失败语义只在更高层爆）。
- **模块测试仍是主武器**：定位快、可离线、api 可执行防漂移。
- 门槛 = **契约 + 组合 + 场景**；禁止只凭单元绿发版。
- 每个 api 公开符号至少一条行为锚点，或显式标「纯类型」。

### 7.1 单测

- 与源码同目录（`*.test.ts`），`node:test` + `node:assert/strict`。
- **不 mock 全局**——注入 fake：FakeGateway、内存 registry、mkdtemp 真 fs、kernelHarness 手动计时器、gateway `fetch?`。
- 纯逻辑抽纯函数单独测（access 代数 / JSONC / frontmatter / legalize 等）。
- 分模块：`npm run test:module -- "<glob>"`。

### 7.2 可行性冒烟

`npm run test:feas`（`test/feasibility/`）：offline1 装配/端到端/审批/书写/模型/重启；offline2 compact；online 真网关（需密钥）。

- 改 core 装配 / 族谱 / 网关 → **必须**跑离线两档。
- 发版前补跑在线档。

### 7.3 真端点教训（高价值）

1. **自造 mock 会精确隐藏它没见过的形状**——真端点冒烟不可省；抓真 SSE 原文写回归是标准流程。
2. **假阳性断言**：marker 别写进 prompt；断言指到 `role:"tool"` 行级证据。
3. **时序**：等 LLM 轮先等进 `thinking` 再等离开；compact 探针要第三轮；`prompt_tokens` 用阶梯递增，固定值会撞负差回落护栏。
4. **手动计时器**：`flushAll` 全量触发会同时炸掉长超时与 0ms 倒计时——含 `waitForReply` 的链先 pump，久无进展再 flush；配对通道守「先登记等待者、后投递触发信」。

---

## 8. 提交

- **门槛**：`npm run typecheck` 0（忽略 `reference/` 噪音）+ `npm test` 相对基线不新增失败。
- **身份**：`git -c user.name="OwlCat" -c user.email="owlcat@local" commit`。
- **提交前一律先让用户审查**。
- **message**：conventional commit；标题一句话说清功能变化；正文只列关键点。**严禁进度代号**（S7/T1/R6 之类）——历史要读出「系统多了什么能力」。
- 每功能批一次 commit；scope 用能力域（feat(kernel) / refactor(tools) / docs / test…）。
- `docs/prompts.md` 不提交。

---

## 9. 环境陷阱（开发机实录）

- nvm PATH **不跨 shell 会话**：每条命令自带 `export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"`。
- 密钥只走 env：Windows 用户变量经 `powershell.exe -NoProfile -Command "[Environment]::GetEnvironmentVariable('<NAME>','User')"` 读，只进子进程，零打印零落盘。
- 常驻服务必须 `setsid` 脱组；`pkill -f` 用 `[r]` 拆分防自噬。
- `/mnt/c` drvfs 偶发 NotFound——重试即恢复。
- loopback HTTP 测试清 `*_PROXY`；webui SSE = `/api/events`。
- SQLite：`all` 是保留字；node ≥ 23.4。
- 运行依赖 `tsx`；`jsonc-parser` / `yaml` 是 runtime dependencies。
- webui/dashboard：裸机 127.0.0.1；容器 `STEM_HOST=0.0.0.0`。

---

## 10. 提交前自检

- [ ] 层间只 import `index.ts`？core 零平台依赖？
- [ ] 依赖单向？无全局单例？
- [ ] 判别联合、无 `any`、`import type`？
- [ ] 新逻辑有同目录单测？fake 注入而非 mock 全局？
- [ ] 动了接口/配置/工具 shape → §2.2 对拍表走完（整节重写）？
- [ ] 行为变化写进 commit message？无进度代号？
- [ ] typecheck + 全量测试绿？
- [ ] 跨模块 → offline feas 跑过？发版批补在线档？
