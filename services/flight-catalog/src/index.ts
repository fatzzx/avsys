import { Elysia } from 'elysia'
import { cors } from '@elysiajs/cors'
import './config/database'
import { connect } from './config/rabbitmq'
import { flightsController } from './modules/flights/index'
import { seatsController } from './modules/seats/index'
import { startReservationConsumer } from './modules/consumers/reservation.consumer'

const PORT = Number(process.env.PORT ?? 3001)

async function main() {
  await connect()
  await startReservationConsumer()

  const app = new Elysia()
    .use(cors())
    .use(flightsController)
    .use(seatsController)
    .get('/health', () => ({
      status:  'ok',
      service: 'flight-catalog',
      port:    PORT,
    }))
    .listen(PORT)

  console.log(`[flight-catalog] http://localhost:${app.server?.port}`)
}

main().catch(console.error)
