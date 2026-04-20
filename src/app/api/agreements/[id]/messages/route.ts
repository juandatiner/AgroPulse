import { json, options, handleRoute } from '@/lib/api-utils'
import { getDb, ObjectId } from '@/lib/db'
import { getAuthUser } from '@/lib/auth'

export function OPTIONS() { return options() }

function serializeMessage(d: Record<string, unknown>): Record<string, unknown> {
  const toStr = (v: unknown) => v instanceof ObjectId ? v.toHexString() : v != null ? String(v) : null
  return {
    id: toStr(d._id),
    agreement_id: toStr(d.agreement_id),
    sender_id: toStr(d.sender_id),
    content: d.content,
    read_status: d.read_status ? 1 : 0,
    created_at: d.created_at instanceof Date ? d.created_at.toISOString() : d.created_at,
    sender_nombre: d.sender_nombre ?? null,
    sender_apellido: d.sender_apellido ?? null,
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

    const agr = await db.collection('agreements').findOne({
      _id: aid,
      $or: [{ requester_id: uid }, { provider_id: uid }],
    })
    if (!agr) return json({ error: 'No encontrado' }, 404)

    const msgs = await db.collection('messages').aggregate([
      { $match: { agreement_id: aid } },
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
        $addFields: {
          sender_nombre: '$_sender.nombre',
          sender_apellido: '$_sender.apellido',
        },
      },
    ]).toArray()

    // Mark unread as read
    await db.collection('messages').updateMany(
      { agreement_id: aid, sender_id: { $ne: uid }, read_status: false },
      { $set: { read_status: true } }
    )

    return json(msgs.map(m => serializeMessage(m as Record<string, unknown>)))
  })
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  return handleRoute(async () => {
    const { user } = await getAuthUser(request)
    if (!user) return json({ error: 'No autorizado' }, 401)

    let aid: ObjectId
    try { aid = new ObjectId(params.id) } catch { return json({ error: 'No encontrado' }, 404) }

    const db = await getDb()
    const uid = new ObjectId(user.id)

    const agr = await db.collection('agreements').findOne({
      _id: aid,
      $or: [{ requester_id: uid }, { provider_id: uid }],
    })
    if (!agr) return json({ error: 'No encontrado' }, 404)

    const data = await request.json()
    const content = (data.content || '').trim()
    if (!content) return json({ error: 'Mensaje vacío' }, 400)

    const now = new Date()
    const msgDoc = {
      agreement_id: aid,
      sender_id: uid,
      content,
      read_status: false,
      created_at: now,
    }
    const result = await db.collection('messages').insertOne(msgDoc)
    await db.collection('agreements').updateOne({ _id: aid }, { $set: { updated_at: now } })

    const inserted = await db.collection('messages').aggregate([
      { $match: { _id: result.insertedId } },
      {
        $lookup: {
          from: 'users',
          localField: 'sender_id',
          foreignField: '_id',
          as: '_sender',
        },
      },
      { $unwind: '$_sender' },
      {
        $addFields: {
          sender_nombre: '$_sender.nombre',
          sender_apellido: '$_sender.apellido',
        },
      },
    ]).toArray()

    return json(serializeMessage(inserted[0] as Record<string, unknown>), 201)
  })
}
