import { json, options, handleRoute } from '@/lib/api-utils'
import { getDb, ObjectId } from '@/lib/db'
import { verifyAdmin, adminUnauth } from '@/lib/admin-auth'

export function OPTIONS() { return options() }

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleRoute(async () => {
    if (!verifyAdmin(request)) return adminUnauth()
    const { id } = await params
    let uid: ObjectId
    try { uid = new ObjectId(id) } catch { return json({ error: 'ID inválido' }, 400) }
    const body = await request.json()
    const verified = !!body.verified
    const db = await getDb()
    await db.collection('users').updateOne(
      { _id: uid },
      { $set: { verified, verified_at: verified ? new Date() : null } }
    )
    return json({ ok: true, verified })
  })
}
