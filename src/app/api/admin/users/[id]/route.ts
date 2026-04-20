import { json, options, handleRoute } from '@/lib/api-utils'
import { getDb, ObjectId } from '@/lib/db'
import { verifyAdmin, adminUnauth } from '@/lib/admin-auth'

export function OPTIONS() { return options() }

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleRoute(async () => {
    if (!verifyAdmin(request)) return adminUnauth()

    const { id } = await params
    let uid: ObjectId
    try { uid = new ObjectId(id) } catch { return json({ error: 'ID inválido' }, 400) }

    const db = await getDb()

    // Find all agreements involving this user to delete messages
    const agreements = await db.collection('agreements').find({
      $or: [{ requester_id: uid }, { provider_id: uid }],
    }).toArray()

    const agrIds = agreements.map(a => a._id)
    if (agrIds.length > 0) {
      await db.collection('messages').deleteMany({ agreement_id: { $in: agrIds } })
    }

    await Promise.all([
      db.collection('agreements').deleteMany({ $or: [{ requester_id: uid }, { provider_id: uid }] }),
      db.collection('resources').deleteMany({ user_id: uid }),
      db.collection('sessions').deleteMany({ user_id: uid }),
      db.collection('users').deleteOne({ _id: uid }),
    ])

    return json({ ok: true })
  })
}
