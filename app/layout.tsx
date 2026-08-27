import type { Metadata } from 'next';
import { Geist } from 'next/font/google';
import './globals.css';

const geist = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });

export const metadata: Metadata = {
  metadataBase: new URL('http://localhost:3000'),
  title: 'Roamly — Seu guia de viagem',
  description: 'Organize lugares, veja o que está aberto e explore cada destino com um mapa feito para a sua viagem.',
  openGraph: { title: 'Roamly — Seu guia de viagem', description: 'Todos os lugares da sua viagem em um mapa simples e inteligente.', type: 'website', images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Roamly — Sua viagem, toda no mapa.' }] },
  twitter: { card: 'summary_large_image', title: 'Roamly — Seu guia de viagem', description: 'Todos os lugares da sua viagem em um mapa simples e inteligente.', images: ['/og.png'] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body className={`${geist.variable} antialiased`}>{children}</body></html>;
}
