'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import api from '@/lib/api'
import {
  describeVesselKind,
  describeVesselReviewReason,
  type VesselReviewItem,
} from '@/lib/masterVesselReview'

type Props = {
  isAdmin: boolean
  /** Called after an approve or a merge, so the badge and the All Vessel list follow. */
  onChanged: () => void
  /** Open the vessel in the All Vessel list, where the Edit button is. */
  onOpenInList: (vesselName: string) => void
}

function apiMessage(err: unknown, fallback: string): string {
  const message = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
  return message || fallback
}

/**
 * "Perlu review": the vessels KLIP registered itself from a SAP vessel name and was not sure of. They are already in Master Vessel and in use; a person
 * approves one that is right, opens it to correct it, or merges it into the vessel it really is (a name SAP cut at 35 characters into its full name).
 */
export function MasterVesselReviewPanel({ isAdmin, onChanged, onOpenInList }: Props) {
  const [items, setItems] = useState<VesselReviewItem[]>([])
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [mergeInto, setMergeInto] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const res = await api.get('/master-vessels/review')
      setItems((res.data?.data?.items ?? []) as VesselReviewItem[])
    } catch (err) {
      console.error('Failed to load vessels for review', err)
      alert('Failed to load vessels for review')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const approve = async (item: VesselReviewItem) => {
    try {
      setBusyId(item.id)
      await api.post(`/master-vessels/${item.id}/review/approve`)
      await load()
      onChanged()
    } catch (err) {
      alert(apiMessage(err, 'Gagal menyetujui kapal'))
    } finally {
      setBusyId(null)
    }
  }

  const merge = async (item: VesselReviewItem) => {
    const intoId = mergeInto[item.id]
    const target = item.candidates.find((c) => c.id === intoId)
    if (!intoId || !target) return
    const ok = window.confirm(
      `Gabungkan "${item.vessel_name}" ke "${target.vessel_name}"?\n\n` +
        'Kode SAP, shipment, dan pair kapal ini dipindahkan ke kapal tujuan, lalu kapal ini dihapus. Tidak bisa dibatalkan.',
    )
    if (!ok) return
    try {
      setBusyId(item.id)
      await api.post(`/master-vessels/${item.id}/review/merge`, { intoId })
      await load()
      onChanged()
    } catch (err) {
      alert(apiMessage(err, 'Gagal menggabungkan kapal'))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Perlu review</CardTitle>
        <p className="text-xs text-gray-500 mt-1">
          Kapal yang dibuat otomatis dari nama SAP dan belum pasti benar. Kapal ini sudah dipakai di KLIP. Setujui yang sudah benar, buka untuk
          memperbaiki, atau gabungkan ke kapal yang sebenarnya. Kapal yang belum disetujui belum dikirim ke DHM.
        </p>
      </CardHeader>
      <CardContent>
        {loading && items.length === 0 ? (
          <p className="text-sm text-gray-500">Memuat...</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-gray-500">Tidak ada kapal yang perlu direview.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="py-2 pr-3">Nama SAP</th>
                  <th className="py-2 pr-3">Kapal dibuat</th>
                  <th className="py-2 pr-3">Pair</th>
                  <th className="py-2 pr-3">Alasan</th>
                  {isAdmin ? <th className="py-2">Aksi</th> : null}
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-b align-top">
                    <td className="py-3 pr-3 text-gray-700">{item.review_sap_name || '-'}</td>
                    <td className="py-3 pr-3">
                      <div className="font-medium text-gray-900">{item.vessel_name}</div>
                      <div className="text-xs text-gray-500">{describeVesselKind(item)}</div>
                      <div className="text-xs text-gray-500">
                        {item.code_status === 'PROVISIONAL' ? 'Kode sementara' : item.vessel_code}
                      </div>
                    </td>
                    <td className="py-3 pr-3 text-xs text-gray-600">
                      {item.pair_code ? (
                        <>
                          <div>{item.pair_code}</div>
                          <div>{item.pair_partner_name}</div>
                        </>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="py-3 pr-3">
                      <div className="flex flex-col gap-1">
                        {item.review_reasons.map((reason) => (
                          <span
                            key={reason}
                            className="inline-block rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800"
                          >
                            {describeVesselReviewReason(reason)}
                          </span>
                        ))}
                      </div>
                    </td>
                    {isAdmin ? (
                      <td className="py-3">
                        <div className="flex flex-col gap-2">
                          <div className="flex flex-wrap gap-2">
                            <Button size="sm" disabled={busyId === item.id} onClick={() => void approve(item)}>
                              Setujui
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busyId === item.id}
                              onClick={() => onOpenInList(item.vessel_name)}
                            >
                              Buka untuk diedit
                            </Button>
                          </div>
                          {item.candidates.length > 0 ? (
                            <div className="flex flex-wrap items-center gap-2">
                              <select
                                className="h-8 max-w-[220px] rounded border border-gray-300 bg-white px-2 text-xs"
                                value={mergeInto[item.id] ?? ''}
                                onChange={(e) => setMergeInto((prev) => ({ ...prev, [item.id]: e.target.value }))}
                              >
                                <option value="">Gabungkan ke...</option>
                                {item.candidates.map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {c.vessel_name}
                                  </option>
                                ))}
                              </select>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busyId === item.id || !mergeInto[item.id]}
                                onClick={() => void merge(item)}
                              >
                                Gabungkan
                              </Button>
                            </div>
                          ) : null}
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
