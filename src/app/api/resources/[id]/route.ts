import { json, options } from '@/lib/api-utils'
import { query, queryOne, execute } from '@/lib/db'
import { getAuthUser } from '@/lib/auth'

export function OPTIONS() { return options() }

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const rid = Number(params.id)
  const r = queryOne(
    `SELECT r.*, u.nombre as user_nombre, u.apellido as user_apellido,
     u.municipio as user_municipio, u.tipo as user_tipo,
     u.reputation_score as user_reputation, u.id as owner_id
     FROM resources r JOIN users u ON r.user_id = u.id WHERE r.id = ?`,
    [rid]
  )
  if (!r) return json({ error: 'No encontrado' }, 404)
  return json(r)
}

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  const { user } = getAuthUser(request)
  if (!user) return json({ error: 'No autorizado' }, 401)
  const rid = Number(params.id)
  const r = queryOne("SELECT * FROM resources WHERE id = ? AND user_id = ?", [rid, user.id])
  if (!r) return json({ error: 'No encontrado o no autorizado' }, 404)
  const data = await request.json()
  const fields = ['titulo', 'descripcion', 'categoria', 'modalidad', 'municipio', 'status',
    'cantidad', 'unidad', 'condicion', 'disponibilidad', 'precio_referencia',
    'duracion_prestamo', 'garantia', 'ofrece', 'recibe']
  const updates: string[] = []
  const args: unknown[] = []
  for (const f of fields) {
    if (f in data) { updates.push(`${f} = ?`); args.push(data[f]) }
  }
  if (updates.length) {
    args.push(rid)
    execute(`UPDATE resources SET ${updates.join(', ')} WHERE id = ?`, args)
  }
  return json({ ok: true })
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  const { user } = getAuthUser(request)
  if (!user) return json({ error: 'No autorizado' }, 401)
  execute("DELETE FROM resources WHERE id = ? AND user_id = ?", [Number(params.id), user.id])
  return json({ ok: true })
}
