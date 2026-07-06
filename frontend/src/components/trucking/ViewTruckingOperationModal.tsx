'use client'

import { CreateTruckingOperationModal } from '@/components/trucking/CreateTruckingOperationModal'

export interface ViewTruckingOperationModalProps {
  open: boolean
  onClose: () => void
  editTruckingOperationId: string | null
  initialContractId?: string | null
  initialContractExtNo?: string | null
  initialPoNumber?: string | null
  stacked?: boolean
}

/** Read-only trucking detail — same layout as Edit Trucking without save actions. */
export function ViewTruckingOperationModal({
  open,
  onClose,
  editTruckingOperationId,
  initialContractId,
  initialContractExtNo,
  initialPoNumber,
  stacked,
}: ViewTruckingOperationModalProps) {
  return (
    <CreateTruckingOperationModal
      open={open}
      onClose={onClose}
      onCreated={() => {}}
      mode="edit"
      readOnly
      stacked={stacked}
      editTruckingOperationId={editTruckingOperationId}
      initialContractId={initialContractId}
      initialContractExtNo={initialContractExtNo}
      initialPoNumber={initialPoNumber}
    />
  )
}
