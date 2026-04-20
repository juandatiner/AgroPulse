import { json, parseParams, options, handleRoute } from '@/lib/api-utils'
import { getDb, ObjectId } from '@/lib/db'
import { getAuthUser } from '@/lib/auth'

export function OPTIONS() { return options() }

export async function GET(request: Request) {
  return handleRoute(async () => {
    const { user } = await getAuthUser(request)
    if (!user) return json({ error: 'No autorizado' }, 401)

    const db = await getDb()

    // Update last_seen for this user
    await db.collection('users').updateOne(
      { _id: new ObjectId(user.id) },
      { $set: { last_seen: new Date() } }
    )

    const uid = new ObjectId(user.id)
    const params = parseParams(request)
    const since = params.since ? new Date(params.since) : new Date('2000-01-01')

    // New messages from others in agreements the user is part of, since timestamp
    const msgs = await db.collection('messages').aggregate([
      {
        $match: {
          sender_id: { $ne: uid },
          created_at: { $gt: since },
        },
      },
      {
        $lookup: {
          from: 'agreements',
          localField: 'agreement_id',
          foreignField: '_id',
          as: '_agr',
        },
      },
      { $unwind: '$_agr' },
      {
        $match: {
          $or: [{ '_agr.requester_id': uid }, { '_agr.provider_id': uid }],
        },
      },
      {
        $lookup: {
          from: 'users',
          localField: 'sender_id',
          foreignField: '_id',
          as: '_sender',
        },
      },
      { $unwind: '$_sender' },
      { $sort: { created_at: 1 } },
      {
        $project: {
          agreement_id: 1,
          sender_id: 1,
          content: 1,
          read_status: 1,
          created_at: 1,
          sender_nombre: '$_sender.nombre',
          sender_apellido: '$_sender.apellido',
        },
      },
    ]).toArray()

    const pending = await db.collection('agreements').countDocuments({
      provider_id: uid,
      status: 'pending',
    })

    const unread = await db.collection('messages').aggregate([
      { $match: { sender_id: { $ne: uid }, read_status: false } },
      {
        $lookup: {
          from: 'agreements',
          localField: 'agreement_id',
          foreignField: '_id',
          as: '_agr',
        },
      },
      { $unwind: '$_agr' },
      {
        $match: {
          $or: [{ '_agr.requester_id': uid }, { '_agr.provider_id': uid }],
        },
      },
      { $count: 'n' },
    ]).toArray()

    const totalAgr = await db.collection('agreements').countDocuments({
      $or: [{ requester_id: uid }, { provider_id: uid }],
    })

    const serMsg = (d: Record<string, unknown>) => ({
      id: d._id instanceof ObjectId ? d._id.toHexString() : String(d._id),
      agreement_id: d.agreement_id instanceof ObjectId ? d.agreement_id.toHexString() : String(d.agreement_id),
      sender_id: d.sender_id instanceof ObjectId ? d.sender_id.toHexString() : String(d.sender_id),
      content: d.content,
      read_status: d.read_status ? 1 : 0,
      created_at: d.created_at instanceof Date ? d.created_at.toISOString() : d.created_at,
      sender_nombre: d.sender_nombre,
      sender_apellido: d.sender_apellido,
    })

    return json({
      messages: msgs.map(m => serMsg(m as Record<string, unknown>)),
      pending_agreements: pending,
      unread_messages: unread[0]?.n ?? 0,
      total_agreements: totalAgr,
    })
  })
}
