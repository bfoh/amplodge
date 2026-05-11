import { db, auth } from '@/lib/db'
import type { Booking, Room, HousekeepingTask } from '@/types'
import { activityLogService } from '@/services/activity-log-service'

class HousekeepingService {
    /**
     * Creates a housekeeping task for a room after checkout.
     * Also handles logging the activity.
     */
    async createCheckoutTask(
        booking: Booking,
        room: Room,
        guestName: string,
        currentUser: { id: string } | null
    ): Promise<HousekeepingTask | null> {
        const taskId = `task_${Date.now()}_${Math.random().toString(36).substring(7)}`

        const taskPayload = {
            // Use null for userId if not available, to avoid empty string VIOLATING foreign key constraints
            userId: currentUser?.id || booking.userId || null,
            propertyId: room.id,
            roomNumber: room.roomNumber,
            status: 'pending' as 'pending',
            notes: `Checkout cleaning for ${guestName}`,
            createdAt: new Date().toISOString(),
            assignedTo: null // Explicitly null for new tasks
        }

        console.log('🧹 [HousekeepingService] Creating task with payload:', taskPayload)

        try {
            // Create the task in database
            const newTask = await db.housekeepingTasks.create(taskPayload)
            console.log('✅ [HousekeepingService] Task created successfully:', taskId)

            // Log the creation
            try {
                await activityLogService.log({
                    action: 'created',
                    entityType: 'task',
                    entityId: taskId,
                    details: {
                        title: 'Checkout Cleaning',
                        roomNumber: room.roomNumber,
                        guestName: guestName,
                        status: 'pending',
                        reason: 'guest_check_out',
                        bookingId: booking.id
                    },
                    userId: currentUser?.id || 'system'
                })
            } catch (logError) {
                console.error('[HousekeepingService] Failed to log task creation:', logError)
            }

            return newTask
        } catch (error: any) {
            console.error('❌ [HousekeepingService] Failed to create task:', error)
            console.error('❌ [HousekeepingService] Error details:', error?.message || error)
            return null
        }
    }

    /**
     * Completes a housekeeping task and updates the room status to available.
     */
    async completeTask(
        taskId: string,
        roomNumber: string,
        notes: string,
        userId?: string
    ): Promise<{ success: boolean; error?: string }> {
        try {
            console.log(`🧹 [HousekeepingService] Completing task ${taskId} for room ${roomNumber}`)

            // 1. Update task
            await db.housekeepingTasks.update(taskId, {
                status: 'completed',
                completedAt: new Date().toISOString(),
                notes: notes
            })

            // 2. Find property and update status
            const properties = await db.properties.list({ where: { roomNumber }, limit: 1 })
            const property = properties[0]

            if (property) {
                if (property.status?.toLowerCase() === 'cleaning') {
                    console.log(`[HousekeepingService] Updating property ${property.roomNumber} status to active`)
                    await db.properties.update(property.id, { status: 'active' })
                }
            } else {
                console.warn(`[HousekeepingService] Property not found for number: ${roomNumber}`)
            }

            return { success: true }
        } catch (error: any) {
            console.error('[HousekeepingService] Failed to complete task:', error)
            return { success: false, error: error.message }
        }
    }
}

export const housekeepingService = new HousekeepingService()
