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
import { Send, Users, CheckCircle, AlertCircle, Sparkles } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"

// Types
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
            const data = await response.json()

            if (response.ok) {
                toast.success(`Success! Sent to ${data.stats.sent} guests.`)
                setRecipientCount(null) // Reset
                setSelectedTemplate(null) // Close editor?
            } else {
                throw new Error(data.error)
            }
        } catch (err: any) {
            toast.error(err.message || "Failed to send campaign")
        } finally {
            setSending(false)
        }
    }

    if (loading) return <div className="p-8">Loading templates...</div>

    return (
        <div className="container mx-auto p-6 max-w-6xl space-y-8">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">Marketing Center</h1>
                <p className="text-muted-foreground mt-2">
                    Select a template, customize your message, and engage with your guests.
                </p>
            </div>

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
                                    Customize the message before sending. Use <code>{`{{name}}`}</code> to insert guest name.
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

                                <div className="space-y-2 h-full">
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
                            </CardContent>
                            <CardFooter className="justify-between border-t p-6">
                                <Button variant="outline" onClick={() => setSelectedTemplate(null)}>Cancel</Button>

                                <Dialog>
                                    <DialogTrigger asChild>
                                        <Button onClick={handleDryRun} disabled={sending}>
                                            {sending ? 'Analyzing...' : 'Review & Send'}
                                        </Button>
                                    </DialogTrigger>
                                    <DialogContent>
                                        <DialogHeader>
                                            <DialogTitle>Ready to Send?</DialogTitle>
                                            <DialogDescription>
                                                This campaign will be sent to <strong>{recipientCount !== null ? recipientCount : '...'} guests</strong>.
                                            </DialogDescription>
                                        </DialogHeader>
                                        <div className="py-4">
                                            <div className="bg-muted p-4 rounded-md text-sm mb-4">
                                                <p className="font-semibold mb-1">Preview:</p>
                                                <p className="whitespace-pre-wrap">{editContent.replace("{{name}}", "John Doe")}</p>
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
        </div>
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
