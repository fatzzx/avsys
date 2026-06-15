import amqplib from 'amqplib'
import type { Channel, Connection } from 'amqplib'

const EXCHANGE = 'airline.events'
const DLX = 'airline.dead-letter'

let connection: Connection | null = null
let _channel: Channel | null = null

export async function connect(retries = 10): Promise<Channel> {
  const url = process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672'

  for (let i = 1; i <= retries; i++) {
    try {
      connection = await amqplib.connect(url)
      _channel = await connection.createChannel()

      await _channel.assertExchange(EXCHANGE, 'topic', { durable: true })
      await _channel.assertExchange(DLX, 'fanout', { durable: true })

      const queues = [
        'q.payment.requested',
        'q.payment.succeeded',
        'q.payment.failed',
      ]
      for (const q of queues) {
        await _channel!.assertQueue(q, {
          durable: true,
          arguments: { 'x-dead-letter-exchange': DLX },
        })
      }
      await _channel.assertQueue('q.dead-letter', { durable: true })

      await _channel.bindQueue('q.payment.requested', EXCHANGE, 'payment.requested')
      await _channel.bindQueue('q.payment.succeeded', EXCHANGE, 'payment.succeeded')
      await _channel.bindQueue('q.payment.failed',    EXCHANGE, 'payment.failed')
      await _channel.bindQueue('q.dead-letter', DLX, '#')

      connection.on('close', () => {
        console.error('[RabbitMQ] conexão encerrada — reconectando...')
        setTimeout(() => connect(), 5000)
      })

      console.log('[RabbitMQ] conectado')
      return _channel
    } catch {
      console.error(`[RabbitMQ] tentativa ${i}/${retries} falhou`)
      if (i === retries) throw new Error('RabbitMQ indisponível após todas as tentativas')
      await Bun.sleep(3000)
    }
  }
  throw new Error('RabbitMQ connection failed')
}

export function getChannel(): Channel {
  if (!_channel) throw new Error('RabbitMQ não inicializado — chame connect() primeiro')
  return _channel
}

export function publish(routingKey: string, payload: unknown): void {
  const ch = getChannel()
  ch.publish(
    EXCHANGE,
    routingKey,
    Buffer.from(JSON.stringify(payload)),
    { persistent: true, contentType: 'application/json' }
  )
}
