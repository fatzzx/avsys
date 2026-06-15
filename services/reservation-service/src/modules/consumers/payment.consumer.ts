import { getChannel, publish } from '../../config/rabbitmq'
import { ReservationService } from '../reservations/service'
import { logEvent } from '../../config/event-logger'

export async function startPaymentConsumer(): Promise<void> {
  const channel = getChannel()
  await channel.prefetch(1)

  channel.consume('q.payment.succeeded', async (msg) => {
    if (!msg) return
    try {
      const { reservation_id, seat_id, flight_id } = JSON.parse(msg.content.toString())
      console.log(`[Consumer] payment.succeeded — reserva ${reservation_id}`)

      logEvent('payment.succeeded', 'rabbitmq', 'payment-service', `reserva ${reservation_id.slice(0,8)}`)
      ReservationService.updateStatus(reservation_id, 'confirmed')
      publish('reservation.confirmed', { reservation_id, seat_id, flight_id })
      logEvent('reservation.confirmed', 'reservation-service', 'client', `reserva ${reservation_id.slice(0,8)}`)

      channel.ack(msg)
    } catch (err) {
      console.error('[Consumer] payment.succeeded falhou:', err)
      channel.nack(msg, false, false)
    }
  })

  channel.consume('q.payment.failed', async (msg) => {
    if (!msg) return
    try {
      const { reservation_id, seat_id, flight_id } = JSON.parse(msg.content.toString())
      console.log(`[Consumer] payment.failed — reserva ${reservation_id}`)

      logEvent('payment.failed', 'rabbitmq', 'payment-service', `reserva ${reservation_id.slice(0,8)}`)
      ReservationService.updateStatus(reservation_id, 'cancelled')
      ReservationService.restoreSeat(seat_id)
      publish('reservation.cancelled', { reservation_id, seat_id, flight_id })
      logEvent('reservation.cancelled', 'reservation-service', 'client', `reserva ${reservation_id.slice(0,8)}`)

      channel.ack(msg)
    } catch (err) {
      console.error('[Consumer] payment.failed falhou:', err)
      channel.nack(msg, false, false)
    }
  })

  console.log('[Consumer] payment consumer iniciado')
}
