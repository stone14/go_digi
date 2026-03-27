import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Digicap — Infrastructure Monitoring',
  description: 'On-premise infrastructure monitoring system',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        <script dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem('argus-theme')||'dark';document.documentElement.setAttribute('data-theme',t);}catch(e){}` }} />
      </head>
      <body className="min-h-screen">
        {children}
      </body>
    </html>
  )
}
