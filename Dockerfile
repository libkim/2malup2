# syntax=docker/dockerfile:1

# ---- build ----
FROM node:24-alpine AS build
WORKDIR /app

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

COPY . .
# 클라이언트(dist)와 서버 번들(dist-server)을 만든다
RUN yarn build

# ---- run ----
# ws까지 dist-server/index.js 하나에 묶여 있어서 node_modules가 필요 없다
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server

# 플랫폼(Railway, Render, Fly.io, Cloud Run 등)이 주입하는 PORT를 따른다
ENV PORT=8080
# 플랫폼 프록시 뒤에서 도는 것을 전제로 X-Forwarded-For를 클라이언트 IP로 쓴다. 프록시 없이 직접 노출할 때는 0으로 바꾼다
ENV TRUST_PROXY=1
EXPOSE 8080
USER node
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:${PORT}/healthz || exit 1
CMD ["node", "dist-server/index.js"]
