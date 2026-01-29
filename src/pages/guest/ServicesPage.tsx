import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { Label } from '../../components/ui/label'
import { Textarea } from '../../components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select'
import { BellRing, Car, Utensils, Hammer, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { RequestHistory, ServiceRequest } from '../../components/guest/RequestHistory'

export function ServicesPage() {
    const { token } = useParams<{ token: string }>()
    const [loading, setLoading] = useState(false)
    const [type, setType] = useState<string>('')
    const [details, setDetails] = useState('')
    const [requests, setRequests] = useState<ServiceRequest[]>([])
    const [fetchingHistory, setFetchingHistory] = useState(true)

    const fetchHistory = async () => {
        if (!token) return
        try {
            const res = await fetch(`/.netlify/functions/get-guest-requests?token=${token}`)
            const data = await res.json()
            if (data.success) {
                setRequests(data.requests)
            }
        } catch (error) {
            console.error("Failed to fetch history", error)
        } finally {
            setFetchingHistory(false)
        }
    }

    useEffect(() => {
        fetchHistory()
    }, [token])

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()

        if (!token) {
            toast.error("Invalid session. Please scan QR code again.")
            return
        }

        if (!type) {
            toast.error("Please select a service type")
            return
        }

        setLoading(true)
        try {
            const res = await fetch('/.netlify/functions/submit-guest-request', {
                method: 'POST',
                body: JSON.stringify({ token, type, details })
            })

            const data = await res.json()

            if (res.ok && data.success) {
                toast.success("Request received! We'll be with you shortly.")
                setType('')
                setDetails('')
                fetchHistory()
            } else {
                toast.error(data.error || "Failed to submit request")
            }

        } catch (err) {
            console.error(err)
            toast.error("Network error. Please try again.")
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="space-y-6 pb-20 animate-fade-in">
            <div>
                <h2 className="text-2xl font-bold">Guest Services</h2>
                <p className="text-muted-foreground">How can we make your stay better?</p>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-6">
                <ServiceCard
                    icon={<BellRing className="w-5 h-5 text-blue-600" />}
                    label="Housekeeping"
                    active={type === 'housekeeping'}
                    onClick={() => setType('housekeeping')}
                />
                <ServiceCard
                    icon={<Car className="w-5 h-5 text-green-600" />}
                    label="Transport"
                    active={type === 'transport'}
                    onClick={() => setType('transport')}
                />
                <ServiceCard
                    icon={<Utensils className="w-5 h-5 text-orange-600" />}
                    label="In-Room Dining"
                    active={type === 'food'}
                    onClick={() => setType('food')}
                />
                <ServiceCard
                    icon={<Hammer className="w-5 h-5 text-red-600" />}
                    label="Report Issue"
                    active={type === 'problem'}
                    onClick={() => setType('problem')}
                />
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Request Form</CardTitle>
                    <CardDescription>
                        {type ? `New ${type.replace('_', ' ')} request` : 'Select a category above'}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        {!['housekeeping', 'transport', 'food', 'problem'].includes(type) && type !== '' && (
                            <div className="space-y-2">
                                <Label>Service Type</Label>
                                <Select value={type} onValueChange={setType}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select type..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="amenity">Amenity Request</SelectItem>
                                        <SelectItem value="other">Other</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        )}

                        <div className="space-y-2">
                            <Label htmlFor="details">Details / Special Instructions</Label>
                            <Textarea
                                id="details"
                                placeholder={getPlaceholder(type)}
                                className="min-h-[100px]"
                                value={details}
                                onChange={(e) => setDetails(e.target.value)}
                                required
                            />
                        </div>

                        <Button type="submit" className="w-full" size="lg" disabled={loading || !type}>
                            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                            Submit Request
                        </Button>
                    </form>
                </CardContent>
            </Card>

            <RequestHistory requests={requests} loading={fetchingHistory} />
        </div>
    )
}

function ServiceCard({ icon, label, active, onClick }: any) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`flex flex-col items-center justify-center p-4 rounded-xl border transition-all duration-200
                ${active
                    ? 'border-primary bg-primary/5 shadow-md scale-[1.02]'
                    : 'border-border bg-card hover:bg-accent hover:border-accent-foreground/20'
                }
            `}
        >
            <div className={`p-2 rounded-full mb-2 ${active ? 'bg-primary/20' : 'bg-muted'}`}>
                {icon}
            </div>
            <span className={`text-sm font-medium ${active ? 'text-primary' : 'text-foreground'}`}>
                {label}
            </span>
        </button>
    )
}

function getPlaceholder(type: string) {
    switch (type) {
        case 'housekeeping': return "e.g. Extra towels, clean room now..."
        case 'transport': return "e.g. Taxi to airport at 5pm..."
        case 'food': return "e.g. Burger and fries, Room 101..."
        case 'problem': return "e.g. AC not working, leaking tap..."
        default: return "How can we help?"
    }
}
