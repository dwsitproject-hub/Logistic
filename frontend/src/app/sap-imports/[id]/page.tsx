'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Layout from '@/components/Layout';

export default function ImportDetailRedirectPage() {
  const params = useParams();
  const router = useRouter();

  useEffect(() => {
    const id = String(params.id || '').trim();
    router.replace(id ? `/sap-imports?import=${encodeURIComponent(id)}` : '/sap-imports');
  }, [params.id, router]);

  return (
    <Layout>
      <div className="text-sm text-gray-500">Opening import details...</div>
    </Layout>
  );
}
