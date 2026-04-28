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
    const fullPlanAmount = planTier === 'pro' ? cfg.price_pro : cfg.price_basic
    const TIER_RANK: Record<'basic' | 'pro', number> = { basic: 1, pro: 2 }
    const tierPrice = (t: 'basic' | 'pro') => t === 'pro' ? cfg.price_pro : cfg.price_basic

    // Lógica de cobro:
    //   - Activa mismo tier              → renovar: sub_end += 30d, cobro completo.
    //   - Activa tier MAYOR (upgrade)    → INMEDIATO: subir tier ahora, cobro prorrateado de la diferencia
    //                                      por los días restantes; sub_end no cambia.
    //   - Activa tier MENOR (downgrade)  → AGENDAR: actual sigue hasta su fin, plan menor arranca después.
    //   - Trial                          → AGENDAR: prueba sigue hasta trial_end, plan arranca después.
    //   - Sin nada                       → arranca hoy + 30d, cobro completo.
    const userDoc = await db.collection('users').findOne({ _id: uid })
    const userSubEnd: Date | null = userDoc?.subscription_end instanceof Date ? userDoc.subscription_end : null
    const userTrialEnd: Date | null = userDoc?.trial_end instanceof Date ? userDoc.trial_end : null
    const userPlanTier: 'basic' | 'pro' | null = (userDoc?.plan_tier === 'basic' || userDoc?.plan_tier === 'pro') ? userDoc.plan_tier : null

    const DAY = 86400000
    let isRenewal = false
    let bonusDays = 0
    let scheduled: { current_tier: string; current_until: string; next_tier: 'basic' | 'pro'; next_ends: string } | null = null
    let upgrade: { from: 'basic' | 'pro'; to: 'basic' | 'pro'; days_left: number; charged: number; full_price: number } | null = null
    let subEnd: Date
    let chargedAmount = fullPlanAmount

    const isActive = existing.status === 'active' && userSubEnd && userSubEnd > now
    const isTrial = existing.status === 'trial' && userTrialEnd && userTrialEnd > now

    let userUpdate: Record<string, unknown> = { plan_tier: planTier }
    let userUnset: Record<string, ''> | null = null

    if (isActive && userPlanTier && userPlanTier !== planTier) {
      const isUpgrade = TIER_RANK[planTier] > TIER_RANK[userPlanTier]
      if (isUpgrade) {
        // Upgrade inmediato con cobro prorrateado por días restantes
        const daysLeft = Math.max(0, Math.ceil((userSubEnd!.getTime() - now.getTime()) / DAY))
        const priceDiff = tierPrice(planTier) - tierPrice(userPlanTier)
        chargedAmount = Math.max(0, Math.round(priceDiff * (daysLeft / 30)))
        subEnd = userSubEnd!
        upgrade = {
          from: userPlanTier,
          to: planTier,
          days_left: daysLeft,
          charged: chargedAmount,
          full_price: fullPlanAmount,
        }
        userUpdate = {
          subscription_status: 'active',
          subscription_end: subEnd,
          plan_tier: planTier,
        }
        userUnset = { next_plan_tier: '', next_subscription_end: '' }
      } else {
        // Downgrade: agendar plan menor para cuando termine el actual
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
        }
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

    if (willDecline) {
      await db.collection('invoices').insertOne({
        user_id: uid,
        amount: chargedAmount,
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

    const reference = 'AGP-' + crypto.randomBytes(4).toString('hex').toUpperCase()

    await db.collection('invoices').insertOne({
      user_id: uid,
      amount: chargedAmount,
      plan_tier: planTier,
      status: 'paid',
      card_brand: brand,
      card_last4: last4,
      holder,
      reference,
      period_start: now,
      period_end: subEnd,
      created_at: now,
      ...(upgrade ? { is_upgrade: true, upgrade_from: upgrade.from, days_prorated: upgrade.days_left } : {}),
    })

    const updateOp: Record<string, unknown> = { $set: userUpdate }
    if (userUnset) updateOp.$unset = userUnset
    await db.collection('users').updateOne({ _id: uid }, updateOp)

    const sub = await computeSubscriptionState(user.id)
    return json({ ok: true, reference, subscription: sub, bonus_days: bonusDays, is_renewal: isRenewal, scheduled, upgrade, charged: chargedAmount, until: subEnd.toISOString() })
  })
}

function detectBrand(card: string): string {
  if (/^4/.test(card)) return 'Visa'
  if (/^5[1-5]/.test(card)) return 'Mastercard'
  if (/^3[47]/.test(card)) return 'Amex'
  if (/^6(011|5)/.test(card)) return 'Discover'
  return 'Tarjeta'
}
