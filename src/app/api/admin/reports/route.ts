import { json, options, handleRoute, parseParams } from '@/lib/api-utils'
import { getDb, ObjectId } from '@/lib/db'
import { verifyAdmin, adminUnauth } from '@/lib/admin-auth'

export function OPTIONS() { return options() }

const toIso = (v: unknown) => v instanceof Date ? v.toISOString() : v ?? null
const toStr = (v: unknown) => v instanceof ObjectId ? v.toHexString() : v != null ? String(v) : null

export async function GET(request: Request) {
  return handleRoute(async () => {
    if (!verifyAdmin(request)) return adminUnauth()

    const params = parseParams(request)
    const status = typeof params.status === 'string' ? params.status : 'all'
    const type = typeof params.type === 'string' ? params.type : 'all'

    const match: Record<string, unknown> = {}
    if (status !== 'all') match.status = status
    if (type !== 'all') match.type = type

    const db = await getDb()
    const docs = await db.collection('reports').aggregate([
      { $match: match },
      {
        $lookup: {
          from: 'users', localField: 'reporter_id', foreignField: '_id', as: '_reporter',
        },
      },
      { $unwind: { path: '$_reporter', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'resources', localField: 'target_id', foreignField: '_id', as: '_resource',
        },
      },
      { $unwind: { path: '$_resource', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'users', localField: 'target_id', foreignField: '_id', as: '_targetUser',
        },
      },
      { $unwind: { path: '$_targetUser', preserveNullAndEmptyArrays: true } },
      { $sort: { created_at: -1 } },
    ]).toArray()

    return json(docs.map(d => {
      const isResource = d.type === 'resource'
      return {
        id: toStr(d._id),
        type: d.type,
        target_id: toStr(d.target_id),
        reason: d.reason,
        description: d.description || '',
        status: d.status || 'pending',
        admin_notes: d.admin_notes || null,
        created_at: toIso(d.created_at),
        updated_at: toIso(d.updated_at),
        resolved_at: toIso(d.resolved_at),
        reporter_id: toStr(d.reporter_id),
        reporter_nombre: d._reporter?.nombre || '',
        reporter_apellido: d._reporter?.apellido || '',
        reporter_email: d._reporter?.email || '',
        // Preview de la publicación reportada
        target_titulo: isResource ? (d._resource?.titulo || '(eliminado)') : null,
        target_resource_tipo: isResource ? (d._resource?.tipo || null) : null,
        target_resource_status: isResource ? (d._resource?.status || null) : null,
        target_resource_descripcion: isResource ? (d._resource?.descripcion || '') : null,
        target_resource_categoria: isResource ? (d._resource?.categoria || '') : null,
        target_resource_municipio: isResource ? (d._resource?.municipio || '') : null,
        target_resource_image: isResource ? (d._resource?.image_data || '') : null,
        target_resource_owner_id: isResource && d._resource?.user_id instanceof ObjectId ? d._resource.user_id.toHexString() : null,
        // Preview del usuario reportado
        target_user_nombre: !isResource ? (d._targetUser?.nombre || '(eliminado)') : null,
        target_user_apellido: !isResource ? (d._targetUser?.apellido || '') : null,
        target_user_email: !isResource ? (d._targetUser?.email || '') : null,
        target_user_tipo: !isResource ? (d._targetUser?.tipo || '') : null,
        target_user_municipio: !isResource ? (d._targetUser?.municipio || '') : null,
        target_user_bio: !isResource ? (d._targetUser?.bio || '') : null,
        target_user_reputation: !isResource ? (d._targetUser?.reputation_score || 5) : null,
        target_user_verified: !isResource ? !!d._targetUser?.verified : null,
      }
    }))
  })
}
