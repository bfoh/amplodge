
/**
 * Shared Email Template for AMP Lodge
 * Provides a consistent, professional design for all system emails.
 * Uses INLINE STYLES for maximum email client compatibility.
 */

interface EmailTemplateOptions {
  title: string
  preheader?: string
  content: string
  callToAction?: {
    text: string
    url: string
    color?: string // default is primary brown #8B4513
  }
}

export const EMAIL_STYLES = {
  body: 'margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #2C2416; background-color: #f4f4f4;',
  container: 'max-width: 600px; margin: 0 auto; background-color: #ffffff;',
  header: 'background-color: #8B4513; padding: 40px 20px; text-align: center;',
  logo: 'height: 60px; width: auto; max-width: 200px; margin-bottom: 20px;',
  headerTitle: 'color: #ffffff; font-size: 28px; font-weight: 700; margin: 0; text-transform: uppercase; letter-spacing: 1px; font-family: Arial, sans-serif;',
  headerSubtitle: 'color: rgba(255,255,255,0.9); font-size: 16px; margin: 10px 0 0 0; font-weight: 400;',
  content: 'padding: 40px 30px;',
  contentTitle: 'color: #2C2416; font-size: 24px; margin-bottom: 25px; text-align: center; border-bottom: 2px solid #F5F1E8; padding-bottom: 15px;',
  footer: 'background-color: #F5F1E8; padding: 30px 20px; text-align: center; font-size: 12px; color: #666666; border-top: 1px solid #E5E1D8;',
  button: (color: string) => `display: inline-block; padding: 16px 32px; background-color: ${color}; color: #ffffff; text-decoration: none; border-radius: 4px; font-weight: 600; font-size: 16px; margin: 30px 0; text-align: center;`,

  // Helpers for content injection
  infoBox: 'background-color: #F5F1E8; border-left: 4px solid #8B4513; padding: 20px; margin: 20px 0; border-radius: 4px;',
  infoRow: 'margin-bottom: 8px;',
  infoLabel: 'font-weight: 600; color: #2C2416; display: inline-block; width: 120px;',
  warningBox: 'background-color: #FFF3CD; border: 1px solid #FFE69C; padding: 15px; border-radius: 4px; margin: 20px 0;',
  warningTitle: 'color: #856404; display: block; margin-bottom: 5px; font-weight: bold;',
  warningText: 'color: #856404;'
}

export function generateEmailHtml(options: EmailTemplateOptions): string {
  const { title, preheader, content, callToAction } = options
  const year = new Date().getFullYear()
  const buttonColor = callToAction?.color || '#8B4513'

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="${EMAIL_STYLES.body}">
  ${preheader ? `<div style="display:none;font-size:1px;color:#333333;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">${preheader}</div>` : ''}
  
  <div style="${EMAIL_STYLES.container}">
    <!-- Header -->
    <div style="${EMAIL_STYLES.header}">
      <img src="https://amplodge.org/amp.png" alt="AMP Lodge" style="${EMAIL_STYLES.logo}" />
      <h1 style="${EMAIL_STYLES.headerTitle}">AMP Lodge</h1>
      <p style="${EMAIL_STYLES.headerSubtitle}">Premium Hospitality Experience</p>
    </div>

    <!-- Main Content -->
    <div style="${EMAIL_STYLES.content}">
      <h2 style="${EMAIL_STYLES.contentTitle}">${title}</h2>
      
      <div style="font-size: 16px; line-height: 1.6; color: #2C2416;">
        ${content}
      </div>
      
      ${callToAction ? `
        <div style="text-align: center;">
          <!-- Using a simpler button structure for better email client compatibility -->
          <table border="0" cellspacing="0" cellpadding="0" style="margin: 30px auto;">
            <tr>
              <td align="center" bgcolor="${buttonColor}" style="border-radius: 4px;">
                <a href="${callToAction.url}" style="${EMAIL_STYLES.button(buttonColor)}; border: 1px solid ${buttonColor}; display: inline-block; font-family: sans-serif;">${callToAction.text}</a>
              </td>
            </tr>
          </table>
        </div>
      ` : ''}
    </div>

    <!-- Footer -->
    <div style="${EMAIL_STYLES.footer}">
      <p style="margin: 0 0 10px 0;">&copy; ${year} AMP Lodge Hotel Management System. All rights reserved.</p>
      <p style="margin: 0;">Automated notification. Please do not reply directly to this email.</p>
    </div>
  </div>
</body>
</html>
  `
}
