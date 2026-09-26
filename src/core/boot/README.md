# boot —— 组合根

> 落实 `docs/architecture.md` 3.8（系统 init）。  
> **唯一** `new` 服务并接线的地方。boot 只持有装配过程，不持业务状态。

---

## 1. init 序列

```text
createSystem(host)
  ① 日志 / EventHub / LineageTree / PostOffice
  ② 策略 registry（默认 classic + none）
  ③ 工具 drain（host.tools + 策略 ownedTools）→ 冻结；issues 留痕
  ④ ContextPipeline（post + strategyOf + stamp）
  ⑤ Kernel（lineage + deliverFirst→pipeline）
  ⑥ 注册 user 类 → 实例化 user#0（parentId:null）
  ⑦ Pilot（send/peek 适配）
```

失败语义：

| 情况 | 行为 |
|---|---|
| 类/策略解析失败 | 拒启（throw） |
| 单工具 init 失败 | `init.issues` 留痕，不炸启动 |
| dispose | 工具 dispose（连接等） |

---

## 2. HostPorts（宿主注入）

| 端口 | 说明 |
|---|---|
| `gateway` | 模型网关 |
| `timer` | 合并窗口定时 |
| `access` | 权限解析（族谱） |
| `logSink?` / `stamp?` | 观测与打戳 |
| `tools?` / `strategies?` | 种子清单 |

shell/测试提供不同实现；core 不读文件系统、不读 env。

---

## 3. 返回 StemSystem

```text
{ lineage, post, tools, kernel, pilot, events, pipeline, dispose, init.issues }
```

上层（shell Runtime）拿这些端口驱动轮循环；**不要**绕过 kernel 写属性、绕过 pilot 写语料。

---

## 4. 依赖方向

```text
boot → kernel / tools / context / post / lineage / pilot / events / logging / gateway / model
```

无任何模块 import `boot`。

---

## 5. 文件

| 文件 | 内容 |
|---|---|
| `createSystem.ts` | 装配 |
| `index.ts` | 唯一出口 |
