import { json, parseParams, options, handleRoute } from '@/lib/api-utils'
import { getDb, ObjectId } from '@/lib/db'
import { getAuthUser } from '@/lib/auth'

export function OPTIONS() { return options() }

function serializeAgreement(d: Record<string, unknown>): Record<string, unknown> {
  const toStr = (v: unknown) => v instanceof ObjectId ? v.toHexString() : v != null ? String(v) : null
  const toIso = (v: unknown) => v instanceof Date ? v.toISOString() : v ?? null
  return {
    id: toStr(d._id),
    resource_id: d.resource_id ? toStr(d.resource_id) : null,
    requester_id: toStr(d.requester_id),
    provider_id: toStr(d.provider_id),
    status: d.status,
    message: d.message || '',
    rating_requester: d.rating_requester ?? null,
    rating_provider: d.rating_provider ?? null,
    review_requester: d.review_requester ?? null,
    review_provider: d.review_provider ?? null,
    complete_requester: d.complete_requester ?? 0,
    complete_provider: d.complete_provider ?? 0,
    resource_snapshot_titulo: d.resource_snapshot_titulo ?? null,
    resource_snapshot_tipo: d.resource_snapshot_tipo ?? null,
    resource_snapshot_cat: d.resource_snapshot_cat ?? null,
    resource_snapshot_desc: d.resource_snapshot_desc ?? null,
    resource_snapshot_image: d.resource_snapshot_image ?? null,
    created_at: toIso(d.created_at),
    updated_at: toIso(d.updated_at),
    resource_titulo: d.resource_titulo ?? null,
    resource_tipo: d.resource_tipo ?? null,
    resource_cat: d.resource_cat ?? null,
    resource_desc: d.resource_desc ?? null,
    resource_image: d.resource_image ?? null,
    resource_municipio: d.resource_municipio ?? null,
    req_nombre: d.req_nombre ?? null,
    req_apellido: d.req_apellido ?? null,
    req_verified: !!d.req_verified,
    req_reputation: d.req_reputation ?? 5,
    prov_nombre: d.prov_nombre ?? null,
    prov_apellido: d.prov_apellido ?? null,
    prov_verified: !!d.prov_verified,
    prov_reputation: d.prov_reputation ?? 5,
    unread_count: d.unread_count ?? 0,
    cancel_reason: d.cancel_reason ?? null,
    cancelled_by_id: d.cancelled_by_id ? toStr(d.cancelled_by_id) : null,
    cancelled_by_nombre: d.cancelled_by_nombre ?? null,
  }
}

export async function GET(request: Request) {
  return handleRoute(async () => {
    const { user } = await getAuthUser(request)
    if (!user) return json({ error: 'No autorizado' }, 401)

    const db = await getDb()
    const uid = new ObjectId(user.id)
    const params = parseParams(request)

    const matchStage: Record<string, unknown> = {
      $or: [{ requester_id: uid }, { provider_id: uid }],
    }
    if (params.status && params.status !== 'todos') {
      matchStage.status = params.status
    }

    const pipeline: object[] = [
      { $match: matchStage },
      {
        $lookup: {
          from: 'resources',
          localField: 'resource_id',
          foreignField: '_id',
          as: '_res',
        },
      },
      { $addFields: { _res: { $arrayElemAt: ['$_res', 0] } } },
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
        $lookup: {
          from: 'users',
          localField: 'provider_id',
          foreignField: '_id',
          as: '_prov',
        },
      },
      { $unwind: '$_prov' },
      {
        $lookup: {
          from: 'messages',
          let: { aid: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$agreement_id', '$$aid'] },
                    { $ne: ['$sender_id', uid] },
                    { $eq: ['$read_status', false] },
                  ],
                },
              },
            },
            { $count: 'n' },
          ],
          as: '_unread',
        },
      },
      {
        $addFields: {
          unread_count: { $ifNull: [{ $arrayElemAt: ['$_unread.n', 0] }, 0] },
          resource_titulo: { $ifNull: ['$_res.titulo', '$resource_snapshot_titulo'] },
          resource_tipo: { $ifNull: ['$_res.tipo', '$resource_snapshot_tipo'] },
          resource_cat: { $ifNull: ['$_res.categoria', '$resource_snapshot_cat'] },
          resource_desc: { $ifNull: ['$_res.descripcion', '$resource_snapshot_desc'] },
          resource_image: { $ifNull: ['$_res.image_data', '$resource_snapshot_image'] },
          resource_municipio: '$_res.municipio',
          req_nombre: '$_req.nombre',
          req_apellido: '$_req.apellido',
          req_verified: { $ifNull: ['$_req.verified', false] },
          req_reputation: { $ifNull: ['$_req.reputation_score', 5] },
          prov_nombre: '$_prov.nombre',
          prov_apellido: '$_prov.apellido',
          prov_verified: { $ifNull: ['$_prov.verified', false] },
          prov_reputation: { $ifNull: ['$_prov.reputation_score', 5] },
        },
      },
      { $sort: { updated_at: -1 } },
    ]

    const docs = await db.collection('agreements').aggregate(pipeline).toArray()
    return json(docs.map(d => serializeAgreement(d as Record<string, unknown>)))
  })
}

export async function POST(request: Request) {
  return handleRoute(async () => {
    const { user } = await getAuthUser(request)
    if (!user) return json({ error: 'No autorizado' }, 401)

    const data = await request.json()
    const ridStr = data.resource_id
    if (!ridStr) return json({ error: 'resource_id requerido' }, 400)

    let rid: ObjectId
    try { rid = new ObjectId(ridStr) } catch { return json({ error: 'Este recurso ya no está disponible' }, 404) }

    const db = await getDb()
    const uid = new ObjectId(user.id)

    const resource = await db.collection('resources').findOne({ _id: rid })
    if (!resource) return json({ error: 'Este recurso ya no está disponible' }, 404)
    if (resource.status !== 'active')
      return json({ error: 'Este recurso ya fue asignado y no acepta nuevas solicitudes' }, 400)
    if (resource.user_id.toHexString() === user.id)
      return json({ error: 'No puedes solicitar tu propio recurso' }, 400)

    const existing = await db.collection('agreements').findOne({
      resource_id: rid,
      requester_id: uid,
      status: { $nin: ['rejected', 'cancelled'] },
    })
    if (existing)
      return json({
        error: 'Ya tienes una solicitud para este recurso',
        agreement_id: existing._id.toHexString(),
      }, 400)

    // Clean up old rejected/cancelled for same resource+requester
    const oldRejected = await db.collection('agreements').find({
      resource_id: rid,
      requester_id: uid,
      status: { $in: ['rejected', 'cancelled'] },
    }).toArray()
    for (const old of oldRejected) {
      await db.collection('messages').deleteMany({ agreement_id: old._id })
      await db.collection('agreements').deleteOne({ _id: old._id })
    }

    const now = new Date()
    const agrDoc = {
      resource_id: rid,
      requester_id: uid,
      provider_id: resource.user_id,
      status: 'pending',
      message: data.message || '',
      rating_requester: null,
      rating_provider: null,
      review_requester: null,
      review_provider: null,
      complete_requester: 0,
      complete_provider: 0,
      resource_snapshot_titulo: resource.titulo ?? null,
      resource_snapshot_tipo: resource.tipo ?? null,
      resource_snapshot_cat: resource.categoria ?? null,
      resource_snapshot_desc: resource.descripcion ?? null,
      resource_snapshot_image: resource.image_data ?? null,
      created_at: now,
      updated_at: now,
    }
    const result = await db.collection('agreements').insertOne(agrDoc)
    const aid = result.insertedId

    if (data.message) {
      await db.collection('messages').insertOne({
        agreement_id: aid,
        sender_id: uid,
        content: data.message,
        read_status: false,
        created_at: now,
      })
    }

    return json({ id: aid.toHexString(), status: 'pending' }, 201)
  })
}
