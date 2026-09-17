'use client'

import { useEffect, useState } from 'react'
import { Ship, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import api from '@/lib/api'
import {
  VESSEL_MODAL_BODY_CLASS,
  VESSEL_MODAL_FOOTER_BAR_CLASS,
  VESSEL_MODAL_HEADER_CLASS,
  VESSEL_MODAL_OVERLAY_CLASS,
} from '@/lib/vesselModalUi'

export interface MasterVesselFormData {
  id?: string
  vessel_code: string | null
  vessel_name: string
  vessel_capacity_mt: number | null
  vessel_owner: string | null
  vessel_owner_group: string | null
  vessel_type: string | null
  sap_vendor_code: string | null
  year_of_creation: number | null
  heating: boolean | null
  lambung_type: string | null
  terms: string | null
}

const TERMS_OPTIONS = ['V/C', 'T/C'] as const
const VESSEL_TYPE_OPTIONS = ['BARGE', 'TANKER', 'SPOB'] as const
const LAMBUNG_OPTIONS = ['DHDB', 'SHSB', 'SHDB'] as const

export interface EditVesselModalProps {
  open: boolean
  mode: 'create' | 'edit'
  vessel: MasterVesselFormData | null
  isAdmin: boolean
  onClose: () => void
  onSaved: () => void
}

const emptyForm = (): Partial<MasterVesselFormData & { vessel_code_input?: string }> => ({
  vessel_code_input: '',
  vessel_name: '',
  vessel_capacity_mt: null,
  vessel_owner: '',
  vessel_owner_group: '',
  vessel_type: '',
  sap_vendor_code: '',
  year_of_creation: null,
  heating: null,
  lambung_type: '',
  terms: '',
})

export function EditVesselModal({
  open,
  mode,
  vessel,
  isAdmin,
  onClose,
  onSaved,
}: EditVesselModalProps) {
  const [form, setForm] = useState<Partial<MasterVesselFormData & { vessel_code_input?: string }>>(emptyForm())
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    if (mode === 'edit' && vessel) {
      setForm({
        ...vessel,
        vessel_code_input: vessel.vessel_code ?? '',
      })
    } else {
      setForm(emptyForm())
    }
  }, [open, mode, vessel])

  if (!open) return null

  const readOnly = !isAdmin
  const title = mode === 'create' ? 'New Vessel' : 'Edit Vessel'
  const subtitle =
    mode === 'edit' && vessel?.vessel_name ? vessel.vessel_name : 'Maintain vessel reference data'

  const handleChange = (field: keyof MasterVesselFormData | 'vessel_code_input', value: unknown) => {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const handleSubmit = async () => {
    if (readOnly) return
    try {
      const vesselName = String(form.vessel_name ?? '').trim()
      const vesselCode = String(form.vessel_code_input ?? '').trim()
      if (!vesselName) {
        alert('Vessel Name is required')
        return
      }
      if (mode === 'create' && !vesselCode) {
        alert('Vessel Code is required for new vessels')
        return
      }
      const payload = {
        vessel_code: vesselCode || undefined,
        vessel_name: vesselName.toUpperCase(),
        vessel_capacity_mt: form.vessel_capacity_mt,
        vessel_owner: form.vessel_owner ? String(form.vessel_owner).toUpperCase() : null,
        vessel_owner_group: form.vessel_owner_group ? String(form.vessel_owner_group).toUpperCase() : null,
        vessel_type: form.vessel_type ? String(form.vessel_type).toUpperCase() : null,
        sap_vendor_code: form.sap_vendor_code ? String(form.sap_vendor_code).toUpperCase() : null,
        year_of_creation: form.year_of_creation,
        heating: form.heating,
        lambung_type: form.lambung_type ? String(form.lambung_type).toUpperCase() : null,
        terms: form.terms || null,
      }
      setSaving(true)
      if (mode === 'edit' && vessel?.id) {
        await api.put(`/master-vessels/${vessel.id}`, payload)
      } else {
        await api.post('/master-vessels', payload)
      }
      onSaved()
      onClose()
    } catch (err: unknown) {
      console.error('Save master vessel error', err)
      const msg =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
          ?.message || 'Failed to save master vessel'
      alert(msg)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={VESSEL_MODAL_OVERLAY_CLASS} onClick={onClose}>
      <div
        className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`${VESSEL_MODAL_HEADER_CLASS} px-6 py-4`}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100">
                <Ship className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
                <p className="text-sm text-gray-500">{subtitle}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className={VESSEL_MODAL_BODY_CLASS}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Vessel Code</label>
              <Input
                value={form.vessel_code_input ?? ''}
                placeholder={mode === 'edit' && !form.vessel_code_input ? '-' : ''}
                onChange={(e) => handleChange('vessel_code_input', e.target.value.toUpperCase())}
                disabled={readOnly}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Vessel Name</label>
              <Input
                value={form.vessel_name || ''}
                onChange={(e) => handleChange('vessel_name', e.target.value.toUpperCase())}
                disabled={readOnly}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Vessel Capacity (MT)</label>
              <Input
                type="number"
                value={form.vessel_capacity_mt ?? ''}
                onChange={(e) =>
                  handleChange('vessel_capacity_mt', e.target.value === '' ? null : Number(e.target.value))
                }
                disabled={readOnly}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Vessel Owner</label>
              <Input
                value={form.vessel_owner || ''}
                onChange={(e) => handleChange('vessel_owner', e.target.value.toUpperCase())}
                disabled={readOnly}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Vessel Owner Group</label>
              <Input
                value={form.vessel_owner_group || ''}
                onChange={(e) => handleChange('vessel_owner_group', e.target.value.toUpperCase())}
                disabled={readOnly}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">SAP Vendor Code</label>
              <Input
                value={form.sap_vendor_code || ''}
                onChange={(e) => handleChange('sap_vendor_code', e.target.value.toUpperCase())}
                disabled={readOnly}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Vessel Type</label>
              <select
                className="border rounded-md px-3 py-2 w-full text-sm disabled:bg-gray-50 disabled:cursor-not-allowed"
                value={form.vessel_type || ''}
                onChange={(e) => handleChange('vessel_type', e.target.value || null)}
                disabled={readOnly}
              >
                <option value="">Select...</option>
                {VESSEL_TYPE_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Year of Creation (optional)</label>
              <Input
                type="number"
                value={form.year_of_creation ?? ''}
                onChange={(e) =>
                  handleChange('year_of_creation', e.target.value === '' ? null : Number(e.target.value))
                }
                disabled={readOnly}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Heating</label>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={form.heating === true}
                    onCheckedChange={() => handleChange('heating', true)}
                    disabled={readOnly}
                  />
                  Yes
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={form.heating === false}
                    onCheckedChange={() => handleChange('heating', false)}
                    disabled={readOnly}
                  />
                  No
                </label>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Lambung Type</label>
              <select
                className="border rounded-md px-3 py-2 w-full text-sm disabled:bg-gray-50 disabled:cursor-not-allowed"
                value={form.lambung_type || ''}
                onChange={(e) => handleChange('lambung_type', e.target.value || null)}
                disabled={readOnly}
              >
                <option value="">Select...</option>
                {LAMBUNG_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Terms</label>
              <select
                className="border rounded-md px-3 py-2 w-full text-sm disabled:bg-gray-50 disabled:cursor-not-allowed"
                value={form.terms || ''}
                onChange={(e) => handleChange('terms', e.target.value || null)}
                disabled={readOnly}
              >
                <option value="">Select...</option>
                {TERMS_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className={VESSEL_MODAL_FOOTER_BAR_CLASS}>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose} disabled={saving}>
              {readOnly ? 'Close' : 'Cancel'}
            </Button>
            {isAdmin ? (
              <Button onClick={handleSubmit} disabled={saving}>
                {saving ? 'Saving...' : 'Save'}
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
