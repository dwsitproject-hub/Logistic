import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { MetaMaskErrorGuard } from '@/components/MetaMaskErrorGuard'
import { HubSdkScript } from '@/components/HubSdkScript'
import { ChunkErrorRecovery } from '@/components/ChunkErrorRecovery'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'KLIP - KPN Logistics Intelligence Platform',
  description: 'Centralized logistics data management and intelligence platform',
  icons: {
    icon: '/icon.svg',
    shortcut: '/icon.svg',
    apple: '/icon.svg',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <head>
        {/* Downstream Hub SDK — renders nothing unless configured at build time. */}
        <HubSdkScript />
      </head>
      <body className={inter.className}>
        <MetaMaskErrorGuard />
        {/* One reload when a script chunk fails to load (a tab opened before a deploy). */}
        <ChunkErrorRecovery />
        {children}
      </body>
    </html>
  )
}

