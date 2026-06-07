'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useUser } from '@/lib/user-context'
import { createClient } from '@/lib/supabase/client'

/**
 * useRoomsUnread — live count of rooms that have unread messages for the
 * current user.
 *
 * "Unread" = at least one row in `room_messages` (status 'visible') whose
 * `created_at` is newer than the current user's `last_read_at` in
 * `room_participants`, across the rooms the user has joined.
 *
 * The count is fetched from `GET /api/rooms/unread` (server-scoped) and then
 * kept live via a single Supabase Realtime subscription on `room_messages` —
 * reusing the exact channel/cleanup pattern already used by the room thread
 * page (`app/(portal)/rooms/[id]/page.tsx`): one channel, subscribe on mount,
 * `supabase.removeChannel(channel)` on unmount. Any INSERT on `room_messages`
 * simply triggers a re-fetch of the authoritative count (debounced via a ref
 * guard), so we never maintain divergent client-side state or leak channels.
 *
 * Returns a number; 0 means "no unread rooms" (callers should hide the badge).
 */
export function useRoomsUnread(): number {
  const user = useUser()
  const [count, setCount] = useState(0)

  // Guards against overlapping fetches and against setting state after unmount.
  const mountedRef = useRef(true)
  const inFlightRef = useRef(false)
  const pendingRef = useRef(false)

  const refresh = useCallback(async () => {
    if (!user) return
    // Coalesce bursts of realtime events into a single trailing fetch.
    if (inFlightRef.current) {
      pendingRef.current = true
      return
    }
    inFlightRef.current = true
    try {
      const res = await fetch('/api/rooms/unread')
      if (!res.ok) return
      const data = await res.json()
      if (mountedRef.current && typeof data.unread_rooms === 'number') {
        setCount(data.unread_rooms)
      }
    } catch {
      // Network/realtime hiccup — keep the last known count.
    } finally {
      inFlightRef.current = false
      if (pendingRef.current && mountedRef.current) {
        pendingRef.current = false
        refresh()
      }
    }
  }, [user])

  // Initial + on-user-change fetch.
  useEffect(() => {
    mountedRef.current = true
    if (user) refresh()
    return () => { mountedRef.current = false }
  }, [user, refresh])

  // Realtime: re-fetch the count whenever a room message is inserted/updated.
  // Mirrors the room thread page subscription (single channel, try/catch for
  // environments where WebSockets are blocked, removeChannel on cleanup).
  useEffect(() => {
    if (!user) return

    let supabase: ReturnType<typeof createClient> | null = null
    let channel: any = null

    try {
      supabase = createClient()
      channel = supabase
        .channel('rooms-unread')
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'room_messages' },
          () => { refresh() }
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'room_messages' },
          () => { refresh() }
        )
        .subscribe()
    } catch {
      // Realtime unavailable; the initial fetch still gives an accurate count.
    }

    return () => {
      if (supabase && channel) {
        supabase.removeChannel(channel)
      }
    }
  }, [user, refresh])

  return count
}
