import React from 'react'
import { StaffSidebar } from '@/components/layout/StaffSidebar'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export function AdditionalServicesPage() {
  return (
    <div className="flex h-screen bg-secondary">
      <StaffSidebar email="admin@amplodge.com" />
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="h-16 border-b bg-white flex items-center px-6">
          <h1 className="text-lg font-semibold text-secondary-foreground">Additional Services</h1>
        </header>
        <main className="flex-1 overflow-auto p-6">
          <Card>
            <CardHeader>
              <CardTitle>Service Pricing Management</CardTitle>
              <CardDescription>
                Manage pricing for spa treatments, tours, and other guest services
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Additional services pricing interface coming soon. Configure rates for spa services,
                guided tours, airport transfers, and other amenities offered to guests.
              </p>
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  )
}

export default AdditionalServicesPage
