import { json, options, handleRoute, parseParams } from '@/lib/api-utils'
import { getDb, ObjectId } from '@/lib/db'
import { verifyAdmin, adminUnauth } from '@/lib/admin-auth'

export function OPTIONS() { return options() }

// Devuelve ubicaciones para mapas del admin.
//   ?type=users      → puntos de usuarios con coords.
//   ?type=resources  → puntos de publicaciones activas con coords.
export async function GET(request: Request) {
  return handleRoute(async () => {
    if (!verifyAdmin(request)) return adminUnauth()

    const params = parseParams(request)
    const type = params.type === 'resources' ? 'resources' : 'users'

    const db = await getDb()

    if (type === 'users') {
      const users = await db.collection('users').find(
        { latitude: { $ne: null }, longitude: { $ne: null } },
        { projection: { nombre: 1, apellido: 1, municipio: 1, tipo: 1, latitude: 1, longitude: 1, verified: 1, reputation_score: 1 } }
      ).toArray()
      return json(users.map(u => ({
        id: (u._id as ObjectId).toHexString(),
        nombre: u.nombre,
        apellido: u.apellido,
        municipio: u.municipio || '',
        tipo: u.tipo || '',
        lat: typeof u.latitude === 'number' ? u.latitude : parseFloat(String(u.latitude)),
        lng: typeof u.longitude === 'number' ? u.longitude : parseFloat(String(u.longitude)),
        verified: !!u.verified,
        reputation: u.reputation_score || 5,
      })).filter(u => Number.isFinite(u.lat) && Number.isFinite(u.lng)))
    }

    // resources
    const docs = await db.collection('resources').aggregate([
      { $match: { status: 'active', latitude: { $ne: null }, longitude: { $ne: null } } },
      {
        $lookup: { from: 'users', localField: 'user_id', foreignField: '_id', as: '_user' },
      },
      { $unwind: { path: '$_user', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          titulo: 1, tipo: 1, categoria: 1, municipio: 1,
          latitude: 1, longitude: 1, image_data: 1,
          user_nombre: '$_user.nombre',
          user_apellido: '$_user.apellido',
        },
      },
    ]).toArray()
    return json(docs.map(d => ({
      id: (d._id as ObjectId).toHexString(),
      titulo: d.titulo,
      tipo: d.tipo,
      categoria: d.categoria,
      municipio: d.municipio || '',
      lat: typeof d.latitude === 'number' ? d.latitude : parseFloat(String(d.latitude)),
      lng: typeof d.longitude === 'number' ? d.longitude : parseFloat(String(d.longitude)),
      user_nombre: d.user_nombre || '',
      user_apellido: d.user_apellido || '',
    })).filter(d => Number.isFinite(d.lat) && Number.isFinite(d.lng)))
  })
}
