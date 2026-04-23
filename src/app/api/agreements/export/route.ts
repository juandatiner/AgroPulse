import { options, json } from '@/lib/api-utils'
import { NextResponse } from 'next/server'
import { getDb, ObjectId } from '@/lib/db'
import { getAuthUser } from '@/lib/auth'
import { computeSubscriptionState } from '@/lib/subscription'

export function OPTIONS() { return options() }

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v)
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"'
  return s
}

export async function GET(request: Request) {
  try {
    const { user } = await getAuthUser(request)
    if (!user) return json({ error: 'No autorizado' }, 401)
    const sub = await computeSubscriptionState(user.id)
    if (!sub.is_premium) {
      return json({ error: 'premium_required', message: 'La exportación requiere suscripción activa.' }, 403)
    }

    const db = await getDb()
    const uid = new ObjectId(user.id)
    const rows = await db.collection('agreements').aggregate([
      { $match: { $or: [{ requester_id: uid }, { provider_id: uid }] } },
      {
        $lookup: {
          from: 'resources', localField: 'resource_id', foreignField: '_id', as: '_res',
        },
      },
      { $addFields: { _res: { $arrayElemAt: ['$_res', 0] } } },
      {
        $lookup: {
          from: 'users', localField: 'requester_id', foreignField: '_id', as: '_req',
        },
      },
      { $unwind: { path: '$_req', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'users', localField: 'provider_id', foreignField: '_id', as: '_prov',
        },
      },
      { $unwind: { path: '$_prov', preserveNullAndEmptyArrays: true } },
      { $sort: { created_at: -1 } },
    ]).toArray()

    const header = [
      'id', 'recurso', 'tipo_recurso', 'categoria',
      'contraparte_nombre', 'contraparte_email',
      'mi_rol', 'estado', 'rating_dado', 'rating_recibido',
      'creado', 'actualizado',
    ]
    const lines = [header.join(',')]
    for (const r of rows) {
      const reqId = r.requester_id instanceof ObjectId ? r.requester_id.toHexString() : String(r.requester_id)
      const isRequester = reqId === user.id
      const cp = isRequester ? r._prov : r._req
      const ratingGiven = isRequester ? r.rating_requester : r.rating_provider
      const ratingReceived = isRequester ? r.rating_provider : r.rating_requester
      lines.push([
        (r._id as ObjectId).toHexString(),
        csvEscape(r._res?.titulo || r.resource_snapshot_titulo || ''),
        csvEscape(r._res?.tipo || ''),
        csvEscape(r._res?.categoria || ''),
        csvEscape(cp ? `${cp.nombre || ''} ${cp.apellido || ''}`.trim() : ''),
        csvEscape(cp?.email || ''),
        isRequester ? 'solicitante' : 'proveedor',
        csvEscape(r.status || ''),
        csvEscape(ratingGiven ?? ''),
        csvEscape(ratingReceived ?? ''),
        csvEscape(r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at),
        csvEscape(r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at),
      ].join(','))
    }
    const csv = lines.join('\n')
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="agropulse-acuerdos.csv"',
      },
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Error del servidor'
    return json({ error: msg }, 500)
  }
}
