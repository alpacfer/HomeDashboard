// One icon per condition, shared by the current-weather card and the week
// strip so the same sky never draws two different pictures.
import { Cloud, CloudDrizzle, CloudFog, CloudMoon, CloudRain, CloudRainWind, CloudSnow, CloudSun, Cloudy, Moon, Sun } from 'lucide-react';
import { type ConditionKind } from '@/lib/weather';

export const ICONS: Record<ConditionKind, typeof Sun> = {
  clear: Sun, partly: CloudSun, cloudy: Cloudy, overcast: Cloud, fog: CloudFog,
  drizzle: CloudDrizzle, rain: CloudRain, 'heavy-rain': CloudRainWind, sleet: CloudSnow, snow: CloudSnow,
};
export const NIGHT_ICONS: Partial<Record<ConditionKind, typeof Sun>> = { clear: Moon, partly: CloudMoon };

