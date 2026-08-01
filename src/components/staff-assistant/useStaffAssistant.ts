import { useCallback, useEffect, useRef, useState } from 'react'
import { auth } from '@/lib/db'
import { callFunction } from '@/lib/api'
import { useStaffRole } from '@/hooks/use-staff-role'
import { hasPermission } from '@/lib/rbac'
import { executeTool, READ_ONLY_TOOLS, HOOK_EXECUTED_TOOLS, TOOL_PERMISSIONS, type ToolResult, type StaffCtx } from '@/services/staff-assistant-tools'
import type { ChatMessage } from './types'

// Anthropic Messages API turn shapes. A tool call round-trip is two turns:
// an assistant turn carrying the tool_use block (id/name/input) exactly as
// Claude proposed it, then a user turn carrying the matching tool_result
// (referenced by tool_use_id) once it's been executed (or cancelled/denied).
type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: any }
  | { type: 'tool_result'; tool_use_id: string; content: string }
type ClaudeTurn = { role: 'user' | 'assistant'; content: string | ContentBlock[] }

type AssistantResponse = { type: 'text'; text: string } | { type: 'tool_call'; id: string; name: string; args: any }

function uid() {
  return crypto.randomUUID()
}

export function useStaffAssistant() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const historyRef = useRef<ClaudeTurn[]>([])
  const { role, staffRecord } = useStaffRole()

  const staffCtx = useRef<StaffCtx>({})
  useEffect(() => {
    auth.me().then((u: any) => {
      staffCtx.current = { id: u?.id, name: staffRecord?.name || u?.email, staffId: staffRecord?.id }
    }).catch(() => {})
  }, [staffRecord])

  const callAssistant = useCallback(async (history: ClaudeTurn[]): Promise<AssistantResponse> => {
    const res = await callFunction('staff-assistant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ history }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(body?.error || `Assistant request failed (${res.status})`)
    }
    return body as AssistantResponse
  }, [])

  const feedToolResult = useCallback(async (id: string, name: string, args: any, result: ToolResult) => {
    historyRef.current.push({ role: 'assistant', content: [{ type: 'tool_use', id, name, input: args }] })
    historyRef.current.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: JSON.stringify(result) }] })
    setIsLoading(true)
    try {
      const resp = await callAssistant(historyRef.current)
      await handleAssistantResponse(resp)
    } catch (err: any) {
      setMessages((m) => [...m, { id: uid(), role: 'assistant', text: `Sorry, something went wrong: ${err.message}` }])
    } finally {
      setIsLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callAssistant])

  const handleAssistantResponse = useCallback(async (resp: AssistantResponse) => {
    if (resp.type === 'text') {
      historyRef.current.push({ role: 'assistant', content: resp.text })
      setMessages((m) => [...m, { id: uid(), role: 'assistant', text: resp.text }])
      return
    }

    const { id, name, args } = resp

    // Permission check applies to ANY gated tool — both admin/manager-only
    // read tools (e.g. getHotelRevenue) and write tools. Read tools get
    // blocked outright (no card needed either way); write tools never even
    // reach the confirmation card if the role can't do it.
    const perm = TOOL_PERMISSIONS[name]
    if (perm && role && !hasPermission(role, perm.resource, perm.action)) {
      const denial: ToolResult = { ok: false, error: `Your role doesn't have permission to do that. Ask a manager or admin.` }
      setMessages((m) => [...m, { id: uid(), role: 'assistant', text: denial.error }])
      await feedToolResult(id, name, args, denial)
      return
    }

    if (READ_ONLY_TOOLS.has(name)) {
      const result = await executeTool(name, args, staffCtx.current)
      await feedToolResult(id, name, args, result)
      return
    }

    setMessages((m) => [...m, { id: uid(), role: 'assistant', pendingAction: { id, name, args }, actionStatus: 'pending' }])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, feedToolResult])

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    setMessages((m) => [...m, { id: uid(), role: 'user', text: trimmed }])
    historyRef.current.push({ role: 'user', content: trimmed })
    setIsLoading(true)
    try {
      const resp = await callAssistant(historyRef.current)
      await handleAssistantResponse(resp)
    } catch (err: any) {
      setMessages((m) => [...m, { id: uid(), role: 'assistant', text: `Sorry, something went wrong: ${err.message}` }])
    } finally {
      setIsLoading(false)
    }
  }, [callAssistant, handleAssistantResponse])

  /** Called by ActionCard once it has executed (or the staff cancelled) a pending write action. */
  const resolveAction = useCallback(async (messageId: string, id: string, name: string, args: any, result: ToolResult) => {
    setMessages((m) => m.map((msg) =>
      msg.id === messageId
        ? { ...msg, actionStatus: 'done', actionResult: { ok: result.ok, summary: 'ok' in result && result.ok ? result.humanSummary : ('error' in result ? result.error : 'Cancelled.') } }
        : msg
    ))
    await feedToolResult(id, name, args, result)
  }, [feedToolResult])

  const cancelAction = useCallback(async (messageId: string, id: string, name: string, args: any) => {
    setMessages((m) => m.map((msg) => (msg.id === messageId ? { ...msg, actionStatus: 'cancelled' } : msg)))
    await feedToolResult(id, name, args, { ok: false, error: 'Staff cancelled this action before it happened.' })
  }, [feedToolResult])

  return { messages, sendMessage, resolveAction, cancelAction, isLoading, role, staffCtx: staffCtx.current }
}

export { HOOK_EXECUTED_TOOLS }
