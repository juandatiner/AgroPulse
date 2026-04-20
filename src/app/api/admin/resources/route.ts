import { json, options, handleRoute } from '@/lib/api-utils'
import { getDb, ObjectId } from '@/lib/db'
import { verifyAdmin, adminUnauth } from '@/lib/admin-auth'

export function OPTIONS() { return options() }

export async function GET(request: Request) {
  return handleRoute(async () => {
    if (!verifyAdmin(request)) return adminUnauth()

    const db = await getDb()

    const docs = await db.collection('resources').aggregate([
      { $sort: { created_at: -1 } },
      {
        $lookup: {
          from: 'users',
          localField: 'user_id',
          foreignField: '_id',
          as: '_user',
        },
      },
      { $unwind: { path: '$_user', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          tipo: 1,
          titulo: 1,
          categoria: 1,
          municipio: 1,
          status: 1,
          scheduled_at: 1,
          deactivation_scheduled_at: 1,
          created_at: 1,
          user_id: 1,
          location_notes: 1,
          has_image: { $gt: ['$image_data', ''] },
          user_nombre: '$_user.nombre',
          user_apellido: '$_user.apellido',
        },
      },
    ]).toArray()

    const toIso = (v: unknown) => v instanceof Date ? v.toISOString() : v ?? null

    return json(docs.map(d => ({
      id: (d._id as ObjectId).toHexString(),
      tipo: d.tipo,
      titulo: d.titulo,
      categoria: d.categoria,
      municipio: d.municipio,
      status: d.status,
      scheduled_at: toIso(d.scheduled_at),
      deactivation_scheduled_at: toIso(d.deactivation_scheduled_at),
      created_at: toIso(d.created_at),
      user_id: d.user_id instanceof ObjectId ? d.user_id.toHexString() : String(d.user_id),
      user_nombre: d.user_nombre || '',
      user_apellido: d.user_apellido || '',
      image_data: !!d.has_image,
      location_notes: d.location_notes || '',
    })))
  })
}
