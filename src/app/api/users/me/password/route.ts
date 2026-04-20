import { json, options, handleRoute } from '@/lib/api-utils'
import { getDb, ObjectId } from '@/lib/db'
import { getAuthUser, hashPassword, verifyPassword } from '@/lib/auth'
import { isStrongPassword } from '@/lib/email'

export function OPTIONS() { return options() }

export async function PUT(request: Request) {
  return handleRoute(async () => {
    const { user } = await getAuthUser(request)
    if (!user) return json({ error: 'No autorizado' }, 401)

    const data = await request.json()
    const current = data.current_password || ''
    const newPw = data.new_password || ''

    if (!current || !newPw) return json({ error: 'Completa todos los campos' }, 400)
    if (!isStrongPassword(newPw))
      return json({ error: 'La nueva contraseña no cumple los requisitos de seguridad' }, 400)

    const db = await getDb()
    const userDoc = await db.collection('users').findOne({ _id: new ObjectId(user.id) })
    if (!userDoc) return json({ error: 'No encontrado' }, 404)
    if (!verifyPassword(current, userDoc.password_hash as string))
      return json({ error: 'Contraseña actual incorrecta' }, 400)

    await db.collection('users').updateOne(
      { _id: new ObjectId(user.id) },
      { $set: { password_hash: hashPassword(newPw) } }
    )
    return json({ ok: true })
  })
}
