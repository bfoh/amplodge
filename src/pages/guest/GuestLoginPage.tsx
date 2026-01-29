import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { toast } from 'sonner'
import { Loader2, LogIn } from 'lucide-react'

export function GuestLoginPage() {
    const navigate = useNavigate()
    const [roomNumber, setRoomNumber] = useState('')
    const [firstName, setFirstName] = useState('')
    const [loading, setLoading] = useState(false)

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault()

        if (!roomNumber || !firstName) {
            toast.error("Please fill in all fields")
            return
        }

        setLoading(true)
        try {
            const res = await fetch('/.netlify/functions/guest-login', {
                method: 'POST',
                body: JSON.stringify({ roomNumber, firstName })
            })

            const data = await res.json()

            if (res.ok && data.success) {
                toast.success(`Welcome back, ${data.guestName}!`)
                // Redirect to the guest dashboard with the retrieved token
                navigate(`/guest/${data.token}`)
            } else {
                toast.error(data.error || "Login failed. Please check your details.")
            }

        } catch (err) {
            console.error("Login Error:", err)
            toast.error("Network error. Please try again.")
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
            <div className="w-full max-w-md space-y-8 animate-fade-in">
                <div className="text-center space-y-2">
                    <img src="/amp-logo.png" alt="AMP Lodge" className="h-16 w-auto mx-auto object-contain" />
                    <h1 className="text-2xl font-bold text-gray-900">Guest Portal</h1>
                    <p className="text-sm text-gray-600">Enter your room details to access services</p>
                </div>

                <Card className="border-t-4 border-t-primary shadow-lg">
                    <CardHeader>
                        <CardTitle>Sign In</CardTitle>
                        <CardDescription>
                            Please enter your Room Number and First Name found on your booking.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={handleLogin} className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="room">Room Number</Label>
                                <Input
                                    id="room"
                                    placeholder="e.g. 101"
                                    value={roomNumber}
                                    onChange={(e) => setRoomNumber(e.target.value)}
                                    className="h-11"
                                    required
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="firstname">First Name</Label>
                                <Input
                                    id="firstname"
                                    placeholder="e.g. John"
                                    value={firstName}
                                    onChange={(e) => setFirstName(e.target.value)}
                                    className="h-11"
                                    required
                                />
                            </div>
                            <Button type="submit" className="w-full h-11 text-base font-medium" disabled={loading}>
                                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LogIn className="mr-2 h-4 w-4" />}
                                Access Portal
                            </Button>
                        </form>
                    </CardContent>
                </Card>

                <p className="text-center text-xs text-gray-500">
                    Having trouble? Contact reception at +233 55 500 9697
                </p>
            </div>
        </div>
    )
}
