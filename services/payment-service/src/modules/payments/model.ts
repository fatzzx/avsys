import { t } from 'elysia'

export const PaymentModel = {
  IdParams: t.Object({
    paymentId: t.String(),
  }),
}

export type IdParams = typeof PaymentModel.IdParams.static
