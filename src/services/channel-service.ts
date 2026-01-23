import { blink } from '@/blink/client'
import { ChannelConnection, ChannelRoomMapping, ExternalBooking } from '@/types'

export class ChannelService {
    private static instance: ChannelService
    private db = blink.db as any

    static getInstance(): ChannelService {
        if (!ChannelService.instance) {
            ChannelService.instance = new ChannelService()
        }
        return ChannelService.instance
    }

    // --- Channel Connections ---

    async getConnections(): Promise<ChannelConnection[]> {
        try {
            // Ensure we get all connections
            const result = await this.db.channelConnections?.list({ limit: 50 }) || []
            return result
        } catch (error) {
            console.error('Failed to fetch channel connections:', error)
            return []
        }
    }

    async getConnection(channelId: string): Promise<ChannelConnection | null> {
        try {
            const connections = await this.getConnections()
            return connections.find(c => c.channelId === channelId) || null
        } catch (error) {
            console.error(`Failed to fetch connection for ${channelId}:`, error)
            return null
        }
    }

    async createConnection(data: Partial<ChannelConnection>): Promise<ChannelConnection> {
        try {
            return await this.db.channelConnections.create({
                ...data,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            })
        } catch (error) {
            console.error('Failed to create channel connection:', error)
            throw error
        }
    }

    async updateConnection(id: string, updates: Partial<ChannelConnection>): Promise<ChannelConnection> {
        try {
            const updated = {
                ...updates,
                updatedAt: new Date().toISOString()
            }
            return await this.db.channelConnections.update(id, updated)
        } catch (error) {
            console.error(`Failed to update connection ${id}:`, error)
            throw error
        }
    }

    async toggleConnection(channelId: string, isActive: boolean): Promise<ChannelConnection> {
        const connection = await this.getConnection(channelId)

        if (connection) {
            return this.updateConnection(connection.id, { isActive })
        } else {
            // Create if doesn't exist (e.g. first time enabling)
            // Map channel ID to display name
            const channelNames: Record<string, string> = {
                airbnb: 'Airbnb',
                booking: 'Booking.com',
                expedia: 'Expedia',
                vrbo: 'VRBO',
                tripadvisor: 'TripAdvisor',
                hotels: 'Hotels.com'
            }

            return this.createConnection({
                channelId: channelId as any,
                name: channelNames[channelId] || channelId,
                isActive
            })
        }
    }

    // --- Room Mappings ---

    async getMappings(connectionId?: string): Promise<ChannelRoomMapping[]> {
        try {
            const result = await this.db.channelRoomMappings?.list({ limit: 100 }) || []

            if (connectionId) {
                return result.filter((m: ChannelRoomMapping) => m.channelConnectionId === connectionId)
            }

            return result
        } catch (error) {
            console.error('Failed to fetch room mappings:', error)
            return []
        }
    }

    async createMapping(data: Partial<ChannelRoomMapping>): Promise<ChannelRoomMapping> {
        try {
            // Ensure export token is generated if not provided
            const exportToken = data.exportToken || Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)

            return await this.db.channelRoomMappings.create({
                ...data,
                exportToken,
                syncStatus: 'pending',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            })
        } catch (error) {
            console.error('Failed to create room mapping:', error)
            throw error
        }
    }

    async updateMapping(id: string, updates: Partial<ChannelRoomMapping>): Promise<ChannelRoomMapping> {
        try {
            const updated = {
                ...updates,
                updatedAt: new Date().toISOString()
            }
            return await this.db.channelRoomMappings.update(id, updated)
        } catch (error) {
            console.error(`Failed to update mapping ${id}:`, error)
            throw error
        }
    }

    async deleteMapping(id: string): Promise<void> {
        try {
            await this.db.channelRoomMappings.delete(id)
        } catch (error) {
            console.error(`Failed to delete mapping ${id}:`, error)
            throw error
        }
    }

    // --- External Bookings ---

    async getExternalBookings(mappingId: string): Promise<ExternalBooking[]> {
        try {
            const result = await this.db.externalBookings?.list({ limit: 500 }) || []
            return result.filter((b: ExternalBooking) => b.mappingId === mappingId)
        } catch (error) {
            console.error(`Failed to fetch external bookings for mapping ${mappingId}:`, error)
            return []
        }
    }
}

export const channelService = ChannelService.getInstance()
