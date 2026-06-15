import { t } from 'elysia'

export const ReservationModel = {
  CreateBody: t.Object({
    user_id:     t.String({ minLength: 1, description: 'ID do usuário' }),
    flight_id:   t.String({ minLength: 1, description: 'ID do voo' }),
    seat_id:     t.String({ minLength: 1, description: 'ID do assento' }),
    total_price: t.Number({ minimum: 0,   description: 'Valor total em BRL' }),
  }),
  IdParams: t.Object({
    reservationId: t.String(),
  }),
  UserParams: t.Object({
    userId: t.String(),
  }),
}

export type CreateBody  = typeof ReservationModel.CreateBody.static
export type IdParams    = typeof ReservationModel.IdParams.static
export type UserParams  = typeof ReservationModel.UserParams.static
