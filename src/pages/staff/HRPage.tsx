import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import { blink } from '@/blink/client'
import { useStaffRole } from '@/hooks/use-staff-role'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  Clock,
  CalendarDays,
  DollarSign,
  Star,
  FileText,
  Plus,
  Check,
  X,
  Eye,
  Loader2,
  Users2,
  AlertCircle,
  Download,
  TrendingUp,
  ChevronDown,
  CheckCircle,
  BookOpen,
  QrCode,
  Wifi,
  RefreshCw,
  Printer,
  MapPin
} from 'lucide-react'
import { generateEmploymentApplicationPDF } from '@/lib/hr-form-pdf'
import {
  getWeekBounds,
  getPastWeeksBounds,
  getAllStaffReportsForWeek,
  reviewWeekReport,
  fetchBookingsForStaffWeek,
  type WeeklyRevenueReport,
  type WeekBounds,
  type BookingSummary,
} from '@/services/revenue-service'
import {
  getLiveAttendance,
  generateClockUrl,
  secondsUntilNextToken,
  downloadCsv,
  type AttendanceRecord as LiveAttendanceRecord,
} from '@/services/attendance-service'
import { QRCodeSVG } from 'qrcode.react'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

// ─── Types ───────────────────────────────────────────────────────────────────

interface AttendanceRecord {
  id: string
  staffId: string
  staffName: string
  date: string
  clockIn: string
  clockOut: string
  hoursWorked: number
  status: string
  notes: string
  createdAt: string
}

interface LeaveRequest {
  id: string
  staffId: string
  staffName: string
  leaveType: string
  startDate: string
  endDate: string
  reason: string
  status: string
  reviewedBy: string
  reviewedAt: string
  createdAt: string
}

interface PayrollRecord {
  id: string
  staffId: string
  staffName: string
  period: string
  baseSalary: number
  allowances: number
  deductions: number
  netPay: number
  paymentStatus: string
  paymentDate: string
  notes: string
  createdAt: string
}

interface PerformanceReview {
  id: string
  staffId: string
  staffName: string
  reviewerId: string
  reviewerName: string
  reviewDate: string
  rating: number
  strengths: string
  improvements: string
  notes: string
  createdAt: string
}

interface JobApplication {
  id: string
  applicantName: string
  email: string
  phone: string
  position: string
  experience: string
  skills: string
  coverLetter: string
  status: string
  reviewedBy: string
  interviewDate: string
  notes: string
  createdAt: string
}

interface StaffMember {
  id: string
  userId: string
  name: string
  email: string
  role: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const db = blink.db as any

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, string> = {
    present: 'bg-green-100 text-green-800',
    absent: 'bg-red-100 text-red-800',
    late: 'bg-yellow-100 text-yellow-800',
    approved: 'bg-green-100 text-green-800',
    rejected: 'bg-red-100 text-red-800',
    pending: 'bg-yellow-100 text-yellow-800',
    paid: 'bg-green-100 text-green-800',
    unpaid: 'bg-red-100 text-red-800',
    'under-review': 'bg-blue-100 text-blue-800',
    'interview-scheduled': 'bg-purple-100 text-purple-800',
    init: 'hidden'
  }
  const cls = variants[status] ?? 'bg-gray-100 text-gray-700'
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${cls}`}>
      {status.replace(/-/g, ' ')}
    </span>
  )
}

function StarRating({ rating, onChange }: { rating: number; onChange?: (r: number) => void }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={`w-5 h-5 ${n <= rating ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300'} ${onChange ? 'cursor-pointer' : ''}`}
          onClick={() => onChange?.(n)}
        />
      ))}
    </div>
  )
}

function StatCard({ icon: Icon, label, value, color }: { icon: any; label: string; value: string | number; color: string }) {
  return (
    <div className="bg-card border rounded-xl p-4 flex items-center gap-4">
      <div className={`p-3 rounded-lg ${color}`}>
        <Icon className="w-5 h-5 text-white" />
      </div>
      <div>
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-2xl font-bold">{value}</p>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function HRPage() {
  const { role, loading: roleLoading, staffRecord } = useStaffRole()

  // Guard: admin / owner only
  if (!roleLoading && role !== 'admin' && role !== 'owner') {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4 text-muted-foreground">
        <AlertCircle className="w-12 h-12" />
        <p className="text-lg font-medium">Access Denied</p>
        <p className="text-sm">Only admins and owners can access HR.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-primary/10 rounded-lg">
          <Users2 className="w-6 h-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Human Resources</h1>
          <p className="text-sm text-muted-foreground">Manage staff HR records and applications</p>
        </div>
      </div>

      <Tabs defaultValue="attendance" className="space-y-4">
        <TabsList className="grid grid-cols-6 w-full lg:w-auto">
          <TabsTrigger value="attendance" className="flex items-center gap-2 text-xs">
            <Clock className="w-4 h-4" /> Attendance
          </TabsTrigger>
          <TabsTrigger value="leave" className="flex items-center gap-2 text-xs">
            <CalendarDays className="w-4 h-4" /> Leave
          </TabsTrigger>
          <TabsTrigger value="payroll" className="flex items-center gap-2 text-xs">
            <DollarSign className="w-4 h-4" /> Payroll
          </TabsTrigger>
          <TabsTrigger value="performance" className="flex items-center gap-2 text-xs">
            <Star className="w-4 h-4" /> Performance
          </TabsTrigger>
          <TabsTrigger value="applications" className="flex items-center gap-2 text-xs">
            <FileText className="w-4 h-4" /> Applications
          </TabsTrigger>
          <TabsTrigger value="revenue" className="flex items-center gap-2 text-xs">
            <TrendingUp className="w-4 h-4" /> Revenue
          </TabsTrigger>
        </TabsList>

        <TabsContent value="attendance"><AttendanceTab currentStaff={staffRecord} /></TabsContent>
        <TabsContent value="leave"><LeaveTab currentStaff={staffRecord} /></TabsContent>
        <TabsContent value="payroll"><PayrollTab /></TabsContent>
        <TabsContent value="performance"><PerformanceTab currentStaff={staffRecord} /></TabsContent>
        <TabsContent value="applications"><ApplicationsTab /></TabsContent>
        <TabsContent value="revenue"><RevenueReportTab /></TabsContent>
      </Tabs>
    </div>
  )
}

// ─── Tab 1: Attendance & Shifts ───────────────────────────────────────────────

// ─── QR Code Panel ────────────────────────────────────────────────────────────

function QRPanel() {
  const [url, setUrl] = useState(() => generateClockUrl())
  const [secs, setSecs] = useState(() => secondsUntilNextToken())

  useEffect(() => {
    const id = setInterval(() => {
      const s = secondsUntilNextToken()
      setSecs(s)
      // Token just rolled over — regenerate URL
      if (s === WINDOW_SECS - 1 || s === WINDOW_SECS) {
        setUrl(generateClockUrl())
      }
    }, 1000)
    return () => clearInterval(id)
  }, [])

  const m = Math.floor(secs / 60)
  const s = secs % 60

  const handlePrint = () => {
    const w = window.open('', '_blank')
    if (!w) return
    const svg = document.getElementById('att-qr')?.innerHTML ?? ''
    w.document.write(`<!DOCTYPE html><html><head><title>AMP Lodge — Clock-In QR</title>
      <style>body{font-family:sans-serif;text-align:center;padding:48px}
      h1{font-size:22px;margin-bottom:6px}p{color:#666;font-size:13px;margin:6px 0}
      .qr{display:inline-block;background:#fff;padding:16px;border:1px solid #e5e7eb;border-radius:12px;margin:24px 0}</style>
      </head><body>
      <h1>🏨 AMP Lodge</h1>
      <p>Scan to clock in / clock out</p>
      <div class="qr">${svg}</div>
      <p style="font-size:11px;color:#aaa;margin-top:8px">Post at hotel entrance · Scan with phone camera</p>
      <script>window.onload=()=>window.print()</script>
      </body></html>`)
    w.document.close()
  }

  return (
    <div className="border rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <QrCode className="w-5 h-5 text-primary" />
          <h3 className="font-semibold">Staff Clock-In QR Code</h3>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Refreshes in {m}:{String(s).padStart(2, '0')}</span>
        </div>
      </div>
      <div className="flex flex-col sm:flex-row items-center gap-6">
        <div id="att-qr" className="bg-white p-3 rounded-lg border flex-shrink-0">
          <QRCodeSVG value={url} size={180} level="M" />
        </div>
        <div className="space-y-3 text-sm text-muted-foreground">
          <p className="flex items-center gap-2">
            <Wifi className="w-4 h-4 text-green-500 flex-shrink-0" />
            Post this at the hotel entrance. Staff scan with their phone camera to clock in or out.
          </p>
          <p className="flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-blue-500 flex-shrink-0" />
            The token rotates every 10 minutes to prevent screenshot reuse.
          </p>
          <Button variant="outline" size="sm" className="gap-2 mt-2" onClick={handlePrint}>
            <Printer className="w-4 h-4" /> Print QR Code
          </Button>
        </div>
      </div>
    </div>
  )
}

const WINDOW_SECS = 10 * 60

// ─── Live Now Panel ───────────────────────────────────────────────────────────

function LiveNowPanel() {
  const [live, setLive] = useState<LiveAttendanceRecord[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const data = await getLiveAttendance()
      setLive(data)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 30_000)
    return () => clearInterval(id)
  }, [refresh])

  const present = live.filter(r => !r.clockOut)
  const completed = live.filter(r => r.clockOut)

  return (
    <div className="border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-muted/30 border-b">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
          </span>
          <span className="font-semibold text-sm">Live Now — {present.length} present</span>
        </div>
        <Button variant="ghost" size="sm" className="gap-1.5 text-xs h-7 px-2" onClick={refresh}>
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </Button>
      </div>
      {loading ? (
        <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : live.length === 0 ? (
        <div className="text-center py-6 text-sm text-muted-foreground">No staff clocked in today yet.</div>
      ) : (
        <div className="divide-y">
          {present.map(r => (
            <div key={r.id} className="flex items-center gap-3 px-4 py-2.5">
              <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
              <span className="font-medium text-sm flex-1">{(r as any).staffName}</span>
              <span className="text-xs text-muted-foreground">Clocked in {(r as any).clockIn}</span>
            </div>
          ))}
          {completed.map(r => (
            <div key={r.id} className="flex items-center gap-3 px-4 py-2.5 opacity-60">
              <span className="w-2 h-2 rounded-full bg-gray-400 flex-shrink-0" />
              <span className="text-sm flex-1">{(r as any).staffName}</span>
              <span className="text-xs text-muted-foreground">{(r as any).clockIn} → {(r as any).clockOut}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Attendance Tab ───────────────────────────────────────────────────────────

function AttendanceTab({ currentStaff }: { currentStaff: any }) {
  const [records, setRecords] = useState<AttendanceRecord[]>([])
  const [staffList, setStaffList] = useState<StaffMember[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState({ staffId: '', staffName: '', date: '', clockIn: '', clockOut: '', status: 'present', notes: '' })
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [att, staff] = await Promise.allSettled([
        db.hr_attendance.list({ orderBy: { createdAt: 'desc' } }),
        db.staff.list({})
      ])
      setRecords(att.status === 'fulfilled' ? (att.value || []).filter((r: AttendanceRecord) => r.status !== 'init') : [])
      setStaffList(staff.status === 'fulfilled' ? (staff.value || []) : [])
    } catch {
      setRecords([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const today = new Date().toISOString().split('T')[0]
  const todayRecords = records.filter(r => r.date === today)
  const presentToday = todayRecords.filter(r => r.status === 'present' || r.status === 'late').length
  const absentToday = todayRecords.filter(r => r.status === 'absent').length
  const hoursThisWeek = records
    .filter(r => {
      const d = new Date(r.date)
      const now = new Date()
      const weekStart = new Date(now.setDate(now.getDate() - now.getDay()))
      return d >= weekStart
    })
    .reduce((sum, r) => sum + (r.hoursWorked || 0), 0)

  const handleStaffChange = (staffId: string) => {
    const member = staffList.find(s => s.id === staffId)
    setForm(f => ({ ...f, staffId, staffName: member?.name || '' }))
  }

  const handleSave = async () => {
    if (!form.staffId || !form.date || !form.clockIn) {
      toast.error('Staff, date, and clock-in time are required')
      return
    }
    setSaving(true)
    try {
      let hoursWorked = 0
      if (form.clockIn && form.clockOut) {
        const [inH, inM] = form.clockIn.split(':').map(Number)
        const [outH, outM] = form.clockOut.split(':').map(Number)
        hoursWorked = Math.max(0, (outH * 60 + outM - inH * 60 - inM) / 60)
      }
      await db.hr_attendance.create({
        id: `att_${Date.now()}`,
        ...form,
        hoursWorked: parseFloat(hoursWorked.toFixed(2)),
        createdAt: new Date().toISOString()
      })
      toast.success('Attendance logged')
      setDialogOpen(false)
      setForm({ staffId: '', staffName: '', date: '', clockIn: '', clockOut: '', status: 'present', notes: '' })
      load()
    } catch {
      toast.error('Failed to log attendance')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await db.hr_attendance.delete(id)
      toast.success('Record deleted')
      load()
    } catch {
      toast.error('Failed to delete record')
    }
  }

  const handleExport = () => {
    if (records.length === 0) { toast.error('No records to export'); return }
    const today_ = new Date().toISOString().split('T')[0]
    downloadCsv(records, `attendance_${today_}.csv`)
    toast.success('Attendance exported')
  }

  return (
    <div className="space-y-5">
      {/* QR Code Panel */}
      <QRPanel />

      {/* Live Now */}
      <LiveNowPanel />

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard icon={Check} label="Present Today" value={presentToday} color="bg-green-500" />
        <StatCard icon={Clock} label="Hours This Week" value={hoursThisWeek.toFixed(1)} color="bg-blue-500" />
        <StatCard icon={X} label="Absent Today" value={absentToday} color="bg-red-500" />
      </div>

      {/* Records header */}
      <div className="flex flex-wrap justify-between items-center gap-2">
        <h2 className="text-lg font-semibold">Attendance Records</h2>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={handleExport}>
            <Download className="w-4 h-4" /> Export CSV
          </Button>
          <Button onClick={() => setDialogOpen(true)} size="sm">
            <Plus className="w-4 h-4 mr-1.5" /> Log Manually
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : records.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">No attendance records yet. Staff can clock in by scanning the QR code above.</div>
      ) : (
        <div className="rounded-xl border overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                {['Staff Name', 'Date', 'Clock In', 'Clock Out', 'Hours', 'Status', 'Notes', ''].map(h => (
                  <th key={h} className="px-4 py-3 text-left font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {records.map(r => (
                <tr key={r.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-medium whitespace-nowrap">{r.staffName}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{r.date}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{r.clockIn || '—'}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{r.clockOut || '—'}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{r.hoursWorked ? `${r.hoursWorked}h` : '—'}</td>
                  <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                  <td className="px-4 py-3 max-w-[200px]">
                    {r.notes === 'GPS: location access denied' ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-red-100 text-red-800 text-xs font-medium px-2.5 py-1 border border-red-200">
                        <MapPin className="w-3 h-3 flex-shrink-0" />
                        Location denied
                      </span>
                    ) : r.notes === 'GPS: clocked in outside hotel premises' ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 text-amber-800 text-xs font-medium px-2.5 py-1 border border-amber-200">
                        <MapPin className="w-3 h-3 flex-shrink-0" />
                        Outside hotel
                      </span>
                    ) : (
                      <span className="text-muted-foreground truncate block">{r.notes || '—'}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => handleDelete(r.id)}>
                      <X className="w-4 h-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Log Attendance Manually</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>Staff Member</Label>
              <Select onValueChange={handleStaffChange} value={form.staffId}>
                <SelectTrigger><SelectValue placeholder="Select staff…" /></SelectTrigger>
                <SelectContent>
                  {staffList.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Date</Label>
              <Input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>Clock In</Label>
                <Input type="time" value={form.clockIn} onChange={e => setForm(f => ({ ...f, clockIn: e.target.value }))} />
              </div>
              <div className="grid gap-2">
                <Label>Clock Out</Label>
                <Input type="time" value={form.clockOut} onChange={e => setForm(f => ({ ...f, clockOut: e.target.value }))} />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Status</Label>
              <Select onValueChange={v => setForm(f => ({ ...f, status: v }))} value={form.status}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="present">Present</SelectItem>
                  <SelectItem value="absent">Absent</SelectItem>
                  <SelectItem value="late">Late</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Notes</Label>
              <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── Tab 2: Leave Management ──────────────────────────────────────────────────

function LeaveTab({ currentStaff }: { currentStaff: any }) {
  const [records, setRecords] = useState<LeaveRequest[]>([])
  const [staffList, setStaffList] = useState<StaffMember[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState({ staffId: '', staffName: '', leaveType: 'annual', startDate: '', endDate: '', reason: '' })
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [leaves, staff] = await Promise.allSettled([
        db.hr_leave_requests.list({ orderBy: { createdAt: 'desc' } }),
        db.staff.list({})
      ])
      setRecords(leaves.status === 'fulfilled' ? (leaves.value || []).filter((r: LeaveRequest) => r.status !== 'init') : [])
      setStaffList(staff.status === 'fulfilled' ? (staff.value || []) : [])
    } catch {
      setRecords([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const pending = records.filter(r => r.status === 'pending').length
  const approvedThisMonth = records.filter(r => {
    return r.status === 'approved' && r.createdAt?.startsWith(new Date().toISOString().substring(0, 7))
  }).length
  const rejected = records.filter(r => r.status === 'rejected').length

  const handleStaffChange = (staffId: string) => {
    const member = staffList.find(s => s.id === staffId)
    setForm(f => ({ ...f, staffId, staffName: member?.name || '' }))
  }

  const handleSave = async () => {
    if (!form.staffId || !form.startDate || !form.endDate || !form.reason) {
      toast.error('All fields are required')
      return
    }
    setSaving(true)
    try {
      await db.hr_leave_requests.create({
        id: `leave_${Date.now()}`,
        ...form,
        status: 'pending',
        reviewedBy: '',
        reviewedAt: '',
        createdAt: new Date().toISOString()
      })
      toast.success('Leave request submitted')
      setDialogOpen(false)
      setForm({ staffId: '', staffName: '', leaveType: 'annual', startDate: '', endDate: '', reason: '' })
      load()
    } catch {
      toast.error('Failed to submit leave request')
    } finally {
      setSaving(false)
    }
  }

  const handleAction = async (id: string, action: 'approved' | 'rejected') => {
    try {
      await db.hr_leave_requests.update(id, {
        status: action,
        reviewedBy: currentStaff?.name || 'Admin',
        reviewedAt: new Date().toISOString()
      })
      toast.success(`Leave request ${action}`)
      load()
    } catch {
      toast.error('Failed to update leave request')
    }
  }

  const daysBetween = (start: string, end: string) => {
    const s = new Date(start), e = new Date(end)
    return Math.max(1, Math.round((e.getTime() - s.getTime()) / 86400000) + 1)
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard icon={AlertCircle} label="Pending Requests" value={pending} color="bg-yellow-500" />
        <StatCard icon={Check} label="Approved This Month" value={approvedThisMonth} color="bg-green-500" />
        <StatCard icon={X} label="Rejected" value={rejected} color="bg-red-500" />
      </div>

      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">Leave Requests</h2>
        <Button onClick={() => setDialogOpen(true)} size="sm">
          <Plus className="w-4 h-4 mr-2" /> New Request
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : records.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">No leave requests yet.</div>
      ) : (
        <div className="rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                {['Staff', 'Type', 'From', 'To', 'Days', 'Reason', 'Status', 'Actions'].map(h => (
                  <th key={h} className="px-4 py-3 text-left font-medium text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {records.map(r => (
                <tr key={r.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-medium">{r.staffName}</td>
                  <td className="px-4 py-3 capitalize">{r.leaveType}</td>
                  <td className="px-4 py-3">{r.startDate}</td>
                  <td className="px-4 py-3">{r.endDate}</td>
                  <td className="px-4 py-3">{daysBetween(r.startDate, r.endDate)}</td>
                  <td className="px-4 py-3 max-w-[140px] truncate text-muted-foreground">{r.reason}</td>
                  <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                  <td className="px-4 py-3">
                    {r.status === 'pending' && (
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" className="text-green-600 border-green-300 hover:bg-green-50" onClick={() => handleAction(r.id, 'approved')}>
                          <Check className="w-3 h-3 mr-1" /> Approve
                        </Button>
                        <Button size="sm" variant="outline" className="text-red-600 border-red-300 hover:bg-red-50" onClick={() => handleAction(r.id, 'rejected')}>
                          <X className="w-3 h-3 mr-1" /> Reject
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Leave Request</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>Staff Member</Label>
              <Select onValueChange={handleStaffChange} value={form.staffId}>
                <SelectTrigger><SelectValue placeholder="Select staff…" /></SelectTrigger>
                <SelectContent>
                  {staffList.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Leave Type</Label>
              <Select onValueChange={v => setForm(f => ({ ...f, leaveType: v }))} value={form.leaveType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="annual">Annual Leave</SelectItem>
                  <SelectItem value="sick">Sick Leave</SelectItem>
                  <SelectItem value="emergency">Emergency Leave</SelectItem>
                  <SelectItem value="maternity">Maternity Leave</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>Start Date</Label>
                <Input type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} />
              </div>
              <div className="grid gap-2">
                <Label>End Date</Label>
                <Input type="date" value={form.endDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Reason</Label>
              <Textarea value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Submit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── Tab 3: Payroll Summary ───────────────────────────────────────────────────

function PayrollTab() {
  const [records, setRecords] = useState<PayrollRecord[]>([])
  const [staffList, setStaffList] = useState<StaffMember[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState({ staffId: '', staffName: '', period: '', baseSalary: '', allowances: '', deductions: '', notes: '' })
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [pay, staff] = await Promise.allSettled([
        db.hr_payroll.list({ orderBy: { createdAt: 'desc' } }),
        db.staff.list({})
      ])
      setRecords(pay.status === 'fulfilled' ? (pay.value || []).filter((r: PayrollRecord) => r.paymentStatus !== 'init') : [])
      setStaffList(staff.status === 'fulfilled' ? (staff.value || []) : [])
    } catch {
      setRecords([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const thisMonth = new Date().toISOString().substring(0, 7)
  const monthRecords = records.filter(r => r.period === thisMonth)
  const totalPayroll = monthRecords.reduce((sum, r) => sum + (r.netPay || 0), 0)
  const paidCount = monthRecords.filter(r => r.paymentStatus === 'paid').length
  const pendingCount = monthRecords.filter(r => r.paymentStatus === 'unpaid').length

  const handleStaffChange = (staffId: string) => {
    const member = staffList.find(s => s.id === staffId)
    setForm(f => ({ ...f, staffId, staffName: member?.name || '' }))
  }

  const handleSave = async () => {
    if (!form.staffId || !form.period || !form.baseSalary) {
      toast.error('Staff, period, and base salary are required')
      return
    }
    setSaving(true)
    try {
      const base = parseFloat(form.baseSalary) || 0
      const allowances = parseFloat(form.allowances) || 0
      const deductions = parseFloat(form.deductions) || 0
      const netPay = base + allowances - deductions
      await db.hr_payroll.create({
        id: `pay_${Date.now()}`,
        staffId: form.staffId,
        staffName: form.staffName,
        period: form.period,
        baseSalary: base,
        allowances,
        deductions,
        netPay,
        paymentStatus: 'unpaid',
        paymentDate: '',
        notes: form.notes,
        createdAt: new Date().toISOString()
      })
      toast.success('Payroll record added')
      setDialogOpen(false)
      setForm({ staffId: '', staffName: '', period: '', baseSalary: '', allowances: '', deductions: '', notes: '' })
      load()
    } catch {
      toast.error('Failed to add payroll record')
    } finally {
      setSaving(false)
    }
  }

  const markPaid = async (id: string) => {
    try {
      await db.hr_payroll.update(id, { paymentStatus: 'paid', paymentDate: new Date().toISOString().split('T')[0] })
      toast.success('Marked as paid')
      load()
    } catch {
      toast.error('Failed to update payment status')
    }
  }

  const fmt = (n: number) => `GHS ${n.toFixed(2)}`

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard icon={DollarSign} label="Total Payroll This Month" value={fmt(totalPayroll)} color="bg-blue-500" />
        <StatCard icon={Check} label="Paid" value={paidCount} color="bg-green-500" />
        <StatCard icon={AlertCircle} label="Pending Payment" value={pendingCount} color="bg-yellow-500" />
      </div>

      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">Payroll Records</h2>
        <Button onClick={() => setDialogOpen(true)} size="sm">
          <Plus className="w-4 h-4 mr-2" /> Add Record
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : records.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">No payroll records yet.</div>
      ) : (
        <div className="rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                {['Staff', 'Period', 'Base Salary', 'Allowances', 'Deductions', 'Net Pay', 'Status', 'Actions'].map(h => (
                  <th key={h} className="px-4 py-3 text-left font-medium text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {records.map(r => (
                <tr key={r.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-medium">{r.staffName}</td>
                  <td className="px-4 py-3">{r.period}</td>
                  <td className="px-4 py-3">{fmt(r.baseSalary)}</td>
                  <td className="px-4 py-3 text-green-700">+{fmt(r.allowances)}</td>
                  <td className="px-4 py-3 text-red-700">-{fmt(r.deductions)}</td>
                  <td className="px-4 py-3 font-semibold">{fmt(r.netPay)}</td>
                  <td className="px-4 py-3"><StatusBadge status={r.paymentStatus} /></td>
                  <td className="px-4 py-3">
                    {r.paymentStatus === 'unpaid' && (
                      <Button size="sm" variant="outline" className="text-green-600 border-green-300 hover:bg-green-50" onClick={() => markPaid(r.id)}>
                        <Check className="w-3 h-3 mr-1" /> Mark Paid
                      </Button>
                    )}
                    {r.paymentStatus === 'paid' && (
                      <span className="text-xs text-muted-foreground">{r.paymentDate}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Payroll Record</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>Staff Member</Label>
              <Select onValueChange={handleStaffChange} value={form.staffId}>
                <SelectTrigger><SelectValue placeholder="Select staff…" /></SelectTrigger>
                <SelectContent>
                  {staffList.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Period (Month)</Label>
              <Input type="month" value={form.period} onChange={e => setForm(f => ({ ...f, period: e.target.value }))} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="grid gap-2">
                <Label>Base Salary (GHS)</Label>
                <Input type="number" min="0" value={form.baseSalary} onChange={e => setForm(f => ({ ...f, baseSalary: e.target.value }))} />
              </div>
              <div className="grid gap-2">
                <Label>Allowances (GHS)</Label>
                <Input type="number" min="0" value={form.allowances} onChange={e => setForm(f => ({ ...f, allowances: e.target.value }))} />
              </div>
              <div className="grid gap-2">
                <Label>Deductions (GHS)</Label>
                <Input type="number" min="0" value={form.deductions} onChange={e => setForm(f => ({ ...f, deductions: e.target.value }))} />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Notes</Label>
              <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── Tab 4: Performance Reviews ───────────────────────────────────────────────

function PerformanceTab({ currentStaff }: { currentStaff: any }) {
  const [records, setRecords] = useState<PerformanceReview[]>([])
  const [staffList, setStaffList] = useState<StaffMember[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [viewRecord, setViewRecord] = useState<PerformanceReview | null>(null)
  const [form, setForm] = useState({ staffId: '', staffName: '', reviewDate: '', rating: 3, strengths: '', improvements: '', notes: '' })
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [reviews, staff] = await Promise.allSettled([
        db.hr_performance_reviews.list({ orderBy: { createdAt: 'desc' } }),
        db.staff.list({})
      ])
      setRecords(reviews.status === 'fulfilled' ? (reviews.value || []).filter((r: PerformanceReview) => r.rating !== 0) : [])
      setStaffList(staff.status === 'fulfilled' ? (staff.value || []) : [])
    } catch {
      setRecords([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleStaffChange = (staffId: string) => {
    const member = staffList.find(s => s.id === staffId)
    setForm(f => ({ ...f, staffId, staffName: member?.name || '' }))
  }

  const handleSave = async () => {
    if (!form.staffId || !form.reviewDate || !form.strengths) {
      toast.error('Staff, date, and strengths are required')
      return
    }
    setSaving(true)
    try {
      await db.hr_performance_reviews.create({
        id: `perf_${Date.now()}`,
        staffId: form.staffId,
        staffName: form.staffName,
        reviewerId: currentStaff?.id || 'admin',
        reviewerName: currentStaff?.name || 'Admin',
        reviewDate: form.reviewDate,
        rating: form.rating,
        strengths: form.strengths,
        improvements: form.improvements,
        notes: form.notes,
        createdAt: new Date().toISOString()
      })
      toast.success('Review submitted')
      setDialogOpen(false)
      setForm({ staffId: '', staffName: '', reviewDate: '', rating: 3, strengths: '', improvements: '', notes: '' })
      load()
    } catch {
      toast.error('Failed to submit review')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await db.hr_performance_reviews.delete(id)
      toast.success('Review deleted')
      load()
    } catch {
      toast.error('Failed to delete review')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">Performance Reviews</h2>
        <Button onClick={() => setDialogOpen(true)} size="sm">
          <Plus className="w-4 h-4 mr-2" /> Add Review
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : records.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">No performance reviews yet.</div>
      ) : (
        <div className="rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                {['Staff', 'Reviewed By', 'Date', 'Rating', 'Strengths', 'Actions'].map(h => (
                  <th key={h} className="px-4 py-3 text-left font-medium text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {records.map(r => (
                <tr key={r.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-medium">{r.staffName}</td>
                  <td className="px-4 py-3 text-muted-foreground">{r.reviewerName}</td>
                  <td className="px-4 py-3">{r.reviewDate}</td>
                  <td className="px-4 py-3"><StarRating rating={r.rating} /></td>
                  <td className="px-4 py-3 max-w-[180px] truncate text-muted-foreground">{r.strengths}</td>
                  <td className="px-4 py-3 flex gap-2">
                    <Button variant="ghost" size="icon" onClick={() => setViewRecord(r)}>
                      <Eye className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => handleDelete(r.id)}>
                      <X className="w-4 h-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Review Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Performance Review</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>Staff Member</Label>
              <Select onValueChange={handleStaffChange} value={form.staffId}>
                <SelectTrigger><SelectValue placeholder="Select staff…" /></SelectTrigger>
                <SelectContent>
                  {staffList.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Review Date</Label>
              <Input type="date" value={form.reviewDate} onChange={e => setForm(f => ({ ...f, reviewDate: e.target.value }))} />
            </div>
            <div className="grid gap-2">
              <Label>Rating</Label>
              <StarRating rating={form.rating} onChange={r => setForm(f => ({ ...f, rating: r }))} />
            </div>
            <div className="grid gap-2">
              <Label>Strengths</Label>
              <Textarea value={form.strengths} onChange={e => setForm(f => ({ ...f, strengths: e.target.value }))} rows={2} placeholder="Key strengths observed…" />
            </div>
            <div className="grid gap-2">
              <Label>Areas for Improvement</Label>
              <Textarea value={form.improvements} onChange={e => setForm(f => ({ ...f, improvements: e.target.value }))} rows={2} placeholder="Areas to develop…" />
            </div>
            <div className="grid gap-2">
              <Label>Additional Notes</Label>
              <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Submit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Full Review Dialog */}
      <Dialog open={!!viewRecord} onOpenChange={() => setViewRecord(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Performance Review — {viewRecord?.staffName}</DialogTitle>
          </DialogHeader>
          {viewRecord && (
            <div className="space-y-4 py-2">
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>Reviewed by {viewRecord.reviewerName}</span>
                <span>{viewRecord.reviewDate}</span>
              </div>
              <div>
                <p className="text-sm font-medium mb-1">Rating</p>
                <StarRating rating={viewRecord.rating} />
              </div>
              <div>
                <p className="text-sm font-medium mb-1">Strengths</p>
                <p className="text-sm bg-muted rounded-lg p-3">{viewRecord.strengths}</p>
              </div>
              {viewRecord.improvements && (
                <div>
                  <p className="text-sm font-medium mb-1">Areas for Improvement</p>
                  <p className="text-sm bg-muted rounded-lg p-3">{viewRecord.improvements}</p>
                </div>
              )}
              {viewRecord.notes && (
                <div>
                  <p className="text-sm font-medium mb-1">Notes</p>
                  <p className="text-sm bg-muted rounded-lg p-3">{viewRecord.notes}</p>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setViewRecord(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── Tab 5: Employment Applications ──────────────────────────────────────────

function ApplicationsTab() {
  const [records, setRecords] = useState<JobApplication[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [viewRecord, setViewRecord] = useState<JobApplication | null>(null)
  const [form, setForm] = useState({ applicantName: '', email: '', phone: '', position: '', experience: '', skills: '', coverLetter: '' })
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const apps = await db.hr_job_applications.list({ orderBy: { createdAt: 'desc' } })
      setRecords((apps || []).filter((r: JobApplication) => r.status !== 'init'))
    } catch {
      // Table may not exist yet — treat as empty
      setRecords([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const total = records.length
  const pendingCount = records.filter(r => r.status === 'pending').length
  const approvedCount = records.filter(r => r.status === 'approved').length
  const rejectedCount = records.filter(r => r.status === 'rejected').length

  const handleSave = async () => {
    if (!form.applicantName || !form.email || !form.position || !form.coverLetter) {
      toast.error('Name, email, position, and cover letter are required')
      return
    }
    setSaving(true)
    try {
      await db.hr_job_applications.create({
        id: `app_${Date.now()}`,
        ...form,
        status: 'pending',
        reviewedBy: '',
        interviewDate: '',
        notes: '',
        createdAt: new Date().toISOString()
      })
      toast.success('Application submitted')
      setDialogOpen(false)
      setForm({ applicantName: '', email: '', phone: '', position: '', experience: '', skills: '', coverLetter: '' })
      load()
    } catch {
      toast.error('Failed to submit application')
    } finally {
      setSaving(false)
    }
  }

  const handleAction = async (id: string, status: string) => {
    try {
      await db.hr_job_applications.update(id, { status, reviewedBy: 'Admin' })
      toast.success(`Application ${status}`)
      load()
    } catch {
      toast.error('Failed to update application')
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard icon={FileText} label="Total Applications" value={total} color="bg-gray-500" />
        <StatCard icon={AlertCircle} label="Pending Review" value={pendingCount} color="bg-yellow-500" />
        <StatCard icon={Check} label="Approved" value={approvedCount} color="bg-green-500" />
        <StatCard icon={X} label="Rejected" value={rejectedCount} color="bg-red-500" />
      </div>

      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">Employment Applications</h2>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={generateEmploymentApplicationPDF}>
            <Download className="w-4 h-4 mr-2" /> Download Form
          </Button>
          <Button onClick={() => setDialogOpen(true)} size="sm">
            <Plus className="w-4 h-4 mr-2" /> Add Application
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : records.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">No applications yet.</div>
      ) : (
        <div className="rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                {['Name', 'Email', 'Position', 'Experience', 'Status', 'Actions'].map(h => (
                  <th key={h} className="px-4 py-3 text-left font-medium text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {records.map(r => (
                <tr key={r.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-medium">{r.applicantName}</td>
                  <td className="px-4 py-3 text-muted-foreground">{r.email}</td>
                  <td className="px-4 py-3">{r.position}</td>
                  <td className="px-4 py-3 max-w-[120px] truncate text-muted-foreground">{r.experience || '—'}</td>
                  <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2 flex-wrap">
                      <Button variant="ghost" size="icon" onClick={() => setViewRecord(r)} title="View Application">
                        <Eye className="w-4 h-4" />
                      </Button>
                      {r.status === 'pending' && (
                        <>
                          <Button size="sm" variant="outline" className="text-green-600 border-green-300 hover:bg-green-50" onClick={() => handleAction(r.id, 'approved')}>
                            <Check className="w-3 h-3 mr-1" /> Approve
                          </Button>
                          <Button size="sm" variant="outline" className="text-blue-600 border-blue-300 hover:bg-blue-50" onClick={() => handleAction(r.id, 'interview-scheduled')}>
                            <CalendarDays className="w-3 h-3 mr-1" /> Interview
                          </Button>
                          <Button size="sm" variant="outline" className="text-red-600 border-red-300 hover:bg-red-50" onClick={() => handleAction(r.id, 'rejected')}>
                            <X className="w-3 h-3 mr-1" /> Reject
                          </Button>
                        </>
                      )}
                      {r.status === 'interview-scheduled' && (
                        <>
                          <Button size="sm" variant="outline" className="text-green-600 border-green-300 hover:bg-green-50" onClick={() => handleAction(r.id, 'approved')}>
                            <Check className="w-3 h-3 mr-1" /> Approve
                          </Button>
                          <Button size="sm" variant="outline" className="text-red-600 border-red-300 hover:bg-red-50" onClick={() => handleAction(r.id, 'rejected')}>
                            <X className="w-3 h-3 mr-1" /> Reject
                          </Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Application Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Add Employment Application</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2 max-h-[60vh] overflow-y-auto pr-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>Full Name</Label>
                <Input value={form.applicantName} onChange={e => setForm(f => ({ ...f, applicantName: e.target.value }))} placeholder="Applicant name" />
              </div>
              <div className="grid gap-2">
                <Label>Email</Label>
                <Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="email@example.com" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>Phone</Label>
                <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+233 XX XXX XXXX" />
              </div>
              <div className="grid gap-2">
                <Label>Position Applied For</Label>
                <Input value={form.position} onChange={e => setForm(f => ({ ...f, position: e.target.value }))} placeholder="e.g. Receptionist" />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Years of Experience</Label>
              <Input value={form.experience} onChange={e => setForm(f => ({ ...f, experience: e.target.value }))} placeholder="e.g. 3 years in hospitality" />
            </div>
            <div className="grid gap-2">
              <Label>Key Skills</Label>
              <Input value={form.skills} onChange={e => setForm(f => ({ ...f, skills: e.target.value }))} placeholder="e.g. Customer service, MS Office, French" />
            </div>
            <div className="grid gap-2">
              <Label>Cover Letter / Statement</Label>
              <Textarea value={form.coverLetter} onChange={e => setForm(f => ({ ...f, coverLetter: e.target.value }))} rows={4} placeholder="Why should we hire you?" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Submit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Full Application Dialog */}
      <Dialog open={!!viewRecord} onOpenChange={() => setViewRecord(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Application — {viewRecord?.applicantName}</DialogTitle>
          </DialogHeader>
          {viewRecord && (
            <div className="space-y-4 py-2 max-h-[60vh] overflow-y-auto pr-1">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">Email: </span>{viewRecord.email}</div>
                <div><span className="text-muted-foreground">Phone: </span>{viewRecord.phone || '—'}</div>
                <div><span className="text-muted-foreground">Position: </span>{viewRecord.position}</div>
                <div><span className="text-muted-foreground">Status: </span><StatusBadge status={viewRecord.status} /></div>
              </div>
              {viewRecord.experience && (
                <div>
                  <p className="text-sm font-medium mb-1">Experience</p>
                  <p className="text-sm bg-muted rounded-lg p-3">{viewRecord.experience}</p>
                </div>
              )}
              {viewRecord.skills && (
                <div>
                  <p className="text-sm font-medium mb-1">Skills</p>
                  <p className="text-sm bg-muted rounded-lg p-3">{viewRecord.skills}</p>
                </div>
              )}
              <div>
                <p className="text-sm font-medium mb-1">Cover Letter</p>
                <p className="text-sm bg-muted rounded-lg p-3 whitespace-pre-wrap">{viewRecord.coverLetter}</p>
              </div>
              {viewRecord.notes && (
                <div>
                  <p className="text-sm font-medium mb-1">Internal Notes</p>
                  <p className="text-sm bg-muted rounded-lg p-3">{viewRecord.notes}</p>
                </div>
              )}
              <p className="text-xs text-muted-foreground">Submitted: {new Date(viewRecord.createdAt).toLocaleString()}</p>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setViewRecord(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── Revenue Report Tab (admin view) ─────────────────────────────────────────

function formatGHS(amount: number) {
  return `GHS ${amount.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function RevStatusBadge({ status }: { status: string }) {
  if (status === 'reviewed') return <Badge className="bg-green-100 text-green-800 border-green-200 text-xs">Reviewed</Badge>
  if (status === 'submitted') return <Badge className="bg-blue-100 text-blue-800 border-blue-200 text-xs">Submitted</Badge>
  if (status === 'draft') return <Badge variant="outline" className="text-muted-foreground text-xs">Draft</Badge>
  return null
}

function StaffRevenueRow({
  report,
  onReview,
  onLiveData,
}: {
  report: WeeklyRevenueReport
  onReview: (r: WeeklyRevenueReport) => void
  onLiveData: (id: string, count: number, revenue: number) => void
}) {
  const [open, setOpen] = useState(false)
  const [bookings, setBookings] = useState<BookingSummary[]>([])
  const [loadingBks, setLoadingBks] = useState(false)
  const [liveCount, setLiveCount] = useState<number>(report.bookingCount)
  const [liveRevenue, setLiveRevenue] = useState<number>(report.totalRevenue)

  const loadBks = useCallback(async () => {
    setLoadingBks(true)
    try {
      const { bookings: bks } = await fetchBookingsForStaffWeek(report.staffId, report.weekStart, report.weekEnd)
      const count = bks.length
      const revenue = bks.reduce((s, b) => s + b.totalPrice, 0)
      setBookings(bks)
      setLiveCount(count)
      setLiveRevenue(revenue)
      onLiveData(report.id, count, revenue)
    } catch { /* silent */ } finally { setLoadingBks(false) }
  }, [report.staffId, report.weekStart, report.weekEnd, report.id, onLiveData])

  // Load bookings eagerly so header count/revenue is always accurate
  useEffect(() => { loadBks() }, [loadBks])

  const handleOpen = (v: boolean) => { setOpen(v) }

  return (
    <Collapsible open={open} onOpenChange={handleOpen}>
      <div className="border rounded-lg overflow-hidden">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/40 transition-colors text-left"
          >
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                <span className="text-xs font-bold text-primary">{report.staffName.charAt(0).toUpperCase()}</span>
              </div>
              <span className="font-medium text-sm truncate">{report.staffName}</span>
              <RevStatusBadge status={report.status} />
            </div>
            <div className="flex items-center gap-4 flex-shrink-0">
              <span className="text-xs text-muted-foreground hidden sm:block">{liveCount} booking{liveCount !== 1 ? 's' : ''}</span>
              <span className="font-semibold text-sm">{formatGHS(liveRevenue)}</span>
              {report.status === 'submitted' && (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs h-7"
                  onClick={(e) => { e.stopPropagation(); onReview({ ...report, bookingCount: liveCount, totalRevenue: liveRevenue }) }}
                >
                  <CheckCircle className="w-3 h-3 mr-1" /> Review
                </Button>
              )}
              <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
            </div>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-t px-4 py-3 bg-muted/20 space-y-2">
            {report.notes && (
              <p className="text-xs text-muted-foreground"><span className="font-medium">Staff notes:</span> {report.notes}</p>
            )}
            {report.adminNotes && (
              <p className="text-xs text-green-700 bg-green-50 rounded px-2 py-1"><span className="font-medium">Admin feedback:</span> {report.adminNotes}</p>
            )}
            {loadingBks ? (
              <div className="flex items-center gap-2 py-3 text-muted-foreground text-xs"><Loader2 className="w-3 h-3 animate-spin" /> Loading…</div>
            ) : bookings.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">No bookings for this week.</p>
            ) : (
              <div className="overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Booking</TableHead>
                      <TableHead className="text-xs">Guest</TableHead>
                      <TableHead className="text-xs">Room</TableHead>
                      <TableHead className="text-xs">Check-in</TableHead>
                      <TableHead className="text-xs">Check-out</TableHead>
                      <TableHead className="text-xs text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bookings.map((b) => (
                      <TableRow key={b.id}>
                        <TableCell className="font-mono text-xs">{b.id.slice(0, 8)}…</TableCell>
                        <TableCell className="text-xs">{b.guestName}</TableCell>
                        <TableCell className="text-xs">{b.roomNumber}</TableCell>
                        <TableCell className="text-xs">{b.checkIn}</TableCell>
                        <TableCell className="text-xs">{b.checkOut}</TableCell>
                        <TableCell className="text-xs text-right font-medium">{formatGHS(b.totalPrice)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}

function RevenueReportTab() {
  const [selectedWeek, setSelectedWeek] = useState<WeekBounds>(() => getWeekBounds())
  const [weekOptions] = useState<WeekBounds[]>(() => getPastWeeksBounds(12))
  const [reports, setReports] = useState<WeeklyRevenueReport[]>([])
  const [loading, setLoading] = useState(false)
  const [reviewTarget, setReviewTarget] = useState<WeeklyRevenueReport | null>(null)
  const [adminNotes, setAdminNotes] = useState('')
  const [reviewing, setReviewing] = useState(false)
  const [liveData, setLiveData] = useState<Record<string, { count: number; revenue: number }>>({})

  const handleLiveData = useCallback((id: string, count: number, revenue: number) => {
    setLiveData(prev => ({ ...prev, [id]: { count, revenue } }))
  }, [])

  const loadReports = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getAllStaffReportsForWeek(selectedWeek.weekStart)
      setReports(data)
    } catch (e) {
      console.error('[RevenueReportTab] loadReports error:', e)
      toast.error(`Revenue error: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setLoading(false)
    }
  }, [selectedWeek.weekStart])

  useEffect(() => {
    setLiveData({})
    loadReports()
  }, [loadReports])

  const handleReview = async () => {
    if (!reviewTarget) return
    setReviewing(true)
    try {
      await reviewWeekReport(reviewTarget.id, adminNotes, 'Admin')
      toast.success(`Reviewed ${reviewTarget.staffName}'s report`)
      setReviewTarget(null)
      setAdminNotes('')
      loadReports()
    } catch {
      toast.error('Failed to submit review')
    } finally {
      setReviewing(false)
    }
  }

  const totalRevenue = reports.reduce((s, r) => s + (liveData[r.id]?.revenue ?? r.totalRevenue), 0)
  const totalBookings = reports.reduce((s, r) => s + (liveData[r.id]?.count ?? r.bookingCount), 0)
  const submittedCount = reports.filter((r) => r.status === 'submitted' || r.status === 'reviewed').length

  return (
    <div className="space-y-4">
      {/* Week selector */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h2 className="text-lg font-semibold flex items-center gap-2"><TrendingUp className="w-5 h-5 text-primary" /> Staff Revenue Reports</h2>
        <Select
          value={selectedWeek.weekStart}
          onValueChange={(v) => {
            const found = weekOptions.find((w) => w.weekStart === v)
            if (found) setSelectedWeek(found)
          }}
        >
          <SelectTrigger className="w-56">
            <SelectValue placeholder="Select week" />
          </SelectTrigger>
          <SelectContent>
            {weekOptions.map((w) => (
              <SelectItem key={w.weekStart} value={w.weekStart}>{w.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-card border rounded-xl p-4 flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-lg"><TrendingUp className="w-5 h-5 text-primary" /></div>
          <div>
            <p className="text-xs text-muted-foreground">Total Revenue</p>
            <p className="text-lg font-bold">{formatGHS(totalRevenue)}</p>
          </div>
        </div>
        <div className="bg-card border rounded-xl p-4 flex items-center gap-3">
          <div className="p-2 bg-blue-100 rounded-lg"><BookOpen className="w-5 h-5 text-blue-600" /></div>
          <div>
            <p className="text-xs text-muted-foreground">Total Bookings</p>
            <p className="text-lg font-bold">{totalBookings}</p>
          </div>
        </div>
        <div className="bg-card border rounded-xl p-4 flex items-center gap-3">
          <div className="p-2 bg-green-100 rounded-lg"><CheckCircle className="w-5 h-5 text-green-600" /></div>
          <div>
            <p className="text-xs text-muted-foreground">Submitted</p>
            <p className="text-lg font-bold">{submittedCount}</p>
          </div>
        </div>
      </div>

      {/* Staff list */}
      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : reports.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">No revenue reports found for this week.</div>
      ) : (
        <div className="space-y-2">
          {reports.map((r) => (
            <StaffRevenueRow key={r.id} report={r} onReview={setReviewTarget} onLiveData={handleLiveData} />
          ))}
        </div>
      )}

      {/* Review dialog */}
      <Dialog open={!!reviewTarget} onOpenChange={(v) => { if (!v) { setReviewTarget(null); setAdminNotes('') } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Review Report</DialogTitle></DialogHeader>
          {reviewTarget && (
            <div className="space-y-4 py-2">
              <div className="bg-muted/40 rounded-lg p-4 space-y-1 text-sm">
                <p><span className="font-medium">Staff:</span> {reviewTarget.staffName}</p>
                <p><span className="font-medium">Week:</span> {reviewTarget.weekStart} → {reviewTarget.weekEnd}</p>
                <p><span className="font-medium">Revenue:</span> {formatGHS(reviewTarget.totalRevenue)}</p>
                <p><span className="font-medium">Bookings:</span> {reviewTarget.bookingCount}</p>
                {reviewTarget.notes && <p><span className="font-medium">Staff notes:</span> {reviewTarget.notes}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>Feedback (optional)</Label>
                <Textarea
                  placeholder="Leave feedback for this staff member…"
                  value={adminNotes}
                  onChange={(e) => setAdminNotes(e.target.value)}
                  rows={3}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setReviewTarget(null); setAdminNotes('') }} disabled={reviewing}>Cancel</Button>
            <Button onClick={handleReview} disabled={reviewing} className="gap-2">
              {reviewing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
              Mark as Reviewed
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
