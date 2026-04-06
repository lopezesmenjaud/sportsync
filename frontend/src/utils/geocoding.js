export async function geocodeCity(cityName) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(cityName)}&format=json&limit=1&addressdetails=1&accept-language=en`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'FanSchedule/1.0' }
  });
  const data = await res.json();
  if (!data || data.length === 0) throw new Error('No se pudo identificar la ubicación.');
  const place = data[0];
  return {
    lat: parseFloat(place.lat),
    lon: parseFloat(place.lon),
    city: place.address?.city || place.address?.town || place.address?.village || cityName,
    country: place.address?.country || '',
    displayName: place.display_name
  };
}

export async function reverseGeocode(lat, lon) {
  const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&addressdetails=1&accept-language=en`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'FanSchedule/1.0' }
  });
  const data = await res.json();
  if (!data || data.error) throw new Error('No se pudo identificar la ubicación.');
  return {
    lat,
    lon,
    city: data.address?.city || data.address?.town || data.address?.village || '',
    country: data.address?.country || '',
    displayName: data.display_name
  };
}
