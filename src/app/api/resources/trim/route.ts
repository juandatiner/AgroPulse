import { json, options, handleRoute } from '@/lib/api-utils'
import { getDb, ObjectId } from '@/lib/db'
import { getAuthUser } from '@/lib/auth'
import { computeSubscriptionState } from '@/lib/subscription'

export function OPTIONS() { return options() }

export async function POST(request: Request) {
  return handleRoute(async () => {
    const { user } = await getAuthUser(request)
    if (!user) return json({ error: 'No autorizado' }, 401)

    const body = await request.json().catch(() => ({}))
    const keepIds = Array.isArray(body?.keep_ids) ? body.keep_ids : []
    const sub = await computeSubscriptionState(user.id)

    if (sub.is_premium) {
      return json({ error: 'No aplica: tu suscripción está activa.' }, 400)
    }

    const limit = sub.free_active_limit
    if (keepIds.length > limit) {
      return json({ error: `Solo puedes conservar hasta ${limit} publicaciones activas.` }, 400)
    }

    const db = await getDb()
    const uid = new ObjectId(user.id)
    const keepObjIds: ObjectId[] = []
    for (const id of keepIds) {
      try { keepObjIds.push(new ObjectId(String(id))) } catch { /* skip invalid */ }
    }

    const filter: Record<string, unknown> = {
      user_id: uid,
      status: 'active',
    }
    if (keepObjIds.length > 0) filter._id = { $nin: keepObjIds }

    const result = await db.collection('resources').deleteMany(filter)
    const newSub = await computeSubscriptionState(user.id)
    return json({ ok: true, deleted: result.deletedCount, subscription: newSub })
  })
}
