import { json, options, handleRoute } from '@/lib/api-utils'
import { getDb, ObjectId } from '@/lib/db'
import { verifyAdmin, adminUnauth } from '@/lib/admin-auth'

export function OPTIONS() { return options() }

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleRoute(async () => {
    if (!verifyAdmin(request)) return adminUnauth()

    const { id } = await params
    let rid: ObjectId
    try { rid = new ObjectId(id) } catch { return json({ error: 'ID inválido' }, 400) }

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
      { $unwind: { path: '$_user', preserveNullAndEmptyArrays: true } },
    ]).toArray()

    if (!docs.length) return json({ error: 'Publicación no encontrada' }, 404)
    const d = docs[0]
    const toIso = (v: unknown) => v instanceof Date ? v.toISOString() : v ?? null

    return json({
      id: (d._id as ObjectId).toHexString(),
      tipo: d.tipo || '',
      titulo: d.titulo || '',
      descripcion: d.descripcion || '',
      categoria: d.categoria || '',
      municipio: d.municipio || '',
      modalidad: d.modalidad || '',
      cantidad: d.cantidad || '',
      unidad: d.unidad || '',
      condicion: d.condicion || '',
      disponibilidad: d.disponibilidad || '',
      precio_referencia: d.precio_referencia || '',
      duracion_prestamo: d.duracion_prestamo || '',
      garantia: d.garantia || '',
      ofrece: d.ofrece || '',
      recibe: d.recibe || '',
      location_notes: d.location_notes || '',
      latitude: typeof d.latitude === 'number' ? d.latitude : (d.latitude ? parseFloat(String(d.latitude)) : null),
      longitude: typeof d.longitude === 'number' ? d.longitude : (d.longitude ? parseFloat(String(d.longitude)) : null),
      image_data: d.image_data || '',
      status: d.status || 'active',
      scheduled_at: toIso(d.scheduled_at),
      deactivation_scheduled_at: toIso(d.deactivation_scheduled_at),
      created_at: toIso(d.created_at),
      has_image: !!(d.image_data),
      user_id: d.user_id instanceof ObjectId ? d.user_id.toHexString() : String(d.user_id || ''),
      user_nombre: d._user?.nombre || '',
      user_apellido: d._user?.apellido || '',
      user_email: d._user?.email || '',
      user_municipio: d._user?.municipio || '',
      user_tipo: d._user?.tipo || '',
      user_reputation: d._user?.reputation_score || 5,
      user_verified: !!d._user?.verified,
    })
  })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleRoute(async () => {
    if (!verifyAdmin(request)) return adminUnauth()

    const { id } = await params
    let rid: ObjectId
    try { rid = new ObjectId(id) } catch { return json({ error: 'ID inválido' }, 400) }

    const body = await request.json()
    const allowed = ['tipo', 'titulo', 'descripcion', 'categoria', 'municipio', 'status',
                     'modalidad', 'cantidad', 'unidad', 'condicion', 'disponibilidad',
                     'precio_referencia', 'duracion_prestamo', 'garantia', 'ofrece', 'recibe', 'location_notes']
    const update: Record<string, unknown> = {}
    for (const k of allowed) {
      if (k in body) update[k] = String(body[k] ?? '').trim()
    }
    if ('image_data' in body) update.image_data = String(body.image_data ?? '')
    if ('latitude' in body) {
      const v = body.latitude
      update.latitude = (v === null || v === '') ? null : (typeof v === 'number' ? v : parseFloat(String(v)))
    }
    if ('longitude' in body) {
      const v = body.longitude
      update.longitude = (v === null || v === '') ? null : (typeof v === 'number' ? v : parseFloat(String(v)))
    }
    if (!Object.keys(update).length) return json({ error: 'Sin campos para actualizar' }, 400)

    const db = await getDb()
    await db.collection('resources').updateOne({ _id: rid }, { $set: update })
    return json({ ok: true })
  })
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleRoute(async () => {
    if (!verifyAdmin(request)) return adminUnauth()

    const { id } = await params
    let rid: ObjectId
    try { rid = new ObjectId(id) } catch { return json({ error: 'ID inválido' }, 400) }

    const db = await getDb()
    await db.collection('resources').deleteOne({ _id: rid })
    return json({ ok: true })
  })
}
