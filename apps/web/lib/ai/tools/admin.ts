import { createClient } from '@supabase/supabase-js'

// Shared service-role Supabase client for all AI tool handlers.
// Typed as `any` so query result properties resolve identically to inline adminClient declarations
// in existing route files (supabase-js v2.105+ infers GenericStringError for exported generics).
// Bypasses RLS — every handler must manually scope queries to the relevant org/bank/deal.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const adminClient: any = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)
