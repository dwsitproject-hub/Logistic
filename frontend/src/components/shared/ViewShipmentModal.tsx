'use client'

import { EditShipmentModal, type EditShipmentModalProps } from '@/components/shared/EditShipmentModal'

export type ViewShipmentModalProps = Omit<
  EditShipmentModalProps,
  'readOnly' | 'onSubmit'
>

/** Read-only shipment detail modal — same layout as Edit Shipment without edit actions. */
export function ViewShipmentModal(props: ViewShipmentModalProps) {
  return (
    <EditShipmentModal
      {...props}
      readOnly
      onSubmit={async () => {}}
    />
  )
}
