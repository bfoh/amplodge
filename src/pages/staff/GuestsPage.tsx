import { useEffect, useState } from 'react'
import { Card, CardContent } from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '../../components/ui/dialog'
import { Plus, Users, Mail, Phone, Search, MoreVertical, Pencil, Trash2 } from 'lucide-react'
import { blink } from '../../blink/client'
import { activityLogService } from '@/services/activity-log-service'
import { toast } from 'sonner'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '../../components/ui/dropdown-menu'

export function GuestsPage() {
  const [guests, setGuests] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    address: '',
    country: '',
    notes: ''
  })

  useEffect(() => {
    loadGuests()
  }, [])

  const loadGuests = async () => {
    try {
      const user = await blink.auth.me()
      const data = await blink.db.guests.list({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' }
      })
      setGuests(data)
    } catch (error) {
      console.error('Failed to load guests:', error)
      toast.error('Failed to load guests')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const user = await blink.auth.me()
      if (editingId) {
        const oldGuest = guests.find(g => g.id === editingId)
        await blink.db.guests.update(editingId, {
          ...formData,
          userId: user.id,
          updatedAt: new Date().toISOString()
        })
        // Log activity
        await activityLogService.logGuestUpdated(editingId, {
          name: { old: oldGuest?.name, new: formData.name },
          email: { old: oldGuest?.email, new: formData.email },
          phone: { old: oldGuest?.phone, new: formData.phone },
        }, user.id).catch(err => console.error('Failed to log guest update:', err))
        toast.success('Guest updated')
      } else {
        const newGuestId = `guest_${Date.now()}`
        await blink.db.guests.create({
          id: newGuestId,
          userId: user.id,
          ...formData,
          totalBookings: 0,
          totalRevenue: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        })
        // Log activity
        await activityLogService.logGuestCreated(newGuestId, formData, user.id)
          .catch(err => console.error('Failed to log guest creation:', err))
        toast.success('Guest added successfully')
      }
      setDialogOpen(false)
      setEditingId(null)
      setFormData({ name: '', email: '', phone: '', address: '', country: '', notes: '' })
      loadGuests()
    } catch (error) {
      console.error('Failed to save guest:', error)
      toast.error('Failed to save guest')
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this guest?')) return
    try {
      const user = await blink.auth.me()
      const guest = guests.find(g => g.id === id)
      await blink.db.guests.delete(id)
      // Log activity
      await activityLogService.logGuestDeleted(id, guest?.name || 'Unknown Guest', user.id)
        .catch(err => console.error('Failed to log guest deletion:', err))
      toast.success('Guest deleted')
      loadGuests()
    } catch (error) {
      console.error('Failed to delete guest:', error)
      toast.error('Failed to delete guest')
    }
  }

  const filteredGuests = guests.filter((guest: any) =>
    guest.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    guest.email?.toLowerCase().includes(searchTerm.toLowerCase())
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold">Guests</h2>
          <p className="text-muted-foreground mt-1">Manage your guest database</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => {
              setEditingId(null)
              setFormData({ name: '', email: '', phone: '', address: '', country: '', notes: '' })
            }}>
              <Plus className="w-4 h-4 mr-2" />
              Add Guest
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingId ? 'Edit Guest' : 'Add New Guest'}</DialogTitle>
              <DialogDescription>Enter guest information</DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Full Name*</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone">Phone</Label>
                  <Input
                    id="phone"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="address">Address</Label>
                <Input
                  id="address"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="country">Country</Label>
                <Input
                  id="country"
                  value={formData.country}
                  onChange={(e) => setFormData({ ...formData, country: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="notes">Notes</Label>
                <textarea
                  id="notes"
                  className="w-full px-3 py-2 border rounded-md min-h-[80px]"
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                />
              </div>
              <div className="flex justify-end gap-3">
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit">{editingId ? 'Save Changes' : 'Add Guest'}</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search guests by name or email..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-9"
        />
      </div>

      {filteredGuests.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Users className="w-16 h-16 text-muted-foreground mb-4 opacity-50" />
            <h3 className="text-xl font-semibold mb-2">No Guests Found</h3>
            <p className="text-muted-foreground text-center mb-6 max-w-md">
              {searchTerm ? 'Try adjusting your search' : 'Add your first guest to the database'}
            </p>
            {!searchTerm && (
              <Button onClick={() => setDialogOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Add First Guest
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredGuests.map((guest: any) => (
            <Card key={guest.id} className="hover:shadow-lg transition-shadow">
              <CardContent className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                    <Users className="w-6 h-6 text-primary" />
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => {
                        setEditingId(guest.id)
                        setFormData({
                          name: guest.name || '',
                          email: guest.email || '',
                          phone: guest.phone || '',
                          address: guest.address || '',
                          country: guest.country || '',
                          notes: guest.notes || ''
                        })
                        setDialogOpen(true)
                      }}>
                        <Pencil className="h-4 w-4 mr-2" />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => handleDelete(guest.id)}
                        className="text-destructive"
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <h3 className="font-semibold text-lg mb-3">{guest.name}</h3>
                <div className="space-y-2 text-sm text-muted-foreground">
                  {guest.email && (
                    <div className="flex items-center gap-2">
                      <Mail className="w-4 h-4 flex-shrink-0" />
                      <span className="truncate">{guest.email}</span>
                    </div>
                  )}
                  {guest.phone && (
                    <div className="flex items-center gap-2">
                      <Phone className="w-4 h-4 flex-shrink-0" />
                      <span>{guest.phone}</span>
                    </div>
                  )}
                </div>
                <div className="mt-4 pt-4 border-t grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">Bookings</p>
                    <p className="font-semibold">{guest.totalBookings || 0}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Revenue</p>
                    <p className="font-semibold">${Number(guest.totalRevenue || 0).toFixed(2)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
