import { Elysia } from 'elysia'
import { cors } from '@elysiajs/cors'
import './config/database'
import { connect } from './config/rabbitmq'
import { paymentsController } from './modules/payments/index'
import { startPaymentRequestConsumer } from './modules/consumers/payment-request.consumer'

const PORT = Number(process.env.PORT ?? 3003)

async function main() {
  await connect()
  await startPaymentRequestConsumer()

  const app = new Elysia()
    .use(cors())
    .use(paymentsController)
    .get('/health', () => ({
      status:  'ok',
      service: 'payment-service',
      port:    PORT,
    }))
    .listen(PORT)

  console.log(`[payment-service] http://localhost:${app.server?.port}`)
}

main().catch(console.error)
