import type { Metadata, Viewport } from 'next'
import { Plus_Jakarta_Sans } from 'next/font/google'
import { QueryProvider } from '@/components/providers/query-provider'
import { WebVitals } from '@/components/layout/web-vitals'
import './globals.css'

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-plus-jakarta',
})

export const metadata: Metadata = {
  title: 'CMS Portal',
  description: 'Content Management & Operations Portal',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={plusJakarta.variable}>
      <body className="font-sans antialiased">
        <WebVitals />
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  )
}
