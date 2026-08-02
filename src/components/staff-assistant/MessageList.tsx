import { useEffect, useRef } from 'react'
import { Loader2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ActionCard } from './ActionCard'
import type { ChatMessage } from './types'
import type { ToolResult } from '@/services/staff-assistant-tools'

/**
 * Renders assistant replies as markdown (tables, bold labels, lists) instead
 * of a raw text blob — the model is asked to format with markdown, so this
 * is what turns that into something readable instead of literal `|` pipes.
 */
function AssistantMarkdown({ text }: { text: string }) {
  return (
    <div className="text-sm leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="my-1.5">{children}</p>,
          strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
          ul: ({ children }) => <ul className="my-1.5 ml-4 list-disc space-y-0.5">{children}</ul>,
          ol: ({ children }) => <ol className="my-1.5 ml-4 list-decimal space-y-0.5">{children}</ol>,
          li: ({ children }) => <li className="pl-0.5">{children}</li>,
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">
              {children}
            </a>
          ),
          code: ({ children }) => (
            <code className="rounded bg-background/60 px-1 py-0.5 font-mono text-[0.85em]">{children}</code>
          ),
          hr: () => <hr className="my-2 border-border" />,
          h1: ({ children }) => <p className="mt-2 mb-1 font-semibold text-foreground">{children}</p>,
          h2: ({ children }) => <p className="mt-2 mb-1 font-semibold text-foreground">{children}</p>,
          h3: ({ children }) => <p className="mt-2 mb-1 font-semibold text-foreground">{children}</p>,
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto rounded-lg border border-border">
              <table className="w-full border-collapse text-xs">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-background/60">{children}</thead>,
          th: ({ children }) => (
            <th className="border-b border-border px-2 py-1.5 text-left font-medium text-muted-foreground">{children}</th>
          ),
          td: ({ children }) => <td className="border-b border-border/60 px-2 py-1.5 last:border-r-0">{children}</td>,
          tr: ({ children }) => <tr className="last:[&>td]:border-b-0">{children}</tr>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}

export function MessageList({
  messages,
  isLoading,
  onResolveAction,
  onCancelAction,
}: {
  messages: ChatMessage[]
  isLoading: boolean
  onResolveAction: (messageId: string, id: string, name: string, args: any, result: ToolResult) => void
  onCancelAction: (messageId: string, id: string, name: string, args: any) => void
}) {
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

  if (messages.length === 0) {
    return (
      <div className="text-center text-muted-foreground mt-10 text-sm px-4">
        <p>Hi! I can help with bookings, check-in/out, extending stays, group bookings, charges, and availability.</p>
        <p className="mt-2">Try: "check in room 105, cash" or "who's arriving today?"</p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3">
      {messages.map((msg) => (
        <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
          {msg.pendingAction ? (
            <div className="max-w-[90%] w-full">
              <ActionCard
                name={msg.pendingAction.name}
                args={msg.pendingAction.args}
                status={msg.actionStatus}
                result={msg.actionResult}
                onResolved={(result) => onResolveAction(msg.id, msg.pendingAction!.id, msg.pendingAction!.name, msg.pendingAction!.args, result)}
                onCancel={() => onCancelAction(msg.id, msg.pendingAction!.id, msg.pendingAction!.name, msg.pendingAction!.args)}
              />
            </div>
          ) : (
            <div
              className={`max-w-[85%] px-3 py-2 rounded-2xl text-sm ${
                msg.role === 'user'
                  ? 'bg-primary text-primary-foreground rounded-br-none whitespace-pre-wrap'
                  : 'bg-muted text-foreground rounded-bl-none'
              }`}
            >
              {msg.role === 'user' ? msg.text : <AssistantMarkdown text={msg.text} />}
            </div>
          )}
        </div>
      ))}

      {isLoading && (
        <div className="flex justify-start">
          <div className="bg-muted px-3 py-2 rounded-2xl rounded-bl-none flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Thinking...
          </div>
        </div>
      )}
      <div ref={endRef} />
    </div>
  )
}
