const WINDY_EMBED = 'https://embed.windy.com/embed2.html';

export function forecastMapUrl() {
  const params = new URLSearchParams({
    lat: '55.78',
    lon: '12.43',
    detailLat: '55.73825',
    detailLon: '12.53836',
    zoom: '9',
    level: 'surface',
    overlay: 'rain',
    product: 'ecmwf',
    menu: '',
    message: 'false',
    marker: 'true',
    calendar: 'now',
    pressure: '',
    type: 'map',
    location: 'coordinates',
    detail: '',
    metricWind: 'default',
    metricTemp: '°C',
    radarRange: '-1',
    play: '1',
  });
  return `${WINDY_EMBED}?${params.toString()}`;
}
