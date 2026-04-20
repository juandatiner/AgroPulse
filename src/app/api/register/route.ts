import { json, options } from '@/lib/api-utils'
import { query, queryOne, execute } from '@/lib/db'
import { hashPassword, createSession } from '@/lib/auth'

export function OPTIONS() { return options() }

export async function POST(request: Request) {
  const data = await request.json()
  const required = ['nombre', 'apellido', 'email', 'password', 'municipio', 'tipo']
  for (const f of required) {
    if (!(data[f] || '').trim()) return json({ error: `Campo ${f} es requerido` }, 400)
  }
  if (data.password.length < 6)
    return json({ error: 'La contraseña debe tener al menos 6 caracteres' }, 400)

  const existing = queryOne("SELECT id FROM users WHERE email = ?", [data.email.toLowerCase()])
  if (existing) return json({ error: 'Este correo ya está registrado' }, 400)

  const pwHash = hashPassword(data.password)
  const uid = execute(
    `INSERT INTO users (nombre,apellido,email,password_hash,municipio,tipo,telefono,bio,latitude,longitude)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [data.nombre.trim(), data.apellido.trim(), data.email.toLowerCase().trim(),
     pwHash, data.municipio, data.tipo,
     data.telefono || '', data.bio || '',
     data.latitude || null, data.longitude || null]
  )
  const token = createSession(uid)
  const user: Record<string, unknown> = { ...queryOne("SELECT * FROM users WHERE id = ?", [uid]) }
  delete user.password_hash
  return json({ token, user })
}
