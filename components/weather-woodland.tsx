import { memo } from 'react';

// The clearing's own props. `scene-lit` marks what the sky lights rather than
// what emits: the wood takes the ambient filter, the fire's glow and flames
// never do. See app/clock-workshop.css.
//
// Painted cloud textures keep their brushwork; CSS supplies the time-of-day
// tint and motion. The overcast ceiling fills the entire traced sky opening.
// All particles are a fixed set of elements: no frame loop or growing pool.
//
// Everything inside `.exterior-sky` is cut to the painted sky by the traced
// mask in app/horizon.css, which is what puts the two bodies behind the trees
// instead of over them — and what hides whichever of them is under the land,
// with no rule anywhere saying so. The moon is four elements rather than one
// because a phase is a shape: the layer carries the glow, the box carries the
// tilt, and the two shapes inside it are the lit half of the disc and the
// bulge that a gibbous moon adds to it. app/clock-hillside.css §3 draws them.
//
// The fireflies are the one thing here that is not a gradient on a layer. They
// have to blink out of step with each other or they read as a string of lights,
// and out-of-step means one animation delay each, which means one element each.
export default memo(function WeatherWoodland() {
  return <div className="weather-surface clock-surface" aria-hidden="true">
    <span className="scene-paint exterior-paint" />
    <span className="scene-light" />
    <div className="exterior-sky">
      <span className="cs-stars" />
      <span className="cs-sun" />
      <span className="cs-moon"><span className="moon-disc">
        <span className="moon-lit"><span className="moon-face" /></span><span className="moon-bulge" />
      </span></span>
      <span className="cs-far" /><span className="cs-deck" />
      <span className="cs-bank" /><span className="cs-scud" />
      <svg className="wood-birds" viewBox="0 0 350 168" preserveAspectRatio="none">
        {/* Each is drawn wings up, with the tips well clear of the body and the
            wrist held above the chord, so the flap in app/clock-hillside.css
            has room to flatten it without collapsing it. Spans 13, 11 and 9. */}
        <g className="bird-flight"><g className="bird-wings"><path d="M-6.5-3.1Q-3.4-3.5 0 0Q3.4-3.5 6.5-3.1" /></g></g>
        <g className="bird-flight"><g className="bird-wings"><path d="M-5.5-2.6Q-2.9-3 0 0Q2.9-3 5.5-2.6" /></g></g>
        <g className="bird-flight"><g className="bird-wings"><path d="M-4.5-2.2Q-2.4-2.5 0 0Q2.4-2.5 4.5-2.2" /></g></g>
      </svg>
    </div>
    <span className="scene-paint exterior-paint wood-canopy canopy-left" />
    <span className="scene-paint exterior-paint wood-canopy canopy-right" />
    <svg className="scene-props exterior-props" viewBox="0 0 350 168" preserveAspectRatio="none">
      <defs>
        <radialGradient id="woodland-fire"><stop stopColor="#ffc477" stopOpacity=".65" /><stop offset=".35" stopColor="#ed8b32" stopOpacity=".3" /><stop offset="1" stopColor="#dba35c" stopOpacity="0" /></radialGradient>
        <linearGradient id="woodland-log" x2="0" y2="1"><stop stopColor="#976d42" /><stop offset=".4" stopColor="#573d2d" /><stop offset="1" stopColor="#2b2925" /></linearGradient>
        <radialGradient id="woodland-smoke"><stop stopColor="#b8b5a1" stopOpacity=".23" /><stop offset="1" stopColor="#b8b5a1" stopOpacity="0" /></radialGradient>
      </defs>
      <g className="exterior-camp" transform="translate(278 149)">
        <ellipse className="wood-fire-glow" cy="3" rx="37" ry="15" fill="url(#woodland-fire)" />
        <ellipse className="wood-fire-halo" cy="-5" rx="17" ry="22" fill="url(#woodland-fire)" />
        <g className="wood-smoke" fill="url(#woodland-smoke)"><ellipse cy="-7" rx="7" ry="11" /><ellipse cx="3" cy="-14" rx="9" ry="9" /></g>
        <g className="wood-smoke smoke-second" fill="url(#woodland-smoke)"><ellipse cy="-7" rx="7" ry="11" /></g>
        <g className="camp-materials scene-lit">
          <ellipse cy="5" rx="14" ry="5" fill="#252b25" />
          <path d="M-13 4-11 1-7 0-5 2-7 5ZM7 1 11 0 14 3 12 5 8 4Z" fill="#77745e" />
          <path d="M-12 5-8 3-5 5-6 8-11 7ZM4 6 9 4 13 6 10 8 6 9Z" fill="#8b8166" />
          <path d="m-10 1 19 5-1 3-19-5Zm18-2 2 3-18 6-1-3Z" fill="url(#woodland-log)" />
          <path d="m-8 2 12 4M-4 5 11 0" stroke="#b18450" strokeWidth=".5" />
        </g>
        <ellipse cy="3" rx="7" ry="2" fill="#d46b2a" opacity=".8" />
        <image className="wood-flame flame-back" href="/weather/flame-v1.webp" x="-14" y="-28" width="28" height="36" preserveAspectRatio="none" />
        <image className="wood-flame flame-front" href="/weather/flame-v1.webp" x="-10" y="-15" width="19" height="22" preserveAspectRatio="none" />
        <g className="wood-embers" fill="#ffd995"><circle r=".7" /><circle r=".5" /><circle r=".65" /><circle r=".4" /><circle r=".5" /></g>
        <path d="m-7 4 3 1m6-2 3-1M0 6l2-.5" stroke="#f9bd63" strokeWidth=".6" strokeLinecap="round" />
      </g>
    </svg>
    <span className="cs-fall" /><span className="wood-fall-near" />
    <span className="wood-mist" /><span className="wood-ripples"><i /><i /><i /></span>
    <span className="cs-air" />
    <span className="cs-flies">
      <span /><span /><span /><span /><span /><span /><span /><span />
    </span>
    <span className="weather-shade" />
  </div>;
});
