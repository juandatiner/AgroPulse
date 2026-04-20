import { json, options } from '@/lib/api-utils'
import { query, queryOne, execute } from '@/lib/db'
import { getAuthUser } from '@/lib/auth'

export function OPTIONS() { return options() }

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const { user } = getAuthUser(request)
  if (!user) return json({ error: 'No autorizado' }, 401)
  const aid = Number(params.id)
  const a = queryOne(
    `SELECT a.*,
     COALESCE(r.titulo, a.resource_snapshot_titulo) as resource_titulo,
     COALESCE(r.tipo, a.resource_snapshot_tipo) as resource_tipo,
     COALESCE(r.categoria, a.resource_snapshot_cat) as resource_cat,
     COALESCE(r.descripcion, a.resource_snapshot_desc) as descripcion,
     COALESCE(r.image_data, a.resource_snapshot_image) as image_data,
     req.nombre as req_nombre, req.apellido as req_apellido,
     prov.nombre as prov_nombre, prov.apellido as prov_apellido
     FROM agreements a
     LEFT JOIN resources r ON a.resource_id = r.id
     JOIN users req ON a.requester_id = req.id
     JOIN users prov ON a.provider_id = prov.id
     WHERE a.id = ? AND (a.requester_id = ? OR a.provider_id = ?)`,
    [aid, user.id, user.id]
  )
  if (!a) return json({ error: 'No encontrado' }, 404)
  return json(a)
}

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  const { user } = getAuthUser(request)
  if (!user) return json({ error: 'No autorizado' }, 401)
  const aid = Number(params.id)
  const a = queryOne<Record<string, unknown>>(
    "SELECT * FROM agreements WHERE id = ? AND (requester_id = ? OR provider_id = ?)",
    [aid, user.id, user.id]
  )
  if (!a) return json({ error: 'No encontrado' }, 404)

  const data = await request.json()
  const action = data.status
  const current = a.status as string

  // Mark complete (either party)
  if (action === 'mark_complete') {
    if (current !== 'active')
      return json({ error: 'Solo se puede completar un acuerdo activo' }, 400)
    const isRequester = user.id === a.requester_id
    if (isRequester) {
      execute("UPDATE agreements SET complete_requester = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [aid])
    } else {
      execute("UPDATE agreements SET complete_provider = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [aid])
    }
    const updated = queryOne<Record<string, unknown>>(
      "SELECT complete_requester, complete_provider FROM agreements WHERE id = ?", [aid]
    )
    if (updated && updated.complete_requester && updated.complete_provider) {
      execute("UPDATE agreements SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [aid])
      return json({ ok: true, status: 'completed' })
    }
    return json({ ok: true, status: 'active', waiting: true })
  }

  const validTransitions: Record<string, string[]> = {
    pending: ['active', 'rejected', 'cancelled'],
    active: ['completed', 'cancelled'],
  }
  if (!(validTransitions[current] || []).includes(action))
    return json({ error: `Acción no válida en estado ${current}` }, 400)
  if (['active', 'rejected', 'completed'].includes(action) && user.id !== a.provider_id)
    return json({ error: 'Solo el dueño del recurso puede realizar esta acción' }, 403)

  execute("UPDATE agreements SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [action, aid])

  const rid = a.resource_id as number | null
  if (action === 'active' && rid) {
    execute("UPDATE resources SET status = 'closed' WHERE id = ?", [rid])
  } else if (action === 'completed' && rid) {
    execute("UPDATE agreements SET resource_id = NULL WHERE resource_id = ?", [rid])
    execute("DELETE FROM resources WHERE id = ?", [rid])
  } else if (action === 'cancelled' && rid) {
    if (current === 'active') {
      execute("UPDATE resources SET status = 'active' WHERE id = ?", [rid])
    }
  }
  return json({ ok: true, status: action })
}
