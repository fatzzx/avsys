import { db } from '../../config/database'
import type { SeatQuery } from './model'

export abstract class SeatService {
  static listByFlight(flightId: string, query: SeatQuery) {
    if (query.class) {
      return db.query(`
        SELECT * FROM seats
        WHERE flight_id = ? AND seat_class = ?
        ORDER BY seat_number
      `).all(flightId, query.class)
    }
    return db.query(`
      SELECT * FROM seats WHERE flight_id = ? ORDER BY seat_number
    `).all(flightId)
  }

  static findById(flightId: string, seatId: string) {
    return db.query(`
      SELECT * FROM seats WHERE id = ? AND flight_id = ?
    `).get(seatId, flightId) ?? null
  }

  static updateStatus(seatId: string, newStatus: 'available' | 'reserved' | 'sold'): void {
    db.query(
      `UPDATE seats SET status = ?, version = version + 1 WHERE id = ?`
    ).run(newStatus, seatId)
  }
}
