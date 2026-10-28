import type { Metadata, Viewport } from 'next'
import '@fontsource/plus-jakarta-sans/400.css'
import '@fontsource/plus-jakarta-sans/500.css'
import '@fontsource/plus-jakarta-sans/600.css'
import '@fontsource/plus-jakarta-sans/700.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import './globals.css'
import { ChunkErrorRecovery } from '@/components/ChunkErrorRecovery'
import { HubSdkScript } from '@/components/HubSdkScript'
import { Providers } from './providers'

export const metadata: Metadata = {
  title: 'Commercial Documents',
  description: 'Contracts, BA, Bea Cukai, DO and invoices filed per PO.',
}

export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HubSdkScript />
      </head>
      <body>
        {/* One reload when a script chunk fails to load (a tab opened before a deploy). */}
        <ChunkErrorRecovery />
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
