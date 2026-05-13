import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { MetaMaskErrorGuard } from '@/components/MetaMaskErrorGuard'

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
      <body className={inter.className}>
        <MetaMaskErrorGuard />
        {children}
      </body>
    </html>
  )
}

