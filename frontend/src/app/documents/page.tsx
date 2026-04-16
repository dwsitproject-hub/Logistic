'use client'

import { useEffect, useState } from 'react'
import Layout from '@/components/Layout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Download, FileText, Search, ChevronDown, ChevronRight } from 'lucide-react'
import api from '@/lib/api'
import { formatDateTimeDMY } from '@/lib/dateFormat'

interface Contract {
  id: string
  contract_id: string
  supplier: string
  product: string
  group_name: string
  status: string
}

interface DocumentItem {
  id: string
  document_type?: string
  file_name: string
  file_size?: number
  mime_type?: string
  contract_id?: string
  shipment_id?: string
  trucking_operation_id?: string
  created_at?: string
  upload_date?: string
  source?: 'contract' | 'shipment' | 'trucking'
  entity_name?: string
}

interface Shipment {
  id: string
  shipment_id: string
  contract_id: string
  vessel_name: string
}

interface TruckingOperation {
  id: string
  operation_id: string
  contract_id: string
  location: string
  trucking_owner: string
}

export default function DocumentsPage() {
  const [contracts, setContracts] = useState<Contract[]>([])
  const [loading, setLoading] = useState(true)
  const [authReady, setAuthReady] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [expandedContracts, setExpandedContracts] = useState<Set<string>>(new Set())
  const [contractDocs, setContractDocs] = useState<{ [key: string]: DocumentItem[] }>({})
  const [loadingDocs, setLoadingDocs] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (typeof window === 'undefined') return
    const hasToken = () => Boolean(localStorage.getItem('token'))
    if (hasToken()) {
      setAuthReady(true)
      return
    }
    const startedAt = Date.now()
    const interval = window.setInterval(() => {
      if (hasToken()) {
        window.clearInterval(interval)
        setAuthReady(true)
      } else if (Date.now() - startedAt > 3000) {
        window.clearInterval(interval)
      }
    }, 150)
    return () => window.clearInterval(interval)
  }, [])

  useEffect(() => {
    if (!authReady) return
    fetchContracts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady])

  const fetchContracts = async () => {
    try {
      const response = await api.get('/contracts?limit=1000')
      setContracts(response.data.data.contracts || [])
    } catch (error) {
      console.error('Failed to fetch contracts:', error)
      const status = (error as any)?.response?.status
      if (status === 401 || status === 403) return
      alert('Failed to load contracts. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const fetchContractDocuments = async (contractId: string) => {
    if (contractDocs[contractId]) return // Already loaded

    setLoadingDocs(prev => new Set(prev).add(contractId))
    try {
      // Fetch all related entities (shipments and trucking operations for this contract)
      const [shipmentsRes, truckingRes] = await Promise.all([
        api.get(`/shipments?limit=1000`),
        api.get(`/trucking?limit=1000`)
      ])

      const shipments: Shipment[] = shipmentsRes.data?.data?.shipments || []
      const truckingOps: TruckingOperation[] = truckingRes.data?.data?.truckingOperations || []

      // Filter by contract
      const relatedShipments = shipments.filter(s => s.contract_id === contractId)
      const relatedTrucking = truckingOps.filter(t => t.contract_id === contractId)

      // Fetch documents for contract
      const contractDocsRes = await api.get(`/documents?contractId=${contractId}`)
      const contractDocsList: DocumentItem[] = (contractDocsRes.data?.data || []).map((d: DocumentItem) => ({
        ...d,
        source: 'contract' as const,
        entity_name: 'Contract Document'
      }))

      // Fetch documents for all related shipments
      const shipmentDocsPromises = relatedShipments.map(async (ship) => {
        const res = await api.get(`/documents?shipmentId=${ship.id}`)
        return (res.data?.data || []).map((d: DocumentItem) => ({
          ...d,
          source: 'shipment' as const,
          entity_name: `Shipment: ${ship.vessel_name || ship.shipment_id}`
        }))
      })

      // Fetch documents for all related trucking operations
      const truckingDocsPromises = relatedTrucking.map(async (truck) => {
        const res = await api.get(`/documents?truckingOperationId=${truck.id}`)
        return (res.data?.data || []).map((d: DocumentItem) => ({
          ...d,
          source: 'trucking' as const,
          entity_name: `Trucking: ${truck.location || truck.operation_id}`
        }))
      })

      const shipmentDocsArrays = await Promise.all(shipmentDocsPromises)
      const truckingDocsArrays = await Promise.all(truckingDocsPromises)

      const shipmentDocs = shipmentDocsArrays.flat()
      const truckingDocs = truckingDocsArrays.flat()

      // Combine all documents
      const allDocs = [...contractDocsList, ...shipmentDocs, ...truckingDocs]
      setContractDocs(prev => ({ ...prev, [contractId]: allDocs }))
    } catch (error) {
      console.error('Failed to fetch documents:', error)
      setContractDocs(prev => ({ ...prev, [contractId]: [] }))
    } finally {
      setLoadingDocs(prev => {
        const newSet = new Set(prev)
        newSet.delete(contractId)
        return newSet
      })
    }
  }

  const toggleContract = async (contractId: string) => {
    const newExpanded = new Set(expandedContracts)
    if (newExpanded.has(contractId)) {
      newExpanded.delete(contractId)
    } else {
      newExpanded.add(contractId)
      await fetchContractDocuments(contractId)
    }
    setExpandedContracts(newExpanded)
  }

  const handleDownloadDocument = async (docId: string, fileName: string) => {
    try {
      const response = await api.get(`/documents/${docId}/download`, {
        responseType: 'blob'
      })
      
      const blob = new Blob([response.data])
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = fileName
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Download document error:', err)
      alert('Failed to download document. Please try again.')
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Open':
      case 'OPEN':
      case 'ACTIVE': // backward compatibility
        return 'bg-green-100 text-green-800'
      case 'Close':
      case 'CLOSE':
      case 'COMPLETED':
        return 'bg-blue-100 text-blue-800'
      case 'Cancelled':
      case 'CANCELLED':
        return 'bg-red-100 text-red-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return '-'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const getSourceBadgeColor = (source?: string) => {
    switch (source) {
      case 'contract':
        return 'bg-blue-100 text-blue-800'
      case 'shipment':
        return 'bg-green-100 text-green-800'
      case 'trucking':
        return 'bg-purple-100 text-purple-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  const getSourceLabel = (source?: string) => {
    switch (source) {
      case 'contract':
        return 'Contract'
      case 'shipment':
        return 'Shipment'
      case 'trucking':
        return 'Trucking'
      default:
        return 'Unknown'
    }
  }

  const filteredContracts = contracts.filter(contract => {
    if (!searchTerm) return true
    const search = searchTerm.toLowerCase()
    return (
      contract.contract_id?.toLowerCase().includes(search) ||
      contract.supplier?.toLowerCase().includes(search) ||
      contract.product?.toLowerCase().includes(search) ||
      contract.group_name?.toLowerCase().includes(search)
    )
  })

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Documents</h1>
            <p className="text-gray-600 mt-2">View and manage contract documents</p>
          </div>
        </div>

        {/* Search */}
        <Card>
          <CardContent className="pt-6">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search by Contract ID, Supplier, Product, or Group..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
          </CardContent>
        </Card>

        {/* Contracts List */}
        <Card>
          <CardHeader>
            <CardTitle>Documents by Contract</CardTitle>
            <p className="text-sm text-gray-500 mt-1">
              {filteredContracts.length} contract{filteredContracts.length !== 1 ? 's' : ''} found • 
              Click to view contract, shipment, and trucking documents
            </p>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-center py-8">Loading contracts...</div>
            ) : filteredContracts.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <FileText className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                <p>No contracts found</p>
                {searchTerm && <p className="text-sm mt-2">Try adjusting your search</p>}
              </div>
            ) : (
              <div className="space-y-2">
                {filteredContracts.map((contract) => {
                  const isExpanded = expandedContracts.has(contract.id)
                  const docs = contractDocs[contract.id] || []
                  const isLoadingDocs = loadingDocs.has(contract.id)

                  return (
                    <div key={contract.id} className="border rounded-lg">
                      {/* Contract Header */}
                      <div
                        className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                        onClick={() => toggleContract(contract.id)}
                      >
                        <div className="flex items-center gap-3 flex-1">
                          {isExpanded ? (
                            <ChevronDown className="h-5 w-5 text-gray-400" />
                          ) : (
                            <ChevronRight className="h-5 w-5 text-gray-400" />
                          )}
                          <div className="flex-1">
                            <div className="flex items-center gap-3">
                              <span className="font-semibold text-lg">{contract.contract_id}</span>
                              <Badge className={getStatusColor(contract.status)}>
                                {contract.status}
                              </Badge>
                            </div>
                            <div className="text-sm text-gray-500 mt-1">
                              {contract.supplier} • {contract.product} • {contract.group_name}
                            </div>
                          </div>
                        </div>
                        {isExpanded && !isLoadingDocs && (
                          <div className="flex items-center gap-2 ml-2">
                            <Badge variant="outline">
                              {docs.length} total
                            </Badge>
                            {docs.filter(d => d.source === 'contract').length > 0 && (
                              <Badge className="bg-blue-100 text-blue-800" variant="outline">
                                {docs.filter(d => d.source === 'contract').length} contract
                              </Badge>
                            )}
                            {docs.filter(d => d.source === 'shipment').length > 0 && (
                              <Badge className="bg-green-100 text-green-800" variant="outline">
                                {docs.filter(d => d.source === 'shipment').length} shipment
                              </Badge>
                            )}
                            {docs.filter(d => d.source === 'trucking').length > 0 && (
                              <Badge className="bg-purple-100 text-purple-800" variant="outline">
                                {docs.filter(d => d.source === 'trucking').length} trucking
                              </Badge>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Documents List */}
                      {isExpanded && (
                        <div className="border-t bg-gray-50 p-4">
                          {isLoadingDocs ? (
                            <div className="text-center py-8 text-gray-500">
                              Loading documents...
                            </div>
                          ) : docs.length === 0 ? (
                            <div className="text-center py-8 text-gray-500">
                              <FileText className="h-12 w-12 text-gray-400 mx-auto mb-2" />
                              <p>No documents uploaded for this contract</p>
                            </div>
                          ) : (
                            <div className="space-y-2">
                              {docs.map((doc) => (
                                <div
                                  key={doc.id}
                                  className="flex items-center justify-between px-4 py-3 bg-white border rounded hover:shadow-sm transition-shadow"
                                >
                                  <div className="flex items-center gap-3 flex-1">
                                    <FileText className="h-5 w-5 text-blue-600" />
                                    <div className="flex-1">
                                      <div className="flex items-center gap-2">
                                        <span className="font-medium">{doc.file_name}</span>
                                        <Badge className={getSourceBadgeColor(doc.source)} variant="outline">
                                          {getSourceLabel(doc.source)}
                                        </Badge>
                                      </div>
                                      <div className="text-xs text-gray-500 mt-1">
                                        {doc.entity_name && (
                                          <>
                                            <span className="font-medium">{doc.entity_name}</span>
                                            {' • '}
                                          </>
                                        )}
                                        {doc.document_type || 'FILE'} • {formatFileSize(doc.file_size)} • {' '}
                                        {doc.upload_date || doc.created_at
                                          ? formatDateTimeDMY(doc.upload_date || doc.created_at!)
                                          : ''}
                                      </div>
                                    </div>
                                  </div>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleDownloadDocument(doc.id, doc.file_name)}
                                  >
                                    <Download className="h-4 w-4 mr-1" />
                                    Download
                                  </Button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  )
}

