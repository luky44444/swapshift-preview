FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public
ENV NODE_ENV=production
ENV HOST=0.0.0.0
EXPOSE 8080
CMD ["node", "--experimental-sqlite", "src/server.js"]
