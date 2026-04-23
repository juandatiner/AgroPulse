import { getDb, ObjectId } from './db'

export interface AppConfig {
  trial_days: number
  subscription_price: number
  price_basic: number
  price_pro: number
  free_posts_per_month: number
  promo_active: boolean
  promo_discount_percent: number
  promo_end_date: string | null
  support_email: string
}

const DEFAULT_CONFIG: AppConfig = {
  trial_days: 60,
  subscription_price: 12900,
  price_basic: 7900,
  price_pro: 12900,
  free_posts_per_month: 3,
  promo_active: true,
  promo_discount_percent: 50,
  promo_end_date: null,
  support_email: 'soporte@agropulse.co',
}

export async function getAppConfig(): Promise<AppConfig> {
  const db = await getDb()
  const doc = await db.collection('app_config').findOne({ _id: 'main' as unknown as ObjectId })
  if (!doc) return { ...DEFAULT_CONFIG }
  const priceBasic = doc.price_basic ?? doc.subscription_price ?? DEFAULT_CONFIG.price_basic
  const pricePro = doc.price_pro ?? DEFAULT_CONFIG.price_pro
  return {
    trial_days: doc.trial_days ?? DEFAULT_CONFIG.trial_days,
    subscription_price: doc.subscription_price ?? pricePro,
    price_basic: priceBasic,
    price_pro: pricePro,
    free_posts_per_month: doc.free_posts_per_month ?? DEFAULT_CONFIG.free_posts_per_month,
    promo_active: doc.promo_active ?? DEFAULT_CONFIG.promo_active,
    promo_discount_percent: doc.promo_discount_percent ?? DEFAULT_CONFIG.promo_discount_percent,
    promo_end_date: doc.promo_end_date instanceof Date ? doc.promo_end_date.toISOString() : (doc.promo_end_date ?? null),
    support_email: doc.support_email ?? DEFAULT_CONFIG.support_email,
  }
}

export async function setAppConfig(patch: Partial<AppConfig>): Promise<AppConfig> {
  const db = await getDb()
  const update: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue
    if (k === 'promo_end_date' && typeof v === 'string' && v) {
      update[k] = new Date(v)
    } else {
      update[k] = v
    }
  }
  await db.collection('app_config').updateOne(
    { _id: 'main' as unknown as ObjectId },
    { $set: update },
    { upsert: true }
  )
  return getAppConfig()
}

export type SubStatus = 'trial' | 'active' | 'expired' | 'cancelled'

export type PlanTier = 'none' | 'trial' | 'basic' | 'pro'

export interface UserSubFields {
  trial_start?: Date | null
  trial_end?: Date | null
  subscription_status?: SubStatus
  subscription_end?: Date | null
  monthly_post_count?: number
  monthly_post_reset?: Date | null
  verified?: boolean
  promo_applied?: boolean
  plan_tier?: PlanTier
}

export interface SubscriptionState {
  status: SubStatus
  is_premium: boolean
  is_pro: boolean
  plan_tier: PlanTier
  trial_end: string | null
  trial_days_left: number
  trial_days_granted: number
  subscription_end: string | null
  subscription_days_left: number
  monthly_post_count: number
  monthly_post_reset: string | null
  free_posts_per_month: number
  posts_remaining: number
  can_post: boolean
  needs_payment: boolean
  price_regular: number
  price_promo: number
  price_basic: number
  price_basic_regular: number
  price_pro: number
  price_pro_regular: number
  promo_active: boolean
  promo_end_date: string | null
  promo_days_left: number
}

function daysBetween(a: Date, b: Date): number {
  return Math.max(0, Math.ceil((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24)))
}

export async function ensurePostCounterWindow(userId: string): Promise<void> {
  const db = await getDb()
  const uid = new ObjectId(userId)
  const u = await db.collection('users').findOne({ _id: uid })
  if (!u) return
  const now = new Date()
  const reset = u.monthly_post_reset instanceof Date ? u.monthly_post_reset : null
  if (!reset) {
    const start = u.created_at instanceof Date ? u.created_at : now
    await db.collection('users').updateOne(
      { _id: uid },
      { $set: { monthly_post_reset: start, monthly_post_count: u.monthly_post_count ?? 0 } }
    )
    return
  }
  const windowEnd = new Date(reset.getTime() + 30 * 24 * 60 * 60 * 1000)
  if (now >= windowEnd) {
    await db.collection('users').updateOne(
      { _id: uid },
      { $set: { monthly_post_reset: now, monthly_post_count: 0 } }
    )
  }
}

export async function computeSubscriptionState(userId: string): Promise<SubscriptionState> {
  const db = await getDb()
  const cfg = await getAppConfig()
  await ensurePostCounterWindow(userId)
  const u = await db.collection('users').findOne({ _id: new ObjectId(userId) })
  const now = new Date()

  const trialEnd: Date | null = u?.trial_end instanceof Date ? u.trial_end : null
  const subEnd: Date | null = u?.subscription_end instanceof Date ? u.subscription_end : null
  let status: SubStatus = (u?.subscription_status as SubStatus) || 'trial'

  if (status === 'active' && subEnd && now >= subEnd) status = 'expired'
  if (status === 'trial' && trialEnd && now >= trialEnd) status = 'expired'

  const inTrial = status === 'trial' && !!trialEnd && now < trialEnd
  const activePaid = status === 'active' && !!subEnd && now < subEnd
  const isPremium = activePaid || inTrial

  const rawTier: PlanTier = (u?.plan_tier as PlanTier) || (inTrial ? 'trial' : (activePaid ? 'basic' : 'none'))
  const planTier: PlanTier = isPremium ? (rawTier === 'none' ? (inTrial ? 'trial' : 'basic') : rawTier) : 'none'
  const isPro = planTier === 'trial' || planTier === 'pro'

  const trialDaysLeft = trialEnd ? daysBetween(now, trialEnd) : 0
  const subDaysLeft = subEnd ? daysBetween(now, subEnd) : 0

  const postCount = u?.monthly_post_count ?? 0
  const postReset = u?.monthly_post_reset instanceof Date ? u.monthly_post_reset : null
  const postsRemaining = Math.max(0, cfg.free_posts_per_month - postCount)

  const canPost = isPremium || postsRemaining > 0
  const needsPayment = !canPost

  const discountFactor = cfg.promo_active ? (1 - cfg.promo_discount_percent / 100) : 1
  const priceBasicRegular = cfg.promo_active ? Math.round(cfg.price_basic / discountFactor) : cfg.price_basic
  const priceProRegular = cfg.promo_active ? Math.round(cfg.price_pro / discountFactor) : cfg.price_pro
  // Legacy fields based on basic price (used by older banner copy)
  const pricePromo = cfg.price_basic
  const priceRegular = priceBasicRegular

  const promoEnd: Date | null = cfg.promo_end_date ? new Date(cfg.promo_end_date) : null
  const promoDaysLeft = cfg.promo_active && promoEnd ? daysBetween(now, promoEnd) : 0
  const promoActiveResolved = cfg.promo_active && (!promoEnd || now < promoEnd)

  const trialGranted = typeof u?.trial_days_granted === 'number' ? u.trial_days_granted : cfg.trial_days

  return {
    status,
    is_premium: isPremium,
    is_pro: isPro,
    plan_tier: planTier,
    trial_end: trialEnd ? trialEnd.toISOString() : null,
    trial_days_left: trialDaysLeft,
    trial_days_granted: trialGranted,
    subscription_end: subEnd ? subEnd.toISOString() : null,
    subscription_days_left: subDaysLeft,
    monthly_post_count: postCount,
    monthly_post_reset: postReset ? postReset.toISOString() : null,
    free_posts_per_month: cfg.free_posts_per_month,
    posts_remaining: postsRemaining,
    can_post: !!canPost,
    needs_payment: needsPayment,
    price_regular: priceRegular,
    price_promo: pricePromo,
    price_basic: cfg.price_basic,
    price_basic_regular: priceBasicRegular,
    price_pro: cfg.price_pro,
    price_pro_regular: priceProRegular,
    promo_active: promoActiveResolved,
    promo_end_date: cfg.promo_end_date,
    promo_days_left: promoDaysLeft,
  }
}

export async function incrementPostCount(userId: string): Promise<void> {
  const db = await getDb()
  await db.collection('users').updateOne(
    { _id: new ObjectId(userId) },
    { $inc: { monthly_post_count: 1 } }
  )
}

export async function initTrialForNewUser(userId: string): Promise<void> {
  const db = await getDb()
  const cfg = await getAppConfig()
  const now = new Date()
  const trialEnd = new Date(now.getTime() + cfg.trial_days * 24 * 60 * 60 * 1000)
  await db.collection('users').updateOne(
    { _id: new ObjectId(userId) },
    {
      $set: {
        trial_start: now,
        trial_end: trialEnd,
        trial_days_granted: cfg.trial_days,
        subscription_status: 'trial',
        subscription_end: null,
        plan_tier: 'trial',
        monthly_post_count: 0,
        monthly_post_reset: now,
        verified: false,
        promo_applied: cfg.promo_active,
        promo_snapshot: cfg.promo_active ? {
          discount_percent: cfg.promo_discount_percent,
          price_at_signup: cfg.price_pro,
          trial_days: cfg.trial_days,
          registered_at: now,
        } : null,
      },
    }
  )
}

export function luhnCheck(card: string): boolean {
  const digits = card.replace(/\s+/g, '')
  if (!/^\d{13,19}$/.test(digits)) return false
  let sum = 0
  let alt = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = parseInt(digits[i], 10)
    if (alt) {
      n *= 2
      if (n > 9) n -= 9
    }
    sum += n
    alt = !alt
  }
  return sum % 10 === 0
}
