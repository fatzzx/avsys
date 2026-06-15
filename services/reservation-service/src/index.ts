import { Elysia, t } from 'elysia'
import { cors } from '@elysiajs/cors'
import './config/database'
import { connect } from './config/rabbitmq'
import { reservationsController } from './modules/reservations/index'
import { startPaymentConsumer } from './modules/consumers/payment.consumer'
import { getRecentEvents } from './config/event-logger'

const PORT = Number(process.env.PORT ?? 3002)

async function main() {
  await connect()
  await startPaymentConsumer()

  const app = new Elysia()
    .use(cors())
    .use(reservationsController)
    .get('/events', ({ query }) => getRecentEvents(
      Math.min(Number(query.limit ?? 50), 100),
      Number(query.since ?? 0),
    ), {
      query: t.Object({
        limit: t.Optional(t.Numeric({ default: 50 })),
        since: t.Optional(t.Numeric({ default: 0 })),
      }),
    })
    .get('/health', () => ({
      status:  'ok',
      service: 'reservation-service',
      port:    PORT,
    }))
    .listen(PORT)

  console.log(`[reservation-service] http://localhost:${app.server?.port}`)
}

main().catch(console.error)
