import { json, options, handleRoute } from '@/lib/api-utils'
import { getDb, ObjectId } from '@/lib/db'
import { verifyAdmin, adminUnauth } from '@/lib/admin-auth'

export function OPTIONS() { return options() }

const VALID_STATUS = new Set(['pending', 'reviewing', 'resolved', 'dismissed'])

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleRoute(async () => {
    if (!verifyAdmin(request)) return adminUnauth()
    const { id } = await params
    let rid: ObjectId
    try { rid = new ObjectId(id) } catch { return json({ error: 'ID inválido' }, 400) }

    const body = await request.json()
    const update: Record<string, unknown> = { updated_at: new Date() }

    if (typeof body.status === 'string') {
      if (!VALID_STATUS.has(body.status)) return json({ error: 'status inválido' }, 400)
      update.status = body.status
      if (body.status === 'resolved' || body.status === 'dismissed') {
        update.resolved_at = new Date()
      }
    }
    if (typeof body.admin_notes === 'string') {
      update.admin_notes = body.admin_notes.trim().slice(0, 2000) || null
    }

    const db = await getDb()

    // Acciones de sanción
    if (body.sanction === 'deactivate_resource' || body.sanction === 'delete_resource') {
      const r = await db.collection('reports').findOne({ _id: rid })
      if (r && r.type === 'resource' && r.target_id instanceof ObjectId) {
        if (body.sanction === 'deactivate_resource') {
          await db.collection('resources').updateOne(
            { _id: r.target_id },
            { $set: { status: 'closed' } }
          )
        } else {
          await db.collection('resources').deleteOne({ _id: r.target_id })
        }
      }
    }

    // Enviar mensaje de corrección al usuario reportado (vía ticket de soporte iniciado por admin)
    if (body.sanction === 'send_correction') {
      const correctionMsg = String(body.correction_message || '').trim()
      if (!correctionMsg) return json({ error: 'mensaje de corrección vacío' }, 400)
      const r = await db.collection('reports').findOne({ _id: rid })
      if (!r) return json({ error: 'Reporte no encontrado' }, 404)

      // Determinar a quién va dirigido: para resource → owner; para user → el target
      let targetUserId: ObjectId | null = null
      let context = ''
      if (r.type === 'resource' && r.target_id instanceof ObjectId) {
        const res = await db.collection('resources').findOne({ _id: r.target_id })
        if (res && res.user_id instanceof ObjectId) {
          targetUserId = res.user_id
          context = `Sobre tu publicación "${res.titulo || ''}"`
        }
      } else if (r.type === 'user' && r.target_id instanceof ObjectId) {
        targetUserId = r.target_id
        context = 'Aviso del equipo de moderación'
      }

      if (!targetUserId) return json({ error: 'No se pudo identificar al destinatario' }, 400)

      const now = new Date()
      const ticket = await db.collection('support_tickets').insertOne({
        user_id: targetUserId,
        subject: `Aviso de moderación · ${context}`,
        status: 'open',
        priority: 'priority',
        admin_initiated: true,
        related_report_id: rid,
        unread_for_user: 1,
        unread_for_admin: 0,
        created_at: now,
        updated_at: now,
      })
      await db.collection('support_messages').insertOne({
        ticket_id: ticket.insertedId,
        from: 'admin',
        message: correctionMsg,
        created_at: now,
      })
    }

    await db.collection('reports').updateOne({ _id: rid }, { $set: update })
    const updated = await db.collection('reports').findOne({ _id: rid })
    return json({ ok: true, report: updated })
  })
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleRoute(async () => {
    if (!verifyAdmin(request)) return adminUnauth()
    const { id } = await params
    let rid: ObjectId
    try { rid = new ObjectId(id) } catch { return json({ error: 'ID inválido' }, 400) }
    const db = await getDb()
    await db.collection('reports').deleteOne({ _id: rid })
    return json({ ok: true })
  })
}
