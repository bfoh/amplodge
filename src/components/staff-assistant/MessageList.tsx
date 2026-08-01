import { useEffect, useRef } from 'react'
import { Loader2 } from 'lucide-react'
import { ActionCard } from './ActionCard'
import type { ChatMessage } from './types'
import type { ToolResult } from '@/services/staff-assistant-tools'

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
                  ? 'bg-primary text-primary-foreground rounded-br-none'
                  : 'bg-muted text-foreground rounded-bl-none'
              }`}
            >
              {msg.text}
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
