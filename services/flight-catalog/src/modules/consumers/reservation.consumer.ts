import { getChannel } from '../../config/rabbitmq'
import { SeatService } from '../seats/service'

export async function startReservationConsumer(): Promise<void> {
  const channel = getChannel()
  await channel.prefetch(1)

  channel.consume('q.reservation.confirmed', (msg) => {
    if (!msg) return
    try {
      const { seat_id } = JSON.parse(msg.content.toString())
      SeatService.updateStatus(seat_id, 'sold')
      console.log(`[Consumer] reservation.confirmed — assento ${seat_id} → sold`)
      channel.ack(msg)
    } catch (err) {
      console.error('[Consumer] reservation.confirmed falhou:', err)
      channel.nack(msg, false, false) // envia para DLX
    }
  })

  channel.consume('q.reservation.cancelled', (msg) => {
    if (!msg) return
    try {
      const { seat_id } = JSON.parse(msg.content.toString())
      SeatService.updateStatus(seat_id, 'available')
      console.log(`[Consumer] reservation.cancelled — assento ${seat_id} → available`)
      channel.ack(msg)
    } catch (err) {
      console.error('[Consumer] reservation.cancelled falhou:', err)
      channel.nack(msg, false, false)
    }
  })

  console.log('[Consumer] reservation consumer iniciado')
}
