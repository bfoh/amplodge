import { requireAdmin, jsonResponse, handleCors } from './_lib/auth.js'
import { serviceClient, isLockNo, logActivity, parseBody, UUID } from './_lib/key-cards.js'

/**
 * Sets the lock number(s) of one room. Admins only: this decides which door a
 * guest card opens, so the browser cannot write room_locks directly.
 *
 * POST { roomId, locks: [{ lockNo, label? }] }   (an empty list removes the room's locks)
 */
export const handler = async (event) => {
  const cors = handleCors(event); if (cors) return cors
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' })

  let ctx
  try { ctx = await requireAdmin(event) } catch (e) { return jsonResponse(e.status, e.body) }

  const body = parseBody(event)
  if (!body) return jsonResponse(400, { error: 'Invalid JSON body' })
  const { roomId } = body
  const locks = Array.isArray(body.locks) ? body.locks : null
  if (typeof roomId !== 'string' || !UUID.test(roomId)) return jsonResponse(400, { error: 'roomId is required' })
  if (!locks || locks.length > 4) return jsonResponse(400, { error: 'locks must be a list of at most 4' })
  const wanted = locks.map((l) => ({ lockNo: String(l?.lockNo ?? '').trim(), label: l?.label ? String(l.label).slice(0, 60) : null }))
  const bad = wanted.find((l) => !isLockNo(l.lockNo))
  if (bad) return jsonResponse(400, { error: `"${bad.lockNo}" is not a lock number: it must be 8 digits, starting 00 to 15.` })
  if (new Set(wanted.map((l) => l.lockNo)).size !== wanted.length) return jsonResponse(400, { error: 'The same lock number is listed twice' })

  try {
    const sb = serviceClient()
    const { data: room } = await sb.from('rooms').select('id, room_number').eq('id', roomId).maybeSingle()
    if (!room) return jsonResponse(404, { error: 'Room not found' })

    if (wanted.length) {
      const { data: taken, error } = await sb.from('room_locks').select('lock_no, room_id').in('lock_no', wanted.map((l) => l.lockNo))
      if (error) throw error
      const clash = (taken || []).find((t) => t.room_id !== roomId)
      if (clash) {
        const { data: other } = await sb.from('rooms').select('room_number').eq('id', clash.room_id).maybeSingle()
        return jsonResponse(409, { error: `Lock ${clash.lock_no} is already set on room ${other?.room_number ?? clash.room_id}.` })
      }
    }

    const { data: current, error: curErr } = await sb.from('room_locks').select('*').eq('room_id', roomId)
    if (curErr) throw curErr
    const keep = new Set(wanted.map((l) => l.lockNo))
    const removed = (current || []).filter((c) => !keep.has(c.lock_no))
    for (const r of removed) {
      const { error } = await sb.from('room_locks').delete().eq('id', r.id)
      if (error) throw error
    }
    const now = new Date().toISOString()
    for (const l of wanted) {
      const existing = (current || []).find((c) => c.lock_no === l.lockNo)
      const { error } = existing
        ? await sb.from('room_locks').update({ label: l.label, updated_at: now }).eq('id', existing.id)
        : await sb.from('room_locks').insert({ room_id: roomId, lock_no: l.lockNo, label: l.label, created_at: now, updated_at: now })
      if (error) {
        if (error.code === '23505') return jsonResponse(409, { error: `Lock ${l.lockNo} is already set on another room.` })
        throw error
      }
    }

    const { data: saved } = await sb.from('room_locks').select('*').eq('room_id', roomId)
    await logActivity(sb, {
      action: 'room_locks_updated',
      entityId: roomId,
      userId: ctx.user?.id,
      details: { room: room.room_number, before: (current || []).map((c) => c.lock_no), after: wanted.map((l) => l.lockNo) },
    })
    return jsonResponse(200, { roomId, locks: saved || [] })
  } catch (e) {
    console.error('[room-locks-save]', e)
    return jsonResponse(e.status || 500, { error: e.status ? e.message : 'Could not save the lock numbers' })
  }
}
