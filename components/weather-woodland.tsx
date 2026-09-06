import { memo } from 'react';

// The clearing's own props. `scene-lit` marks what the sky lights rather than
// what emits: the flowers and the wood take the ambient filter, the fire's
// glow and flames never do. See app/clock-workshop.css.
export default memo(function WeatherWoodland() {
  return <div className="weather-surface clock-surface" aria-hidden="true">
    <span className="scene-paint exterior-paint" />
    <span className="scene-light" />
    <div className="exterior-sky"><span className="cs-sun" /><span className="cs-far" /><span className="cs-bank" /></div>
    <svg className="scene-props exterior-props" viewBox="0 0 350 168" preserveAspectRatio="none">
      <defs>
        <linearGradient id="woodland-petal" x2=".8" y2="1"><stop stopColor="#dfddba" /><stop offset=".6" stopColor="#c0c39a" /><stop offset="1" stopColor="#7f9876" /></linearGradient>
        <linearGradient id="woodland-leaf" x2="1" y2="1"><stop stopColor="#809368" /><stop offset="1" stopColor="#3b6047" /></linearGradient>
        <radialGradient id="woodland-fire"><stop stopColor="#e4b572" stopOpacity=".4" /><stop offset="1" stopColor="#dba35c" stopOpacity="0" /></radialGradient>
      </defs>
      <g className="exterior-flowers scene-lit" fill="none" stroke="#6e8760" strokeWidth=".8">
        <path d="M336 160Q333 139 339 118Q342 105 335 104M337 147Q345 137 345 126Q345 120 341 119M335 139Q329 126 332 119" />
        <g fill="url(#woodland-leaf)" stroke="#52724e" strokeWidth=".4">
          <path d="M335 142Q321 139 321 130Q331 128 335 142ZM338 145Q347 132 352 138Q350 149 338 145ZM337 127Q330 120 333 114Q340 117 337 127ZM336 158Q325 150 323 143Q335 144 336 158Z" />
        </g>
        <path d="M325 134l9 7M341 144l7-5M326 147l8 8" stroke="#a1aa7a" strokeWidth=".5" opacity=".6" />
        <g fill="url(#woodland-petal)" stroke="#859779" strokeWidth=".4">
          <path d="M335 103Q329 102 328 109L325 112Q330 115 335 112Q338 109 335 103Z" />
          <path d="M341 118Q336 117 335 123L332 126Q337 129 342 126Q344 122 341 118Z" />
          <path d="M332 119Q326 117 326 123L323 125Q329 128 333 124Z" />
        </g>
        <path d="m328 112 4 .4M335 126l4 .2" stroke="#e0dfbc" strokeWidth=".7" />
      </g>
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
