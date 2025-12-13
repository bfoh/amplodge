import React from 'react'
import { StaffSidebar } from '@/components/layout/StaffSidebar'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export function MealsPage() {
  return (
    <div className="flex h-screen bg-secondary">
      <StaffSidebar email="admin@amplodge.com" />
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="h-16 border-b bg-white flex items-center px-6">
          <h1 className="text-lg font-semibold text-secondary-foreground">Meals & Dining</h1>
        </header>
        <main className="flex-1 overflow-auto p-6">
          <Card>
            <CardHeader>
              <CardTitle>Meal Plan Pricing</CardTitle>
              <CardDescription>
                Configure breakfast, lunch, dinner packages and special dining options
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Meal pricing management coming soon. Set up meal plan packages including breakfast,
                half-board, full-board options, and à la carte dining prices.
              </p>
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  )
}

export default MealsPage
