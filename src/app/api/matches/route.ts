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

    const matches: Record<string, unknown>[] = []
    for (const r of myResources) {
      const opposite = r.tipo === 'oferta' ? 'demanda' : 'oferta'
      const query: Record<string, unknown> = {
        status: 'active',
        tipo: opposite,
        categoria: r.categoria,
        user_id: { $ne: uid },
      }
      if (r.municipio) query.municipio = r.municipio

      const candidates = await db.collection('resources').aggregate([
        { $match: query },
        { $limit: 10 },
        {
          $lookup: {
            from: 'users',
            localField: 'user_id',
            foreignField: '_id',
            as: '_user',
          },
        },
        { $unwind: '$_user' },
        { $sort: { created_at: -1 } },
      ]).toArray()

      for (const c of candidates) {
        matches.push({
          my_resource_id: (r._id as ObjectId).toHexString(),
          my_resource_titulo: r.titulo,
          my_resource_tipo: r.tipo,
          match_id: (c._id as ObjectId).toHexString(),
          match_titulo: c.titulo,
          match_tipo: c.tipo,
          match_categoria: c.categoria,
          match_municipio: c.municipio,
          match_descripcion: c.descripcion,
          match_user_id: c.user_id instanceof ObjectId ? c.user_id.toHexString() : String(c.user_id),
          match_user_nombre: c._user.nombre,
          match_user_apellido: c._user.apellido,
          match_user_verified: !!c._user.verified,
          match_created_at: c.created_at instanceof Date ? c.created_at.toISOString() : c.created_at,
        })
      }
    }
    return json(matches)
  })
}
