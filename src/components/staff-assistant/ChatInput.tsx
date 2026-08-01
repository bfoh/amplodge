import { useState } from 'react'
import { Send } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function ChatInput({ onSend, disabled }: { onSend: (text: string) => void; disabled?: boolean }) {
  const [value, setValue] = useState('')

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!value.trim() || disabled) return
    onSend(value)
    setValue('')
  }

  return (
    <form onSubmit={submit} className="flex items-center gap-2 p-3 border-t border-border bg-background">
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Ask me to book, check in, extend a stay..."
        disabled={disabled}
        className="flex-1 px-3 py-2 bg-muted rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-60"
      />
      <Button type="submit" size="icon" className="h-9 w-9 rounded-full shrink-0" disabled={disabled || !value.trim()}>
        <Send className="h-4 w-4" />
      </Button>
    </form>
  )
}
