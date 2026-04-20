import { json, parseParams, options } from '@/lib/api-utils'
import { query, queryOne } from '@/lib/db'
import { getAuthUser } from '@/lib/auth'

export function OPTIONS() { return options() }

export async function GET(request: Request) {
  const { user } = getAuthUser(request)
  if (!user) return json({ error: 'No autorizado' }, 401)
  const params = parseParams(request)
  const since = params.since || '2000-01-01'

  const msgs = query(
    `SELECT m.*, m.agreement_id,
     u.nombre as sender_nombre, u.apellido as sender_apellido
     FROM messages m JOIN users u ON m.sender_id = u.id
     JOIN agreements a ON m.agreement_id = a.id
     WHERE (a.requester_id = ? OR a.provider_id = ?)
     AND m.sender_id != ?
     AND m.created_at > ?
     ORDER BY m.created_at ASC`,
    [user.id, user.id, user.id, since]
  )
  const pending = queryOne<{ c: number }>(
    "SELECT COUNT(*) as c FROM agreements WHERE provider_id = ? AND status = 'pending'",
    [user.id]
  )
  const unread = queryOne<{ c: number }>(
    `SELECT COUNT(*) as c FROM messages m
     JOIN agreements a ON m.agreement_id = a.id
     WHERE (a.requester_id = ? OR a.provider_id = ?)
     AND m.sender_id != ? AND m.read_status = 0`,
    [user.id, user.id, user.id]
  )
  const totalAgr = queryOne<{ c: number }>(
    "SELECT COUNT(*) as c FROM agreements WHERE requester_id = ? OR provider_id = ?",
    [user.id, user.id]
  )
  return json({
    messages: msgs,
    pending_agreements: pending?.c || 0,
    unread_messages: unread?.c || 0,
    total_agreements: totalAgr?.c || 0,
  })
}
