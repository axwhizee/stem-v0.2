# 发布形态（单文件 / 编译）

> 开发期 Node + tsx 足够；正式分发可选 SEA 或 Bun compile。

## Node SEA（已验证可行）

| 项 | 说明 |
|---|---|
| 脚本 | `script/build-exe.ts` + 统一入口 `bin/stem.ts` |
| 链路 | esbuild → cjs → `node --experimental-sea-config` → postject |
| 体积 | ~94MB（整颗 node 运行时） |
| 动态工具 | Node type-stripping 可载简单 `.ts` custom 工具 |

**踩坑**：

1. `jsonc-parser` 必须 ESM 入口；UMD 会被 SEA 误判 builtin。  
2. `node:sqlite` 标 external。  
3. 静态页构建期内嵌（`static.gen.ts`），勿 `new URL` 运行时读。  
4. PowerShell 写配置避免 BOM。

## Bun compile（规划优先）

| 项 | 说明 |
|---|---|
| 体积 | 46–63MB（opencode 量级） |
| Web 内嵌 | `$bunfs` + `import {type:'file'}` |
| 迁移 | 测试与 sqlite 需对齐 Bun API |

## 建议

- 开发：Node + npm scripts  
- 服务部署：Docker  
- 便携 exe：SEA 作保守备选；1.0 正式版优先 Bun compile  

**绝不**把用户 `.stem/` 空间打进 exe/镜像层（体积与隐私）。
