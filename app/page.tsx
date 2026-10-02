'use client';

import { useTripGuide } from './trip-guide/use-trip-guide';
import { TripGuideView } from './trip-guide/trip-guide-view';

export default function Home() {
  const controller = useTripGuide();
  return <TripGuideView controller={controller} />;
}
