import { json, options, handleRoute } from '@/lib/api-utils'
import { getDb, ObjectId } from '@/lib/db'
import { verifyAdmin, adminUnauth } from '@/lib/admin-auth'

export function OPTIONS() { return options() }

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleRoute(async () => {
    if (!verifyAdmin(request)) return adminUnauth()

    const { id } = await params
    let rid: ObjectId
    try { rid = new ObjectId(id) } catch { return json({ error: 'ID inválido' }, 400) }

    const db = await getDb()
    await db.collection('resources').deleteOne({ _id: rid })
    return json({ ok: true })
  })
}
