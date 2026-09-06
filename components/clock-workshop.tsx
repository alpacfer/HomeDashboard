import { memo } from 'react';

// Painted backgrounds stay still. Softly shaded, imperfect props are separate
// so the small brass movement and lamplight can be composited independently.
export default memo(function ClockWorkshop() {
  return <div className="workshop-room" aria-hidden="true">
    <span className="scene-paint interior-paint" />
    <span className="scene-paint interior-paint workshop-bench" />
    <span className="scene-light" />
    <span className="shed-window-weather"><span className="shed-window-rain" /></span>
    <svg className="scene-props" viewBox="0 0 350 158" preserveAspectRatio="none">
      <defs>
        <linearGradient id="shed-brass" x1=".1" y1="0" x2=".8" y2="1"><stop stopColor="#c1ac77" /><stop offset=".44" stopColor="#9d8352" /><stop offset="1" stopColor="#6f5738" /></linearGradient>
        <linearGradient id="shed-enamel" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#a2ab89" /><stop offset=".4" stopColor="#748b78" /><stop offset="1" stopColor="#3d5b50" /></linearGradient>
        <linearGradient id="shed-clay" x2=".9" y2="1"><stop stopColor="#b99772" /><stop offset=".5" stopColor="#947455" /><stop offset="1" stopColor="#66513f" /></linearGradient>
        <radialGradient id="shed-lamplight"><stop stopColor="#ffcf82" stopOpacity=".24" /><stop offset="1" stopColor="#ffcf82" stopOpacity="0" /></radialGradient>
        <g id="shed-gear">
          <path d="M-3-17H3L4-13 7-12 11-14 15-10 12-6 14-3 18-2V3L14 4 12 7 14 11 10 15 6 12 3 14 2 18H-3L-4 14-7 12-11 14-15 10-12 6-14 3-18 2V-3L-14-4-12-7-14-11-10-15-6-12-3-14ZM0-10A10 10 0 1 0 0 10A10 10 0 1 0 0-10Z" fill="url(#shed-brass)" fillRule="evenodd" stroke="#665239" strokeWidth=".7" />
          <circle r="11.7" fill="none" stroke="#c7b583" strokeWidth=".5" opacity=".65" />
          <g fill="url(#shed-brass)">
            <path d="M-2-11Q4-5 2 0L-1 2Q1-6-5-10Z" />
            <path d="M-2-11Q4-5 2 0L-1 2Q1-6-5-10Z" transform="rotate(120)" />
            <path d="M-2-11Q4-5 2 0L-1 2Q1-6-5-10Z" transform="rotate(240)" />
          </g>
          <circle r="3.3" fill="#aa9467" stroke="#665239" strokeWidth=".7" /><path d="m-1.3 1 2.6-2" stroke="#524631" strokeWidth=".8" />
          <path d="m-2-15 3 .2M13-1l2 .4M-10 9l2 1" stroke="#d5c291" strokeWidth=".65" opacity=".7" />
        </g>
      </defs>
      <g className="shed-hardware">
      <g transform="translate(313 25)"><g className="shed-wheel shed-wheel-large"><use href="#shed-gear" transform="scale(.72)" /></g></g>
      <g transform="translate(292 20)"><g className="shed-wheel shed-wheel-small"><use href="#shed-gear" transform="scale(.48)" /></g></g>
      <g className="shed-pendulum">
        <path d="M328 17Q327.5 27 328 39" fill="none" stroke="#937d55" strokeWidth="1.2" />
        <path d="M328 35C333 36 333 44 328 45C323 44 323 36 328 35Z" fill="url(#shed-brass)" stroke="#62523a" strokeWidth=".6" /><path d="M326 38Q325 41 327 43" fill="none" stroke="#c5b582" strokeWidth=".65" />
      </g>
      </g>
      <ellipse className="shed-lamplight" cx="245" cy="51" rx="66" ry="56" fill="url(#shed-lamplight)" />
      <path d="M245 12Q244 18 245 23" fill="none" stroke="#3c362a" strokeWidth="1.5" />
      <g transform="translate(245 34) scale(1.45) translate(-265 -32)">
      <g className="shed-lamp-shade">
      <path d="M252 32Q256 29 258 25Q261 21 265 22Q270 21 272 26Q274 30 278 32Q266 35 252 32Z" fill="url(#shed-enamel)" stroke="#4b5e4a" strokeWidth=".6" />
      <path d="M255 30Q260 24 264 24M269 23l2 1" fill="none" stroke="#c2c5a1" strokeWidth=".8" opacity=".65" />
      <path d="M252 32Q264 30 278 32Q266 37 252 32Z" fill="#c8b88a" />
      </g>
      <ellipse className="shed-lamplight" cx="265" cy="33" rx="4" ry="2.5" fill="#f1d9a3" />
      </g>
      <g className="shed-furniture" transform="translate(22 1) scale(1.25 1.12)">
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
