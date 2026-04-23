import { json, options, handleRoute } from '@/lib/api-utils'
import { getDb, ObjectId } from '@/lib/db'
import { verifyAdmin, adminUnauth } from '@/lib/admin-auth'

export function OPTIONS() { return options() }

export async function GET(request: Request) {
  return handleRoute(async () => {
    if (!verifyAdmin(request)) return adminUnauth()
    const db = await getDb()
    const docs = await db.collection('support_tickets').aggregate([
      { $sort: { priority: -1, updated_at: -1 } },
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
          subject: 1, status: 1, priority: 1, last_message: 1,
          unread_for_admin: 1, created_at: 1, updated_at: 1,
          user_id: 1,
          user_nombre: '$_user.nombre',
          user_apellido: '$_user.apellido',
          user_email: '$_user.email',
          user_subscription_status: '$_user.subscription_status',
        },
      },
    ]).toArray()

    return json(docs.map(d => ({
      id: (d._id as ObjectId).toHexString(),
      user_id: d.user_id instanceof ObjectId ? d.user_id.toHexString() : String(d.user_id),
      user_nombre: d.user_nombre,
      user_apellido: d.user_apellido,
      user_email: d.user_email,
      user_subscription_status: d.user_subscription_status || 'trial',
      subject: d.subject,
      status: d.status,
      priority: d.priority,
      last_message: d.last_message || '',
      unread_for_admin: d.unread_for_admin || 0,
      created_at: d.created_at instanceof Date ? d.created_at.toISOString() : d.created_at,
      updated_at: d.updated_at instanceof Date ? d.updated_at.toISOString() : d.updated_at,
    })))
  })
}
