import { getChannel, publish } from '../../config/rabbitmq'
import { PaymentService } from '../payments/service'

interface PaymentRequestPayload {
  reservation_id:  string
  user_id:         string
  flight_id:       string
  seat_id:         string
  amount:          number
  currency:        string
  idempotency_key: string
}

export async function startPaymentRequestConsumer(): Promise<void> {
  const channel = getChannel()
  await channel.prefetch(1)

  channel.consume('q.payment.requested', async (msg) => {
    if (!msg) return
    try {
      const payload = JSON.parse(msg.content.toString()) as PaymentRequestPayload
      console.log(`[Consumer] payment.requested — reserva ${payload.reservation_id}`)

      const result = await PaymentService.process(payload)

      if (result.success) {
        publish('payment.succeeded', {
          reservation_id: payload.reservation_id,
          seat_id:        payload.seat_id,
          flight_id:      payload.flight_id,
          payment_id:     result.paymentId,
        })
      } else {
        publish('payment.failed', {
          reservation_id: payload.reservation_id,
          seat_id:        payload.seat_id,
          flight_id:      payload.flight_id,
          reason:         result.reason,
        })
      }

      channel.ack(msg)
    } catch (err) {
      console.error('[Consumer] payment.requested falhou:', err)
      channel.nack(msg, false, false) // envia para DLX após falha
    }
  })

  console.log('[Consumer] payment-request consumer iniciado')
}
