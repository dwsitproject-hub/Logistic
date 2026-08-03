'use client'

import { EditShipmentModal, type EditShipmentModalProps } from '@/components/shared/EditShipmentModal'

export type ViewShipmentModalProps = Omit<
  EditShipmentModalProps,
  'readOnly' | 'enableAtaQualityEditInView'
>

/** Read-only shipment detail with optional ATA + Quality edit (when user has edit permission). */
export function ViewShipmentModal({
  onSubmit = async () => {},
  ...props
}: ViewShipmentModalProps) {
  return (
    <EditShipmentModal
      {...props}
      onSubmit={onSubmit}
      readOnly
      enableAtaQualityEditInView
    />
  )
}
