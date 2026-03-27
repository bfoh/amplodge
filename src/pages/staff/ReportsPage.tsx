import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'
import { BarChart3, TrendingUp, Calendar, DollarSign, ShieldAlert } from 'lucide-react'
import { usePermissions } from '@/hooks/use-permissions'
import { Badge } from '@/components/ui/badge'

export function ReportsPage() {
  const permissions = usePermissions()
  
  // Check if user has permission to view reports
  if (!permissions.can('reports', 'read')) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
        <ShieldAlert className="w-16 h-16 text-destructive" />
        <h2 className="text-2xl font-bold">Access Denied</h2>
        <p className="text-muted-foreground text-center max-w-md">
          You do not have permission to view reports. Please contact your administrator.
        </p>
        <Badge variant="outline" className="mt-4">
          Required: Manager, Admin, or Owner role
        </Badge>
      </div>
    )
  }
  
  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <div className="p-1.5 rounded-lg bg-primary/10">
            <BarChart3 className="w-5 h-5 text-primary" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Reports & Analytics</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Track your business performance
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="hover:shadow-lg transition-shadow">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                <DollarSign className="w-5 h-5 text-primary" />
              </div>
              <div>
                <CardTitle>Revenue Report</CardTitle>
                <CardDescription>Monthly revenue breakdown</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-center py-12 text-muted-foreground">
              <BarChart3 className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>Revenue analytics coming soon</p>
            </div>
          </CardContent>
        </Card>

        <Card className="hover:shadow-lg transition-shadow">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                <Calendar className="w-5 h-5 text-primary" />
              </div>
              <div>
                <CardTitle>Occupancy Report</CardTitle>
                <CardDescription>Property utilization rates</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-center py-12 text-muted-foreground">
              <TrendingUp className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>Occupancy data coming soon</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Available Reports</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-3 text-sm">
            <li className="flex items-center justify-between p-3 rounded-lg border hover:bg-accent/50 transition-colors">
              <span className="font-medium">Revenue by Property</span>
              <span className="text-muted-foreground">Coming Soon</span>
            </li>
            <li className="flex items-center justify-between p-3 rounded-lg border hover:bg-accent/50 transition-colors">
              <span className="font-medium">Booking Source Analysis</span>
              <span className="text-muted-foreground">Coming Soon</span>
            </li>
            <li className="flex items-center justify-between p-3 rounded-lg border hover:bg-accent/50 transition-colors">
              <span className="font-medium">Guest Demographics</span>
              <span className="text-muted-foreground">Coming Soon</span>
            </li>
            <li className="flex items-center justify-between p-3 rounded-lg border hover:bg-accent/50 transition-colors">
              <span className="font-medium">Seasonal Trends</span>
              <span className="text-muted-foreground">Coming Soon</span>
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
