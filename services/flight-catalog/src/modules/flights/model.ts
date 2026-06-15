import { t } from 'elysia'

export const FlightModel = {
  SearchQuery: t.Object({
    origin:      t.String({ minLength: 3, maxLength: 3, description: 'Código IATA de origem (ex: GRU)' }),
    destination: t.String({ minLength: 3, maxLength: 3, description: 'Código IATA de destino (ex: GIG)' }),
    date:        t.String({ description: 'Data no formato YYYY-MM-DD' }),
    class:       t.Optional(
      t.Union([t.Literal('economy'), t.Literal('business'), t.Literal('first')])
    ),
  }),
  IdParams: t.Object({
    flightId: t.String(),
  }),
}

export type SearchQuery = typeof FlightModel.SearchQuery.static
export type IdParams    = typeof FlightModel.IdParams.static
