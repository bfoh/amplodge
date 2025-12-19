
import { useState, useEffect } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Star, Loader2, Home, CheckCircle } from 'lucide-react'
import { toast } from '@/hooks/use-toast'

interface BookingDetails {
    guestName: string
    roomType: string
    checkIn: string
    checkOut: string
    alreadyReviewed: boolean
}

export function ReviewSubmissionPage() {
    const [searchParams] = useSearchParams()
    const bookingId = searchParams.get('bookingId')

    const [rating, setRating] = useState(0)
    const [hoverRating, setHoverRating] = useState(0)
    const [comment, setComment] = useState('')
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [loading, setLoading] = useState(true)
    const [details, setDetails] = useState<BookingDetails | null>(null)
    const [error, setError] = useState('')
    const [submitted, setSubmitted] = useState(false)

    useEffect(() => {
        if (!bookingId) {
            setLoading(false)
            setError('Invalid link. Please use the link sent to your email.')
            return
        }

        const fetchDetails = async () => {
            try {
                const res = await fetch(`/.netlify/functions/get-booking-details?bookingId=${bookingId}`)
                if (!res.ok) throw new Error('Booking not found')
                const data = await res.json()

                if (data.alreadyReviewed) {
                    setSubmitted(true)
                    setDetails(data)
                } else {
                    setDetails(data)
                }
            } catch (err) {
                setError('Could not verify booking details. Please try again.')
            } finally {
                setLoading(false)
            }
        }

        fetchDetails()
    }, [bookingId])

    const handleSubmit = async () => {
        if (rating === 0) {
            toast({ title: 'Please select a rating', variant: 'destructive' })
            return
        }

        setIsSubmitting(true)
        try {
            const res = await fetch('/.netlify/functions/submit-review', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    bookingId,
                    rating,
                    comment
                })
            })

            if (!res.ok) {
                const err = await res.json()
                throw new Error(err.error || 'Submission failed')
            }

            setSubmitted(true)
            toast({ title: 'Thank you!', description: 'Your review has been submitted.' })
        } catch (err: any) {
            toast({ title: 'Error', description: err.message, variant: 'destructive' })
        } finally {
            setIsSubmitting(false)
        }
    }

    if (loading) {
        return (
            <div className="flex h-screen items-center justify-center bg-gray-50">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
        )
    }

    if (error) {
        return (
            <div className="flex h-screen items-center justify-center bg-gray-50 p-4">
                <Card className="w-full max-w-md text-center">
                    <CardHeader>
                        <CardTitle className="text-red-600">Error</CardTitle>
                        <CardDescription>{error}</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Link to="/">
                            <Button>Go to Home</Button>
                        </Link>
                    </CardContent>
                </Card>
            </div>
        )
    }

    if (submitted) {
        return (
            <div className="flex h-screen items-center justify-center bg-gray-50 p-4 animate-fade-in">
                <Card className="w-full max-w-md text-center">
                    <CardContent className="pt-6">
                        <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4">
                            <CheckCircle className="w-8 h-8" />
                        </div>
                        <h2 className="text-2xl font-bold mb-2">Thank You!</h2>
                        <p className="text-muted-foreground mb-6">
                            Your feedback helps us improve. We appreciate your time, {details?.guestName}.
                        </p>
                        <Link to="/">
                            <Button variant="outline" className="gap-2">
                                <Home className="w-4 h-4" />
                                Return Home
                            </Button>
                        </Link>
                    </CardContent>
                </Card>
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
            <Card className="w-full max-w-lg shadow-xl">
                <CardHeader className="text-center border-b bg-primary/5 pb-8">
                    <h1 className="text-2xl font-bold text-primary mb-2">How was your stay?</h1>
                    <p className="text-muted-foreground">
                        Hi {details?.guestName}, we hope you enjoyed your stay in our {details?.roomType}.
                    </p>
                </CardHeader>
                <CardContent className="pt-8 space-y-8">

                    <div className="flex flex-col items-center gap-4">
                        <label className="text-sm font-medium text-gray-700">Rate your experience</label>
                        <div className="flex gap-2">
                            {[1, 2, 3, 4, 5].map((star) => (
                                <button
                                    key={star}
                                    type="button"
                                    className="transition-transform hover:scale-110 focus:outline-none"
                                    onMouseEnter={() => setHoverRating(star)}
                                    onMouseLeave={() => setHoverRating(0)}
                                    onClick={() => setRating(star)}
                                >
                                    <Star
                                        className={`w-10 h-10 transition-colors ${star <= (hoverRating || rating)
                                                ? 'fill-yellow-400 text-yellow-400 drop-shadow-sm'
                                                : 'fill-gray-100 text-gray-200'
                                            }`}
                                    />
                                </button>
                            ))}
                        </div>
                        <p className="text-sm font-medium text-primary h-5">
                            {hoverRating === 1 || rating === 1 ? 'Poor' :
                                hoverRating === 2 || rating === 2 ? 'Fair' :
                                    hoverRating === 3 || rating === 3 ? 'Good' :
                                        hoverRating === 4 || rating === 4 ? 'Very Good' :
                                            hoverRating === 5 || rating === 5 ? 'Excellent' : ''}
                        </p>
                    </div>

                    <div className="space-y-3">
                        <label className="text-sm font-medium text-gray-700">Share your thoughts (optional)</label>
                        <Textarea
                            placeholder="What did you like best? How can we improve?"
                            className="resize-none h-32"
                            value={comment}
                            onChange={(e) => setComment(e.target.value)}
                        />
                    </div>

                    <Button
                        className="w-full text-lg py-6"
                        onClick={handleSubmit}
                        disabled={isSubmitting || rating === 0}
                    >
                        {isSubmitting ? (
                            <>
                                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                                Submitting...
                            </>
                        ) : (
                            'Submit Review'
                        )}
                    </Button>

                </CardContent>
            </Card>
        </div>
    )
}
