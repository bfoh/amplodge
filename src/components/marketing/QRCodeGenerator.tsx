import { useState, useRef } from "react"
import { QRCodeCanvas } from "qrcode.react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "sonner"
import { Printer, Mail, MessageSquare, Download, Share2 } from "lucide-react"
import html2canvas from "html2canvas"

export function QRCodeGenerator() {
    const [url, setUrl] = useState("https://www.amplodge.org")
    const [size, setSize] = useState(300)
    const qrRef = useRef<HTMLDivElement>(null)

    // Email State
    const [emailOpen, setEmailOpen] = useState(false)
    const [emailTo, setEmailTo] = useState("")
    const [emailSubject, setEmailSubject] = useState("AMP Lodge QR Code")
    const [emailSending, setEmailSending] = useState(false)

    // SMS State
    const [smsOpen, setSmsOpen] = useState(false)
    const [smsTo, setSmsTo] = useState("")
    const [smsSending, setSmsSending] = useState(false)

    const handlePrint = () => {
        const printWindow = window.open('', '', 'height=600,width=800');
        if (!printWindow) return;

        // capture the QR code canvas data URL
        const canvas = qrRef.current?.querySelector('canvas');
        if (!canvas) return;
        const dataUrl = canvas.toDataURL();

        printWindow.document.write('<html><head><title>Print QR Code</title>');
        printWindow.document.write('</head><body style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;">');
        printWindow.document.write(`<img src="${dataUrl}" style="width: 500px; max-width: 100%;" />`);
        printWindow.document.write(`<p style="font-family:sans-serif;margin-top:20px;font-size:24px;">${url}</p>`);
        printWindow.document.write('</body></html>');
        printWindow.document.close();
        printWindow.focus();
        setTimeout(() => {
            printWindow.print();
        }, 500);
    }

    const handleDownload = () => {
        const canvas = qrRef.current?.querySelector('canvas');
        if (!canvas) return;
        const dataUrl = canvas.toDataURL('image/png');
        const link = document.createElement('a');
        link.href = dataUrl;
        link.download = 'amplodge-qr.png';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    const handleSendEmail = async () => {
        if (!emailTo) return toast.error("Please enter an email address");

        setEmailSending(true);
        try {
            const canvas = qrRef.current?.querySelector('canvas');
            if (!canvas) throw new Error("Could not generate QR code image");

            // Convert to base64
            const dataUrl = canvas.toDataURL('image/png');
            // Remove header
            // const base64Content = dataUrl.split(',')[1];

            const response = await fetch('/.netlify/functions/send-email', {
                method: 'POST',
                body: JSON.stringify({
                    to: emailTo,
                    subject: emailSubject,
                    html: `
                        <h2>Here is the QR Code for AMP Lodge</h2>
                        <p>Scan this code to visit our website.</p>
                        <p>Or visit: <a href="${url}">${url}</a></p>
                    `,
                    attachments: [
                        {
                            filename: 'amplodge-qr.png',
                            content: dataUrl, // Function handles data URI
                            contentType: 'image/png'
                        }
                    ]
                })
            });

            const data = await response.json();
            if (response.ok && data.success) {
                toast.success("Email sent successfully!");
                setEmailOpen(false);
                setEmailTo("");
            } else {
                throw new Error(data.error || "Failed to send email");
            }
        } catch (err: any) {
            toast.error(err.message);
        } finally {
            setEmailSending(false);
        }
    }

    const handleSendSMS = async () => {
        if (!smsTo) return toast.error("Please enter a phone number");

        setSmsSending(true);
        try {
            const response = await fetch('/.netlify/functions/send-sms', {
                method: 'POST',
                body: JSON.stringify({
                    to: smsTo,
                    message: `Visit AMP Lodge website here: ${url}`
                })
            });

            const data = await response.json();

            // Check nested success structure from existing SMS function logic
            // The function returns { success: true, results: { sms: ... } } on success
            if (response.ok && data.success) {
                toast.success("SMS sent successfully!");
                setSmsOpen(false);
                setSmsTo("");
            } else {
                throw new Error(data.error || "Failed to send SMS");
            }
        } catch (err: any) {
            toast.error(err.message);
        } finally {
            setSmsSending(false);
        }
    }

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <Card>
                <CardHeader>
                    <CardTitle>QR Code Settings</CardTitle>
                    <CardDescription>Configure the QR code content and size.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label>Target URL</Label>
                        <Input
                            value={url}
                            onChange={(e) => setUrl(e.target.value)}
                            placeholder="https://www.amplodge.org"
                        />
                    </div>
                </CardContent>
                <CardFooter className="flex-col gap-2 items-start">
                    <p className="text-sm text-muted-foreground">
                        This QR code directs users to the main website. You can print it for marketing materials or send it directly to guests.
                    </p>
                </CardFooter>
            </Card>

            <Card className="flex flex-col items-center justify-center p-6 bg-slate-50">
                <div ref={qrRef} className="bg-white p-4 rounded-xl shadow-sm border mb-6">
                    <QRCodeCanvas
                        value={url}
                        size={size}
                        level={"H"}
                        includeMargin={true}
                        imageSettings={{
                            src: "/amp-logo.png",
                            x: undefined,
                            y: undefined,
                            height: size * 0.2, // 20% of size
                            width: size * 0.2,
                            excavate: true,
                        }}
                    />
                </div>

                <div className="flex flex-wrap gap-2 justify-center">
                    <Button onClick={handlePrint} variant="outline" className="gap-2">
                        <Printer className="w-4 h-4" />
                        Print
                    </Button>
                    <Button onClick={handleDownload} variant="outline" className="gap-2">
                        <Download className="w-4 h-4" />
                        Download
                    </Button>

                    <Dialog open={emailOpen} onOpenChange={setEmailOpen}>
                        <DialogTrigger asChild>
                            <Button variant="outline" className="gap-2">
                                <Mail className="w-4 h-4" />
                                Email
                            </Button>
                        </DialogTrigger>
                        <DialogContent>
                            <DialogHeader>
                                <DialogTitle>Send QR Code via Email</DialogTitle>
                                <DialogDescription>Send the QR code image as an attachment.</DialogDescription>
                            </DialogHeader>
                            <div className="space-y-4 py-4">
                                <div className="space-y-2">
                                    <Label>Recipient Email</Label>
                                    <Input
                                        type="email"
                                        placeholder="guest@example.com"
                                        value={emailTo}
                                        onChange={(e) => setEmailTo(e.target.value)}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>Subject</Label>
                                    <Input
                                        value={emailSubject}
                                        onChange={(e) => setEmailSubject(e.target.value)}
                                    />
                                </div>
                            </div>
                            <DialogFooter>
                                <Button variant="outline" onClick={() => setEmailOpen(false)}>Cancel</Button>
                                <Button onClick={handleSendEmail} disabled={emailSending || !emailTo}>
                                    {emailSending ? "Sending..." : "Send Email"}
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>

                    <Dialog open={smsOpen} onOpenChange={setSmsOpen}>
                        <DialogTrigger asChild>
                            <Button variant="outline" className="gap-2">
                                <MessageSquare className="w-4 h-4" />
                                SMS
                            </Button>
                        </DialogTrigger>
                        <DialogContent>
                            <DialogHeader>
                                <DialogTitle>Send Link via SMS</DialogTitle>
                                <DialogDescription>
                                    Note: This will send the text URL via SMS. Images are not supported by the SMS gateway.
                                </DialogDescription>
                            </DialogHeader>
                            <div className="space-y-4 py-4">
                                <div className="space-y-2">
                                    <Label>Phone Number</Label>
                                    <Input
                                        placeholder="0551234567"
                                        value={smsTo}
                                        onChange={(e) => setSmsTo(e.target.value)}
                                    />
                                </div>
                            </div>
                            <DialogFooter>
                                <Button variant="outline" onClick={() => setSmsOpen(false)}>Cancel</Button>
                                <Button onClick={handleSendSMS} disabled={smsSending || !smsTo}>
                                    {smsSending ? "Sending..." : "Send SMS"}
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                </div>
            </Card>
        </div>
    )
}
