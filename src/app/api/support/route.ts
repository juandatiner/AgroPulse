import { json, options, handleRoute } from '@/lib/api-utils'
import { getDb, ObjectId } from '@/lib/db'
import { getAuthUser } from '@/lib/auth'
import { computeSubscriptionState } from '@/lib/subscription'

export function OPTIONS() { return options() }

export async function GET(request: Request) {
  return handleRoute(async () => {
    const { user } = await getAuthUser(request)
    if (!user) return json({ error: 'No autorizado' }, 401)
    const db = await getDb()
    const docs = await db.collection('support_tickets')
      .find({ user_id: new ObjectId(user.id) })
      .sort({ updated_at: -1 })
      .toArray()
    return json(docs.map(d => ({
      id: (d._id as ObjectId).toHexString(),
      subject: d.subject,
      status: d.status,
      priority: d.priority,
      unread_for_user: d.unread_for_user || 0,
      last_message: d.last_message || '',
      created_at: d.created_at instanceof Date ? d.created_at.toISOString() : d.created_at,
      updated_at: d.updated_at instanceof Date ? d.updated_at.toISOString() : d.updated_at,
    })))
  })
}

export async function POST(request: Request) {
  return handleRoute(async () => {
    const { user } = await getAuthUser(request)
    if (!user) return json({ error: 'No autorizado' }, 401)
    const body = await request.json()
    const subject = String(body.subject || '').trim()
    const message = String(body.message || '').trim()
    if (!subject) return json({ error: 'El asunto es requerido' }, 400)
    if (!message) return json({ error: 'El mensaje es requerido' }, 400)

    const sub = await computeSubscriptionState(user.id)
    const priority = sub.is_premium ? 'priority' : 'normal'
    const db = await getDb()
    const now = new Date()
    const ticket = await db.collection('support_tickets').insertOne({
      user_id: new ObjectId(user.id),
      subject,
      status: 'open',
      priority,
      last_message: message,
      unread_for_admin: 1,
      unread_for_user: 0,
      created_at: now,
      updated_at: now,
    })
    await db.collection('support_messages').insertOne({
      ticket_id: ticket.insertedId,
      from: 'user',
      message,
      created_at: now,
    })
    return json({ id: ticket.insertedId.toHexString() }, 201)
  })
}
