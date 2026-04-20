import { json, parseParams, options } from '@/lib/api-utils'
import { query, execute } from '@/lib/db'
import { getAuthUser } from '@/lib/auth'

export function OPTIONS() { return options() }

export async function GET(request: Request) {
  const params = parseParams(request)
  const where: string[] = []
  const args: unknown[] = []
  const isOwner = !!params.owner

  if (isOwner) {
    where.push("r.user_id = ?")
    args.push(Number(params.owner))
  } else {
    where.push("r.status = 'active'")
  }
  if (params.tipo) { where.push("r.tipo = ?"); args.push(params.tipo) }
  if (params.categoria) { where.push("r.categoria = ?"); args.push(params.categoria) }
  if (params.municipio) { where.push("r.municipio = ?"); args.push(params.municipio) }
  if (params.q) {
    where.push("(r.titulo LIKE ? OR r.descripcion LIKE ? OR r.municipio LIKE ?)")
    const q = `%${params.q}%`
    args.push(q, q, q)
  }
  if (params.exclude_user) { where.push("r.user_id != ?"); args.push(Number(params.exclude_user)) }

  const order = params.sort === 'oldest' ? "r.created_at ASC" : "r.created_at DESC"

  let sql: string
  if (isOwner) {
    sql = `SELECT r.*, u.nombre as user_nombre, u.apellido as user_apellido,
           u.municipio as user_municipio, u.reputation_score as user_reputation,
           a.id as agr_id, a.status as agr_status,
           req.nombre as agr_req_nombre, req.apellido as agr_req_apellido
           FROM resources r JOIN users u ON r.user_id = u.id
           LEFT JOIN agreements a ON a.resource_id = r.id
               AND a.status NOT IN ('rejected','cancelled','completed')
           LEFT JOIN users req ON a.requester_id = req.id
           WHERE ${where.join(' AND ')} ORDER BY ${order}`
  } else {
    sql = `SELECT r.*, u.nombre as user_nombre, u.apellido as user_apellido,
           u.municipio as user_municipio, u.reputation_score as user_reputation
           FROM resources r JOIN users u ON r.user_id = u.id
           WHERE ${where.join(' AND ')} ORDER BY ${order}`
  }
  return json(query(sql, args))
}

export async function POST(request: Request) {
  const { user } = getAuthUser(request)
  if (!user) return json({ error: 'No autorizado' }, 401)
  const data = await request.json()
  const required = ['tipo', 'titulo', 'descripcion', 'categoria', 'municipio']
  for (const f of required) {
    if (!(data[f] || '').trim()) return json({ error: `Campo ${f} es requerido` }, 400)
  }
  const rid = execute(
    `INSERT INTO resources (user_id,tipo,titulo,descripcion,categoria,modalidad,
     municipio,latitude,longitude,cantidad,unidad,condicion,disponibilidad,
     precio_referencia,duracion_prestamo,garantia,ofrece,recibe,image_data)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [user.id, data.tipo, data.titulo.trim(), data.descripcion.trim(),
     data.categoria, data.modalidad || '', data.municipio,
     data.latitude || null, data.longitude || null,
     data.cantidad || '', data.unidad || '',
     data.condicion || '', data.disponibilidad || '',
     data.precio_referencia || '', data.duracion_prestamo || '',
     data.garantia || '', data.ofrece || '', data.recibe || '',
     data.image_data || '']
  )
  const resource = query("SELECT * FROM resources WHERE id = ?", [rid])
  return json(resource[0], 201)
}
