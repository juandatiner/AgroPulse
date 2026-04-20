import { json, options } from '@/lib/api-utils'
import { query, queryOne, execute } from '@/lib/db'
import { getAuthUser } from '@/lib/auth'

export function OPTIONS() { return options() }

export async function GET(request: Request) {
  const { user } = getAuthUser(request)
  if (!user) return json({ error: 'No autorizado' }, 401)

  const stats = {
    total_resources: (queryOne<{ c: number }>(
      "SELECT COUNT(*) as c FROM resources WHERE user_id = ?", [user.id]
    ))?.c || 0,
    active_resources: (queryOne<{ c: number }>(
      "SELECT COUNT(*) as c FROM resources WHERE user_id = ? AND status = 'active'", [user.id]
    ))?.c || 0,
    total_agreements: (queryOne<{ c: number }>(
      "SELECT COUNT(*) as c FROM agreements WHERE requester_id = ? OR provider_id = ?",
      [user.id, user.id]
    ))?.c || 0,
    completed_agreements: (queryOne<{ c: number }>(
      `SELECT COUNT(*) as c FROM agreements
       WHERE (requester_id = ? OR provider_id = ?) AND status = 'completed'`,
      [user.id, user.id]
    ))?.c || 0,
  }
  const u: Record<string, unknown> = { ...user }
  delete u.password_hash
  u.stats = stats
  return json(u)
}

export async function PUT(request: Request) {
  const { user } = getAuthUser(request)
  if (!user) return json({ error: 'No autorizado' }, 401)
  const data = await request.json()
  const fields = ['nombre', 'apellido', 'municipio', 'tipo', 'telefono', 'bio', 'latitude', 'longitude']
  const updates: string[] = []
  const args: unknown[] = []
  for (const f of fields) {
    if (f in data) { updates.push(`${f} = ?`); args.push(data[f]) }
  }
  if (updates.length) {
    args.push(user.id)
    execute(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, args)
  }
  const updated = queryOne<Record<string, unknown>>("SELECT * FROM users WHERE id = ?", [user.id])
  if (updated) delete updated.password_hash
  return json(updated)
}
