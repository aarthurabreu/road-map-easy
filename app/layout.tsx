import type { Metadata, Viewport } from 'next';
import { Geist } from 'next/font/google';
import './globals.css';

const geist = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });

export const viewport: Viewport = { themeColor: '#fffdfa' };

// Apply before the first paint, including when Safari restores the installed web app.
const themeBootstrap = `(function(){var t;try{t=localStorage.getItem('roamly-theme')}catch(e){}if(t!=='dark'&&t!=='light')t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.dataset.theme=t;var m=document.querySelector('meta[name="theme-color"]');if(m)m.content=t==='dark'?'#14201b':'#fffdfa'})()`;

export const metadata: Metadata = {
  metadataBase: new URL('https://roamly-trip-guide-arthur.arthurmaquizito.chatgpt.site'),
  title: 'Easy Road Map — Seu guia de viagem',
  description: 'Organize lugares, veja o que está aberto e explore cada destino com um mapa feito para a sua viagem.',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/easy-road-map-icon.svg', apple: '/apple-touch-icon.png' },
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'Easy Road Map' },
  openGraph: { title: 'Easy Road Map — Seu guia de viagem', description: 'Todos os lugares da sua viagem em um mapa simples e inteligente.', type: 'website', images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Easy Road Map — Sua viagem, toda no mapa.' }] },
  twitter: { card: 'summary_large_image', title: 'Easy Road Map — Seu guia de viagem', description: 'Todos os lugares da sua viagem em um mapa simples e inteligente.', images: ['/og.png'] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: themeBootstrap }} /></head><body className={`${geist.variable} antialiased`}>{children}</body></html>;
}
