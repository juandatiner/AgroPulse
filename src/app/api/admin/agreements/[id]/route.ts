import { json, options, handleRoute } from '@/lib/api-utils'
import { getDb, ObjectId } from '@/lib/db'
import { verifyAdmin, adminUnauth } from '@/lib/admin-auth'

export function OPTIONS() { return options() }

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleRoute(async () => {
    if (!verifyAdmin(request)) return adminUnauth()

    const { id } = await params
    let aid: ObjectId
    try { aid = new ObjectId(id) } catch { return json({ error: 'ID inválido' }, 400) }

    const db = await getDb()
    const docs = await db.collection('agreements').aggregate([
      { $match: { _id: aid } },
      {
        $lookup: {
          from: 'resources',
          localField: 'resource_id',
          foreignField: '_id',
          as: '_res',
        },
      },
      { $addFields: { _res: { $arrayElemAt: ['$_res', 0] } } },
      {
        $lookup: {
          from: 'users',
          localField: 'requester_id',
          foreignField: '_id',
          as: '_req',
        },
      },
      { $unwind: { path: '$_req', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'users',
          localField: 'provider_id',
          foreignField: '_id',
          as: '_prov',
        },
      },
      { $unwind: { path: '$_prov', preserveNullAndEmptyArrays: true } },
    ]).toArray()

    if (!docs.length) return json({ error: 'Acuerdo no encontrado' }, 404)
    const d = docs[0]
    const toIso = (v: unknown) => v instanceof Date ? v.toISOString() : v ?? null

    const msgCount = await db.collection('messages').countDocuments({ agreement_id: aid })
    const messages = await db.collection('messages')
      .aggregate([
        { $match: { agreement_id: aid } },
        { $sort: { created_at: 1 } },
        { $lookup: { from: 'users', localField: 'sender_id', foreignField: '_id', as: '_s' } },
        { $unwind: { path: '$_s', preserveNullAndEmptyArrays: true } },
      ])
      .toArray()
    const serializedMessages = messages.map((m) => ({
      id: (m._id as ObjectId).toHexString(),
      sender_id: m.sender_id instanceof ObjectId ? m.sender_id.toHexString() : String(m.sender_id || ''),
      sender_nombre: m._s?.nombre || '',
      sender_apellido: m._s?.apellido || '',
      content: m.content || '',
      created_at: toIso(m.created_at),
    }))

    return json({
      id: (d._id as ObjectId).toHexString(),
      status: d.status || '',
      message: d.message || '',
      resource_titulo: d._res?.titulo || d.resource_snapshot_titulo || '',
      resource_tipo: d._res?.tipo || d.resource_snapshot_tipo || '',
      resource_categoria: d._res?.categoria || d.resource_snapshot_cat || '',
      resource_descripcion: d._res?.descripcion || d.resource_snapshot_desc || '',
      requester_id: d.requester_id instanceof ObjectId ? d.requester_id.toHexString() : String(d.requester_id || ''),
      req_nombre: d._req?.nombre || '',
      req_apellido: d._req?.apellido || '',
      req_email: d._req?.email || '',
      provider_id: d.provider_id instanceof ObjectId ? d.provider_id.toHexString() : String(d.provider_id || ''),
      prov_nombre: d._prov?.nombre || '',
      prov_apellido: d._prov?.apellido || '',
      prov_email: d._prov?.email || '',
      rating_requester: d.rating_requester ?? null,
      rating_provider: d.rating_provider ?? null,
      review_requester: d.review_requester || '',
      review_provider: d.review_provider || '',
      complete_requester: d.complete_requester ?? 0,
      complete_provider: d.complete_provider ?? 0,
      message_count: msgCount,
      messages: serializedMessages,
      cancel_reason: d.cancel_reason || '',
      cancelled_by_id: d.cancelled_by_id instanceof ObjectId ? d.cancelled_by_id.toHexString() : (d.cancelled_by_id || ''),
      cancelled_by_nombre: d.cancelled_by_nombre || '',
      created_at: toIso(d.created_at),
      updated_at: toIso(d.updated_at),
    })
  })
}
