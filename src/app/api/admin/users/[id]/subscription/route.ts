import { json, options, handleRoute } from '@/lib/api-utils'
import { getDb, ObjectId } from '@/lib/db'
import { verifyAdmin, adminUnauth } from '@/lib/admin-auth'
import { computeSubscriptionState } from '@/lib/subscription'

export function OPTIONS() { return options() }

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleRoute(async () => {
    if (!verifyAdmin(request)) return adminUnauth()
    const { id } = await params
    let uid: ObjectId
    try { uid = new ObjectId(id) } catch { return json({ error: 'ID inválido' }, 400) }
    const db = await getDb()
    const u = await db.collection('users').findOne({ _id: uid })
    if (!u) return json({ error: 'No encontrado' }, 404)
    const sub = await computeSubscriptionState(id)
    return json(sub)
  })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleRoute(async () => {
    if (!verifyAdmin(request)) return adminUnauth()
    const { id } = await params
    let uid: ObjectId
    try { uid = new ObjectId(id) } catch { return json({ error: 'ID inválido' }, 400) }
    const body = await request.json()
    const update: Record<string, unknown> = {}
    const now = new Date()

    if (typeof body.trial_end_offset_minutes === 'number') {
      update.trial_end = new Date(now.getTime() + body.trial_end_offset_minutes * 60 * 1000)
      update.subscription_status = 'trial'
    }
    if (typeof body.trial_end === 'string') {
      update.trial_end = new Date(body.trial_end)
    }
    if (typeof body.subscription_end === 'string') {
      update.subscription_end = new Date(body.subscription_end)
    }
    if (typeof body.subscription_end_offset_minutes === 'number') {
      update.subscription_end = new Date(now.getTime() + body.subscription_end_offset_minutes * 60 * 1000)
    }
    if (typeof body.subscription_status === 'string' &&
        ['trial', 'active', 'expired', 'cancelled'].includes(body.subscription_status)) {
      update.subscription_status = body.subscription_status
      if (body.subscription_status === 'active' && !update.subscription_end) {
        update.subscription_end = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
      }
      if (body.subscription_status === 'expired') {
        update.subscription_end = now
      }
    }
    if (body.reset_posts === true) {
      update.monthly_post_count = 0
      update.monthly_post_reset = now
    }
    if (body.restore_promised_trial === true) {
      const db0 = await getDb()
      const u = await db0.collection('users').findOne({ _id: uid })
      if (u && u.trial_start instanceof Date && typeof u.trial_days_granted === 'number') {
        const restored = new Date(u.trial_start.getTime() + u.trial_days_granted * 24 * 60 * 60 * 1000)
        update.trial_end = restored
        update.subscription_status = restored > now ? 'trial' : 'expired'
      }
    }
    if (typeof body.monthly_post_count === 'number') {
      update.monthly_post_count = Math.max(0, Math.floor(body.monthly_post_count))
    }

    if (!Object.keys(update).length) return json({ error: 'Sin cambios' }, 400)
    const db = await getDb()
    await db.collection('users').updateOne({ _id: uid }, { $set: update })
    const sub = await computeSubscriptionState(id)
    return json(sub)
  })
}
