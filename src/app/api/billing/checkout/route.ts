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

    const existing = await computeSubscriptionState(user.id)
    const body = await request.json()
    const planTier: 'basic' | 'pro' = body.plan === 'pro' ? 'pro' : 'basic'
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
    const planAmount = planTier === 'pro' ? cfg.price_pro : cfg.price_basic

    if (willDecline) {
      await db.collection('invoices').insertOne({
        user_id: uid,
        amount: planAmount,
        plan_tier: planTier,
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

    // Lógica de programación (sin prorratear):
    //   - Activa mismo tier  → renovar: sub_end += 30d.
    //   - Activa otro tier   → AGENDAR: actual sigue hasta su fin, nuevo plan arranca cuando termine.
    //   - Trial              → AGENDAR: prueba sigue hasta trial_end, nuevo plan arranca después.
    //   - Sin nada           → arranca hoy + 30d.
    const userDoc = await db.collection('users').findOne({ _id: uid })
    const userSubEnd: Date | null = userDoc?.subscription_end instanceof Date ? userDoc.subscription_end : null
    const userTrialEnd: Date | null = userDoc?.trial_end instanceof Date ? userDoc.trial_end : null
    const userPlanTier: 'basic' | 'pro' | null = (userDoc?.plan_tier === 'basic' || userDoc?.plan_tier === 'pro') ? userDoc.plan_tier : null

    const DAY = 86400000
    let isRenewal = false
    let bonusDays = 0
    let scheduled: { current_tier: string; current_until: string; next_tier: 'basic' | 'pro'; next_ends: string } | null = null
    let subEnd: Date

    const isActive = existing.status === 'active' && userSubEnd && userSubEnd > now
    const isTrial = existing.status === 'trial' && userTrialEnd && userTrialEnd > now

    let userUpdate: Record<string, unknown> = { plan_tier: planTier }
    let userUnset: Record<string, ''> | null = null

    if (isActive && userPlanTier && userPlanTier !== planTier) {
      // Agendar nuevo plan
      const nextStart = userSubEnd!
      const nextEnd = new Date(nextStart.getTime() + 30 * DAY)
      subEnd = nextEnd
      scheduled = {
        current_tier: userPlanTier,
        current_until: nextStart.toISOString(),
        next_tier: planTier,
        next_ends: nextEnd.toISOString(),
      }
      userUpdate = {
        next_plan_tier: planTier,
        next_subscription_end: nextEnd,
        // mantener subscription_end y plan_tier actuales
      }
    } else if (isActive && userSubEnd) {
      // Renovación mismo tier
      subEnd = new Date(userSubEnd.getTime() + 30 * DAY)
      isRenewal = true
      userUpdate = {
        subscription_status: 'active',
        subscription_end: subEnd,
        plan_tier: planTier,
        monthly_post_count: 0,
        monthly_post_reset: now,
      }
      userUnset = { next_plan_tier: '', next_subscription_end: '' }
    } else if (isTrial && userTrialEnd) {
      // Agendar plan después de la prueba
      const nextStart = userTrialEnd
      subEnd = new Date(nextStart.getTime() + 30 * DAY)
      bonusDays = existing.trial_days_left
      scheduled = {
        current_tier: 'trial',
        current_until: nextStart.toISOString(),
        next_tier: planTier,
        next_ends: subEnd.toISOString(),
      }
      // Mantener trial activo, agendar suscripción para después
      userUpdate = {
        next_plan_tier: planTier,
        next_subscription_end: subEnd,
      }
    } else {
      // Sin nada → arranca hoy
      subEnd = new Date(now.getTime() + 30 * DAY)
      userUpdate = {
        subscription_status: 'active',
        subscription_end: subEnd,
        plan_tier: planTier,
        monthly_post_count: 0,
        monthly_post_reset: now,
      }
      userUnset = { next_plan_tier: '', next_subscription_end: '' }
    }
    const reference = 'AGP-' + crypto.randomBytes(4).toString('hex').toUpperCase()

    await db.collection('invoices').insertOne({
      user_id: uid,
      amount: planAmount,
      plan_tier: planTier,
      status: 'paid',
      card_brand: brand,
      card_last4: last4,
      holder,
      reference,
      period_start: now,
      period_end: subEnd,
      created_at: now,
    })

    const updateOp: Record<string, unknown> = { $set: userUpdate }
    if (userUnset) updateOp.$unset = userUnset
    await db.collection('users').updateOne({ _id: uid }, updateOp)

    const sub = await computeSubscriptionState(user.id)
    return json({ ok: true, reference, subscription: sub, bonus_days: bonusDays, is_renewal: isRenewal, scheduled, until: subEnd.toISOString() })
  })
}

function detectBrand(card: string): string {
  if (/^4/.test(card)) return 'Visa'
  if (/^5[1-5]/.test(card)) return 'Mastercard'
  if (/^3[47]/.test(card)) return 'Amex'
  if (/^6(011|5)/.test(card)) return 'Discover'
  return 'Tarjeta'
}
