import { json, parseParams, options, handleRoute } from '@/lib/api-utils'
import { getDb, ObjectId, sa } from '@/lib/db'
import { getAuthUser } from '@/lib/auth'
import { computeSubscriptionState, incrementPostCount } from '@/lib/subscription'

export function OPTIONS() { return options() }

export async function GET(request: Request) {
  return handleRoute(async () => {
    const db = await getDb()
    const now = new Date()

    // Auto-deactivate resources past their deactivation_scheduled_at
    await db.collection('resources').updateMany(
      { status: 'active', deactivation_scheduled_at: { $ne: null, $lte: now } },
      { $set: { status: 'closed' } }
    )

    const params = parseParams(request)
    const isOwner = !!params.owner
    const sort = params.sort === 'oldest' ? 1 : -1

    if (isOwner) {
      let ownerId: ObjectId
      try { ownerId = new ObjectId(params.owner) } catch { return json([]) }

      const pipeline: object[] = [
        { $match: { user_id: ownerId } },
        {
          $lookup: {
            from: 'users',
            localField: 'user_id',
            foreignField: '_id',
            as: '_user',
          },
        },
        { $unwind: '$_user' },
        {
          $lookup: {
            from: 'agreements',
            let: { rid: '$_id' },
            pipeline: [
              {
                $match: {
                  $expr: { $eq: ['$resource_id', '$$rid'] },
                  status: { $nin: ['rejected', 'cancelled', 'completed'] },
                },
              },
              { $limit: 1 },
              {
                $lookup: {
                  from: 'users',
                  localField: 'requester_id',
                  foreignField: '_id',
                  as: '_req',
                },
              },
              { $unwind: { path: '$_req', preserveNullAndEmptyArrays: true } },
            ],
            as: '_agr',
          },
        },
        {
          $addFields: {
            _agr: { $arrayElemAt: ['$_agr', 0] },
          },
        },
        { $sort: { created_at: sort } },
        {
          $project: {
            tipo: 1, titulo: 1, descripcion: 1, categoria: 1, municipio: 1,
            image_data: 1, status: 1, scheduled_at: 1, deactivation_scheduled_at: 1,
            location_notes: 1, created_at: 1,
            user_id: 1,
            user_nombre: '$_user.nombre',
            user_apellido: '$_user.apellido',
            user_municipio: '$_user.municipio',
            user_reputation: '$_user.reputation_score',
            user_verified: '$_user.verified',
            agr_id: '$_agr._id',
            agr_status: '$_agr.status',
            agr_req_nombre: '$_agr._req.nombre',
            agr_req_apellido: '$_agr._req.apellido',
          },
        },
      ]

      const docs = await db.collection('resources').aggregate(pipeline).toArray()
      return json(docs.map(d => {
        const out: Record<string, unknown> = {
          id: d._id.toHexString(),
          tipo: d.tipo,
          titulo: d.titulo,
          descripcion: d.descripcion,
          categoria: d.categoria,
          municipio: d.municipio,
          image_data: d.image_data || '',
          status: d.status,
          scheduled_at: d.scheduled_at instanceof Date ? d.scheduled_at.toISOString() : d.scheduled_at ?? null,
          deactivation_scheduled_at: d.deactivation_scheduled_at instanceof Date
            ? d.deactivation_scheduled_at.toISOString()
            : d.deactivation_scheduled_at ?? null,
          location_notes: d.location_notes || '',
          created_at: d.created_at instanceof Date ? d.created_at.toISOString() : d.created_at,
          user_id: d.user_id instanceof ObjectId ? d.user_id.toHexString() : String(d.user_id),
          user_nombre: d.user_nombre,
          user_apellido: d.user_apellido,
          user_municipio: d.user_municipio,
          user_reputation: d.user_reputation,
      user_verified: !!d.user_verified,
        }
        if (d.agr_id) {
          out.agr_id = d.agr_id instanceof ObjectId ? d.agr_id.toHexString() : String(d.agr_id)
          out.agr_status = d.agr_status
          out.agr_req_nombre = d.agr_req_nombre || null
          out.agr_req_apellido = d.agr_req_apellido || null
        }
        return out
      }))
    }

    // Marketplace query
    const match: Record<string, unknown> = {
      status: 'active',
      $or: [{ scheduled_at: null }, { scheduled_at: { $lte: now } }],
      $and: [
        { $or: [{ deactivation_scheduled_at: null }, { deactivation_scheduled_at: { $gt: now } }] },
      ],
    }
    if (params.tipo) match.tipo = params.tipo
    if (params.categoria) match.categoria = params.categoria
    if (params.municipio) match.municipio = params.municipio
    if (params.exclude_user) {
      try { match.user_id = { $ne: new ObjectId(params.exclude_user) } } catch { /* ignore */ }
    }
    if (params.q) {
      const q = new RegExp(params.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
      match.$or = [{ titulo: q }, { descripcion: q }, { municipio: q }]
      // Remove the existing $or from status-related filters if q is set, merge carefully
      delete (match as Record<string, unknown>).$or
      match.$and = [
        { $or: [{ scheduled_at: null }, { scheduled_at: { $lte: now } }] },
        { $or: [{ deactivation_scheduled_at: null }, { deactivation_scheduled_at: { $gt: now } }] },
        { $or: [{ titulo: q }, { descripcion: q }, { municipio: q }] },
      ]
    }

    const pipeline: object[] = [
      { $match: match },
      {
        $lookup: {
          from: 'users',
          localField: 'user_id',
          foreignField: '_id',
          as: '_user',
        },
      },
      { $unwind: '$_user' },
      { $sort: { created_at: sort } },
      {
        $project: {
          tipo: 1, titulo: 1, descripcion: 1, categoria: 1, municipio: 1,
          image_data: 1, status: 1, scheduled_at: 1, deactivation_scheduled_at: 1,
          location_notes: 1, created_at: 1, user_id: 1,
          user_nombre: '$_user.nombre',
          user_apellido: '$_user.apellido',
          user_municipio: '$_user.municipio',
          user_reputation: '$_user.reputation_score',
        },
      },
    ]

    const docs = await db.collection('resources').aggregate(pipeline).toArray()
    return json(docs.map(d => ({
      id: d._id.toHexString(),
      tipo: d.tipo,
      titulo: d.titulo,
      descripcion: d.descripcion,
      categoria: d.categoria,
      municipio: d.municipio,
      image_data: d.image_data || '',
      status: d.status,
      scheduled_at: d.scheduled_at instanceof Date ? d.scheduled_at.toISOString() : d.scheduled_at ?? null,
      deactivation_scheduled_at: d.deactivation_scheduled_at instanceof Date
        ? d.deactivation_scheduled_at.toISOString()
        : d.deactivation_scheduled_at ?? null,
      location_notes: d.location_notes || '',
      created_at: d.created_at instanceof Date ? d.created_at.toISOString() : d.created_at,
      user_id: d.user_id instanceof ObjectId ? d.user_id.toHexString() : String(d.user_id),
      user_nombre: d.user_nombre,
      user_apellido: d.user_apellido,
      user_municipio: d.user_municipio,
      user_reputation: d.user_reputation,
      user_verified: !!d.user_verified,
    })))
  })
}

export async function POST(request: Request) {
  return handleRoute(async () => {
    const { user } = await getAuthUser(request)
    if (!user) return json({ error: 'No autorizado' }, 401)
    const data = await request.json()
    const required = ['tipo', 'titulo', 'descripcion', 'categoria']
    for (const f of required) {
      if (!(data[f] || '').trim()) return json({ error: `Campo ${f} es requerido` }, 400)
    }

    const sub = await computeSubscriptionState(user.id)
    if (!sub.can_post) {
      return json({
        error: 'subscription_required',
        message: `Alcanzaste el límite de ${sub.free_posts_per_month} publicaciones este mes. Suscríbete para publicar sin límite.`,
        subscription: sub,
      }, 402)
    }

    const db = await getDb()
    const now = new Date()
    const doc = {
      user_id: new ObjectId(user.id),
      tipo: data.tipo,
      titulo: data.titulo.trim(),
      descripcion: data.descripcion.trim(),
      categoria: data.categoria,
      modalidad: data.modalidad || '',
      municipio: data.municipio || '',
      latitude: data.latitude || null,
      longitude: data.longitude || null,
      cantidad: data.cantidad || '',
      unidad: data.unidad || '',
      condicion: data.condicion || '',
      disponibilidad: data.disponibilidad || '',
      precio_referencia: data.precio_referencia || '',
      duracion_prestamo: data.duracion_prestamo || '',
      garantia: data.garantia || '',
      ofrece: data.ofrece || '',
      recibe: data.recibe || '',
      image_data: data.image_data || '',
      status: 'active',
      scheduled_at: data.scheduled_at ? new Date(data.scheduled_at) : null,
      deactivation_scheduled_at: data.deactivation_scheduled_at
        ? new Date(data.deactivation_scheduled_at)
        : null,
      location_notes: data.location_notes || '',
      created_at: now,
    }
    const result = await db.collection('resources').insertOne(doc)
    await incrementPostCount(user.id)
    return json({
      id: result.insertedId.toHexString(),
      ...doc,
      user_id: user.id,
      scheduled_at: doc.scheduled_at ? doc.scheduled_at.toISOString() : null,
      deactivation_scheduled_at: doc.deactivation_scheduled_at
        ? doc.deactivation_scheduled_at.toISOString()
        : null,
      created_at: now.toISOString(),
    }, 201)
  })
}
