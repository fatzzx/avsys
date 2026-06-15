import Redis from 'ioredis'

export const redis = new Redis({
  host: process.env.REDIS_HOST ?? 'localhost',
  port: Number(process.env.REDIS_PORT ?? 6379),
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => Math.min(times * 200, 2000),
  lazyConnect: false,
})

redis.on('connect', () => console.log('[Redis] conectado'))
redis.on('error', (err) => console.error('[Redis] erro:', err.message))
