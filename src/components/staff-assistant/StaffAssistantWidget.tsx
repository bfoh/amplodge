import { useState } from 'react'
import { Bot, X } from 'lucide-react'
import { useStaffAssistant } from './useStaffAssistant'
import { MessageList } from './MessageList'
import { ChatInput } from './ChatInput'

export default function StaffAssistantWidget() {
  const [isOpen, setIsOpen] = useState(false)
  const { messages, sendMessage, resolveAction, cancelAction, isLoading } = useStaffAssistant()

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end">
      {isOpen && (
        <div className="mb-4 w-80 md:w-96 bg-background rounded-2xl shadow-2xl overflow-hidden border border-border flex flex-col h-[520px]">
          <div className="bg-primary p-4 flex justify-between items-center text-primary-foreground">
            <div className="flex items-center gap-2">
              <Bot className="h-4 w-4" />
              <h3 className="font-medium text-sm">Staff Assistant</h3>
            </div>
            <button onClick={() => setIsOpen(false)} className="hover:bg-primary-foreground/10 p-1 rounded-full transition-colors">
              <X size={18} />
            </button>
          </div>

          <MessageList
            messages={messages}
            isLoading={isLoading}
            onResolveAction={resolveAction}
            onCancelAction={cancelAction}
          />

          <ChatInput onSend={sendMessage} disabled={isLoading} />
        </div>
      )}

      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="flex items-center justify-center w-14 h-14 bg-primary text-primary-foreground rounded-full shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-300"
          aria-label="Open staff assistant"
        >
          <Bot size={24} />
        </button>
      )}
    </div>
  )
}
