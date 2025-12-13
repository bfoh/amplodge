import React from 'react'
import { StaffSidebar } from '@/components/layout/StaffSidebar'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

export function LocalTaxPage() {
  return (
    <div className="flex h-screen bg-secondary">
      <StaffSidebar email="admin@amplodge.com" />
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="h-16 border-b bg-white flex items-center px-6">
          <h1 className="text-lg font-semibold text-secondary-foreground flex items-center gap-2">
            Local Tax Configuration
            <Badge variant="destructive" className="text-[10px]">NEW</Badge>
          </h1>
        </header>
        <main className="flex-1 overflow-auto p-6">
          <Card>
            <CardHeader>
              <CardTitle>Tax & Fee Management</CardTitle>
              <CardDescription>
                Configure local tourist taxes, VAT rates, and other statutory fees
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Local tax configuration interface coming soon. Set up tourist taxes, VAT rates,
                city fees, and other mandatory charges that apply to guest bookings.
              </p>
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  )
}

export default LocalTaxPage
