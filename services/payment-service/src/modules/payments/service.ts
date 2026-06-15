import { redis } from '../../config/redis'
import { db } from '../../config/database'

interface PaymentPayload {
  reservation_id:  string
  user_id:         string
  amount:          number
  currency:        string
  idempotency_key: string
  flight_id:       string
  seat_id:         string
}

interface PaymentResult {
  success:   boolean
  paymentId: string
  reason?:   string
}

const IDEMPOTENCY_TTL = 86_400 // 24 horas

export abstract class PaymentService {
  static async process(payload: PaymentPayload): Promise<PaymentResult> {
    // ── 1. Idempotência via Redis ─────────────────────────────────────────────
    const idempKey = `payments:idempotency:${payload.idempotency_key}`
    const cached   = await redis.get(idempKey)
    if (cached) {
      console.log(`[Payment] Processamento duplicado detectado — ${payload.idempotency_key}`)
      return JSON.parse(cached) as PaymentResult
    }

    // ── 2. Verifica se já existe no banco ────────────────────────────────────
    const existing = db.query(
      `SELECT id, status FROM payment_orders WHERE reservation_id = ?`
    ).get(payload.reservation_id) as { id: string; status: string } | null

    if (existing) {
      return { success: existing.status === 'captured', paymentId: existing.id }
    }

    // ── 3. Simula autorização de pagamento (90% de taxa de sucesso) ──────────
    const success    = Math.random() < 0.9
    const paymentId  = crypto.randomUUID()
    const dbStatus   = success ? 'captured' : 'failed'
    const providerRef = success ? `MOCK-${Date.now()}` : null

    db.query(`
      INSERT INTO payment_orders
        (id, reservation_id, user_id, amount, currency, status, idempotency_key, provider_ref)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      paymentId, payload.reservation_id, payload.user_id,
      payload.amount, payload.currency, dbStatus,
      payload.idempotency_key, providerRef
    )

    // ── 4. Registra notificação simulada ─────────────────────────────────────
    PaymentService.logNotification(
      payload.user_id,
      payload.reservation_id,
      success ? 'payment_confirmed' : 'payment_failed'
    )

    const result: PaymentResult = {
      success,
      paymentId,
      reason: success ? undefined : 'Pagamento recusado pela operadora.',
    }

    // ── 5. Armazena resultado idempotente ────────────────────────────────────
    await redis.set(idempKey, JSON.stringify(result), 'EX', IDEMPOTENCY_TTL)

    console.log(
      `[Payment] ${success ? '✓ APROVADO' : '✗ RECUSADO'} — ` +
      `reserva ${payload.reservation_id}, valor ${payload.amount} ${payload.currency}`
    )

    return result
  }

  static findById(paymentId: string) {
    return db.query(
      `SELECT * FROM payment_orders WHERE id = ?`
    ).get(paymentId) ?? null
  }

  private static logNotification(userId: string, reservationId: string, template: string): void {
    const notifId = crypto.randomUUID()
    db.query(`
      INSERT INTO notifications (id, user_id, reservation_id, template, status, sent_at)
      VALUES (?, ?, ?, ?, 'sent', datetime('now'))
    `).run(notifId, userId, reservationId, template)

    console.log(`[Notification] ${template} → usuário ${userId} (reserva ${reservationId})`)
  }
}
