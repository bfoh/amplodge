import { supabase } from './supabase'

/**
 * Call a Netlify function with the current Supabase session token attached.
 *
 * Use this for any privileged netlify function that requires staff/admin auth.
 * For public endpoints (booking, guest portal) plain fetch() is fine.
 *
 * Example:
 *   const res = await callFunction('create-employee', {
 *     method: 'POST',
 *     body: JSON.stringify({ email, password }),
 *     headers: { 'Content-Type': 'application/json' },
 *   })
 */
export async function callFunction(name: string, init: RequestInit = {}): Promise<Response> {
  const { data: { session } } = await supabase.auth.getSession()
  const headers = new Headers(init.headers)
  if (session?.access_token) {
    headers.set('Authorization', `Bearer ${session.access_token}`)
  }
  return fetch(`/.netlify/functions/${name}`, { ...init, headers })
}
