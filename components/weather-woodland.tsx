import { memo } from 'react';

// The clearing's own props. `scene-lit` marks what the sky lights rather than
// what emits: the wood takes the ambient filter, the fire's glow and flames
// never do. See app/clock-workshop.css.
export default memo(function WeatherWoodland() {
  return <div className="weather-surface clock-surface" aria-hidden="true">
    <span className="scene-paint exterior-paint" />
    <span className="scene-light" />
    <div className="exterior-sky"><span className="cs-sun" /><span className="cs-far" /><span className="cs-bank" /></div>
    <svg className="scene-props exterior-props" viewBox="0 0 350 168" preserveAspectRatio="none">
      <defs>
        <radialGradient id="woodland-fire"><stop stopColor="#e4b572" stopOpacity=".4" /><stop offset="1" stopColor="#dba35c" stopOpacity="0" /></radialGradient>
      </defs>
      <g className="exterior-camp" transform="translate(278 149)">
        <ellipse className="wood-fire-glow" rx="27" ry="11" fill="url(#woodland-fire)" />
        <g className="camp-materials scene-lit">
        <path d="M-8 4-4 2 2 3 7 2 10 5 6 7-6 7Z" fill="#6f7561" />
        <path d="m-6 3 12 3M6 2-12 4" stroke="#8e775a" strokeWidth="2.5" strokeLinecap="round" />
        </g>
        <path className="wood-flame" d="M-4 3C-9-2-2-5-3-11C3-8 1-5 4-6C3-2 10-1 5 4Z" fill="#c98b50" />
        <path className="wood-flame" d="M-2 3Q-3-1 1-6Q0 0 4 2L2 4Z" fill="#e8c889" />
      </g>
    </svg>
    <span className="cs-fall" /><span className="cs-air" />
    <span className="weather-shade" />
  </div>;
});
