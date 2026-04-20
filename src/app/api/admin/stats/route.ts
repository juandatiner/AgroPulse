import { json, options, handleRoute } from '@/lib/api-utils'
import { getDb, ObjectId } from '@/lib/db'
import { verifyAdmin, adminUnauth } from '@/lib/admin-auth'

export function OPTIONS() { return options() }

export async function GET(request: Request) {
  return handleRoute(async () => {
    if (!verifyAdmin(request)) return adminUnauth()

    const db = await getDb()
    const now = new Date()
    const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000)
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())

    const [
      usersTotal,
      usersOnline,
      resourcesActive,
      resourcesScheduled,
      resourcesClosed,
      agreementsPending,
      agreementsActive,
      agreementsCompleted,
      messagesToday,
    ] = await Promise.all([
      db.collection('users').countDocuments(),
      db.collection('users').countDocuments({ last_seen: { $gte: fiveMinAgo } }),
      db.collection('resources').countDocuments({ status: 'active' }),
      db.collection('resources').countDocuments({ status: 'scheduled' }),
      db.collection('resources').countDocuments({ status: 'closed' }),
      db.collection('agreements').countDocuments({ status: 'pending' }),
      db.collection('agreements').countDocuments({ status: 'active' }),
      db.collection('agreements').countDocuments({ status: 'completed' }),
      db.collection('messages').countDocuments({ created_at: { $gte: startOfToday } }),
    ])

    const recentResourcesDocs = await db.collection('resources').aggregate([
      { $sort: { created_at: -1 } },
      { $limit: 5 },
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
          titulo: 1,
          tipo: 1,
          created_at: 1,
          user_nombre: { $concat: ['$_user.nombre', ' ', '$_user.apellido'] },
        },
      },
    ]).toArray()

    const recentAgreementsDocs = await db.collection('agreements').aggregate([
      { $sort: { created_at: -1 } },
      { $limit: 5 },
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
          resource_titulo: { $ifNull: ['$_res.titulo', '$resource_snapshot_titulo'] },
          req_nombre: { $concat: ['$_req.nombre', ' ', '$_req.apellido'] },
          prov_nombre: { $concat: ['$_prov.nombre', ' ', '$_prov.apellido'] },
        },
      },
    ]).toArray()

    const toIso = (v: unknown) => v instanceof Date ? v.toISOString() : v ?? null

    const recentResources = recentResourcesDocs.map(d => ({
      id: (d._id as ObjectId).toHexString(),
      titulo: d.titulo,
      tipo: d.tipo,
      user_nombre: d.user_nombre,
      created_at: toIso(d.created_at),
    }))

    const recentAgreements = recentAgreementsDocs.map(d => ({
      id: (d._id as ObjectId).toHexString(),
      resource_titulo: d.resource_titulo,
      req_nombre: d.req_nombre,
      prov_nombre: d.prov_nombre,
      status: d.status,
      created_at: toIso(d.created_at),
    }))

    return json({
      users_total: usersTotal,
      users_online: usersOnline,
      resources_active: resourcesActive,
      resources_scheduled: resourcesScheduled,
      resources_closed: resourcesClosed,
      agreements_pending: agreementsPending,
      agreements_active: agreementsActive,
      agreements_completed: agreementsCompleted,
      messages_today: messagesToday,
      recent_resources: recentResources,
      recent_agreements: recentAgreements,
    })
  })
}
