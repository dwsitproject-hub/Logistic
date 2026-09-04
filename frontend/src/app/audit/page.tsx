'use client'

import Layout from '@/components/Layout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { FileCheck } from 'lucide-react'

export default function AuditPage() {
  return (
    <Layout>
      <div className="space-y-6">
        <p className="text-gray-600">Track all system activities and changes</p>

        <Card>
          <CardHeader>
            <CardTitle>Activity Log</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-center py-12">
              <FileCheck className="h-16 w-16 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-500">No audit logs available</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </Layout>
  )
}

