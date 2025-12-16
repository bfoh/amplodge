import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { sendTransactionalEmail } from '@/services/email-service'
import { toast } from 'sonner'
import { Loader2, Mail, Terminal, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'

export function DiagnoseEmailPage() {
    const [email, setEmail] = useState('')
    const [loading, setLoading] = useState(false)
    const [logs, setLogs] = useState<string[]>([])
    const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle')

    const addLog = (message: string) => {
        setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`])
    }

    const handleTestEmail = async () => {
        if (!email) {
            toast.error('Please enter an email address')
            return
        }

        setLoading(true)
        setStatus('idle')
        setLogs([])
        addLog('🚀 Starting email diagnostic test...')
        addLog(`🎯 Target Email: ${email}`)

        try {
            addLog('📡 calling sendTransactionalEmail()...')

            const result = await sendTransactionalEmail({
                to: email,
                subject: 'AMP Lodge - Diagnostic Test Email',
                html: `
          <div style="font-family: sans-serif; padding: 20px; background: #f4f4f4;">
            <div style="background: white; padding: 20px; border-radius: 8px;">
              <h2 style="color: #8B4513;">Test Email</h2>
              <p>This is a diagnostic test email from your AMP Lodge system.</p>
              <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
              <p>If you are reading this, the email service is working correctly! ✅</p>
            </div>
          </div>
        `,
                text: 'This is a diagnostic test email from AMP Lodge. If you received this, it works!'
            })

            if (result.success) {
                addLog(`✅ Success! Email ID: ${result.id}`)
                setStatus('success')
                toast.success('Test email sent successfully!')
            } else {
                addLog(`❌ Failed. Error: ${result.error}`)
                setStatus('error')
                toast.error('Failed to send test email')

                // Analyze common errors
                if (result.error?.includes('not verified')) {
                    addLog('💡 TIP: This looks like a domain verification issue. Check your Resend dashboard.')
                } else if (result.error?.includes('API key')) {
                    addLog('💡 TIP: Check your RESEND_API_KEY in Netlify environment variables.')
                } else if (result.error?.includes('500') || result.error?.includes('Internal Server Error')) {
                    addLog('💡 TIP: The Netlify Function crashed. Check Netlify function logs.')
                }
            }

        } catch (error: any) {
            addLog(`💥 Exception caught: ${error.message}`)
            setStatus('error')
        } finally {
            setLoading(false)
            addLog('🏁 Test completed.')
        }
    }

    return (
        <div className="container max-w-2xl mx-auto py-8 px-4 space-y-6">
            <div>
                <h1 className="text-3xl font-bold tracking-tight text-[#2C2416]">Email Diagnostics</h1>
                <p className="text-muted-foreground mt-2">
                    Use this tool to test if the system can successfully send emails via Netlify Functions.
                </p>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Mail className="h-5 w-5" />
                        Send Test Email
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="email">Recipient Email</Label>
                        <div className="flex gap-2">
                            <Input
                                id="email"
                                placeholder="Enter your email to receive a test"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                            />
                            <Button
                                onClick={handleTestEmail}
                                disabled={loading || !email}
                                className="bg-[#8B6F47] hover:bg-[#705835]"
                            >
                                {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : 'Send Test'}
                            </Button>
                        </div>
                        <p className="text-xs text-muted-foreground">
                            We'll try to send a real email to this address using your current configuration.
                        </p>
                    </div>

                    {/* Status Indicator */}
                    {status === 'success' && (
                        <div className="bg-green-50 border border-green-200 text-green-700 p-4 rounded-md flex items-center gap-2">
                            <CheckCircle2 className="h-5 w-5" />
                            <div>
                                <p className="font-semibold">Email Service is Working!</p>
                                <p className="text-sm">Check your inbox (and spam folder) for the test email.</p>
                            </div>
                        </div>
                    )}

                    {status === 'error' && (
                        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-md flex items-center gap-2">
                            <XCircle className="h-5 w-5" />
                            <div>
                                <p className="font-semibold">Email Service Failed</p>
                                <p className="text-sm">Check the logs below for error details.</p>
                            </div>
                        </div>
                    )}

                    {/* Logs Console */}
                    <div className="mt-6">
                        <Label className="flex items-center gap-2 mb-2">
                            <Terminal className="h-4 w-4" />
                            Diagnostic Logs
                        </Label>
                        <div className="bg-zinc-950 text-zinc-50 p-4 rounded-md font-mono text-sm min-h-[200px] max-h-[400px] overflow-y-auto whitespace-pre-wrap">
                            {logs.length === 0 ? (
                                <span className="text-zinc-500">Waiting to start test...</span>
                            ) : (
                                logs.map((log, i) => (
                                    <div key={i} className="border-b border-zinc-900/50 pb-1 mb-1 last:border-0">
                                        {log}
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    <div className="bg-blue-50 border border-blue-200 p-4 rounded-md flex gap-3 text-sm text-blue-800">
                        <AlertTriangle className="h-5 w-5 shrink-0" />
                        <div className="space-y-2">
                            <p className="font-semibold">Common Setup Issues:</p>
                            <ul className="list-disc pl-4 space-y-1">
                                <li>
                                    <strong>Unverified Domain:</strong> You cannot send from <code>noreply@updates.amplodge.org</code> unless you have verified <code>updates.amplodge.org</code> in Resend.
                                    <br />
                                    <em>Fix:</em> Verify the domain in Resend, or use <code>onboarding@resend.dev</code> for testing (only to your own email).
                                </li>
                                <li>
                                    <strong>Missing API Key:</strong> Ensure <code>RESEND_API_KEY</code> is set in Netlify Site Settings.
                                </li>
                            </ul>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}
