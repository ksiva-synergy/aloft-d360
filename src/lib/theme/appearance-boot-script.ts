/**
 * Blocking boot script injected by Vite (`web/vite.config.ts`). Kept in its own module so
 * edits to `appearance.ts` do not force a full Vite server restart (which briefly breaks the
 * `/api` proxy and can log next-auth CLIENT_FETCH_ERROR).
 */
const STORAGE_KEY = 'aloft-appearance';

const RAIL_VAR_KEYS = [
  '--rail-bg', '--rail-bg-top', '--rail-accent', '--rail-ink', '--rail-ink-strong', '--rail-muted',
  '--rail-line', '--rail-hover', '--rail-active', '--rail-shadow', '--rail-glow',
];

export const APPEARANCE_BOOT_SCRIPT = `(function(){try{
  var s=JSON.parse(localStorage.getItem('${STORAGE_KEY}')||'null');
  if(!s||!s.vars)return;
  var r=document.documentElement,dark=r.classList.contains('dark'),mode=dark?'dark':'light';
  var v=Object.assign({},s.vars[mode]);
  function lum(h){var n=parseInt(h.slice(1),16),R=(n>>16)&255,G=(n>>8)&255,B=n&255;return(0.2126*R+0.7152*G+0.0722*B)/255;}
  function railHex(){if(mode==='light'&&s.railLight)return s.railLight;if(mode==='dark'&&s.railDark)return s.railDark;if(s.rail){var d=lum(s.rail)<0.2;return(mode==='dark'?d:!d)?s.rail:null;}return null;}
  if(!railHex()){${JSON.stringify(RAIL_VAR_KEYS)}.forEach(function(k){delete v[k];});}
  for(var k in v)r.style.setProperty(k,v[k]);
}catch(e){}})();`;
