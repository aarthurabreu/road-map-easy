import type { Metadata } from 'next';
import { SharedMapView } from './share-map-view';

export const metadata: Metadata = { robots: { index: false, follow: false, noarchive: true } };

export default async function SharedMapPage({ params }: { params: Promise<{ shareId: string }> }) {
  const { shareId } = await params;
  return <SharedMapView shareId={shareId} />;
}
