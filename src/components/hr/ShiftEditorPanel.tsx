/**
 * Shift schedule editor — admin sets each staff member's weekly shifts.
 * Shifts drive the late/minutes and absent metrics computed by the
 * clock-in RPC and the attendance report. An end time earlier than the
 * start time means an overnight shift.
 *
 * Realtime-driven via the hr_shifts table subscription.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarClock, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { db } from '@/lib/db'
import { useSubscription } from '@/hooks/use-subscription'
import {
  listShifts,
  upsertShift,
  deleteShift,
  type Shift,
} from '@/services/attendance-service'
import { activityLogService } from '@/services/activity-log-service'

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

interface StaffOption {
  id: string
  userId: string
  name: string
}

interface EditState {
  weekday: number
  shiftId: string | null   // null = new shift
  startTime: string        // HH:MM
  endTime: string
  graceMinutes: number
}

export function ShiftEditorPanel({ adminId }: { adminId: string }) {
  const [staff, setStaff] = useState<StaffOption[]>([])
  const [shifts, setShifts] = useState<Shift[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedUserId, setSelectedUserId] = useState('')
  const [editing, setEditing] = useState<EditState | null>(null)
  const [saving, setSaving] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const [staffRows, shiftRows] = await Promise.allSettled([
        db.staff.list({}),
        listShifts(),
      ])
      const options: StaffOption[] = staffRows.status === 'fulfilled'
        ? (staffRows.value || [])
            .filter((s: any) => s.userId)
            .map((s: any) => ({ id: s.id, userId: s.userId, name: s.name }))
            .sort((a: StaffOption, b: StaffOption) => a.name.localeCompare(b.name))
        : []
      setStaff(options)
      setShifts(shiftRows.status === 'fulfilled' ? shiftRows.value : [])
      setSelectedUserId(prev =>
        prev && options.some(o => o.userId === prev) ? prev : (options[0]?.userId ?? '')
      )
    } finally {
      setLoading(false)
    }
  }, [])

  const updatedAtShifts = useSubscription('hr_shifts')
  const updatedAtStaff = useSubscription('staff')

  useEffect(() => { refresh() }, [refresh, updatedAtShifts, updatedAtStaff])

  const selectedStaff = staff.find(o => o.userId === selectedUserId)
  const weekShifts = useMemo(
    () => shifts.filter(s => s.staffId === selectedUserId),
    [shifts, selectedUserId]
  )

  const openEditor = (weekday: number, existing?: Shift) => {
    setEditing({
      weekday,
      shiftId: existing?.id ?? null,
      startTime: existing ? existing.startTime.slice(0, 5) : '08:00',
      endTime: existing ? existing.endTime.slice(0, 5) : '17:00',
      graceMinutes: existing?.graceMinutes ?? 10,
    })
  }

  const handleSave = async () => {
    if (!editing || !selectedStaff) return
    if (!editing.startTime || !editing.endTime) {
      toast.error('Start and end times are required')
      return
    }
    setSaving(true)
    try {
      await upsertShift({
        staffId: selectedStaff.userId,
        weekday: editing.weekday,
        startTime: editing.startTime,
        endTime: editing.endTime,
        graceMinutes: editing.graceMinutes,
      })
      toast.success(`${WEEKDAYS[editing.weekday]} shift saved for ${selectedStaff.name}.`)
      activityLogService.logAttendanceAction(
        'shift_changed', selectedStaff.userId,
        {
          staffName: selectedStaff.name,
          weekday: WEEKDAYS[editing.weekday],
          startTime: editing.startTime,
          endTime: editing.endTime,
          graceMinutes: editing.graceMinutes,
        },
        adminId
      ).catch(() => {})
      setEditing(null)
      await refresh()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (shift: Shift) => {
    if (!selectedStaff) return
    setSaving(true)
    try {
      await deleteShift(shift.id)
      toast.success(`${WEEKDAYS[shift.weekday]} shift removed.`)
      activityLogService.logAttendanceAction(
        'shift_changed', selectedStaff.userId,
        { staffName: selectedStaff.name, weekday: WEEKDAYS[shift.weekday], removed: true },
        adminId
      ).catch(() => {})
      if (editing?.shiftId === shift.id) setEditing(null)
      await refresh()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="border rounded-xl overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 bg-muted/30 border-b">
        <div className="flex items-center gap-2">
          <CalendarClock className="w-5 h-5 text-primary" />
          <h3 className="font-semibold text-sm">Shift Schedules</h3>
        </div>
        <select
          value={selectedUserId}
          onChange={e => { setSelectedUserId(e.target.value); setEditing(null) }}
          className="h-8 rounded-md border bg-background px-2 text-sm"
          disabled={loading || staff.length === 0}
        >
          {staff.length === 0 && <option value="">No staff with accounts</option>}
          {staff.map(o => (
            <option key={o.userId} value={o.userId}>{o.name}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : !selectedStaff ? (
        <p className="text-sm text-muted-foreground text-center py-6">
          No staff accounts to schedule.
        </p>
      ) : (
        <div className="divide-y">
          {WEEKDAYS.map((day, weekday) => {
            const shift = weekShifts.find(s => s.weekday === weekday)
            const isEditing = editing?.weekday === weekday
            return (
              <div key={day} className="px-4 py-2.5">
                <div className="flex items-center gap-3">
                  <span className="w-24 text-sm font-medium flex-shrink-0">{day}</span>
                  {isEditing && editing ? (
                    <div className="flex flex-wrap items-end gap-2 flex-1">
                      <div className="grid gap-1">
                        <Label className="text-[10px] uppercase text-muted-foreground">Start</Label>
                        <Input
                          type="time"
                          value={editing.startTime}
                          onChange={e => setEditing({ ...editing, startTime: e.target.value })}
                          className="h-8 w-auto"
                        />
                      </div>
                      <div className="grid gap-1">
                        <Label className="text-[10px] uppercase text-muted-foreground">End</Label>
                        <Input
                          type="time"
                          value={editing.endTime}
                          onChange={e => setEditing({ ...editing, endTime: e.target.value })}
                          className="h-8 w-auto"
                        />
                      </div>
                      <div className="grid gap-1">
                        <Label className="text-[10px] uppercase text-muted-foreground">Grace (min)</Label>
                        <Input
                          type="number"
                          min={0}
                          max={120}
                          value={editing.graceMinutes}
                          onChange={e => setEditing({ ...editing, graceMinutes: Number(e.target.value) || 0 })}
                          className="h-8 w-20"
                        />
                      </div>
                      <Button size="sm" className="h-8" onClick={handleSave} disabled={saving}>
                        {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Save'}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8"
                        onClick={() => setEditing(null)}
                        disabled={saving}
                      >
                        <X className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ) : (
                    <>
                      <span className="flex-1 text-sm text-muted-foreground">
                        {shift
                          ? `${shift.startTime.slice(0, 5)} – ${shift.endTime.slice(0, 5)} · ${shift.graceMinutes}m grace${shift.endTime < shift.startTime ? ' · overnight' : ''}`
                          : 'No shift'}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1 text-xs"
                        onClick={() => openEditor(weekday, shift)}
                        disabled={saving}
                      >
                        {shift ? <Pencil className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
                        {shift ? 'Edit' : 'Add'}
                      </Button>
                      {shift && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-destructive hover:bg-red-50"
                          onClick={() => handleDelete(shift)}
                          disabled={saving}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </div>
            )
          })}
          <p className="px-4 py-2 text-[11px] text-muted-foreground bg-muted/20">
            An end time earlier than the start time means the shift runs overnight into the next day.
            Late clock-ins beyond the grace period are flagged automatically.
          </p>
        </div>
      )}
    </div>
  )
}
