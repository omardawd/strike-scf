import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { PortalProvider, type PortalType } from '@/lib/portal-context'
import { UserProvider, type UserOrg } from '@/lib/user-context'
import { PortalShell } from './portal-shell'
import { KybStatusPage } from '@/components/kyb-status-page'
import { isDemoAccount } from '@/lib/demo'
import { DemoConductor } from '@/components/demo/DemoConductor'

const adminClient = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function derivePortal(role: string): PortalType {
  if (role === 'bank_admin' || role === 'bank_credit_officer') return 'bank'
  if (role === 'strike_admin') return 'admin'
  // org_admin / org_member — any org, no more anchor/supplier sub-portal
  return 'org'
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

  // Load the org for marketplace context. An org user with no bank_id is valid —
  // there is no bank gate here anymore.
  let org: UserOrg | null = null
  if (userData.org_id) {
    const { data: orgData } = await adminClient
      .from('organizations')
      .select('type, status, kyb_status, network_visible, passport_score')
      .eq('id', userData.org_id)
      .single()
    if (orgData) {
      org = {
        type: orgData.type,
        status: orgData.status,
        kyb_status: orgData.kyb_status ?? 'not_started',
        network_visible: orgData.network_visible ?? false,
        passport_score: orgData.passport_score ?? null,
      }
    }
  }

  const portal = derivePortal(userData.role ?? '')

  // Central platform-access gate: an org must be KYB-approved to use the
  // platform at all. Bank/admin users have no org and always pass through.
  // Non-approved orgs see ONLY the status page — no sidebar, no other route
  // is reachable — until Strike approves their application.
  const needsKybGate = !!org && org.kyb_status !== 'approved'
  const isDemo = isDemoAccount(userData.email)

  return (
    <PortalProvider portal={portal}>
      <UserProvider user={{
        id: userData.id,
        full_name: userData.full_name ?? '',
        email: userData.email ?? user.email ?? '',
        role: userData.role ?? '',
        org_id: userData.org_id ?? null,
        bank_id: userData.bank_id ?? null,
        org,
      }}>
        {needsKybGate ? (
          <KybStatusPage />
        ) : (
          <PortalShell portal={portal} userName={userData.full_name ?? undefined}>
            {isDemo ? <DemoConductor>{children}</DemoConductor> : children}
          </PortalShell>
        )}
      </UserProvider>
    </PortalProvider>
  )
}
