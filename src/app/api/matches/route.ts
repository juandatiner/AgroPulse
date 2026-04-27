import { json, options, handleRoute } from '@/lib/api-utils'
import { getDb, ObjectId } from '@/lib/db'
import { getAuthUser } from '@/lib/auth'
import { computeSubscriptionState } from '@/lib/subscription'

export function OPTIONS() { return options() }

export async function GET(request: Request) {
  return handleRoute(async () => {
    const { user } = await getAuthUser(request)
    if (!user) return json({ error: 'No autorizado' }, 401)

    const sub = await computeSubscriptionState(user.id)
    if (!sub.is_premium) {
      return json({ error: 'premium_required', message: 'Las alertas de match requieren suscripción activa.', subscription: sub }, 403)
    }

    const db = await getDb()
    const uid = new ObjectId(user.id)
    const myResources = await db.collection('resources').find({
      user_id: uid,
      status: 'active',
    }).toArray()

    if (!myResources.length) return json([])

    // Pairing rules: oferta ↔ solicitud, prestamo ↔ prestamo, trueque ↔ trueque
    const oppositeMap: Record<string, string[]> = {
      oferta: ['solicitud'],
      solicitud: ['oferta'],
      prestamo: ['prestamo'],
      trueque: ['trueque'],
    }

    const seen = new Set<string>()
    const matches: Record<string, unknown>[] = []
    for (const r of myResources) {
      const opposites = oppositeMap[r.tipo as string] || []
      if (!opposites.length) continue
      const query: Record<string, unknown> = {
        status: 'active',
        tipo: { $in: opposites },
        categoria: r.categoria,
        user_id: { $ne: uid },
      }
      if (r.municipio) query.municipio = r.municipio

      const candidates = await db.collection('resources').aggregate([
        { $match: query },
        { $sort: { created_at: -1 } },
        { $limit: 20 },
        {
          $lookup: {
            from: 'users',
            localField: 'user_id',
            foreignField: '_id',
            as: '_user',
          },
        },
        { $unwind: '$_user' },
      ]).toArray()

      for (const c of candidates) {
        const key = `${(r._id as ObjectId).toHexString()}::${(c._id as ObjectId).toHexString()}`
        if (seen.has(key)) continue
        seen.add(key)
        matches.push({
          my_resource_id: (r._id as ObjectId).toHexString(),
          my_resource_titulo: r.titulo,
          my_resource_tipo: r.tipo,
          my_resource_categoria: r.categoria,
          match_id: (c._id as ObjectId).toHexString(),
          match_titulo: c.titulo,
          match_tipo: c.tipo,
          match_categoria: c.categoria,
          match_municipio: c.municipio,
          match_descripcion: c.descripcion,
          match_image_data: c.image_data || '',
          match_user_id: c.user_id instanceof ObjectId ? c.user_id.toHexString() : String(c.user_id),
          match_user_nombre: c._user.nombre,
          match_user_apellido: c._user.apellido,
          match_user_verified: !!c._user.verified,
          match_user_reputation: c._user.reputation_score || 5,
          match_created_at: c.created_at instanceof Date ? c.created_at.toISOString() : c.created_at,
        })
      }
    }
    matches.sort((a, b) => {
      const ad = new Date(a.match_created_at as string).getTime()
      const bd = new Date(b.match_created_at as string).getTime()
      return bd - ad
    })
    return json(matches)
  })
}
