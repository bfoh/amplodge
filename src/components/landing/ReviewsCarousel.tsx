
import { useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from '@/components/ui/carousel'
import { Star, User } from 'lucide-react'
import { blink } from '@/blink/client'
import { formatDistanceToNow } from 'date-fns'

interface Review {
    id: string
    guestId: string
    rating: number
    comment: string
    createdAt: string
    isFeatured: boolean
    status: string
}

interface Guest {
    id: string
    name: string
}

export function ReviewsCarousel() {
    const [reviews, setReviews] = useState<Review[]>([])
    const [guests, setGuests] = useState<Record<string, Guest>>({})
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        const loadReviews = async () => {
            try {
                // Fetch approved reviews
                // Note: For best performance, we prioritize 'isFeatured' reviews if possible, 
                // but currently we just list all approved ones sorted by date.
                const allReviews = await blink.db.reviews.list({
                    where: { status: 'approved' },
                    orderBy: { createdAt: 'desc' },
                    limit: 10
                })

                if (!allReviews || allReviews.length === 0) {
                    setReviews([])
                    setLoading(false)
                    return
                }

                // Ideally, we prioritize featured reviews
                // Since we fetched recent ones, let's just use them. 
                // If we want featured on top, we'd need multiple queries or client-side sort if list is small.
                // Let's sort client-side: Featured first, then new
                const sorted = (allReviews as Review[]).sort((a, b) => {
                    if (a.isFeatured === b.isFeatured) {
                        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
                    }
                    return a.isFeatured ? -1 : 1
                })

                setReviews(sorted)

                // Fetch Guest Names
                const guestIds = Array.from(new Set(sorted.map(r => r.guestId)))
                if (guestIds.length > 0) {
                    // @ts-ignore
                    const guestList = await blink.db.guests.list({
                        where: { id: { in: guestIds } }
                    })
                    const guestMap: Record<string, Guest> = {}
                    guestList.forEach((g: any) => {
                        guestMap[g.id] = g
                    })
                    setGuests(guestMap)
                }

            } catch (err) {
                console.error('Failed to load reviews:', err)
            } finally {
                setLoading(false)
            }
        }

        loadReviews()
    }, [])

    if (loading || reviews.length === 0) {
        return null
    }

    return (
        <section className="py-20 bg-slate-50">
            <div className="container px-4 md:px-6 mx-auto">
                <div className="text-center max-w-3xl mx-auto mb-16">
                    <h2 className="text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl text-primary mb-4">
                        Guest Experiences
                    </h2>
                    <p className="text-muted-foreground text-lg">
                        See what our guests have to say about their stay at AMP Lodge.
                    </p>
                </div>

                <Carousel
                    opts={{
                        align: "start",
                        loop: true,
                    }}
                    className="w-full max-w-5xl mx-auto"
                >
                    <CarouselContent className="-ml-2 md:-ml-4">
                        {reviews.map((review) => (
                            <CarouselItem key={review.id} className="pl-2 md:pl-4 md:basis-1/2 lg:basis-1/3">
                                <div className="p-1 h-full">
                                    <Card className="h-full border-none shadow-md hover:shadow-lg transition-shadow duration-300">
                                        <CardContent className="p-6 flex flex-col h-full">
                                            <div className="flex mb-4">
                                                {[1, 2, 3, 4, 5].map((star) => (
                                                    <Star
                                                        key={star}
                                                        className={`w-4 h-4 ${star <= review.rating
                                                                ? "fill-yellow-400 text-yellow-400"
                                                                : "fill-gray-100 text-gray-100"
                                                            }`}
                                                    />
                                                ))}
                                            </div>

                                            <blockquote className="flex-1 text-muted-foreground italic mb-6 text-sm leading-relaxed">
                                                "{review.comment}"
                                            </blockquote>

                                            <div className="flex items-center mt-auto border-t pt-4">
                                                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center mr-3">
                                                    <User className="w-5 h-5 text-primary" />
                                                </div>
                                                <div>
                                                    <p className="font-semibold text-sm">
                                                        {guests[review.guestId]?.name || 'Verified Guest'}
                                                    </p>
                                                    <p className="text-xs text-muted-foreground">
                                                        {formatDistanceToNow(new Date(review.createdAt), { addSuffix: true })}
                                                    </p>
                                                </div>
                                            </div>
                                        </CardContent>
                                    </Card>
                                </div>
                            </CarouselItem>
                        ))}
                    </CarouselContent>
                    <CarouselPrevious className="hidden md:flex" />
                    <CarouselNext className="hidden md:flex" />
                </Carousel>
            </div>
        </section>
    )
}
