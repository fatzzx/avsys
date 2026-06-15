import { Database } from 'bun:sqlite'
import { mkdirSync } from 'fs'

const DB_PATH = process.env.DB_PATH ?? 'data/payments.db'
mkdirSync(DB_PATH.substring(0, DB_PATH.lastIndexOf('/')), { recursive: true })

export const db = new Database(DB_PATH, { create: true })

db.exec('PRAGMA journal_mode=WAL')
db.exec('PRAGMA foreign_keys=ON')
db.exec('PRAGMA busy_timeout=5000')

db.exec(`
  CREATE TABLE IF NOT EXISTS payment_orders (
    id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    reservation_id  TEXT NOT NULL UNIQUE,
    user_id         TEXT NOT NULL,
    amount          REAL NOT NULL,
    currency        TEXT NOT NULL DEFAULT 'BRL',
    status          TEXT NOT NULL DEFAULT 'pending'
      CHECK(status IN ('pending','authorized','captured','failed','refunded')),
    idempotency_key TEXT UNIQUE,
    provider_ref    TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id             TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    user_id        TEXT NOT NULL,
    reservation_id TEXT NOT NULL,
    channel        TEXT NOT NULL DEFAULT 'email'
      CHECK(channel IN ('email','sms','push')),
    template       TEXT NOT NULL,
    payload        TEXT NOT NULL DEFAULT '{}',
    status         TEXT NOT NULL DEFAULT 'queued'
      CHECK(status IN ('queued','sent','failed')),
    sent_at        TEXT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_payments_reservation ON payment_orders(reservation_id);
  CREATE INDEX IF NOT EXISTS idx_notifications_user   ON notifications(user_id);
`)

console.log('[DB] payments.db pronto')
