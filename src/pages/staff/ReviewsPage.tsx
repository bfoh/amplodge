
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Loader2, Check, X, Star, Trash2 } from 'lucide-react'
import { blink } from '@/blink/client'
import { toast } from '@/hooks/use-toast'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { format } from 'date-fns'

interface Review {
    id: string
    bookingId: string
    guestId: string
    rating: number
    comment: string
    status: 'pending' | 'approved' | 'rejected'
    createdAt: string
    isFeatured: boolean
}

interface Guest {
    id: string
    name: string
    email: string
}

export function ReviewsPage() {
    const [reviews, setReviews] = useState<Review[]>([])
    const [guests, setGuests] = useState<Record<string, Guest>>({})
    const [isLoading, setIsLoading] = useState(true)
    const [filter, setFilter] = useState<string>('pending')

    useEffect(() => {
        loadReviews()
    }, [])

    const loadReviews = async () => {
        try {
            setIsLoading(true)
            console.log('🔄 [ReviewsPage] Loading reviews...')

            const reviewsList = await blink.db.reviews.list({
                orderBy: { createdAt: 'desc' }
            })

            setReviews(reviewsList as Review[])

            // Load associated guests
            if (reviewsList.length > 0) {
                const guestIds = Array.from(new Set(reviewsList.map((r: any) => r.guestId))).filter(Boolean)
                if (guestIds.length > 0) {
                    // Fetch guests in batches or one by one if wrapper doesn't support 'in' with array properly or if list is short
                    // The wrapper supports 'in' operator: query.in(snakeKey, value.in)
                    try {
                        // @ts-ignore
                        const guestsList = await blink.db.guests.list({
                            where: { id: { in: guestIds } }
                        })

                        const guestsMap: Record<string, Guest> = {}
                        guestsList.forEach((g: any) => {
                            guestsMap[g.id] = g
                        })
                        setGuests(guestsMap)
                    } catch (e) {
                        console.error('Failed to load guests for reviews:', e)
                    }
                }
            }

        } catch (err) {
            console.error('❌ [ReviewsPage] Failed to load reviews:', err)
            toast({ title: 'Failed to load reviews', description: 'Please refresh the page.' })
        } finally {
            setIsLoading(false)
        }
    }

    const handleStatusChange = async (reviewId: string, newStatus: 'approved' | 'rejected') => {
        try {
            await blink.db.reviews.update(reviewId, { status: newStatus })

            setReviews(prev => prev.map(r =>
                r.id === reviewId ? { ...r, status: newStatus } : r
            ))

            toast({
                title: `Review ${newStatus}`,
                description: `The review has been ${newStatus}.`
            })
        } catch (err) {
            toast({
                title: 'Action failed',
                description: 'Could not update review status.',
                variant: 'destructive'
            })
        }
    }

    const handleToggleFeature = async (review: Review) => {
        try {
            const newFeatured = !review.isFeatured
            await blink.db.reviews.update(review.id, { isFeatured: newFeatured })

            setReviews(prev => prev.map(r =>
                r.id === review.id ? { ...r, isFeatured: newFeatured } : r
            ))

            toast({
                title: newFeatured ? 'Review Featured' : 'Review Unfeatured',
                description: newFeatured ? 'This review will appear on the home page.' : 'Removed from home page.'
            })
        } catch (err) {
            toast({ title: 'Action failed', variant: 'destructive' })
        }
    }

    const filteredReviews = reviews.filter(r => {
        if (filter === 'all') return true
        return r.status === filter
    })

    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'approved': return <Badge className="bg-green-500">Approved</Badge>
            case 'rejected': return <Badge variant="destructive">Rejected</Badge>
            default: return <Badge variant="secondary">Pending</Badge>
        }
    }

    return (
        <div className="space-y-6 animate-fade-in">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold">Guest Reviews</h2>
                    <p className="text-muted-foreground mt-1">Moderate and manage guest feedback</p>
                </div>
                <Button onClick={loadReviews} variant="outline" disabled={isLoading}>
                    <Loader2 className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                    Refresh
                </Button>
            </div>

            <Tabs defaultValue="pending" onValueChange={setFilter} className="w-full">
                <TabsList>
                    <TabsTrigger value="pending">Pending ({reviews.filter(r => r.status === 'pending').length})</TabsTrigger>
                    <TabsTrigger value="approved">Approved</TabsTrigger>
                    <TabsTrigger value="rejected">Rejected</TabsTrigger>
                    <TabsTrigger value="all">All Reviews</TabsTrigger>
                </TabsList>

                <TabsContent value={filter} className="mt-4">
                    <Card>
                        <CardContent className="p-0">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Date</TableHead>
                                        <TableHead>Guest</TableHead>
                                        <TableHead>Rating</TableHead>
                                        <TableHead>Comment</TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead>Featured</TableHead>
                                        <TableHead className="text-right">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {isLoading ? (
                                        <TableRow>
                                            <TableCell colSpan={7} className="h-24 text-center">
                                                <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
                                            </TableCell>
                                        </TableRow>
                                    ) : filteredReviews.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                                                No reviews found in this category.
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        filteredReviews.map((review) => (
                                            <TableRow key={review.id}>
                                                <TableCell className="whitespace-nowrap">
                                                    {format(new Date(review.createdAt), 'MMM d, yyyy')}
                                                </TableCell>
                                                <TableCell>
                                                    <div className="font-medium">{guests[review.guestId]?.name || 'Unknown Guest'}</div>
                                                    <div className="text-xs text-muted-foreground">{guests[review.guestId]?.email}</div>
                                                </TableCell>
                                                <TableCell>
                                                    <div className="flex items-center text-yellow-500">
                                                        <span className="font-bold mr-1">{review.rating}</span>
                                                        <Star className="w-4 h-4 fill-current" />
                                                    </div>
                                                </TableCell>
                                                <TableCell className="max-w-md">
                                                    <p className="line-clamp-2 text-sm text-gray-600 italic">"{review.comment}"</p>
                                                </TableCell>
                                                <TableCell>
                                                    {getStatusBadge(review.status)}
                                                </TableCell>
                                                <TableCell>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => handleToggleFeature(review)}
                                                        className={review.isFeatured ? 'text-yellow-600' : 'text-gray-400'}
                                                    >
                                                        <Star className={`w-4 h-4 ${review.isFeatured ? 'fill-current' : ''}`} />
                                                    </Button>
                                                </TableCell>
                                                <TableCell className="text-right space-x-2">
                                                    {review.status === 'pending' && (
                                                        <>
                                                            <Button size="sm" variant="outline" className="text-green-600 hover:text-green-700" onClick={() => handleStatusChange(review.id, 'approved')}>
                                                                <Check className="w-4 h-4" />
                                                            </Button>
                                                            <Button size="sm" variant="outline" className="text-red-600 hover:text-red-700" onClick={() => handleStatusChange(review.id, 'rejected')}>
                                                                <X className="w-4 h-4" />
                                                            </Button>
                                                        </>
                                                    )}
                                                    {review.status === 'approved' && (
                                                        <Button size="sm" variant="ghost" className="text-red-600" onClick={() => handleStatusChange(review.id, 'rejected')}>
                                                            Reject
                                                        </Button>
                                                    )}
                                                    {review.status === 'rejected' && (
                                                        <Button size="sm" variant="ghost" className="text-green-600" onClick={() => handleStatusChange(review.id, 'approved')}>
                                                            Approve
                                                        </Button>
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    )
}
