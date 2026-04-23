import { json, options, handleRoute } from '@/lib/api-utils'
import { getAuthUser } from '@/lib/auth'
import { computeSubscriptionState, getAppConfig } from '@/lib/subscription'

export function OPTIONS() { return options() }

export async function GET(request: Request) {
  return handleRoute(async () => {
    const { user } = await getAuthUser(request)
    if (!user) {
      const cfg = await getAppConfig()
      return json({
        public: true,
        price_regular: cfg.promo_active
          ? Math.round(cfg.subscription_price / (1 - cfg.promo_discount_percent / 100))
          : cfg.subscription_price,
        price_promo: cfg.subscription_price,
        promo_active: cfg.promo_active,
        promo_discount_percent: cfg.promo_discount_percent,
        promo_end_date: cfg.promo_end_date,
        trial_days: cfg.trial_days,
        free_posts_per_month: cfg.free_posts_per_month,
      })
    }
    const sub = await computeSubscriptionState(user.id)
    return json(sub)
  })
}
