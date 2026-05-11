import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { PortalProvider, type PortalType } from '@/lib/portal-context'
import { UserProvider } from '@/lib/user-context'
import { Sidebar } from '@/components/sidebar'

const adminClient = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function derivePortal(role: string): PortalType {
  if (role === 'bank_admin' || role === 'bank_credit_officer') return 'bank'
  if (role === 'anchor_admin' || role === 'anchor_member') return 'anchor'
  return 'supplier'
}

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userData } = await adminClient
    .from('users')
    .select('id, full_name, email, role, org_id, bank_id')
    .eq('id', user.id)
    .single()

  if (!userData) redirect('/login')

  const portal = derivePortal(userData.role ?? '')

  return (
    <PortalProvider portal={portal}>
      <UserProvider user={{
        id: userData.id,
        full_name: userData.full_name ?? '',
        email: userData.email ?? user.email ?? '',
        role: userData.role ?? '',
        org_id: userData.org_id ?? null,
        bank_id: userData.bank_id ?? null,
      }}>
        <div className="app-shell">
          <Sidebar />
          <main className="main">
            {children}
          </main>
        </div>
      </UserProvider>
    </PortalProvider>
  )
}
