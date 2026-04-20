import { json, parseParams, options } from '@/lib/api-utils'
import { query, queryOne, execute } from '@/lib/db'
import { getAuthUser } from '@/lib/auth'

export function OPTIONS() { return options() }

export async function GET(request: Request) {
  const { user } = getAuthUser(request)
  if (!user) return json({ error: 'No autorizado' }, 401)
  const params = parseParams(request)
  const where = ["(a.requester_id = ? OR a.provider_id = ?)"]
  const args: unknown[] = [user.id, user.id]
  if (params.status && params.status !== 'todos') {
    where.push("a.status = ?")
    args.push(params.status)
  }
  const rows = query(
    `SELECT a.*,
     COALESCE(r.titulo, a.resource_snapshot_titulo) as resource_titulo,
     COALESCE(r.tipo, a.resource_snapshot_tipo) as resource_tipo,
     COALESCE(r.categoria, a.resource_snapshot_cat) as resource_cat,
     req.nombre as req_nombre, req.apellido as req_apellido,
     prov.nombre as prov_nombre, prov.apellido as prov_apellido,
     (SELECT COUNT(*) FROM messages m WHERE m.agreement_id = a.id
      AND m.sender_id != ? AND m.read_status = 0) as unread_count
     FROM agreements a
     LEFT JOIN resources r ON a.resource_id = r.id
     JOIN users req ON a.requester_id = req.id
     JOIN users prov ON a.provider_id = prov.id
     WHERE ${where.join(' AND ')}
     ORDER BY a.updated_at DESC`,
    [user.id, ...args]
  )
  return json(rows)
}

export async function POST(request: Request) {
  const { user } = getAuthUser(request)
  if (!user) return json({ error: 'No autorizado' }, 401)
  const data = await request.json()
  const rid = data.resource_id
  if (!rid) return json({ error: 'resource_id requerido' }, 400)

  const resource = queryOne<Record<string, unknown>>("SELECT * FROM resources WHERE id = ?", [rid])
  if (!resource) return json({ error: 'Este recurso ya no está disponible' }, 404)
  if (resource.status !== 'active')
    return json({ error: 'Este recurso ya fue asignado y no acepta nuevas solicitudes' }, 400)
  if (resource.user_id === user.id)
    return json({ error: 'No puedes solicitar tu propio recurso' }, 400)

  const existing = queryOne(
    `SELECT id, status FROM agreements WHERE resource_id = ? AND requester_id = ?
     AND status NOT IN ('rejected','cancelled')`,
    [rid, user.id]
  )
  if (existing)
    return json({ error: 'Ya tienes una solicitud para este recurso', agreement_id: (existing as Record<string, unknown>).id }, 400)

  // Clean up old rejected/cancelled
  const oldRejected = query(
    `SELECT id FROM agreements WHERE resource_id = ? AND requester_id = ?
     AND status IN ('rejected','cancelled')`,
    [rid, user.id]
  )
  for (const old of oldRejected) {
    execute("DELETE FROM messages WHERE agreement_id = ?", [(old as Record<string, unknown>).id])
    execute("DELETE FROM agreements WHERE id = ?", [(old as Record<string, unknown>).id])
  }

  const aid = execute(
    `INSERT INTO agreements (resource_id, requester_id, provider_id, message,
     resource_snapshot_titulo, resource_snapshot_tipo, resource_snapshot_cat,
     resource_snapshot_desc, resource_snapshot_image)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [rid, user.id, resource.user_id, data.message || '',
     resource.titulo, resource.tipo, resource.categoria,
     resource.descripcion, resource.image_data]
  )
  if (data.message) {
    execute("INSERT INTO messages (agreement_id, sender_id, content) VALUES (?, ?, ?)",
      [aid, user.id, data.message])
  }
  return json({ id: aid, status: 'pending' }, 201)
}
