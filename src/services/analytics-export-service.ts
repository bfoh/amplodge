import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'
import { 
  RevenueAnalytics, 
  OccupancyAnalytics, 
  GuestAnalytics, 
  PerformanceMetrics 
} from '@/types/analytics'

export class AnalyticsExportService {
  /**
   * Export analytics data as PDF report
   */
  static async exportToPDF(
    revenue: RevenueAnalytics | null,
    occupancy: OccupancyAnalytics | null,
    guests: GuestAnalytics | null,
    performance: PerformanceMetrics | null,
    elementId?: string
  ): Promise<void> {
    try {
      const pdf = new jsPDF('p', 'mm', 'a4')
      const pageWidth = pdf.internal.pageSize.getWidth()
      const pageHeight = pdf.internal.pageSize.getHeight()
      
      // Add header
      pdf.setFontSize(20)
      pdf.setFont('helvetica', 'bold')
      pdf.text('Analytics Report', pageWidth / 2, 20, { align: 'center' })
      
      pdf.setFontSize(12)
      pdf.setFont('helvetica', 'normal')
      pdf.text(`Generated on: ${new Date().toLocaleDateString()}`, pageWidth / 2, 30, { align: 'center' })
      
      let yPosition = 50
      
      // Revenue Section
      if (revenue) {
        pdf.setFontSize(16)
        pdf.setFont('helvetica', 'bold')
        pdf.text('Revenue Analytics', 20, yPosition)
        yPosition += 10
        
        pdf.setFontSize(10)
        pdf.setFont('helvetica', 'normal')
        
        // Total Revenue
        pdf.text(`Total Revenue: $${(revenue.totalRevenue || 0).toLocaleString()}`, 20, yPosition)
        yPosition += 6
        
        // Revenue by Period
        pdf.text('Revenue by Period:', 20, yPosition)
        yPosition += 6
        pdf.text(`  This Week: $${(revenue.revenueByPeriod.thisWeek || 0).toLocaleString()}`, 25, yPosition)
        yPosition += 5
        pdf.text(`  This Month: $${(revenue.revenueByPeriod.thisMonth || 0).toLocaleString()}`, 25, yPosition)
        yPosition += 5
        pdf.text(`  This Year: $${(revenue.revenueByPeriod.thisYear || 0).toLocaleString()}`, 25, yPosition)
        yPosition += 5
        pdf.text(`  Last Month: $${(revenue.revenueByPeriod.lastMonth || 0).toLocaleString()}`, 25, yPosition)
        yPosition += 8
        
        // Revenue by Source
        pdf.text('Revenue by Source:', 20, yPosition)
        yPosition += 6
        pdf.text(`  Online: $${(revenue.revenueBySource.online || 0).toLocaleString()}`, 25, yPosition)
        yPosition += 5
        pdf.text(`  Reception: $${(revenue.revenueBySource.reception || 0).toLocaleString()}`, 25, yPosition)
        yPosition += 10
      }
      
      // Occupancy Section
      if (occupancy) {
        pdf.setFontSize(16)
        pdf.setFont('helvetica', 'bold')
        pdf.text('Occupancy Analytics', 20, yPosition)
        yPosition += 10
        
        pdf.setFontSize(10)
        pdf.setFont('helvetica', 'normal')
        
        pdf.text(`Current Occupancy Rate: ${occupancy.currentOccupancyRate || 0}%`, 20, yPosition)
        yPosition += 6
        pdf.text(`Occupied Rooms: ${occupancy.occupiedRooms || 0}`, 20, yPosition)
        yPosition += 6
        pdf.text(`Total Rooms: ${occupancy.totalRooms || 0}`, 20, yPosition)
        yPosition += 6
        pdf.text(`Average Occupancy Rate: ${occupancy.averageOccupancyRate || 0}%`, 20, yPosition)
        yPosition += 10
      }
      
      // Guest Analytics Section
      if (guests) {
        pdf.setFontSize(16)
        pdf.setFont('helvetica', 'bold')
        pdf.text('Guest Analytics', 20, yPosition)
        yPosition += 10
        
        pdf.setFontSize(10)
        pdf.setFont('helvetica', 'normal')
        
        pdf.text(`Total Guests: ${guests.totalGuests || 0}`, 20, yPosition)
        yPosition += 6
        pdf.text(`New Guests: ${guests.newGuests || 0}`, 20, yPosition)
        yPosition += 6
        pdf.text(`Repeat Guests: ${guests.repeatGuests || 0}`, 20, yPosition)
        yPosition += 6
        pdf.text(`Repeat Rate: ${guests.repeatGuestRate || 0}%`, 20, yPosition)
        yPosition += 6
        pdf.text(`Average Lifetime Value: $${(guests.guestLifetimeValue.average || 0).toLocaleString()}`, 20, yPosition)
        yPosition += 10
      }
      
      // Performance Metrics Section
      if (performance) {
        pdf.setFontSize(16)
        pdf.setFont('helvetica', 'bold')
        pdf.text('Performance Metrics', 20, yPosition)
        yPosition += 10
        
        pdf.setFontSize(10)
        pdf.setFont('helvetica', 'normal')
        
        pdf.text(`Average Daily Rate: $${performance.averageDailyRate || 0}`, 20, yPosition)
        yPosition += 6
        pdf.text(`RevPAR: $${performance.revpar || 0}`, 20, yPosition)
        yPosition += 6
        pdf.text(`Total Bookings: ${performance.totalBookings || 0}`, 20, yPosition)
        yPosition += 6
        pdf.text(`Average Length of Stay: ${performance.averageLengthOfStay || 0} nights`, 20, yPosition)
        yPosition += 6
        pdf.text(`Cancellation Rate: ${performance.cancellationRate || 0}%`, 20, yPosition)
        yPosition += 10
      }
      
      // Add footer
      pdf.setFontSize(8)
      pdf.setFont('helvetica', 'italic')
      pdf.text('Generated by AMP LODGE Analytics System', pageWidth / 2, pageHeight - 10, { align: 'center' })
      
      // Save the PDF
      const fileName = `analytics-report-${new Date().toISOString().split('T')[0]}.pdf`
      pdf.save(fileName)
      
    } catch (error) {
      console.error('Error generating PDF:', error)
      throw new Error('Failed to generate PDF report')
    }
  }
  
  /**
   * Export analytics data as CSV
   */
  static exportToCSV(
    revenue: RevenueAnalytics | null,
    occupancy: OccupancyAnalytics | null,
    guests: GuestAnalytics | null,
    performance: PerformanceMetrics | null
  ): void {
    try {
      const csvData: string[][] = []
      
      // Add headers
      csvData.push(['Metric', 'Value', 'Category'])
      
      // Revenue data
      if (revenue) {
        csvData.push(['Total Revenue', `$${(revenue.totalRevenue || 0).toLocaleString()}`, 'Revenue'])
        csvData.push(['This Week Revenue', `$${(revenue.revenueByPeriod.thisWeek || 0).toLocaleString()}`, 'Revenue'])
        csvData.push(['This Month Revenue', `$${(revenue.revenueByPeriod.thisMonth || 0).toLocaleString()}`, 'Revenue'])
        csvData.push(['This Year Revenue', `$${(revenue.revenueByPeriod.thisYear || 0).toLocaleString()}`, 'Revenue'])
        csvData.push(['Online Revenue', `$${(revenue.revenueBySource.online || 0).toLocaleString()}`, 'Revenue'])
        csvData.push(['Reception Revenue', `$${(revenue.revenueBySource.reception || 0).toLocaleString()}`, 'Revenue'])
      }
      
      // Occupancy data
      if (occupancy) {
        csvData.push(['Current Occupancy Rate', `${occupancy.currentOccupancyRate || 0}%`, 'Occupancy'])
        csvData.push(['Occupied Rooms', `${occupancy.occupiedRooms || 0}`, 'Occupancy'])
        csvData.push(['Total Rooms', `${occupancy.totalRooms || 0}`, 'Occupancy'])
        csvData.push(['Average Occupancy Rate', `${occupancy.averageOccupancyRate || 0}%`, 'Occupancy'])
      }
      
      // Guest data
      if (guests) {
        csvData.push(['Total Guests', `${guests.totalGuests || 0}`, 'Guests'])
        csvData.push(['New Guests', `${guests.newGuests || 0}`, 'Guests'])
        csvData.push(['Repeat Guests', `${guests.repeatGuests || 0}`, 'Guests'])
        csvData.push(['Repeat Rate', `${guests.repeatGuestRate || 0}%`, 'Guests'])
        csvData.push(['Average Lifetime Value', `$${(guests.guestLifetimeValue.average || 0).toLocaleString()}`, 'Guests'])
      }
      
      // Performance data
      if (performance) {
        csvData.push(['Average Daily Rate', `$${performance.averageDailyRate || 0}`, 'Performance'])
        csvData.push(['RevPAR', `$${performance.revpar || 0}`, 'Performance'])
        csvData.push(['Total Bookings', `${performance.totalBookings || 0}`, 'Performance'])
        csvData.push(['Average Length of Stay', `${performance.averageLengthOfStay || 0} nights`, 'Performance'])
        csvData.push(['Cancellation Rate', `${performance.cancellationRate || 0}%`, 'Performance'])
      }
      
      // Convert to CSV string
      const csvString = csvData.map(row => 
        row.map(cell => `"${cell}"`).join(',')
      ).join('\n')
      
      // Create and download file
      const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' })
      const link = document.createElement('a')
      const url = URL.createObjectURL(blob)
      link.setAttribute('href', url)
      link.setAttribute('download', `analytics-report-${new Date().toISOString().split('T')[0]}.csv`)
      link.style.visibility = 'hidden'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      
    } catch (error) {
      console.error('Error generating CSV:', error)
      throw new Error('Failed to generate CSV report')
    }
  }
  
  /**
   * Export dashboard screenshot as image
   */
  static async exportScreenshot(elementId: string = 'analytics-dashboard'): Promise<void> {
    try {
      const element = document.getElementById(elementId)
      if (!element) {
        throw new Error('Dashboard element not found')
      }
      
      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#ffffff'
      })
      
      const imgData = canvas.toDataURL('image/png')
      const link = document.createElement('a')
      link.download = `analytics-dashboard-${new Date().toISOString().split('T')[0]}.png`
      link.href = imgData
      link.click()
      
    } catch (error) {
      console.error('Error generating screenshot:', error)
      throw new Error('Failed to generate dashboard screenshot')
    }
  }
}
