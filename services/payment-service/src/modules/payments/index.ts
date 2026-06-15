import { Elysia } from 'elysia'
import { PaymentService } from './service'
import { PaymentModel } from './model'

export const paymentsController = new Elysia({ prefix: '/payments', name: 'Payment.Controller' })
  .model({
    'payment.IdParams': PaymentModel.IdParams,
  })
  .decorate('paymentService', PaymentService)
  .onError(({ code, error, set }) => {
    if (code === 'VALIDATION') {
      set.status = 400
      return { error: 'Dados de entrada inválidos', detail: error.message }
    }
    set.status = 500
    return { error: 'Erro interno do servidor' }
  })
  .get('/:paymentId', ({ params: { paymentId }, paymentService, set }) => {
    const payment = paymentService.findById(paymentId)
    if (!payment) {
      set.status = 404
      return { error: 'Pagamento não encontrado' }
    }
    return payment
  }, {
    params: 'payment.IdParams',
  })
