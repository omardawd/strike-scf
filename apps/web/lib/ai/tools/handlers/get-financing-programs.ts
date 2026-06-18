import { createClient as createAdmin } from '@supabase/supabase-js'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export interface GetFinancingProgramsInput {
  org_id: string
}

export async function getFinancingPrograms(input: GetFinancingProgramsInput) {
  const { org_id } = input

  // Find programs the org is enrolled in (active enrollments)
  const { data: enrollments, error: enrollErr } = await adminClient
    .from('program_enrollments')
    .select(`
      id,
      status,
      programs (
        id,
        name,
        financing_types,
        program_limit,
        per_supplier_sublimit,
        min_deal_size,
        max_deal_size,
        standard_tenor_days,
        currency,
        discount_schedule,
        status,
        banks ( display_name, legal_name )
      )
    `)
    .eq('org_id', org_id)
    .eq('status', 'active')

  if (enrollErr) return { error: 'Failed to fetch financing programs.' }

  if (!enrollments || enrollments.length === 0) {
    return {
      enrolled_programs: [],
      message: 'This organization is not currently enrolled in any active financing programs on Strike. They should contact their bank or anchor buyer to request enrollment, or explore Strike Place for open financing requests.',
    }
  }

  const programs = enrollments
    .map(e => {
      const p = e.programs as unknown as Record<string, unknown> | null
      if (!p) return null
      const bank = p.banks as Record<string, unknown> | null
      return {
        program_id: p.id,
        program_name: p.name,
        bank_name: (bank?.display_name ?? bank?.legal_name) as string | null,
        financing_types: p.financing_types as string[],
        program_limit: p.program_limit,
        per_supplier_sublimit: p.per_supplier_sublimit,
        min_deal_size: p.min_deal_size,
        max_deal_size: p.max_deal_size,
        standard_tenor_days: p.standard_tenor_days,
        currency: p.currency,
        status: p.status,
        discount_schedule: p.discount_schedule,
      }
    })
    .filter(Boolean)

  return { enrolled_programs: programs }
}
