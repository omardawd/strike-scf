import { redirect } from 'next/navigation'

// Superseded by /home (the actual live dashboard — see app/(portal)/home/page.tsx).
// This route is still linked from several "back to your dashboard" flows
// (KYB, admin, collateral, transactions/new), so it stays as a redirect
// rather than disappearing outright.
export default function DashboardPage() {
  redirect('/home')
}
