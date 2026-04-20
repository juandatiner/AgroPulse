import { json, options, handleRoute } from '@/lib/api-utils'
import { getDb, ObjectId } from '@/lib/db'
import { getAuthUser } from '@/lib/auth'

export function OPTIONS() { return options() }

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  return handleRoute(async () => {
    let rid: ObjectId
    try { rid = new ObjectId(params.id) } catch { return json({ error: 'No encontrado' }, 404) }

    const db = await getDb()
    const docs = await db.collection('resources').aggregate([
      { $match: { _id: rid } },
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
        $project: {
          tipo: 1, titulo: 1, descripcion: 1, categoria: 1, modalidad: 1,
          municipio: 1, latitude: 1, longitude: 1, cantidad: 1, unidad: 1,
          condicion: 1, disponibilidad: 1, precio_referencia: 1, duracion_prestamo: 1,
          garantia: 1, ofrece: 1, recibe: 1, image_data: 1, status: 1,
          scheduled_at: 1, deactivation_scheduled_at: 1, location_notes: 1, created_at: 1,
          user_id: 1,
          owner_id: '$_user._id',
          user_nombre: '$_user.nombre',
          user_apellido: '$_user.apellido',
          user_municipio: '$_user.municipio',
          user_tipo: '$_user.tipo',
          user_reputation: '$_user.reputation_score',
        },
      },
    ]).toArray()

    if (!docs.length) return json({ error: 'No encontrado' }, 404)
    const d = docs[0]
    return json({
      id: d._id.toHexString(),
      tipo: d.tipo,
      titulo: d.titulo,
      descripcion: d.descripcion,
      categoria: d.categoria,
      modalidad: d.modalidad || '',
      municipio: d.municipio,
      latitude: d.latitude ?? null,
      longitude: d.longitude ?? null,
      cantidad: d.cantidad || '',
      unidad: d.unidad || '',
      condicion: d.condicion || '',
      disponibilidad: d.disponibilidad || '',
      precio_referencia: d.precio_referencia || '',
      duracion_prestamo: d.duracion_prestamo || '',
      garantia: d.garantia || '',
      ofrece: d.ofrece || '',
      recibe: d.recibe || '',
      image_data: d.image_data || '',
      status: d.status,
      scheduled_at: d.scheduled_at instanceof Date ? d.scheduled_at.toISOString() : d.scheduled_at ?? null,
      deactivation_scheduled_at: d.deactivation_scheduled_at instanceof Date
        ? d.deactivation_scheduled_at.toISOString()
        : d.deactivation_scheduled_at ?? null,
      location_notes: d.location_notes || '',
      created_at: d.created_at instanceof Date ? d.created_at.toISOString() : d.created_at,
      user_id: d.user_id instanceof ObjectId ? d.user_id.toHexString() : String(d.user_id),
      owner_id: d.owner_id instanceof ObjectId ? d.owner_id.toHexString() : String(d.owner_id),
      user_nombre: d.user_nombre,
      user_apellido: d.user_apellido,
      user_municipio: d.user_municipio,
      user_tipo: d.user_tipo,
      user_reputation: d.user_reputation,
    })
  })
}

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  return handleRoute(async () => {
    const { user } = await getAuthUser(request)
    if (!user) return json({ error: 'No autorizado' }, 401)

    let rid: ObjectId
    try { rid = new ObjectId(params.id) } catch { return json({ error: 'No encontrado' }, 404) }

    const db = await getDb()
    const uid = new ObjectId(user.id)
    const existing = await db.collection('resources').findOne({ _id: rid, user_id: uid })
    if (!existing) return json({ error: 'No encontrado o no autorizado' }, 404)

    const data = await request.json()
    const allowed = [
      'titulo', 'descripcion', 'categoria', 'modalidad', 'municipio', 'status',
      'cantidad', 'unidad', 'condicion', 'disponibilidad', 'precio_referencia',
      'duracion_prestamo', 'garantia', 'ofrece', 'recibe',
      'scheduled_at', 'deactivation_scheduled_at', 'location_notes',
    ]
    const updates: Record<string, unknown> = {}
    for (const f of allowed) {
      if (!(f in data)) continue
      if (f === 'scheduled_at' || f === 'deactivation_scheduled_at') {
        updates[f] = data[f] ? new Date(data[f]) : null
      } else {
        updates[f] = data[f]
      }
    }
    if (Object.keys(updates).length) {
      await db.collection('resources').updateOne({ _id: rid }, { $set: updates })
    }
    return json({ ok: true })
  })
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  return handleRoute(async () => {
    const { user } = await getAuthUser(request)
    if (!user) return json({ error: 'No autorizado' }, 401)

    let rid: ObjectId
    try { rid = new ObjectId(params.id) } catch { return json({ error: 'No encontrado' }, 404) }

    const db = await getDb()
    await db.collection('resources').deleteOne({ _id: rid, user_id: new ObjectId(user.id) })
    return json({ ok: true })
  })
}
