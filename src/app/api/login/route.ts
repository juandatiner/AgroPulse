import { json, options } from '@/lib/api-utils'
import { queryOne } from '@/lib/db'
import { verifyPassword, createSession } from '@/lib/auth'

export function OPTIONS() { return options() }

export async function POST(request: Request) {
  const data = await request.json()
  const email = (data.email || '').toLowerCase().trim()
  const password = data.password || ''
  if (!email || !password) return json({ error: 'Correo y contraseña son requeridos' }, 400)

  const user = queryOne<Record<string, unknown>>("SELECT * FROM users WHERE email = ?", [email])
  if (!user || !verifyPassword(password, user.password_hash as string))
    return json({ error: 'Correo o contraseña incorrectos' }, 401)

  const token = createSession(user.id as number)
  const safeUser = { ...user }
  delete safeUser.password_hash
  return json({ token, user: safeUser })
}
