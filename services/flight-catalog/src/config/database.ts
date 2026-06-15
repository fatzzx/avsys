import { Database } from 'bun:sqlite'
import { mkdirSync } from 'fs'

const DB_PATH = process.env.DB_PATH ?? 'data/flights.db'
mkdirSync(DB_PATH.substring(0, DB_PATH.lastIndexOf('/')), { recursive: true })

export const db = new Database(DB_PATH, { create: true })

db.exec('PRAGMA journal_mode=WAL')
db.exec('PRAGMA foreign_keys=ON')
db.exec('PRAGMA busy_timeout=5000')

db.exec(`
  CREATE TABLE IF NOT EXISTS airlines (
    id        TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    name      TEXT NOT NULL,
    iata_code TEXT UNIQUE NOT NULL
  );

  CREATE TABLE IF NOT EXISTS airports (
    id        TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    iata_code TEXT UNIQUE NOT NULL,
    city      TEXT NOT NULL,
    country   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS flights (
    id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    flight_number TEXT NOT NULL,
    airline_id    TEXT NOT NULL REFERENCES airlines(id),
    origin        TEXT NOT NULL,
    destination   TEXT NOT NULL,
    departure_at  TEXT NOT NULL,
    arrival_at    TEXT NOT NULL,
    base_price    REAL NOT NULL,
    status        TEXT NOT NULL DEFAULT 'scheduled'
      CHECK(status IN ('scheduled','boarding','departed','arrived','cancelled'))
  );

  CREATE TABLE IF NOT EXISTS seats (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    flight_id   TEXT NOT NULL REFERENCES flights(id),
    seat_number TEXT NOT NULL,
    seat_class  TEXT NOT NULL DEFAULT 'economy'
      CHECK(seat_class IN ('economy','business','first')),
    status      TEXT NOT NULL DEFAULT 'available'
      CHECK(status IN ('available','reserved','sold')),
    version     INTEGER NOT NULL DEFAULT 0,
    UNIQUE(flight_id, seat_number)
  );

  CREATE INDEX IF NOT EXISTS idx_flights_route      ON flights(origin, destination);
  CREATE INDEX IF NOT EXISTS idx_flights_departure  ON flights(departure_at);
  CREATE INDEX IF NOT EXISTS idx_seats_flight       ON seats(flight_id, status);
`)

// Seed apenas se o banco estiver vazio
const { c } = db.query('SELECT COUNT(*) as c FROM airlines').get() as { c: number }
if (c === 0) {
  db.exec(`
    INSERT INTO airlines (id, name, iata_code) VALUES
      ('airline-la', 'LATAM Airlines', 'LA'),
      ('airline-g3', 'Gol Linhas Aéreas', 'G3'),
      ('airline-ad', 'Azul Linhas Aéreas', 'AD');

    INSERT INTO airports (id, iata_code, city, country) VALUES
      ('apt-gru', 'GRU', 'São Paulo', 'BR'),
      ('apt-gig', 'GIG', 'Rio de Janeiro', 'BR'),
      ('apt-bsb', 'BSB', 'Brasília', 'BR');

    INSERT INTO flights (id, flight_number, airline_id, origin, destination,
                         departure_at, arrival_at, base_price) VALUES
      ('flight-001', 'LA3051', 'airline-la', 'GRU', 'GIG',
       '2026-08-15T08:00:00Z', '2026-08-15T09:10:00Z', 299.90),
      ('flight-002', 'G3 1234', 'airline-g3', 'GRU', 'BSB',
       '2026-08-15T10:00:00Z', '2026-08-15T11:30:00Z', 399.90),
      ('flight-003', 'AD4567', 'airline-ad', 'GIG', 'GRU',
       '2026-08-15T14:00:00Z', '2026-08-15T15:10:00Z', 249.90);

    INSERT INTO seats (id, flight_id, seat_number, seat_class) VALUES
      ('seat-001-1A',  'flight-001', '1A',  'first'),
      ('seat-001-1B',  'flight-001', '1B',  'first'),
      ('seat-001-10A', 'flight-001', '10A', 'business'),
      ('seat-001-10B', 'flight-001', '10B', 'business'),
      ('seat-001-20A', 'flight-001', '20A', 'economy'),
      ('seat-001-20B', 'flight-001', '20B', 'economy'),
      ('seat-001-20C', 'flight-001', '20C', 'economy'),
      ('seat-001-21A', 'flight-001', '21A', 'economy'),
      ('seat-002-1A',  'flight-002', '1A',  'first'),
      ('seat-002-10A', 'flight-002', '10A', 'business'),
      ('seat-002-20A', 'flight-002', '20A', 'economy'),
      ('seat-002-20B', 'flight-002', '20B', 'economy'),
      ('seat-003-1A',  'flight-003', '1A',  'first'),
      ('seat-003-20A', 'flight-003', '20A', 'economy'),
      ('seat-003-20B', 'flight-003', '20B', 'economy');
  `)
  console.log('[DB] flights.db — seed inserido')
}

console.log('[DB] flights.db pronto')
