// One icon per condition. The week strip draws these; the weather card paints
// its own sky instead, so this is no longer shared between the two.
import { Cloud, CloudDrizzle, CloudFog, CloudRain, CloudRainWind, CloudSnow, CloudSun, Cloudy, Sun } from 'lucide-react';
import { type ConditionKind } from '@/lib/weather';

export const ICONS: Record<ConditionKind, typeof Sun> = {
  clear: Sun, partly: CloudSun, cloudy: Cloudy, overcast: Cloud, fog: CloudFog,
  drizzle: CloudDrizzle, rain: CloudRain, 'heavy-rain': CloudRainWind, sleet: CloudSnow, snow: CloudSnow,
};

