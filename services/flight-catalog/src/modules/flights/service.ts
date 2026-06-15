import { db } from '../../config/database'
import { redis } from '../../config/redis'
import type { SearchQuery } from './model'

const CACHE_TTL = 300 // 5 minutos

export abstract class FlightService {
  static async search(query: SearchQuery) {
    const cacheKey = `flights:search:${query.origin}:${query.destination}:${query.date}:${query.class ?? 'all'}`

    const cached = await redis.get(cacheKey)
    if (cached) return JSON.parse(cached)

    const flights = db.query(`
      SELECT f.id, f.flight_number, f.origin, f.destination,
             f.departure_at, f.arrival_at, f.base_price, f.status,
             a.name AS airline_name, a.iata_code AS airline_code
      FROM flights f
      JOIN airlines a ON f.airline_id = a.id
      WHERE f.origin      = ?
        AND f.destination = ?
        AND date(f.departure_at) = date(?)
        AND f.status = 'scheduled'
      ORDER BY f.departure_at
    `).all(query.origin, query.destination, query.date) as any[]

    const result = flights.map((f) => {
      const args: unknown[] = [f.id, 'available']
      let countSql = 'SELECT COUNT(*) AS c FROM seats WHERE flight_id = ? AND status = ?'
      if (query.class) {
        countSql += ' AND seat_class = ?'
        args.push(query.class)
      }
      const { c } = db.query(countSql).get(...(args as [unknown, ...unknown[]])) as { c: number }
      return { ...f, available_seats: c }
    })

    await redis.set(cacheKey, JSON.stringify(result), 'EX', CACHE_TTL)
    return result
  }

  static findById(flightId: string) {
    return db.query(`
      SELECT f.*, a.name AS airline_name, a.iata_code AS airline_code
      FROM flights f
      JOIN airlines a ON f.airline_id = a.id
      WHERE f.id = ?
    `).get(flightId) ?? null
  }

  static listAll() {
    return db.query(`
      SELECT f.*, a.name AS airline_name, a.iata_code AS airline_code
      FROM flights f
      JOIN airlines a ON f.airline_id = a.id
      ORDER BY f.departure_at
    `).all()
  }
}
