export const locationLifetimeMs = 60_000;
export function freshLocation(position: { timestamp: number; coords: { latitude: number; longitude: number } }, now = Date.now()) {
  const { latitude, longitude } = position.coords;
  return Number.isFinite(latitude) && Math.abs(latitude) <= 90 && Number.isFinite(longitude) && Math.abs(longitude) <= 180
    && Number.isFinite(position.timestamp) && position.timestamp <= now + 5000 && now - position.timestamp <= locationLifetimeMs;
}
