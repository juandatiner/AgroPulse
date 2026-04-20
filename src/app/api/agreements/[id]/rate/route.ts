import { json, options, handleRoute } from '@/lib/api-utils'
import { getDb, ObjectId } from '@/lib/db'
import { getAuthUser } from '@/lib/auth'

export function OPTIONS() { return options() }

export async function POST(request: Request, { params }: { params: { id: string } }) {
  return handleRoute(async () => {
    const { user } = await getAuthUser(request)
    if (!user) return json({ error: 'No autorizado' }, 401)

    let aid: ObjectId
    try { aid = new ObjectId(params.id) } catch { return json({ error: 'No encontrado' }, 404) }

    const db = await getDb()
    const uid = new ObjectId(user.id)

    const a = await db.collection('agreements').findOne({ _id: aid, status: 'completed' })
    if (!a) return json({ error: 'Acuerdo no encontrado o no completado' }, 404)

    const data = await request.json()
    const rating = data.rating
    const comment = (data.comment || '').toString().trim().slice(0, 500)
    if (!rating || rating < 1 || rating > 5)
      return json({ error: 'Rating debe ser entre 1 y 5' }, 400)

    let targetId: ObjectId
    if (uid.equals(a.requester_id)) {
      await db.collection('agreements').updateOne(
        { _id: aid },
        { $set: { rating_requester: rating, review_requester: comment || null } }
      )
      targetId = a.provider_id as ObjectId
    } else if (uid.equals(a.provider_id)) {
      await db.collection('agreements').updateOne(
        { _id: aid },
        { $set: { rating_provider: rating, review_provider: comment || null } }
      )
      targetId = a.requester_id as ObjectId
    } else {
      return json({ error: 'No autorizado' }, 403)
    }

    // Recalculate reputation for targetId
    // Ratings given by requesters to the provider (provider is targetId)
    const asProvider = await db.collection('agreements').find(
      { provider_id: targetId, rating_requester: { $ne: null } },
      { projection: { rating_requester: 1 } }
    ).toArray()

    // Ratings given by providers to the requester (requester is targetId)
    const asRequester = await db.collection('agreements').find(
      { requester_id: targetId, rating_provider: { $ne: null } },
      { projection: { rating_provider: 1 } }
    ).toArray()

    const allRatings = [
      ...asProvider.map(r => r.rating_requester as number),
      ...asRequester.map(r => r.rating_provider as number),
    ]

    if (allRatings.length) {
      const avg = allRatings.reduce((s, x) => s + x, 0) / allRatings.length
      await db.collection('users').updateOne(
        { _id: targetId },
        { $set: { reputation_score: Math.round(avg * 10) / 10, total_ratings: allRatings.length } }
      )
    }

    return json({ ok: true })
  })
}
