
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Loader2, Check, X, Star, Trash2, MessageSquare } from 'lucide-react'
import { blink } from '@/blink/client'
import { toast } from '@/hooks/use-toast'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { format } from 'date-fns'

interface Review {
    id: string
    bookingId: string
    guestId: string
    guest_name?: string // Persisted guest name
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

            // Load associated guests (fallback for old reviews without guest_name)
            if (reviewsList.length > 0) {
                const guestIds = Array.from(new Set(
                    reviewsList
                        .filter((r: any) => !r.guest_name && r.guestId) // Only need to fetch if guest_name is missing
                        .map((r: any) => r.guestId)
                )).filter(Boolean)
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
            case 'approved': return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">Approved</span>
            case 'rejected': return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-700 ring-1 ring-red-200">Rejected</span>
            default: return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 ring-1 ring-amber-200">Pending</span>
        }
    }

    return (
        <div className="space-y-6 animate-fade-in">
            <div className="flex items-center justify-between">
                <div>
                    <div className="flex items-center gap-2 mb-1">
                        <div className="p-1.5 rounded-lg bg-primary/10">
                            <MessageSquare className="w-5 h-5 text-primary" />
                        </div>
                        <h1 className="text-2xl font-bold tracking-tight">Guest Reviews</h1>
                    </div>
                    <p className="text-sm text-muted-foreground">Moderate and manage guest feedback — {reviews.length} total</p>
                </div>
                <Button onClick={loadReviews} variant="outline" disabled={isLoading}>
                    <Loader2 className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                    Refresh
                </Button>
            </div>

            {/* Stats Strip */}
            <div className="grid grid-cols-3 gap-3">
                <div className="relative overflow-hidden rounded-xl border bg-card p-4 shadow-sm">
                    <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-amber-400 to-amber-600" />
                    <p className="text-xs font-medium text-muted-foreground">Pending Review</p>
                    <p className="text-2xl font-bold mt-1">{reviews.filter(r => r.status === 'pending').length}</p>
                </div>
                <div className="relative overflow-hidden rounded-xl border bg-card p-4 shadow-sm">
                    <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-emerald-400 to-emerald-600" />
                    <p className="text-xs font-medium text-muted-foreground">Approved</p>
                    <p className="text-2xl font-bold mt-1">{reviews.filter(r => r.status === 'approved').length}</p>
                </div>
                <div className="relative overflow-hidden rounded-xl border bg-card p-4 shadow-sm">
                    <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-red-400 to-red-600" />
                    <p className="text-xs font-medium text-muted-foreground">Rejected</p>
                    <p className="text-2xl font-bold mt-1">{reviews.filter(r => r.status === 'rejected').length}</p>
                </div>
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
                                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                                        <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground py-3">Date</TableHead>
                                        <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground py-3">Guest</TableHead>
                                        <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground py-3">Rating</TableHead>
                                        <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground py-3">Comment</TableHead>
                                        <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground py-3">Status</TableHead>
                                        <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground py-3">Featured</TableHead>
                                        <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground py-3 text-right">Actions</TableHead>
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
                                                    <div className="font-medium">{review.guest_name || guests[review.guestId]?.name || 'Unknown Guest'}</div>
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
