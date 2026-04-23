import { json, options, handleRoute } from '@/lib/api-utils'
import { getDb, ObjectId } from '@/lib/db'

export function OPTIONS() { return options() }

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  return handleRoute(async () => {
    let uid: ObjectId
    try { uid = new ObjectId(params.id) } catch { return json({ error: 'No encontrado' }, 404) }

    const db = await getDb()
    const userDoc = await db.collection('users').findOne({ _id: uid })
    if (!userDoc) return json({ error: 'No encontrado' }, 404)

    const now = new Date()

    // Active resources for this user
    const resources = await db.collection('resources').find(
      {
        user_id: uid,
        status: 'active',
        $or: [{ scheduled_at: null }, { scheduled_at: { $lte: now } }],
      },
      {
        projection: {
          tipo: 1, titulo: 1, descripcion: 1, categoria: 1, municipio: 1,
          image_data: 1, created_at: 1,
        },
        sort: { created_at: -1 },
        limit: 12,
      }
    ).toArray()

    // Reviews received: as provider (rated by requester) + as requester (rated by provider)
    const reviewsAsProvider = await db.collection('agreements').aggregate([
      {
        $match: {
          provider_id: uid,
          status: 'completed',
          rating_requester: { $ne: null },
          review_requester: { $ne: null },
        },
      },
      {
        $lookup: {
          from: 'users',
          localField: 'requester_id',
          foreignField: '_id',
          as: '_req',
        },
      },
      { $unwind: '$_req' },
      {
        $project: {
          rating: '$rating_requester',
          comment: '$review_requester',
          reviewer_nombre: '$_req.nombre',
          reviewer_apellido: '$_req.apellido',
          updated_at: 1,
        },
      },
      { $sort: { updated_at: -1 } },
      { $limit: 20 },
    ]).toArray()

    const reviewsAsRequester = await db.collection('agreements').aggregate([
      {
        $match: {
          requester_id: uid,
          status: 'completed',
          rating_provider: { $ne: null },
          review_provider: { $ne: null },
        },
      },
      {
        $lookup: {
          from: 'users',
          localField: 'provider_id',
          foreignField: '_id',
          as: '_prov',
        },
      },
      { $unwind: '$_prov' },
      {
        $project: {
          rating: '$rating_provider',
          comment: '$review_provider',
          reviewer_nombre: '$_prov.nombre',
          reviewer_apellido: '$_prov.apellido',
          updated_at: 1,
        },
      },
      { $sort: { updated_at: -1 } },
      { $limit: 20 },
    ]).toArray()

    const allReviews = [...reviewsAsProvider, ...reviewsAsRequester]
      .sort((a, b) => {
        const da = a.updated_at instanceof Date ? a.updated_at.getTime() : 0
        const db2 = b.updated_at instanceof Date ? b.updated_at.getTime() : 0
        return db2 - da
      })
      .slice(0, 20)
      .map(r => ({
        id: r._id instanceof ObjectId ? r._id.toHexString() : String(r._id),
        rating: r.rating,
        comment: r.comment,
        reviewer_nombre: r.reviewer_nombre,
        reviewer_apellido: r.reviewer_apellido,
        updated_at: r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at,
      }))

    return json({
      id: uid.toHexString(),
      nombre: userDoc.nombre,
      apellido: userDoc.apellido,
      municipio: userDoc.municipio,
      tipo: userDoc.tipo,
      bio: userDoc.bio || '',
      reputation_score: userDoc.reputation_score ?? 5.0,
      total_ratings: userDoc.total_ratings ?? 0,
      latitude: userDoc.latitude ?? null,
      longitude: userDoc.longitude ?? null,
      created_at: userDoc.created_at instanceof Date ? userDoc.created_at.toISOString() : userDoc.created_at,
      verified: !!userDoc.verified,
      resources: resources.map(r => ({
        id: r._id instanceof ObjectId ? r._id.toHexString() : String(r._id),
        tipo: r.tipo,
        titulo: r.titulo,
        descripcion: r.descripcion,
        categoria: r.categoria,
        municipio: r.municipio,
        image_data: r.image_data || '',
        created_at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
      })),
      reviews: allReviews,
    })
  })
}
