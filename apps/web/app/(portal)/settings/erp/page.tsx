'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function ErpSettingsRedirect() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/settings?tab=erp')
  }, [router])
  return null
}
