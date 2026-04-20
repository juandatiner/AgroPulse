import { json, options, handleRoute } from '@/lib/api-utils'
import { getDb, ObjectId } from '@/lib/db'
import { verifyAdmin, adminUnauth } from '@/lib/admin-auth'

export function OPTIONS() { return options() }

export async function GET(request: Request) {
  return handleRoute(async () => {
    if (!verifyAdmin(request)) return adminUnauth()

    const db = await getDb()

    const docs = await db.collection('agreements').aggregate([
      { $sort: { updated_at: -1 } },
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
      { $unwind: { path: '$_req', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'users',
          localField: 'provider_id',
          foreignField: '_id',
          as: '_prov',
        },
      },
      { $unwind: { path: '$_prov', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          status: 1,
          created_at: 1,
          updated_at: 1,
          rating_requester: 1,
          rating_provider: 1,
          resource_titulo: { $ifNull: ['$_res.titulo', '$resource_snapshot_titulo'] },
          req_nombre: '$_req.nombre',
          req_apellido: '$_req.apellido',
          prov_nombre: '$_prov.nombre',
          prov_apellido: '$_prov.apellido',
        },
      },
    ]).toArray()

    const toIso = (v: unknown) => v instanceof Date ? v.toISOString() : v ?? null

    return json(docs.map(d => ({
      id: (d._id as ObjectId).toHexString(),
      status: d.status,
      resource_titulo: d.resource_titulo || '',
      req_nombre: d.req_nombre || '',
      req_apellido: d.req_apellido || '',
      prov_nombre: d.prov_nombre || '',
      prov_apellido: d.prov_apellido || '',
      created_at: toIso(d.created_at),
      updated_at: toIso(d.updated_at),
      rating_requester: d.rating_requester ?? null,
      rating_provider: d.rating_provider ?? null,
    })))
  })
}
