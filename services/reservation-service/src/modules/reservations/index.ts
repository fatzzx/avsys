import { Elysia } from 'elysia'
import { ReservationService } from './service'
import { ReservationModel } from './model'

export const reservationsController = new Elysia({ prefix: '/reservations', name: 'Reservation.Controller' })
  .model({
    'reservation.CreateBody':  ReservationModel.CreateBody,
    'reservation.IdParams':    ReservationModel.IdParams,
    'reservation.UserParams':  ReservationModel.UserParams,
  })
  .decorate('reservationService', ReservationService)
  .onError(({ code, error, set }) => {
    if (code === 'VALIDATION') {
      set.status = 400
      return { error: 'Dados de entrada inválidos', detail: error.message }
    }
    set.status = 500
    return { error: 'Erro interno do servidor' }
  })
  // Criar reserva (aciona lock Redis + transação SQLite)
  .post('/', ({ body, reservationService }) => reservationService.create(body), {
    body: 'reservation.CreateBody',
  })
  // Resumo do estado atual do sistema
  .get('/summary', ({ reservationService }) => reservationService.getSummary())
  // Buscar reserva por ID
  .get('/:reservationId', ({ params: { reservationId }, reservationService, set }) => {
    const reservation = reservationService.findById(reservationId)
    if (!reservation) {
      set.status = 404
      return { error: 'Reserva não encontrada' }
    }
    return reservation
  }, {
    params: 'reservation.IdParams',
  })
  // Listar reservas de um usuário
  .get('/user/:userId', ({ params: { userId }, reservationService }) =>
    reservationService.findByUser(userId),
    { params: 'reservation.UserParams' }
  )
  // Cancelar reserva
  .delete('/:reservationId', async ({ params: { reservationId }, reservationService }) =>
    reservationService.cancel(reservationId),
    { params: 'reservation.IdParams' }
  )
