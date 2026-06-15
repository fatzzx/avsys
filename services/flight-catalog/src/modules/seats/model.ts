import { t } from 'elysia'

export const SeatModel = {
  FlightParams: t.Object({
    flightId: t.String(),
  }),
  SeatParams: t.Object({
    flightId: t.String(),
    seatId:   t.String(),
  }),
  SeatQuery: t.Object({
    class: t.Optional(
      t.Union([t.Literal('economy'), t.Literal('business'), t.Literal('first')])
    ),
  }),
}

export type FlightParams = typeof SeatModel.FlightParams.static
export type SeatParams   = typeof SeatModel.SeatParams.static
export type SeatQuery    = typeof SeatModel.SeatQuery.static
