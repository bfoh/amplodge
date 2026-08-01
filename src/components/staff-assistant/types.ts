export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text?: string
  pendingAction?: { id: string; name: string; args: any }
  actionStatus?: 'pending' | 'executing' | 'done' | 'cancelled'
  actionResult?: { ok: boolean; summary: string }
}
