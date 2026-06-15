import { Elysia } from 'elysia'
import { SeatService } from './service'
import { SeatModel } from './model'

export const seatsController = new Elysia({ name: 'Seat.Controller' })
  .model({
    'seat.FlightParams': SeatModel.FlightParams,
    'seat.SeatParams':   SeatModel.SeatParams,
    'seat.Query':        SeatModel.SeatQuery,
  })
  .decorate('seatService', SeatService)
  .onError(({ code, error, set }) => {
    if (code === 'VALIDATION') {
      set.status = 400
      return { error: 'Dados de entrada inválidos', detail: error.message }
    }
    set.status = 500
    return { error: 'Erro interno do servidor' }
  })
  // Lista assentos de um voo (com filtro de classe opcional)
  .get('/flights/:flightId/seats', ({ params: { flightId }, query, seatService }) =>
    seatService.listByFlight(flightId, query),
    {
      params: 'seat.FlightParams',
      query:  'seat.Query',
    }
  )
  // Busca um assento específico
  .get('/flights/:flightId/seats/:seatId', ({ params, seatService, set }) => {
    const seat = seatService.findById(params.flightId, params.seatId)
    if (!seat) {
      set.status = 404
      return { error: 'Assento não encontrado' }
    }
    return seat
  }, {
    params: 'seat.SeatParams',
  })
