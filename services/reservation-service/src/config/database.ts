import { Database } from 'bun:sqlite'
import { mkdirSync } from 'fs'

const DB_PATH = process.env.DB_PATH ?? 'data/reservations.db'
mkdirSync(DB_PATH.substring(0, DB_PATH.lastIndexOf('/')), { recursive: true })

export const db = new Database(DB_PATH, { create: true })

db.exec('PRAGMA journal_mode=WAL')
db.exec('PRAGMA foreign_keys=ON')
db.exec('PRAGMA busy_timeout=5000')

db.exec(`
  CREATE TABLE IF NOT EXISTS reservations (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    user_id     TEXT NOT NULL,
    flight_id   TEXT NOT NULL,
    seat_id     TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending'
      CHECK(status IN ('pending','confirmed','cancelled','expired')),
    total_price REAL NOT NULL,
    expires_at  TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS reservation_history (
    id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    reservation_id  TEXT NOT NULL REFERENCES reservations(id),
    previous_status TEXT,
    new_status      TEXT NOT NULL,
    reason          TEXT,
    changed_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_reservations_user ON reservations(user_id);
  CREATE INDEX IF NOT EXISTS idx_reservations_seat ON reservations(flight_id, seat_id);
`)

// Tabela local de assentos: reservation-service mantém seu próprio estado de disponibilidade
// para garantir atomicidade do lock otimista (version) sem depender de HTTP ao flight-catalog.
// flight-catalog é notificado via RabbitMQ e mantém o estado canônico (sold/available).
db.exec(`
  CREATE TABLE IF NOT EXISTS seats (
    id        TEXT PRIMARY KEY,
    flight_id TEXT NOT NULL,
    status    TEXT NOT NULL DEFAULT 'available'
      CHECK(status IN ('available','reserved','sold')),
    version   INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_rs_seats ON seats(flight_id, status);
`)

// Seed idempotente — espelha os assentos do flight-catalog
db.exec(`
  INSERT OR IGNORE INTO seats (id, flight_id) VALUES
    ('seat-001-1A',  'flight-001'),
    ('seat-001-1B',  'flight-001'),
    ('seat-001-10A', 'flight-001'),
    ('seat-001-10B', 'flight-001'),
    ('seat-001-20A', 'flight-001'),
    ('seat-001-20B', 'flight-001'),
    ('seat-001-20C', 'flight-001'),
    ('seat-001-21A', 'flight-001'),
    ('seat-002-1A',  'flight-002'),
    ('seat-002-10A', 'flight-002'),
    ('seat-002-20A', 'flight-002'),
    ('seat-002-20B', 'flight-002'),
    ('seat-003-1A',  'flight-003'),
    ('seat-003-20A', 'flight-003'),
    ('seat-003-20B', 'flight-003');
`)

db.exec(`
  CREATE TABLE IF NOT EXISTS events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    type       TEXT NOT NULL,
    source     TEXT NOT NULL,
    target     TEXT NOT NULL,
    label      TEXT,
    payload    TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now'))
  );

  CREATE TRIGGER IF NOT EXISTS trim_events
    AFTER INSERT ON events
    WHEN (SELECT COUNT(*) FROM events) > 500
    BEGIN
      DELETE FROM events WHERE id = (SELECT MIN(id) FROM events);
    END;
`)

console.log('[DB] reservations.db pronto')
