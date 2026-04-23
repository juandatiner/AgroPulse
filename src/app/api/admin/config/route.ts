import { json, options, handleRoute } from '@/lib/api-utils'
import { verifyAdmin, adminUnauth } from '@/lib/admin-auth'
import { getAppConfig, setAppConfig, AppConfig } from '@/lib/subscription'

export function OPTIONS() { return options() }

export async function GET(request: Request) {
  return handleRoute(async () => {
    if (!verifyAdmin(request)) return adminUnauth()
    return json(await getAppConfig())
  })
}

export async function PATCH(request: Request) {
  return handleRoute(async () => {
    if (!verifyAdmin(request)) return adminUnauth()
    const body = await request.json()
    const patch: Partial<AppConfig> = {}
    if (typeof body.trial_days === 'number') patch.trial_days = Math.min(90, Math.max(1, Math.floor(body.trial_days)))
    if (typeof body.subscription_price === 'number') patch.subscription_price = Math.max(0, Math.floor(body.subscription_price))
    if (typeof body.free_posts_per_month === 'number') patch.free_posts_per_month = Math.max(0, Math.floor(body.free_posts_per_month))
    if (typeof body.promo_active === 'boolean') patch.promo_active = body.promo_active
    if (typeof body.promo_discount_percent === 'number') patch.promo_discount_percent = Math.min(99, Math.max(0, body.promo_discount_percent))
    if (body.promo_end_date === null) patch.promo_end_date = null
    else if (typeof body.promo_end_date === 'string') patch.promo_end_date = body.promo_end_date
    if (typeof body.support_email === 'string') patch.support_email = body.support_email
    const updated = await setAppConfig(patch)
    return json(updated)
  })
}
