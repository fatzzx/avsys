import { db } from './database'

export type EventType =
  | 'lock.acquired'
  | 'lock.failed'
  | 'lock.released'
  | 'db.transaction'
  | 'rabbitmq.published'
  | 'payment.succeeded'
  | 'payment.failed'
  | 'reservation.confirmed'
  | 'reservation.cancelled'

export function logEvent(
  type: EventType,
  source: string,
  target: string,
  label?: string,
  payload?: object,
) {
  try {
    db.query(
      `INSERT INTO events (type, source, target, label, payload) VALUES (?, ?, ?, ?, ?)`,
    ).run(type, source, target, label ?? null, payload ? JSON.stringify(payload) : null)
  } catch {
    // never crash main flow
  }
}

export function getRecentEvents(limit = 50, since = 0) {
  return db.query(
    `SELECT * FROM events WHERE id > ? ORDER BY id DESC LIMIT ?`,
  ).all(since, limit)
}
