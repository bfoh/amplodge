import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Loader2, Copy, Check, RefreshCw, AlertCircle, Link as LinkIcon, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import { channelService } from '@/services/channel-service'
import { ChannelConnection, ChannelRoomMapping, RoomType } from '@/types'
import { blink } from '@/blink/client'

interface ChannelConnectDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    channelId: string
    channelName: string
    onUpdate: () => void
}

export function ChannelConnectDialog({ open, onOpenChange, channelId, channelName, onUpdate }: ChannelConnectDialogProps) {
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [connection, setConnection] = useState<ChannelConnection | null>(null)
    const [mappings, setMappings] = useState<ChannelRoomMapping[]>([])
    const [roomTypes, setRoomTypes] = useState<RoomType[]>([])
    const [activeTab, setActiveTab] = useState('settings')

    // Form states
    const [isActive, setIsActive] = useState(false)

    // Mapping form state
    const [selectedRoomTypeId, setSelectedRoomTypeId] = useState<string>('')
    const [importUrl, setImportUrl] = useState('')
    const [addingMapping, setAddingMapping] = useState(false)

    useEffect(() => {
        if (open) {
            loadData()
        }
    }, [open, channelId])

    const loadData = async () => {
        setLoading(true)
        try {
            // Load connection details
            let conn = await channelService.getConnection(channelId)

            // If no connection exists yet, we don't create it until they save, 
            // but we initialize state as if it's inactive
            if (!conn) {
                setIsActive(false)
            } else {
                setConnection(conn)
                setIsActive(conn.isActive)
            }

            // Load room types
            const db = blink.db as any
            const rt = await db.roomTypes.list()
            setRoomTypes(rt)

            // Load mappings if connection exists
            if (conn) {
                const map = await channelService.getMappings(conn.id)
                setMappings(map)
            } else {
                setMappings([])
            }

        } catch (error) {
            console.error('Failed to load channel data:', error)
            toast.error('Failed to load channel details')
        } finally {
            setLoading(false)
        }
    }

    const handleSaveConnection = async () => {
        setSaving(true)
        try {
            // Use toggleConnection which handles create/update
            const updated = await channelService.toggleConnection(channelId, isActive)
            setConnection(updated)
            toast.success(`Channel ${isActive ? 'enabled' : 'disabled'} successfully`)
            onUpdate()
        } catch (error) {
            console.error('Failed to save connection:', error)
            toast.error('Failed to save connection settings')
        } finally {
            setSaving(false)
        }
    }

    const handleAddMapping = async () => {
        if (!connection) {
            toast.error('Please enable the channel first')
            return
        }
        if (!selectedRoomTypeId) {
            toast.error('Please select a room type')
            return
        }

        setAddingMapping(true)
        try {
            await channelService.createMapping({
                channelConnectionId: connection.id,
                localRoomTypeId: selectedRoomTypeId,
                importUrl: importUrl.trim() || undefined,
                syncStatus: 'pending'
            })

            toast.success('Room mapping added')

            // Refresh mappings
            const map = await channelService.getMappings(connection.id)
            setMappings(map)

            // Reset form
            setSelectedRoomTypeId('')
            setImportUrl('')

        } catch (error) {
            console.error('Failed to add mapping:', error)
            toast.error('Failed to add room mapping')
        } finally {
            setAddingMapping(false)
        }
    }

    const handleDeleteMapping = async (id: string) => {
        if (!confirm('Are you sure you want to remove this mapping? Sync will stop for this room type.')) return

        try {
            await channelService.deleteMapping(id)
            toast.success('Mapping removed')
            const map = await channelService.getMappings(connection!.id)
            setMappings(map)
        } catch (error) {
            console.error('Failed to delete mapping:', error)
            toast.error('Failed to remove mapping')
        }
    }

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text)
        toast.success('Copied to clipboard')
    }

    const getExportUrl = (mapping: ChannelRoomMapping) => {
        return `${window.location.origin}/.netlify/functions/export-ical?token=${mapping.exportToken}`
    }

    const getRoomTypeName = (id: string) => {
        return roomTypes.find(r => r.id === id)?.name || 'Unknown Room'
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        {channelName} Integration
                        {connection?.isActive && <Badge variant="default" className="bg-emerald-500 hover:bg-emerald-600">Active</Badge>}
                    </DialogTitle>
                    <DialogDescription>
                        Configure synchronization settings for {channelName}
                    </DialogDescription>
                </DialogHeader>

                {loading ? (
                    <div className="flex justify-center py-8">
                        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                    </div>
                ) : (
                    <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-4">
                        <TabsList className="grid w-full grid-cols-2">
                            <TabsTrigger value="settings">General Settings</TabsTrigger>
                            <TabsTrigger value="mappings" disabled={!connection}>Room Mappings</TabsTrigger>
                        </TabsList>

                        <TabsContent value="settings" className="space-y-6 py-4">
                            <div className="flex items-center justify-between p-4 border rounded-lg bg-card">
                                <div className="space-y-0.5">
                                    <Label className="text-base">Enable {channelName}</Label>
                                    <p className="text-sm text-muted-foreground">
                                        Allow synchronization with this channel
                                    </p>
                                </div>
                                <Switch
                                    checked={isActive}
                                    onCheckedChange={setIsActive}
                                />
                            </div>

                            <div className="flex justify-end">
                                <Button onClick={handleSaveConnection} disabled={saving}>
                                    {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                                    Save Changes
                                </Button>
                            </div>
                        </TabsContent>

                        <TabsContent value="mappings" className="space-y-6 py-4">
                            {!connection?.isActive && (
                                <div className="p-4 bg-amber-50 text-amber-800 rounded-lg flex items-center gap-2 text-sm">
                                    <AlertCircle className="w-4 h-4" />
                                    Please enable the channel first to manage mappings.
                                </div>
                            )}

                            {/* Existing Mappings */}
                            <div className="space-y-4">
                                <h3 className="text-sm font-medium text-muted-foreground">Active Mappings ({mappings.length})</h3>

                                {mappings.length === 0 ? (
                                    <div className="text-center py-8 border-2 border-dashed rounded-lg text-muted-foreground text-sm">
                                        No rooms mapped yet. Add a mapping below.
                                    </div>
                                ) : (
                                    mappings.map(mapping => (
                                        <div key={mapping.id} className="border rounded-lg p-4 space-y-4">
                                            <div className="flex justify-between items-start">
                                                <div>
                                                    <h4 className="font-semibold">{getRoomTypeName(mapping.localRoomTypeId)}</h4>
                                                    <div className="flex items-center gap-2 mt-1">
                                                        <Badge variant={mapping.syncStatus === 'success' ? 'outline' : 'secondary'} className={mapping.syncStatus === 'success' ? 'border-emerald-500 text-emerald-600' : ''}>
                                                            {mapping.syncStatus === 'success' ? 'Synced' : mapping.syncStatus}
                                                        </Badge>
                                                        {mapping.lastSyncedAt && (
                                                            <span className="text-xs text-muted-foreground">
                                                                Last sync: {new Date(mapping.lastSyncedAt).toLocaleString()}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                                <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => handleDeleteMapping(mapping.id)}>
                                                    Remove
                                                </Button>
                                            </div>

                                            <div className="grid gap-4 md:grid-cols-2">
                                                <div className="space-y-2">
                                                    <Label className="text-xs font-semibold text-muted-foreground uppercase">Import URL (From {channelName})</Label>
                                                    <div className="flex gap-2">
                                                        <Input value={mapping.importUrl || ''} readOnly className="text-sm bg-muted/50" placeholder="Not configured" />
                                                    </div>
                                                </div>
                                                <div className="space-y-2">
                                                    <Label className="text-xs font-semibold text-muted-foreground uppercase">Export URL (To {channelName})</Label>
                                                    <div className="flex gap-2">
                                                        <Input value={getExportUrl(mapping)} readOnly className="text-sm font-mono bg-muted/50" />
                                                        <Button variant="outline" size="icon" onClick={() => copyToClipboard(getExportUrl(mapping))}>
                                                            <Copy className="w-4 h-4" />
                                                        </Button>
                                                    </div>
                                                    <p className="text-[10px] text-muted-foreground">
                                                        Paste this URL into {channelName}'s "Import Calendar" setting.
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>

                            <div className="border-t pt-6">
                                <h3 className="font-medium mb-4">Add New Mapping</h3>
                                <div className="grid gap-4 p-4 bg-muted/30 rounded-lg">
                                    <div className="space-y-2">
                                        <Label>Room Type</Label>
                                        <Select value={selectedRoomTypeId} onValueChange={setSelectedRoomTypeId}>
                                            <SelectTrigger>
                                                <SelectValue placeholder="Select a room type to map" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {roomTypes
                                                    .filter(rt => !mappings.some(m => m.localRoomTypeId === rt.id)) // Filter out already mapped
                                                    .map(rt => (
                                                        <SelectItem key={rt.id} value={rt.id}>{rt.name}</SelectItem>
                                                    ))
                                                }
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Import URL (Optional)</Label>
                                        <Input
                                            placeholder={`Paste ${channelName} iCal export URL here...`}
                                            value={importUrl}
                                            onChange={(e) => setImportUrl(e.target.value)}
                                        />
                                        <p className="text-xs text-muted-foreground">
                                            If provided, we will import bookings from this URL to block your calendar.
                                        </p>
                                    </div>
                                    <Button onClick={handleAddMapping} disabled={!selectedRoomTypeId || addingMapping} className="w-full sm:w-auto">
                                        {addingMapping ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <LinkIcon className="w-4 h-4 mr-2" />}
                                        Create Mapping
                                    </Button>
                                </div>
                            </div>
                        </TabsContent>
                    </Tabs>
                )}

                <DialogFooter className="sm:justify-start">
                    {/* Footer content if needed */}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
