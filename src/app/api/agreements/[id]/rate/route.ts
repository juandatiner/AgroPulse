import { json, options } from '@/lib/api-utils'
import { query, queryOne, execute } from '@/lib/db'
import { getAuthUser } from '@/lib/auth'

export function OPTIONS() { return options() }

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const { user } = getAuthUser(request)
  if (!user) return json({ error: 'No autorizado' }, 401)
  const aid = Number(params.id)
  const a = queryOne<Record<string, unknown>>(
    "SELECT * FROM agreements WHERE id = ? AND status = 'completed'", [aid]
  )
  if (!a) return json({ error: 'Acuerdo no encontrado o no completado' }, 404)

  const data = await request.json()
  const rating = data.rating
  if (!rating || rating < 1 || rating > 5)
    return json({ error: 'Rating debe ser entre 1 y 5' }, 400)

  let targetId: number
  if (user.id === a.requester_id) {
    execute("UPDATE agreements SET rating_requester = ? WHERE id = ?", [rating, aid])
    targetId = a.provider_id as number
  } else if (user.id === a.provider_id) {
    execute("UPDATE agreements SET rating_provider = ? WHERE id = ?", [rating, aid])
    targetId = a.requester_id as number
  } else {
    return json({ error: 'No autorizado' }, 403)
  }

  const ratings = query<{ r: number }>(
    `SELECT rating_requester as r FROM agreements
     WHERE provider_id = ? AND rating_requester IS NOT NULL
     UNION ALL
     SELECT rating_provider as r FROM agreements
     WHERE requester_id = ? AND rating_provider IS NOT NULL`,
    [targetId, targetId]
  )
  if (ratings.length) {
    const avg = ratings.reduce((s, x) => s + x.r, 0) / ratings.length
    execute("UPDATE users SET reputation_score = ?, total_ratings = ? WHERE id = ?",
      [Math.round(avg * 10) / 10, ratings.length, targetId])
  }
  return json({ ok: true })
}
