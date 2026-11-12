'use client'

import { useCallback, useEffect, useState } from 'react'
import Layout from '@/components/Layout'
import { Button } from '@/components/ui/button'
import { IntegrationTabs } from '@/components/integrations/IntegrationTabs'
import { IntegrationPanel } from '@/components/integrations/IntegrationPanel'
import api from '@/lib/api'
import type { IntegrationView, IntegrationsPayload } from '@/lib/integrationSettings'
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react'

/**
 * Integrations (ADMIN only): DHM, JPS and KMAPS settings and credentials.
 *
 * Secrets are write-only. The API never returns one - only a hint (prefix, last four, length) - and
 * a secret typed here is dropped from state as soon as it is saved. Leaving a secret field blank
 * means "keep the current one". One integration is shown at a time (a card per integration picks it).
 */
export default function IntegrationsPage() {
  const [data, setData] = useState<IntegrationsPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selected, setSelected] = useState<IntegrationView['id'] | ''>('')
  const [dirty, setDirty] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await api.get('/integrations')
      setData(res.data.data as IntegrationsPayload)
    } catch {
      setLoadError('Gagal memuat konfigurasi integrasi.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Leaving the page with unsaved settings would lose them without a word.
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const integrations = data?.integrations ?? []
  const current = integrations.find((integration) => integration.id === selected) ?? integrations[0] ?? null

  const choose = (id: IntegrationView['id']) => {
    if (current && id === current.id) return
    if (dirty && !window.confirm('Ada perubahan yang belum disimpan. Buang perubahan dan pindah integrasi?')) return
    setDirty(false)
    setSelected(id)
  }

  return (
    <Layout>
      <div className="space-y-5">
        <p className="text-sm text-gray-500">
          Pengaturan integrasi dengan sistem lain. Nilai yang disimpan di sini menggantikan nilai di .env server; credential disimpan
          terenkripsi dan tidak pernah ditampilkan kembali.
        </p>

        {data && !data.secretsKeyConfigured ? (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>
              <span className="font-medium">INTEGRATION_SECRETS_KEY belum dikonfigurasi di server.</span> Credential (private key, API key,
              webhook secret) belum bisa disimpan dari menu ini. Setting lain tetap bisa diubah.
            </span>
          </div>
        ) : null}

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Memuat...
          </div>
        ) : loadError ? (
          <div className="space-y-2">
            <p className="text-sm text-red-600">{loadError}</p>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              <RefreshCw className="mr-2 h-4 w-4" aria-hidden />
              Coba lagi
            </Button>
          </div>
        ) : current ? (
          <>
            <IntegrationTabs integrations={integrations} selectedId={current.id} onSelect={choose} />
            <IntegrationPanel
              key={current.id}
              integration={current}
              secretsKeyConfigured={data?.secretsKeyConfigured ?? false}
              onSaved={setData}
              onDirtyChange={setDirty}
            />
          </>
        ) : null}
      </div>
    </Layout>
  )
}
