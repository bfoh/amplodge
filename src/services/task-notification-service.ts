import { sendTransactionalEmail } from '@/services/email-service'
import { sendTaskAssignmentSMS } from '@/services/sms-service'
import { generateEmailHtml } from '@/services/email-template'

interface TaskAssignmentEmailData {
  employeeName: string
  employeeEmail: string
  employeePhone?: string
  roomNumber: string
  taskNotes: string
  taskId: string
  completionUrl: string
}

export async function sendTaskAssignmentEmail(data: TaskAssignmentEmailData) {
  try {
    console.log('📧 [TaskAssignmentEmail] Sending task assignment email...', {
      employeeEmail: data.employeeEmail,
      roomNumber: data.roomNumber,
      taskId: data.taskId
    })

    const htmlContent = generateEmailHtml({
      title: 'New Housekeeping Task',
      preheader: `Room ${data.roomNumber} Cleaning Assignment`,
      content: `
        <p>Hello <strong>${data.employeeName}</strong>,</p>
        <p>You have been assigned a new housekeeping task. Please attend to this promptly.</p>
        
        <div style="background-color: #F5F1E8; border-left: 4px solid #8B4513; padding: 20px; margin: 20px 0; border-radius: 4px;">
          <div style="margin-bottom: 8px;">
            <span style="font-weight: 600; color: #2C2416; display: inline-block; width: 120px;">Room Number:</span> 
            <span style="font-size: 18px; font-weight: bold; color: #8B4513;">${data.roomNumber}</span>
          </div>
          <div style="margin-bottom: 8px;">
            <span style="font-weight: 600; color: #2C2416; display: inline-block; width: 120px;">Assigned:</span> 
            ${new Date().toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </div>
          <div style="margin-bottom: 8px;">
            <span style="font-weight: 600; color: #2C2416; display: inline-block; width: 120px;">Task ID:</span> 
            <span style="font-family: monospace;">${data.taskId.substring(0, 8)}...</span>
          </div>
        </div>

        ${data.taskNotes ? `
          <div style="background-color: #FFF3CD; border: 1px solid #FFE69C; padding: 15px; border-radius: 4px; margin: 20px 0;">
            <strong style="color: #856404; display: block; margin-bottom: 5px;">📝 Instructions:</strong>
            <span style="color: #856404;">${data.taskNotes}</span>
          </div>
        ` : ''}
        
        <p style="text-align: center; margin-top: 20px; color: #666;">
          Click the button below once you have finished cleaning the room:
        </p>
      `,
      callToAction: {
        text: '✅ MARK TASK AS DONE',
        url: data.completionUrl,
        color: '#27ae60' // Green color for positive action
      }
    })

    const textContent = `
NEW HOUSEKEEPING TASK ASSIGNMENT
AMP Lodge Hotel Management System

Hello ${data.employeeName},

You have been assigned a new housekeeping task:

Room: ${data.roomNumber}
Assigned: ${new Date().toLocaleString()}
Task ID: ${data.taskId}
${data.taskNotes ? `Instructions: ${data.taskNotes}` : ''}

To mark this task as completed, please visit:
${data.completionUrl}

This is an automated notification from AMP Lodge Hotel Management System.
If you have any questions, please contact your supervisor.

---
AMP Lodge Hotel Management System
    `

    const result = await sendTransactionalEmail({
      to: data.employeeEmail,
      subject: `🏨 New Housekeeping Task - Room ${data.roomNumber}`,
      html: htmlContent,
      text: textContent
    })

    if (result.success) {
      console.log('✅ [TaskAssignmentEmail] Email sent successfully')

      // Also send SMS if phone number is provided
      if (data.employeePhone) {
        sendTaskAssignmentSMS({
          phone: data.employeePhone,
          staffName: data.employeeName,
          roomNumber: data.roomNumber,
          taskType: 'Housekeeping',
          completionUrl: data.completionUrl
        }).catch(err => console.error('[TaskAssignmentEmail] SMS failed:', err))
      }

      return { success: true, result }
    }

    console.error('❌ [TaskAssignmentEmail] Email send reported failure:', result.error)
    return { success: false, error: result.error }
  } catch (error: any) {
    console.error('❌ [TaskAssignmentEmail] Failed to send email:', error)
    return { success: false, error: error.message }
  }
}
