import { sendTransactionalEmail } from '@/services/email-service'
import { sendTaskAssignmentSMS } from '@/services/sms-service'

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

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>New Housekeeping Task Assignment</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background-color: #f4f4f4; }
          .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; padding: 20px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; margin: -20px -20px 30px -20px; }
          .header h1 { margin: 0; font-size: 28px; font-weight: bold; }
          .header p { margin: 10px 0 0 0; opacity: 0.9; font-size: 16px; }
          .task-card { background: #f8f9fa; border: 2px solid #e9ecef; border-radius: 8px; padding: 20px; margin: 20px 0; }
          .task-title { font-size: 24px; font-weight: bold; color: #2c3e50; margin: 0 0 15px 0; }
          .task-details { background: white; padding: 15px; border-radius: 6px; border-left: 4px solid #3498db; }
          .detail-row { margin: 10px 0; display: flex; align-items: center; }
          .detail-icon { width: 20px; height: 20px; margin-right: 10px; color: #3498db; }
          .detail-label { font-weight: bold; color: #2c3e50; min-width: 120px; }
          .detail-value { color: #34495e; }
          .notes-section { background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 6px; margin: 15px 0; }
          .notes-title { font-weight: bold; color: #856404; margin: 0 0 10px 0; }
          .notes-content { color: #856404; font-style: italic; }
          .action-section { text-align: center; margin: 30px 0; }
          .done-button { display: inline-block; background: linear-gradient(135deg, #27ae60 0%, #2ecc71 100%); color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-size: 18px; font-weight: bold; box-shadow: 0 4px 15px rgba(46, 204, 113, 0.3); transition: all 0.3s ease; }
          .done-button:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(46, 204, 113, 0.4); }
          .footer { text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e9ecef; color: #6c757d; font-size: 14px; }
          .urgent-badge { background: #e74c3c; color: white; padding: 5px 12px; border-radius: 20px; font-size: 12px; font-weight: bold; margin-left: 10px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🏨 New Housekeeping Task</h1>
            <p>AMP Lodge Hotel Management System</p>
          </div>
          
          <div class="task-card">
            <h2 class="task-title">
              🧹 Room ${data.roomNumber} Cleaning Task
              <span class="urgent-badge">URGENT</span>
            </h2>
            
            <div class="task-details">
              <div class="detail-row">
                <span class="detail-icon">👤</span>
                <span class="detail-label">Assigned to:</span>
                <span class="detail-value">${data.employeeName}</span>
              </div>
              <div class="detail-row">
                <span class="detail-icon">🏠</span>
                <span class="detail-label">Room Number:</span>
                <span class="detail-value">${data.roomNumber}</span>
              </div>
              <div class="detail-row">
                <span class="detail-icon">📅</span>
                <span class="detail-label">Assigned:</span>
                <span class="detail-value">${new Date().toLocaleString()}</span>
              </div>
              <div class="detail-row">
                <span class="detail-icon">📋</span>
                <span class="detail-label">Task ID:</span>
                <span class="detail-value">${data.taskId}</span>
              </div>
            </div>
            
            ${data.taskNotes ? `
              <div class="notes-section">
                <div class="notes-title">📝 Task Instructions:</div>
                <div class="notes-content">${data.taskNotes}</div>
              </div>
            ` : ''}
            
            <div class="action-section">
              <p style="margin-bottom: 20px; font-size: 16px; color: #2c3e50;">
                <strong>Click the button below when you have completed the cleaning task:</strong>
              </p>
              <a href="${data.completionUrl}" class="done-button">
                ✅ MARK TASK AS DONE
              </a>
              <p style="margin-top: 15px; font-size: 14px; color: #6c757d;">
                This will automatically update the task status in our system
              </p>
            </div>
          </div>
          
          <div class="footer">
            <p>This is an automated notification from AMP Lodge Hotel Management System</p>
            <p>If you have any questions, please contact your supervisor</p>
          </div>
        </div>
      </body>
      </html>
    `

    const textContent = `
NEW HOUSEKEEPING TASK ASSIGNMENT
AMP Lodge Hotel Management System

Hello ${data.employeeName},

You have been assigned a new housekeeping task:

Room: ${data.roomNumber}
Task ID: ${data.taskId}
Assigned: ${new Date().toLocaleString()}
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
