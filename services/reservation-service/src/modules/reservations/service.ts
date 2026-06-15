import { status } from 'elysia'
import { db } from '../../config/database'
import { publish } from '../../config/rabbitmq'
import { DistributedLockService } from './lock'
import { logEvent } from '../../config/event-logger'
import type { CreateBody } from './model'

type SeatRow       = { id: string; status: string; version: number }
type ReservationRow = { id: string; status: string; expires_at: string; total_price: number; seat_id: string; flight_id: string }

const LOCK_TTL    = 30  // segundos
const PENDING_TTL = 15  // minutos

export abstract class ReservationService {
  static async create(body: CreateBody) {
    const lockKey   = `lock:seat:${body.flight_id}:${body.seat_id}`
    const lockToken = crypto.randomUUID()

    // ── 1. Tenta adquirir o lock distribuído ─────────────────────────────────
    const acquired = await DistributedLockService.acquire(lockKey, lockToken, LOCK_TTL)
    if (!acquired) {
      logEvent('lock.failed', 'reservation-service', 'redis', lockKey)
      return status(409, {
        error: 'seat_temporarily_locked',
        message: 'Assento temporariamente bloqueado por outro usuário. Tente novamente.',
      })
    }
    logEvent('lock.acquired', 'reservation-service', 'redis', lockKey)

    try {
      const reservationId = crypto.randomUUID()
      const expiresAt     = new Date(Date.now() + PENDING_TTL * 60 * 1000).toISOString()

      // ── 2. Transação SQLite ──────────────────────────────────────────────────
      const createTx = db.transaction(() => {
        // 2a. Verifica disponibilidade do assento (SELECT sem FOR UPDATE — o lock Redis
        //     já garante exclusividade; o version abaixo é segunda camada de segurança)
        const seat = db.query(
          `SELECT id, status, version FROM seats WHERE id = ? AND flight_id = ?`
        ).get(body.seat_id, body.flight_id) as SeatRow | null

        if (!seat) {
          const err = new Error('seat_not_found') as Error & { code: number }
          err.code = 404
          throw err
        }
        if (seat.status !== 'available') {
          const err = new Error('seat_not_available') as Error & { code: number }
          err.code = 409
          throw err
        }

        // 2b. Insere reserva em status 'pending'
        db.query(`
          INSERT INTO reservations (id, user_id, flight_id, seat_id, total_price, expires_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(reservationId, body.user_id, body.flight_id, body.seat_id, body.total_price, expiresAt)

        // 2c. Atualiza assento para 'reserved' — lock otimista na versão
        const upd = db.query(`
          UPDATE seats SET status = 'reserved', version = version + 1
          WHERE id = ? AND version = ?
        `).run(body.seat_id, seat.version)

        if (upd.changes === 0) {
          // Outro processo atualizou o assento entre o SELECT e o UPDATE
          const err = new Error('optimistic_lock_failure') as Error & { code: number }
          err.code = 409
          throw err
        }
      })

      createTx()
      logEvent('db.transaction', 'reservation-service', 'sqlite', `reserva criada: ${reservationId}`)

      // ── 3. Publica evento de pagamento (após COMMIT) ────────────────────────
      publish('payment.requested', {
        reservation_id:  reservationId,
        user_id:         body.user_id,
        flight_id:       body.flight_id,
        seat_id:         body.seat_id,
        amount:          body.total_price,
        currency:        'BRL',
        idempotency_key: `pay-${reservationId}`,
      })
      logEvent('rabbitmq.published', 'reservation-service', 'rabbitmq', `payment.requested → ${reservationId.slice(0,8)}`)

      return status(202, {
        reservation_id: reservationId,
        status:         'pending',
        expires_at:     expiresAt,
        message:        'Reserva criada. Aguardando confirmação de pagamento.',
      })
    } catch (err: any) {
      return status(err.code ?? 500, { error: err.message })
    } finally {
      // ── 4. Libera o lock (sempre, mesmo em caso de erro) ────────────────────
      await DistributedLockService.release(lockKey, lockToken)
      logEvent('lock.released', 'reservation-service', 'redis', lockKey)
    }
  }

  static findById(reservationId: string) {
    return db.query(
      `SELECT * FROM reservations WHERE id = ?`
    ).get(reservationId) ?? null
  }

  static findByUser(userId: string) {
    return db.query(
      `SELECT * FROM reservations WHERE user_id = ? ORDER BY created_at DESC`
    ).all(userId)
  }

  static async cancel(reservationId: string) {
    const reservation = db.query(
      `SELECT * FROM reservations WHERE id = ?`
    ).get(reservationId) as ReservationRow | null

    if (!reservation) return status(404, { error: 'reservation_not_found' })
    if (!['pending', 'confirmed'].includes(reservation.status)) {
      return status(409, { error: 'reservation_cannot_be_cancelled', status: reservation.status })
    }

    db.transaction(() => {
      db.query(
        `UPDATE reservations SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?`
      ).run(reservationId)
      db.query(
        `UPDATE seats SET status = 'available', version = version + 1 WHERE id = ?`
      ).run(reservation.seat_id)
    })()

    publish('reservation.cancelled', {
      reservation_id: reservationId,
      seat_id:        reservation.seat_id,
      flight_id:      reservation.flight_id,
    })
    logEvent('reservation.cancelled', 'reservation-service', 'client', `reserva ${reservationId.slice(0,8)}`)

    return { message: 'Reserva cancelada com sucesso.' }
  }

  static updateStatus(reservationId: string, newStatus: string): void {
    db.query(
      `UPDATE reservations SET status = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(newStatus, reservationId)
  }

  static restoreSeat(seatId: string): void {
    db.query(
      `UPDATE seats SET status = 'available', version = version + 1 WHERE id = ?`
    ).run(seatId)
  }
}
