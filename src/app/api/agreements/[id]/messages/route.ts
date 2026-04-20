import { json, options } from '@/lib/api-utils'
import { query, queryOne, execute } from '@/lib/db'
import { getAuthUser } from '@/lib/auth'

export function OPTIONS() { return options() }

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const { user } = getAuthUser(request)
  if (!user) return json({ error: 'No autorizado' }, 401)
  const aid = Number(params.id)
  const a = queryOne(
    "SELECT * FROM agreements WHERE id = ? AND (requester_id = ? OR provider_id = ?)",
    [aid, user.id, user.id]
  )
  if (!a) return json({ error: 'No encontrado' }, 404)

  const msgs = query(
    `SELECT m.*, u.nombre as sender_nombre, u.apellido as sender_apellido
     FROM messages m JOIN users u ON m.sender_id = u.id
     WHERE m.agreement_id = ? ORDER BY m.created_at ASC`,
    [aid]
  )
  execute(
    `UPDATE messages SET read_status = 1
     WHERE agreement_id = ? AND sender_id != ? AND read_status = 0`,
    [aid, user.id]
  )
  return json(msgs)
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const { user } = getAuthUser(request)
  if (!user) return json({ error: 'No autorizado' }, 401)
  const aid = Number(params.id)
  const a = queryOne(
    "SELECT * FROM agreements WHERE id = ? AND (requester_id = ? OR provider_id = ?)",
    [aid, user.id, user.id]
  )
  if (!a) return json({ error: 'No encontrado' }, 404)

  const data = await request.json()
  const content = (data.content || '').trim()
  if (!content) return json({ error: 'Mensaje vacío' }, 400)

  const mid = execute(
    "INSERT INTO messages (agreement_id, sender_id, content) VALUES (?, ?, ?)",
    [aid, user.id, content]
  )
  execute("UPDATE agreements SET updated_at = CURRENT_TIMESTAMP WHERE id = ?", [aid])
  const msg = queryOne(
    `SELECT m.*, u.nombre as sender_nombre, u.apellido as sender_apellido
     FROM messages m JOIN users u ON m.sender_id = u.id WHERE m.id = ?`,
    [mid]
  )
  return json(msg, 201)
}
