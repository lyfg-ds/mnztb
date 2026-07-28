# 使用官方 Node 22 镜像
FROM node:22-alpine

# 设置工作目录
WORKDIR /app

# 先拷贝依赖清单，利用 Docker 构建缓存
COPY package.json ./
RUN npm install --omit=dev

# 拷贝应用源码
COPY . .

# 创建数据存储目录（云托管可挂载持久卷到此路径）
RUN mkdir -p /data

# 运行时环境变量（CloudBase 会注入 PORT）
ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/data

# 暴露端口（实际端口由 CloudBase 注入的 PORT 决定）
EXPOSE 3000

# 启动应用
CMD ["npm", "start"]
