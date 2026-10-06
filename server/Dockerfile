# fyt360-api 云托管容器镜像（与定时任务同镜像、不同启动命令，决策 #25⑤）
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY dist ./dist
EXPOSE 9000
# 定时触发器实例改用: CMD ["node", "dist/cron.js"]
CMD ["node", "dist/index.js"]
