import { Elysia } from 'elysia'
import { FlightService } from './service'
import { FlightModel } from './model'

export const flightsController = new Elysia({ prefix: '/flights', name: 'Flight.Controller' })
  .model({
    'flight.SearchQuery': FlightModel.SearchQuery,
    'flight.IdParams':    FlightModel.IdParams,
  })
  .decorate('flightService', FlightService)
  .onError(({ code, error, set }) => {
    if (code === 'VALIDATION') {
      set.status = 400
      return { error: 'Dados de entrada inválidos', detail: error.message }
    }
    set.status = 500
    return { error: 'Erro interno do servidor' }
  })
  // Lista todos os voos
  .get('/', ({ flightService }) => flightService.listAll())
  // Busca por rota e data
  .get('/search', async ({ query, flightService }) => flightService.search(query), {
    query: 'flight.SearchQuery',
  })
  // Busca por ID
  .get('/:flightId', ({ params: { flightId }, flightService, set }) => {
    const flight = flightService.findById(flightId)
    if (!flight) {
      set.status = 404
      return { error: 'Voo não encontrado' }
    }
    return flight
  }, {
    params: 'flight.IdParams',
  })
