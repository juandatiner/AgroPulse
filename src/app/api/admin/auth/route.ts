import { json, options } from '@/lib/api-utils'
import { adminToken } from '@/lib/admin-auth'
import crypto from 'crypto'

export function OPTIONS() { return options() }

export async function POST(request: Request) {
  const data = await request.json()
  const pw = (data.password || '').toString()
  const candidate = crypto.createHash('sha256').update(pw + ':agropulse-admin').digest('hex')
  if (candidate !== adminToken()) {
    return json({ error: 'Contraseña incorrecta' }, 401)
  }
  return json({ token: adminToken() })
}
