/** Shapes returned by the KLIP backend (see the backend controllers; field names are the API's, mostly snake_case). */

export type SessionUser = {
  id: string
  username: string
  email: string
  full_name: string | null
  role: string
  level: string | null
  transport_type: string | null
  plant: string | null
  plants: string[]
  products: string[]
  is_active: boolean
  is_first_login: boolean
  /** Downstream Hub user id (OIDC sub); null for an account that never signed in through the Hub. Only the Hub SDK reads it. */
  hub_user_id?: string | null
}

export type PermissionFlags = { canView: boolean; canCreate: boolean; canEdit: boolean; canDelete: boolean }
export type PermissionMap = Record<string, PermissionFlags>

export type DocumentRow = {
  id: string
  contract_id: string
  contract_ext_no: string
  po_number: string | null
  buyer: string | null
  supplier: string | null
  product: string | null
  incoterm: string | null
  contract_date: string | null
  payment_due_date: string | null
  dp_due_date: string | null
  payoff_date: string | null
  quantity_ordered: number
  unit_price: number
  total_price: number
  currency: string | null
  company_name: string | null
  plant_site: string | null
  transport_mode: string | null
  b2b_flag: string | null
  contract_reference_po: string | null
  status: string | null
  is_open: boolean
  uploaded_count: number
  doc_draft_contract: boolean
  doc_contract: boolean
  doc_addendum_contract: boolean
  doc_berita_acara: boolean
  doc_bea_cukai: boolean
  doc_delivery_order: boolean
  doc_invoice_fp_dp: boolean
  doc_invoice_fp_payoff: boolean
  doc_invoice_fp_full: boolean
}

export type Pagination = { total: number; page: number; limit: number; totalPages: number }

export type SummaryCard = { totalCount: number; uploadedCount: number }

export type ContractCounts = { totalCount: number; completeCount: number; incompleteCount: number; emptyCount: number }

export type DocumentFile = {
  id: string
  contract_ext_no: string
  po_number: string | null
  document_type: string
  file_name: string
  created_at: string
  updated_at: string
}

export type HistoryEntry = {
  id: string
  document_type: string
  document_type_label?: string
  action_type: 'ADD' | 'EDIT' | 'DELETE'
  file_name: string | null
  user_name: string | null
  created_at: string
}

export type B2bParty = {
  contract_id: string
  contract_date: string | null
  po_numbers: string | null
  contract_ext_no: string | null
  company_name: string | null
  buyer: string | null
  supplier: string | null
  incoterm: string | null
  quantity_delivery: number | null
  quantity_receive: number | null
}

export type PlantCompleteness = {
  plant: string
  contractCount: number
  uploadedSlots: number
  totalSlots: number
  missingSlots: number
  completenessPct: number
  completeCount: number
  emptyCount: number
}

export type ManagedUser = {
  id: string
  username: string
  email: string
  full_name: string | null
  role: string
  is_active: boolean
  is_first_login: boolean
  phone: string | null
  department: string | null
  level: string | null
  transport_type: string | null
  created_at: string
  updated_at: string | null
  plants: string[]
  products: string[]
}

export type Role = {
  id: string
  role_name: string
  display_name: string | null
  description: string | null
  is_active: boolean
  uses_region_scope: boolean
}

export type RolePermissionRow = {
  id: string
  permission_key: string
  permission_name: string
  category: string | null
  can_view: boolean | null
  can_create: boolean | null
  can_edit: boolean | null
  can_delete: boolean | null
}

export type AuditEntry = {
  id: string
  user_id: string | null
  username: string | null
  full_name: string | null
  role: string | null
  action: string
  entity_type: string
  entity_id: string | null
  before_data: Record<string, unknown> | null
  after_data: Record<string, unknown> | null
  timestamp: string
}
