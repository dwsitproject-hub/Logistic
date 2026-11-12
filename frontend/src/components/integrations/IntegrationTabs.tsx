'use client'

import type { ComponentType } from 'react'
import { Anchor, Database, Webhook } from 'lucide-react'
import { summarizeIntegration, type IntegrationView } from '@/lib/integrationSettings'

const LOOK: Record<IntegrationView['id'], { Icon: ComponentType<{ className?: string }>; chip: string; tagline: string }> = {
  dhm: { Icon: Database, chip: 'bg-blue-50 text-blue-600', tagline: 'DataHub: master data' },
  jps: { Icon: Anchor, chip: 'bg-amber-50 text-amber-700', tagline: 'Jetty Planning System' },
  kmaps: { Icon: Webhook, chip: 'bg-emerald-50 text-emerald-700', tagline: 'Partner API and webhook' },
}

interface Props {
  integrations: IntegrationView[]
  selectedId: string
  onSelect: (id: IntegrationView['id']) => void
}

/** One card per integration: which one the panel below shows, and at a glance how many of its settings are filled in. */
export function IntegrationTabs({ integrations, selectedId, onSelect }: Props) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3" role="tablist" aria-label="Integrations">
      {integrations.map((integration) => {
        const look = LOOK[integration.id]
        const summary = summarizeIntegration(integration.settings)
        const selected = integration.id === selectedId
        return (
          <button
            key={integration.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onSelect(integration.id)}
            className={
              selected
                ? 'flex items-start gap-3 rounded-xl border-2 border-blue-500 bg-white px-4 py-3 text-left'
                : 'flex items-start gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 text-left transition-colors hover:border-gray-300 hover:bg-gray-50'
            }
          >
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${look.chip}`} aria-hidden>
              <look.Icon className="h-[1.125rem] w-[1.125rem]" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-gray-900">{integration.name}</span>
              <span className="block text-xs text-gray-500">{look.tagline}</span>
              <span className="mt-1.5 flex flex-wrap gap-1.5">
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[0.6875rem] text-gray-600">{summary.total} pengaturan</span>
                {summary.unset > 0 ? (
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[0.6875rem] font-medium text-amber-700">
                    {summary.unset} belum diisi
                  </span>
                ) : null}
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
