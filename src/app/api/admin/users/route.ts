import { json, options, handleRoute } from '@/lib/api-utils'
import { getDb, ObjectId } from '@/lib/db'
import { verifyAdmin, adminUnauth } from '@/lib/admin-auth'

export function OPTIONS() { return options() }

export async function GET(request: Request) {
  return handleRoute(async () => {
    if (!verifyAdmin(request)) return adminUnauth()

    const db = await getDb()
    const now = new Date()
    const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000)

    const users = await db.collection('users')
      .find({})
      .sort({ created_at: -1 })
      .toArray()

    // Aggregate resource counts by user_id
    const resourceCounts = await db.collection('resources').aggregate([
      { $group: { _id: '$user_id', count: { $sum: 1 } } },
    ]).toArray()
    const resourceMap = new Map<string, number>()
    for (const r of resourceCounts) {
      resourceMap.set((r._id as ObjectId).toHexString(), r.count as number)
    }

    // Aggregate agreement counts by user (requester or provider)
    const agrCountsReq = await db.collection('agreements').aggregate([
      { $group: { _id: '$requester_id', count: { $sum: 1 } } },
    ]).toArray()
    const agrCountsProv = await db.collection('agreements').aggregate([
      { $group: { _id: '$provider_id', count: { $sum: 1 } } },
    ]).toArray()
    const agrMap = new Map<string, number>()
    for (const a of agrCountsReq) {
      const key = (a._id as ObjectId).toHexString()
      agrMap.set(key, (agrMap.get(key) || 0) + (a.count as number))
    }
    for (const a of agrCountsProv) {
      const key = (a._id as ObjectId).toHexString()
      agrMap.set(key, (agrMap.get(key) || 0) + (a.count as number))
    }

    const toIso = (v: unknown) => v instanceof Date ? v.toISOString() : v ?? null

    return json(users.map(u => {
      const uid = (u._id as ObjectId).toHexString()
      const lastSeen = u.last_seen instanceof Date ? u.last_seen : null
      return {
        id: uid,
        nombre: u.nombre,
        apellido: u.apellido,
        email: u.email,
        tipo: u.tipo,
        municipio: u.municipio,
        reputation_score: u.reputation_score ?? 5.0,
        total_ratings: u.total_ratings ?? 0,
        created_at: toIso(u.created_at),
        last_seen: lastSeen ? lastSeen.toISOString() : null,
        is_online: lastSeen ? lastSeen >= fiveMinAgo : false,
        resources_count: resourceMap.get(uid) || 0,
        agreements_count: agrMap.get(uid) || 0,
        verified: !!u.verified,
        subscription_status: u.subscription_status || 'trial',
        trial_start: toIso(u.trial_start),
        trial_end: toIso(u.trial_end),
        trial_days_granted: u.trial_days_granted ?? null,
        promo_applied: !!u.promo_applied,
        subscription_end: toIso(u.subscription_end),
        monthly_post_count: u.monthly_post_count ?? 0,
      }
    }))
  })
}
