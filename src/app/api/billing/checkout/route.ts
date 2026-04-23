import { json, options, handleRoute } from '@/lib/api-utils'
import { getDb, ObjectId } from '@/lib/db'
import { getAuthUser } from '@/lib/auth'
import { getAppConfig, luhnCheck, computeSubscriptionState } from '@/lib/subscription'
import crypto from 'crypto'

export function OPTIONS() { return options() }

export async function POST(request: Request) {
  return handleRoute(async () => {
    const { user } = await getAuthUser(request)
    if (!user) return json({ error: 'No autorizado' }, 401)

    const body = await request.json()
    const card = String(body.card_number || '').replace(/\s+/g, '')
    const cvv = String(body.cvv || '')
    const expMonth = parseInt(String(body.exp_month || '0'), 10)
    const expYear = parseInt(String(body.exp_year || '0'), 10)
    const holder = String(body.holder || '').trim()

    if (!holder) return json({ error: 'El titular es requerido' }, 400)
    if (!/^\d{3,4}$/.test(cvv)) return json({ error: 'CVV inválido' }, 400)
    if (!expMonth || expMonth < 1 || expMonth > 12) return json({ error: 'Mes de expiración inválido' }, 400)
    const nowExp = new Date()
    const fullYear = expYear < 100 ? 2000 + expYear : expYear
    const expDate = new Date(fullYear, expMonth, 0, 23, 59, 59)
    if (expDate < nowExp) return json({ error: 'La tarjeta está vencida' }, 400)
    if (!luhnCheck(card)) return json({ error: 'Número de tarjeta inválido' }, 400)

    // Simulated processing: 8% random decline
    const willDecline = Math.random() < 0.08
    const last4 = card.slice(-4)
    const brand = detectBrand(card)

    const cfg = await getAppConfig()
    const db = await getDb()
    const now = new Date()
    const uid = new ObjectId(user.id)

    if (willDecline) {
      await db.collection('invoices').insertOne({
        user_id: uid,
        amount: cfg.subscription_price,
        status: 'declined',
        card_brand: brand,
        card_last4: last4,
        holder,
        reference: 'AGP-' + crypto.randomBytes(4).toString('hex').toUpperCase(),
        created_at: now,
        decline_reason: 'Fondos insuficientes o rechazo del emisor',
      })
      return json({
        error: 'payment_declined',
        message: 'El pago fue rechazado por el banco emisor. Verifica tus datos o usa otra tarjeta.',
      }, 402)
    }

    const subEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
    const reference = 'AGP-' + crypto.randomBytes(4).toString('hex').toUpperCase()

    await db.collection('invoices').insertOne({
      user_id: uid,
      amount: cfg.subscription_price,
      status: 'paid',
      card_brand: brand,
      card_last4: last4,
      holder,
      reference,
      period_start: now,
      period_end: subEnd,
      created_at: now,
    })

    await db.collection('users').updateOne(
      { _id: uid },
      {
        $set: {
          subscription_status: 'active',
          subscription_end: subEnd,
          monthly_post_count: 0,
          monthly_post_reset: now,
        },
      }
    )

    const sub = await computeSubscriptionState(user.id)
    return json({ ok: true, reference, subscription: sub })
  })
}

function detectBrand(card: string): string {
  if (/^4/.test(card)) return 'Visa'
  if (/^5[1-5]/.test(card)) return 'Mastercard'
  if (/^3[47]/.test(card)) return 'Amex'
  if (/^6(011|5)/.test(card)) return 'Discover'
  return 'Tarjeta'
}
