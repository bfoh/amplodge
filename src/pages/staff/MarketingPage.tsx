import { useState, useEffect } from "react"
// import { useAuth } from "@/context/AuthContext"
import { supabase } from "@/lib/supabase"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"
import { Send, Users, CheckCircle, AlertCircle, Sparkles, Wand2 } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"

// Types
import { QRCodeGenerator } from "@/components/marketing/QRCodeGenerator"

type Template = {
    id: string
    name: string
    channel: 'sms' | 'email'
    subject?: string
    content: string
}

export default function MarketingPage() {
    // const { user } = useAuth() // Unused

    const [templates, setTemplates] = useState<Template[]>([])
    const [loading, setLoading] = useState(true)
    const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null)

    // AI State
    const [aiPrompt, setAiPrompt] = useState("")
    const [generating, setGenerating] = useState(false)

    // Editor State
    const [editContent, setEditContent] = useState("")
    const [editSubject, setEditSubject] = useState("")

    // Sending State
    const [sending, setSending] = useState(false)
    const [recipientCount, setRecipientCount] = useState<number | null>(null)

    useEffect(() => {
        fetchTemplates()
    }, [])

    const fetchTemplates = async () => {
        try {
            const { data, error } = await supabase
                .from('marketing_templates')
                .select('*')
                .order('name')

            if (error) throw error
            setTemplates(data || [])
        } catch (err) {
            console.error('Error loading templates:', err)
            toast.error("Failed to load templates")
        } finally {
            setLoading(false)
        }
    }

    const handleSelectTemplate = (template: Template) => {
        setSelectedTemplate(template)
        setEditContent(template.content)
        setEditSubject(template.subject || "")
        // Reset stats
        setRecipientCount(null)
    }

    const handleDryRun = async () => {
        if (!selectedTemplate) return
        setSending(true)
        try {
            // Call Backend with dryRun=true
            const response = await fetch('/.netlify/functions/trigger-campaign', {
                method: 'POST',
                body: JSON.stringify({
                    channel: selectedTemplate.channel,
                    content: editContent,
                    subject: editSubject,
                    dryRun: true
                })
            })
            const data = await response.json()
            if (response.ok) {
                setRecipientCount(data.recipientCount)
            } else {
                throw new Error(data.error)
            }
        } catch (err: any) {
            toast.error(err.message || "Failed to estimate recipients")
        } finally {
            setSending(false)
        }
    }

    const handleSendCampaign = async () => {
        if (!selectedTemplate) return
        setSending(true)
        try {
            const response = await fetch('/.netlify/functions/trigger-campaign', {
                method: 'POST',
                body: JSON.stringify({
                    channel: selectedTemplate.channel,
                    content: editContent,
                    subject: editSubject,
                    dryRun: false
                })
            })
            const rawText = await response.text();
            let data;
            try {
                data = JSON.parse(rawText);
            } catch (e) {
                console.error("Non-JSON Response:", rawText);
                throw new Error(`Server Error: ${response.status} (${response.statusText}). Likely timeout due to high volume.`);
            }

            if (response.ok) {
                const { sent, failed, skipped, total } = data.stats;
                let msg = `Sent: ${sent}`;
                if (failed > 0) msg += `, Failed: ${failed}`;
                if (skipped > 0) msg += `, Skipped: ${skipped} (missing contact info)`;

                if (sent === 0 && skipped === total) {
                    toast.warning("No messages sent. All guests were skipped (missing email/phone).");
                } else {
                    toast.success(`Campaign Complete! ${msg}`);
                }

                setRecipientCount(null)
                setSelectedTemplate(null)
            } else {
                throw new Error(data.error || "Unknown error")
            }
        } catch (err: any) {
            toast.error(err.message || "Failed to send campaign")
        } finally {
            setSending(false)
        }
    }

    const handleGenerateAI = async () => {
        if (!selectedTemplate) return
        if (!aiPrompt.trim()) {
            toast.error("Please enter an instruction for the AI")
            return
        }

        setGenerating(true)
        try {
            const response = await fetch('/.netlify/functions/generate-marketing-copy', {
                method: 'POST',
                body: JSON.stringify({
                    currentContent: editContent,
                    userPrompt: aiPrompt,
                    channel: selectedTemplate.channel
                })
            })

            const rawText = await response.text()
            let data
            try {
                data = JSON.parse(rawText)
            } catch (e) {
                console.error("JSON Parse Error. Raw response:", rawText)
                throw new Error(`Server Error: ${response.status} ${response.statusText}. Check console for details.`)
            }

            if (response.ok) {
                setEditContent(data.generatedText)
                toast.success("Content generated!")
                setAiPrompt("") // Clear prompt after success? Or keep it? keeping it might be better for iteration.
            } else {
                throw new Error(data.error || "Unknown server error")
            }
        } catch (err: any) {
            console.error(err)
            toast.error("AI Generation failed: " + err.message)
        } finally {
            setGenerating(false)
        }
    }

    if (loading) return <div className="p-8">Loading templates...</div>


    return (
        <div className="container mx-auto p-6 max-w-6xl space-y-8">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Marketing Center</h1>
                    <p className="text-muted-foreground mt-2">
                        Manage your marketing campaigns and tools.
                    </p>
                </div>
            </div>

            <Tabs defaultValue="campaigns" className="w-full">
                <TabsList className="mb-4 w-full justify-start border-b rounded-none h-auto p-0 bg-transparent space-x-6">
                    <TabsTrigger
                        value="campaigns"
                        className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2"
                    >
                        Campaigns & Templates
                    </TabsTrigger>
                    <TabsTrigger
                        value="qrcode"
                        className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2"
                    >
                        QR Code Generator
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="campaigns" className="mt-6">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {/* Template List */}
                        <div className="md:col-span-1 space-y-4">
                            <h2 className="text-lg font-semibold">Templates</h2>
                            <Tabs defaultValue="all" className="w-full">
                                <TabsList className="w-full">
                                    <TabsTrigger value="all" className="flex-1">All</TabsTrigger>
                                    <TabsTrigger value="sms" className="flex-1">SMS</TabsTrigger>
                                    <TabsTrigger value="email" className="flex-1">Email</TabsTrigger>
                                </TabsList>
                                <TabsContent value="all" className="space-y-3 mt-4">
                                    {templates.map(t => (
                                        <TemplateCard key={t.id} template={t} onClick={() => handleSelectTemplate(t)} active={selectedTemplate?.id === t.id} />
                                    ))}
                                </TabsContent>
                                <TabsContent value="sms" className="space-y-3 mt-4">
                                    {templates.filter(t => t.channel === 'sms').map(t => (
                                        <TemplateCard key={t.id} template={t} onClick={() => handleSelectTemplate(t)} active={selectedTemplate?.id === t.id} />
                                    ))}
                                </TabsContent>
                                <TabsContent value="email" className="space-y-3 mt-4">
                                    {templates.filter(t => t.channel === 'email').map(t => (
                                        <TemplateCard key={t.id} template={t} onClick={() => handleSelectTemplate(t)} active={selectedTemplate?.id === t.id} />
                                    ))}
                                </TabsContent>
                            </Tabs>
                        </div>

                        {/* Editor Area */}
                        <div className="md:col-span-2">
                            {selectedTemplate ? (
                                <Card className="h-full flex flex-col">
                                    <CardHeader>
                                        <CardTitle className="flex justify-between items-center">
                                            <span>Edit Campaign</span>
                                            <span className="text-xs uppercase bg-secondary px-2 py-1 rounded">{selectedTemplate.channel}</span>
                                        </CardTitle>
                                        <CardDescription>
                                            Customize the message before sending. Use <code>{`{{name}}`}</code> for name and <code>{`{{guest_link}}`}</code> for the guest portal URL.
                                        </CardDescription>
                                    </CardHeader>
                                    <CardContent className="space-y-4 flex-1">
                                        {selectedTemplate.channel === 'email' && (
                                            <div className="space-y-2">
                                                <Label>Subject Line</Label>
                                                <Input
                                                    value={editSubject}
                                                    onChange={e => setEditSubject(e.target.value)}
                                                    placeholder="Email Subject..."
                                                />
                                            </div>
                                        )}

                                        <div className="space-y-2 flex flex-col min-h-[150px]">
                                            <Label>Message Content</Label>
                                            <Textarea
                                                value={editContent}
                                                onChange={e => setEditContent(e.target.value)}
                                                className={selectedTemplate.channel === 'email' ? "min-h-[300px] font-mono text-sm" : "min-h-[150px]"}
                                                placeholder="Type your message..."
                                            />
                                            {selectedTemplate.channel === 'sms' && (
                                                <p className="text-xs text-muted-foreground text-right">
                                                    {editContent.length} characters (approx {Math.ceil(editContent.length / 160)} segments)
                                                </p>
                                            )}
                                        </div>


                                        {/* AI Generator Section */}
                                        <div className="pt-4 border-t space-y-3 bg-muted/20 p-4 rounded-lg">
                                            <div className="flex items-center gap-2">
                                                <Wand2 className="w-4 h-4 text-purple-600" />
                                                <Label className="text-purple-900 font-semibold">AI Assistant</Label>
                                            </div>
                                            <div className="flex gap-2">
                                                <Input
                                                    value={aiPrompt}
                                                    onChange={e => setAiPrompt(e.target.value)}
                                                    placeholder="E.g., 'Make it more exciting for Christmas' or 'Shorten this'"
                                                    className="bg-white"
                                                    onKeyDown={e => {
                                                        if (e.key === 'Enter' && !e.shiftKey) {
                                                            e.preventDefault()
                                                            handleGenerateAI()
                                                        }
                                                    }}
                                                />
                                                <Button
                                                    onClick={handleGenerateAI}
                                                    disabled={generating || !aiPrompt.trim()}
                                                    variant="secondary"
                                                    className="shrink-0 bg-purple-100 text-purple-700 hover:bg-purple-200"
                                                >
                                                    {generating ? (
                                                        <Sparkles className="w-4 h-4 animate-spin mr-2" />
                                                    ) : (
                                                        <Sparkles className="w-4 h-4 mr-2" />
                                                    )}
                                                    {generating ? 'Writing...' : 'Generate'}
                                                </Button>
                                            </div>
                                            <p className="text-[10px] text-muted-foreground">
                                                Powered by Gemini. The AI will rewrite your current message based on your instructions.
                                            </p>
                                        </div>
                                    </CardContent>
                                    <CardFooter className="justify-between border-t p-6">
                                        <Button variant="outline" onClick={() => setSelectedTemplate(null)}>Cancel</Button>

                                        <Dialog>
                                            <DialogTrigger asChild>
                                                <Button onClick={handleDryRun} disabled={sending}>
                                                    {sending ? 'Analyzing...' : 'Review & Send'}
                                                </Button>
                                            </DialogTrigger>
                                            <DialogContent className="max-h-[85vh] overflow-y-auto">
                                                <DialogHeader>
                                                    <DialogTitle>Ready to Send?</DialogTitle>
                                                    <DialogDescription>
                                                        This campaign will be sent to <strong>{recipientCount !== null ? recipientCount : '...'} guests</strong>.
                                                    </DialogDescription>
                                                </DialogHeader>
                                                <div className="py-4">
                                                    <div className="bg-muted p-4 rounded-md text-sm mb-4">
                                                        <p className="font-semibold mb-1">Preview:</p>
                                                        <p className="whitespace-pre-wrap">{editContent.replace("{{name}}", "John Doe").replace("{{guest_link}}", "https://amplodge.org/guest/...")}</p>
                                                    </div>
                                                    {recipientCount === 0 && (
                                                        <p className="text-red-500 text-sm">No eligible guests found to receive this message.</p>
                                                    )}
                                                </div>
                                                <DialogFooter>
                                                    <Button variant="outline" onClick={() => setRecipientCount(null)}>Back to Edit</Button>
                                                    <Button onClick={handleSendCampaign} disabled={sending || recipientCount === 0} className="bg-green-600 hover:bg-green-700">
                                                        {sending ? 'Sending...' : 'Confirm & Send'}
                                                    </Button>
                                                </DialogFooter>
                                            </DialogContent>
                                        </Dialog>
                                    </CardFooter>
                                </Card>
                            ) : (
                                <div className="h-full flex items-center justify-center border-2 border-dashed rounded-xl p-12 text-center text-muted-foreground bg-slate-50">
                                    <div className="space-y-4">
                                        <Sparkles className="h-12 w-12 mx-auto text-slate-300" />
                                        <p>Select a template from the left to get started.</p>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </TabsContent>

                <TabsContent value="qrcode" className="mt-6">
                    <QRCodeGenerator />
                </TabsContent>
            </Tabs>
        </div >
    )
}

function TemplateCard({ template, onClick, active }: { template: Template; onClick: () => void; active: boolean }) {
    return (
        <div
            onClick={onClick}
            className={`p-4 rounded-lg border cursor-pointer transition-all hover:bg-accent ${active ? 'border-primary ring-1 ring-primary bg-accent' : 'bg-card'}`}
        >
            <div className="flex justify-between items-start mb-2">
                <h3 className="font-medium text-sm">{template.name}</h3>
                {template.channel === 'sms' ? (
                    <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">SMS</span>
                ) : (
                    <span className="text-[10px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">EMAIL</span>
                )}
            </div>
            <p className="text-xs text-muted-foreground line-clamp-2">
                {template.content}
            </p>
        </div>
    )
}
