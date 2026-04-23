import { json, options, handleRoute } from '@/lib/api-utils'
import { getDb, ObjectId } from '@/lib/db'
import { getAuthUser } from '@/lib/auth'

export function OPTIONS() { return options() }

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleRoute(async () => {
    const { user } = await getAuthUser(request)
    if (!user) return json({ error: 'No autorizado' }, 401)
    const { id } = await params
    let tid: ObjectId
    try { tid = new ObjectId(id) } catch { return json({ error: 'ID inválido' }, 400) }

    const db = await getDb()
    const ticket = await db.collection('support_tickets').findOne({ _id: tid, user_id: new ObjectId(user.id) })
    if (!ticket) return json({ error: 'No encontrado' }, 404)

    const messages = await db.collection('support_messages')
      .find({ ticket_id: tid })
      .sort({ created_at: 1 })
      .toArray()

    await db.collection('support_tickets').updateOne({ _id: tid }, { $set: { unread_for_user: 0 } })

    return json({
      id: (ticket._id as ObjectId).toHexString(),
      subject: ticket.subject,
      status: ticket.status,
      priority: ticket.priority,
      created_at: ticket.created_at instanceof Date ? ticket.created_at.toISOString() : ticket.created_at,
      messages: messages.map(m => ({
        id: (m._id as ObjectId).toHexString(),
        from: m.from,
        message: m.message,
        created_at: m.created_at instanceof Date ? m.created_at.toISOString() : m.created_at,
      })),
    })
  })
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleRoute(async () => {
    const { user } = await getAuthUser(request)
    if (!user) return json({ error: 'No autorizado' }, 401)
    const { id } = await params
    let tid: ObjectId
    try { tid = new ObjectId(id) } catch { return json({ error: 'ID inválido' }, 400) }

    const body = await request.json()
    const message = String(body.message || '').trim()
    if (!message) return json({ error: 'El mensaje es requerido' }, 400)

    const db = await getDb()
    const ticket = await db.collection('support_tickets').findOne({ _id: tid, user_id: new ObjectId(user.id) })
    if (!ticket) return json({ error: 'No encontrado' }, 404)
    if (ticket.status === 'closed') return json({ error: 'El ticket está cerrado' }, 400)

    const now = new Date()
    await db.collection('support_messages').insertOne({
      ticket_id: tid,
      from: 'user',
      message,
      created_at: now,
    })
    await db.collection('support_tickets').updateOne(
      { _id: tid },
      {
        $set: { last_message: message, updated_at: now, status: 'open' },
        $inc: { unread_for_admin: 1 },
      }
    )
    return json({ ok: true })
  })
}
