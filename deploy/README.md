# deploy —— 部署方案

> 面向操作的发布/部署手册；机制见 `docs/architecture.md`，接口见 `docs/api.md`。  
> 一空间一进程；密钥只经 env；容器即 bash 爆炸半径。

## 方案一览

| 形态 | 入口 | 适用 |
|---|---|---|
| **源码直跑** | `npm install` → `npm run shell\|web\|dashboard` | 开发、单机 |
| **Docker Web 服务** | `deploy/Dockerfile` + 本目录脚本 | 服务器/局域网常驻 |
| **单文件可执行** | `script/build-exe.ts`（Node SEA，试验） | 分发便携 exe |
| **Bun compile**（规划） | 发布矩阵 | 体积更小的正式发行 |

## 空间与密钥

```text
<projectRoot>/.stem/     配置 + 类/策略/工具 + home/ + stem.db
STEM_PROJECT_ROOT        空间根（容器内通常 /data）
providers.*.apiKeyEnv    只声明变量名；值走进程 env，不写镜像/配置
```

## 快速索引

| 文档 | 内容 |
|---|---|
| [native.md](./native.md) | 源码运行、npm 脚本、环境 |
| [docker.md](./docker.md) | 镜像构建、volume、健康检查、一键脚本 |
| [release.md](./release.md) | SEA / Bun compile 发布形态与取舍 |

## 安全底线

1. 容器边界 = bash 爆炸半径；挂载的 `/data` 即操作面。  
2. 非 root 运行；密钥零打印、零落盘。  
3. 开发期 schema 零兼容；生产升级前备份 `.stem/`。
