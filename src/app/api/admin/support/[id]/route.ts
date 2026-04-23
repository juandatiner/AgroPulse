import { json, options, handleRoute } from '@/lib/api-utils'
import { getDb, ObjectId } from '@/lib/db'
import { verifyAdmin, adminUnauth } from '@/lib/admin-auth'

export function OPTIONS() { return options() }

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleRoute(async () => {
    if (!verifyAdmin(request)) return adminUnauth()
    const { id } = await params
    let tid: ObjectId
    try { tid = new ObjectId(id) } catch { return json({ error: 'ID inválido' }, 400) }
    const db = await getDb()
    const ticket = await db.collection('support_tickets').findOne({ _id: tid })
    if (!ticket) return json({ error: 'No encontrado' }, 404)
    const user = await db.collection('users').findOne({ _id: ticket.user_id })
    const messages = await db.collection('support_messages')
      .find({ ticket_id: tid })
      .sort({ created_at: 1 })
      .toArray()

    await db.collection('support_tickets').updateOne({ _id: tid }, { $set: { unread_for_admin: 0 } })

    return json({
      id: (ticket._id as ObjectId).toHexString(),
      subject: ticket.subject,
      status: ticket.status,
      priority: ticket.priority,
      user: user ? {
        id: (user._id as ObjectId).toHexString(),
        nombre: user.nombre,
        apellido: user.apellido,
        email: user.email,
        subscription_status: user.subscription_status || 'trial',
      } : null,
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
    if (!verifyAdmin(request)) return adminUnauth()
    const { id } = await params
    let tid: ObjectId
    try { tid = new ObjectId(id) } catch { return json({ error: 'ID inválido' }, 400) }
    const body = await request.json()
    const message = String(body.message || '').trim()
    if (!message) return json({ error: 'El mensaje es requerido' }, 400)
    const db = await getDb()
    const now = new Date()
    await db.collection('support_messages').insertOne({
      ticket_id: tid,
      from: 'admin',
      message,
      created_at: now,
    })
    await db.collection('support_tickets').updateOne(
      { _id: tid },
      {
        $set: { last_message: message, updated_at: now, status: 'open' },
        $inc: { unread_for_user: 1 },
      }
    )
    return json({ ok: true })
  })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleRoute(async () => {
    if (!verifyAdmin(request)) return adminUnauth()
    const { id } = await params
    let tid: ObjectId
    try { tid = new ObjectId(id) } catch { return json({ error: 'ID inválido' }, 400) }
    const body = await request.json()
    const update: Record<string, unknown> = {}
    if (body.status && ['open', 'pending', 'closed'].includes(body.status)) update.status = body.status
    if (body.priority && ['normal', 'priority'].includes(body.priority)) update.priority = body.priority
    if (!Object.keys(update).length) return json({ error: 'Sin campos' }, 400)
    const db = await getDb()
    await db.collection('support_tickets').updateOne({ _id: tid }, { $set: update })
    return json({ ok: true })
  })
}
