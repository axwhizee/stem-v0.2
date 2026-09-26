# stem —— WebUI 服务镜像
# 容器即 bash 边界：/data volume = 爆炸半径；非 root；密钥只经 env。

FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    STEM_PROJECT_ROOT=/data \
    STEM_HOST=0.0.0.0 \
    PORT=4321

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src/ ./src/
COPY shell/ ./shell/
COPY extension/ ./extension/
COPY script/ ./script/

RUN mkdir -p /data && chown node:node /data
USER node

VOLUME ["/data"]
EXPOSE 4321

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4321/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--import", "tsx", "shell/webui/server.ts"]
