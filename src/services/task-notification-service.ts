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

    // Fire email and SMS independently. Either channel can reach the staff
    // member; both should be attempted regardless of the other's outcome.
    // Returning before SMS would silently drop the SMS whenever email rejected.
    const smsPromise = data.employeePhone
      ? sendTaskAssignmentSMS({
          phone: data.employeePhone,
          staffName: data.employeeName,
          roomNumber: data.roomNumber,
          taskType: 'Housekeeping',
          completionUrl: data.completionUrl,
        }).catch(err => {
          console.error('[TaskAssignmentEmail] SMS failed:', err)
          return { success: false, error: String(err) }
        })
      : Promise.resolve({ success: false, error: 'no_phone' })

    const emailPromise = sendTransactionalEmail({
      to: data.employeeEmail,
      subject: `🏨 New Housekeeping Task - Room ${data.roomNumber}`,
      html: htmlContent,
      text: textContent,
    })

    const [emailResult, smsResult] = await Promise.all([emailPromise, smsPromise])

    const emailOk = !!emailResult?.success
    const smsOk = !!(smsResult as any)?.success

    if (emailOk) console.log('✅ [TaskAssignmentEmail] Email sent successfully')
    else console.warn('⚠️ [TaskAssignmentEmail] Email failed:', emailResult?.error)

    if (smsOk) console.log('✅ [TaskAssignmentEmail] SMS sent successfully')
    else if (data.employeePhone) console.warn('⚠️ [TaskAssignmentEmail] SMS failed:', (smsResult as any)?.error)

    // Success if EITHER channel reached the staff member.
    const success = emailOk || smsOk
    return {
      success,
      emailOk,
      smsOk,
      hasPhone: !!data.employeePhone,
      error: success
        ? undefined
        : (emailResult?.error || (smsResult as any)?.error || 'unknown'),
    }
  } catch (error: any) {
    console.error('❌ [TaskAssignmentEmail] Failed to send notifications:', error)
    return { success: false, error: error.message }
  }
}
