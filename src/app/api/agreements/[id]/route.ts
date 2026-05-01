import { json, options, handleRoute } from '@/lib/api-utils'
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
    cancel_reason: d.cancel_reason ?? null,
    cancelled_by_id: d.cancelled_by_id ? (d.cancelled_by_id instanceof ObjectId ? d.cancelled_by_id.toHexString() : String(d.cancelled_by_id)) : null,
    cancelled_by_nombre: d.cancelled_by_nombre ?? null,
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
    descripcion: d.descripcion ?? null,
    image_data: d.image_data ?? null,
    municipio: d.municipio ?? null,
    latitude: d.latitude ?? null,
    longitude: d.longitude ?? null,
    location_notes: d.location_notes ?? null,
    modalidad: d.modalidad ?? null,
    cantidad: d.cantidad ?? null,
    unidad: d.unidad ?? null,
    condicion: d.condicion ?? null,
    disponibilidad: d.disponibilidad ?? null,
    precio_referencia: d.precio_referencia ?? null,
    duracion_prestamo: d.duracion_prestamo ?? null,
    garantia: d.garantia ?? null,
    ofrece: d.ofrece ?? null,
    recibe: d.recibe ?? null,
    req_nombre: d.req_nombre ?? null,
    req_apellido: d.req_apellido ?? null,
    prov_nombre: d.prov_nombre ?? null,
    prov_apellido: d.prov_apellido ?? null,
  }
}

export async function GET(request: Request, { params }: { params: { id: string } }) {
  return handleRoute(async () => {
    const { user } = await getAuthUser(request)
    if (!user) return json({ error: 'No autorizado' }, 401)

    let aid: ObjectId
    try { aid = new ObjectId(params.id) } catch { return json({ error: 'No encontrado' }, 404) }

    const db = await getDb()
    const uid = new ObjectId(user.id)

    const pipeline: object[] = [
      {
        $match: {
          _id: aid,
          $or: [{ requester_id: uid }, { provider_id: uid }],
        },
      },
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
        $addFields: {
          resource_titulo: { $ifNull: ['$_res.titulo', '$resource_snapshot_titulo'] },
          resource_tipo: { $ifNull: ['$_res.tipo', '$resource_snapshot_tipo'] },
          resource_cat: { $ifNull: ['$_res.categoria', '$resource_snapshot_cat'] },
          descripcion: { $ifNull: ['$_res.descripcion', '$resource_snapshot_desc'] },
          image_data: { $ifNull: ['$_res.image_data', '$resource_snapshot_image'] },
          municipio: { $ifNull: ['$_res.municipio', '$resource_snapshot_municipio'] },
          latitude: { $ifNull: ['$_res.latitude', '$resource_snapshot_lat'] },
          longitude: { $ifNull: ['$_res.longitude', '$resource_snapshot_lng'] },
          location_notes: { $ifNull: ['$_res.location_notes', '$resource_snapshot_location_notes'] },
          modalidad: { $ifNull: ['$_res.modalidad', '$resource_snapshot_modalidad'] },
          cantidad: { $ifNull: ['$_res.cantidad', '$resource_snapshot_cantidad'] },
          unidad: { $ifNull: ['$_res.unidad', '$resource_snapshot_unidad'] },
          condicion: { $ifNull: ['$_res.condicion', '$resource_snapshot_condicion'] },
          disponibilidad: { $ifNull: ['$_res.disponibilidad', '$resource_snapshot_disponibilidad'] },
          precio_referencia: { $ifNull: ['$_res.precio_referencia', '$resource_snapshot_precio'] },
          duracion_prestamo: { $ifNull: ['$_res.duracion_prestamo', '$resource_snapshot_duracion'] },
          garantia: { $ifNull: ['$_res.garantia', '$resource_snapshot_garantia'] },
          ofrece: { $ifNull: ['$_res.ofrece', '$resource_snapshot_ofrece'] },
          recibe: { $ifNull: ['$_res.recibe', '$resource_snapshot_recibe'] },
          req_nombre: '$_req.nombre',
          req_apellido: '$_req.apellido',
          prov_nombre: '$_prov.nombre',
          prov_apellido: '$_prov.apellido',
        },
      },
    ]

    const docs = await db.collection('agreements').aggregate(pipeline).toArray()
    if (!docs.length) return json({ error: 'No encontrado' }, 404)
    return json(serializeAgreement(docs[0] as Record<string, unknown>))
  })
}

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  return handleRoute(async () => {
    const { user } = await getAuthUser(request)
    if (!user) return json({ error: 'No autorizado' }, 401)

    let aid: ObjectId
    try { aid = new ObjectId(params.id) } catch { return json({ error: 'No encontrado' }, 404) }

    const db = await getDb()
    const uid = new ObjectId(user.id)

    const a = await db.collection('agreements').findOne({
      _id: aid,
      $or: [{ requester_id: uid }, { provider_id: uid }],
    })
    if (!a) return json({ error: 'No encontrado' }, 404)

    const data = await request.json()
    const action = data.status as string
    const current = a.status as string
    const now = new Date()

    // Mark complete (either party)
    if (action === 'mark_complete') {
      if (current !== 'active')
        return json({ error: 'Solo se puede completar un acuerdo activo' }, 400)
      const isRequester = uid.equals(a.requester_id)
      if (isRequester) {
        await db.collection('agreements').updateOne({ _id: aid }, { $set: { complete_requester: 1, updated_at: now } })
      } else {
        await db.collection('agreements').updateOne({ _id: aid }, { $set: { complete_provider: 1, updated_at: now } })
      }
      const updated = await db.collection('agreements').findOne({ _id: aid })
      if (updated && updated.complete_requester && updated.complete_provider) {
        await db.collection('agreements').updateOne({ _id: aid }, { $set: { status: 'completed', updated_at: now } })
        if (a.resource_id) {
          await db.collection('resources').updateOne({ _id: a.resource_id }, { $set: { status: 'completed' } })
        }
        return json({ ok: true, status: 'completed' })
      }
      return json({ ok: true, status: 'active', waiting: true })
    }

    const validTransitions: Record<string, string[]> = {
      pending: ['active', 'rejected', 'cancelled'],
      active: ['completed', 'cancelled'],
    }
    if (!(validTransitions[current] || []).includes(action))
      return json({ error: `Acción no válida en estado ${current}` }, 400)
    if (['active', 'rejected', 'completed'].includes(action) && !uid.equals(a.provider_id))
      return json({ error: 'Solo el dueño del recurso puede realizar esta acción' }, 403)

    const setFields: Record<string, unknown> = { status: action, updated_at: now }
    if (action === 'cancelled' || action === 'rejected') {
      const reason = typeof data.cancel_reason === 'string' ? data.cancel_reason.trim().slice(0, 500) : ''
      if (!reason) return json({ error: 'Debes indicar el motivo de la cancelación' }, 400)
      setFields.cancel_reason = reason
      setFields.cancelled_by_id = uid
      setFields.cancelled_by_nombre = `${user.nombre || ''} ${user.apellido || ''}`.trim()
    }
    await db.collection('agreements').updateOne({ _id: aid }, { $set: setFields })

    const rid = a.resource_id as ObjectId | null
    if (action === 'active' && rid) {
      await db.collection('resources').updateOne({ _id: rid }, { $set: { status: 'closed' } })
    } else if (action === 'completed' && rid) {
      // No eliminar el recurso: mantener referencia y marcar como completado
      // El recurso queda oculto de listados pero su info sigue disponible para el detalle del acuerdo
      await db.collection('resources').updateOne({ _id: rid }, { $set: { status: 'completed' } })
    } else if (action === 'cancelled' && rid) {
      if (current === 'active') {
        await db.collection('resources').updateOne({ _id: rid }, { $set: { status: 'active' } })
      }
    }
    return json({ ok: true, status: action })
  })
}
