import { memo } from 'react';

// Painted backgrounds stay still. Softly shaded, imperfect props are separate
// so the lamp and its light can be composited independently.
//
// The lamp hangs at x 224, which is where the night plate's painted pool of
// lamplight is centred (`npm run scene -- --sky night,clear` reads it back).
// Anything the room lights rather than emits carries `scene-lit` and takes the
// ambient filter with it; the glow itself never does, or the light would dim
// with the dark it is lighting.
export default memo(function ClockWorkshop() {
  return <div className="workshop-room" aria-hidden="true">
    <span className="scene-paint interior-paint" />
    <span className="scene-paint interior-paint workshop-bench" />
    <span className="scene-light" />
    {/* Weather through the glass. The sky drifts behind the panes and the wash
        and the rain sit on it, in that order, because rain runs down the near
        side of a window and cloud is a long way off on the other. What cuts
        the sky to the four panes -- and leaves the painted frame and mullions
        in front of it -- is the mask in app/horizon.css, traced off these same
        plates by npm run horizon.

        Everything the glass shows is a child of that one masked element, which
        is why the fireflies and the sheen need no second copy of the pane
        shape: cloud far off, fireflies in the trees just outside, and the
        glass itself in front of both. The weather-driven opacity moved off
        this element and onto the cloud when the other two arrived -- a firefly
        must not fade because the sky is clear. */}
    <span className="shed-window-sky">
      <span className="shed-window-cloud" />
      <span className="shed-window-flies"><span /><span /><span /><span /></span>
      <span className="shed-window-glass" />
    </span>
    <span className="shed-window-weather"><span className="shed-window-rain" /></span>
    <svg className="scene-props" viewBox="0 0 350 158" preserveAspectRatio="none">
      <defs>
        <linearGradient id="shed-enamel" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#a2ab89" /><stop offset=".4" stopColor="#748b78" /><stop offset="1" stopColor="#3d5b50" /></linearGradient>
        <linearGradient id="shed-clay" x2=".9" y2="1"><stop stopColor="#b99772" /><stop offset=".5" stopColor="#947455" /><stop offset="1" stopColor="#66513f" /></linearGradient>
        <radialGradient id="shed-lamplight"><stop stopColor="#ffcf82" stopOpacity=".24" /><stop offset="1" stopColor="#ffcf82" stopOpacity="0" /></radialGradient>
      </defs>
      <ellipse className="shed-lamplight" cx="224" cy="51" rx="66" ry="56" fill="url(#shed-lamplight)" />
      <path className="scene-lit" d="M224 12Q223 18 224 23" fill="none" stroke="#3c362a" strokeWidth="1.5" />
      <g transform="translate(224 34) scale(1.45) translate(-265 -32)">
      <g className="shed-lamp-shade scene-lit">
      <path d="M252 32Q256 29 258 25Q261 21 265 22Q270 21 272 26Q274 30 278 32Q266 35 252 32Z" fill="url(#shed-enamel)" stroke="#4b5e4a" strokeWidth=".6" />
      <path d="M255 30Q260 24 264 24M269 23l2 1" fill="none" stroke="#c2c5a1" strokeWidth=".8" opacity=".65" />
      <path d="M252 32Q264 30 278 32Q266 37 252 32Z" fill="#c8b88a" />
      </g>
      <ellipse className="shed-lamplight" cx="265" cy="33" rx="4" ry="2.5" fill="#f1d9a3" />
      </g>
      <g className="shed-furniture scene-lit" transform="translate(22 1) scale(1.25 1.12)">
      <path d="M18 32Q39 30 68 32L67 35Q41 34 19 36Z" fill="#72543d" /><path d="m21 32 18 .2 22-.1" fill="none" stroke="#a18a62" strokeWidth=".7" />
      <path d="M24 23Q32 22 38 24L36 31Q31 34 26 31Z" fill="url(#shed-clay)" stroke="#705c44" strokeWidth=".6" />
      <path d="M23 23Q30 21 39 23L38 25Q30 24 24 25Z" fill="#ad9570" />
      <path d="M30 24Q28 16 24 11M31 24Q33 15 38 12M31 20Q30 11 33 7" fill="none" stroke="#63724d" strokeWidth=".8" />
      <g fill="#77865a"><path d="M29 19Q20 20 20 14Q25 12 29 19ZM25 14Q19 13 22 8Q26 8 25 14ZM32 17Q36 10 41 14Q40 19 32 17ZM32 13Q28 9 33 6Q37 9 32 13Z" /></g>
      <path d="M27 18Q23 17 22 15M34 16l4-1" stroke="#a0a679" strokeWidth=".55" fill="none" />
      <path d="M48 21Q51 19 55 21L56 30Q51 32 47 30Z" fill="url(#shed-enamel)" stroke="#596850" strokeWidth=".5" /><path d="M47 21Q52 22 56 21" stroke="#aeb596" strokeWidth="1" />
      <path d="M59 27Q64 23 66 29L65 32H59Z" fill="url(#shed-clay)" />
      </g>
    </svg>
  </div>;
});
