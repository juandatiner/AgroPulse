import { json, options } from '@/lib/api-utils'
import { query, queryOne } from '@/lib/db'

export function OPTIONS() { return options() }

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const uid = Number(params.id)
  const u = queryOne<Record<string, unknown>>(
    `SELECT id, nombre, apellido, municipio, tipo, bio,
     reputation_score, total_ratings, created_at
     FROM users WHERE id = ?`,
    [uid]
  )
  if (!u) return json({ error: 'No encontrado' }, 404)
  u.resources = query(
    "SELECT * FROM resources WHERE user_id = ? AND status = 'active' ORDER BY created_at DESC",
    [uid]
  )
  return json(u)
}
