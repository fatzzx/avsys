FROM oven/bun:1.2-alpine AS base

RUN apk add --no-cache curl

WORKDIR /app

COPY package.json ./
RUN bun install --production

COPY . .

RUN mkdir -p /app/data

EXPOSE 3003

CMD ["bun", "src/index.ts"]
