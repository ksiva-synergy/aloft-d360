/**
 * Blocking boot script injected by Vite (`web/vite.config.ts`). Resolves `system`
 * (and missing storage) via prefers-color-scheme before first paint — must match
 * next-themes with enableSystem.
 */
import { THEME_COOKIE_NAME } from './cookie';

const STORAGE_KEY = 'theme';

export const THEME_BOOT_SCRIPT = `(function(){try{
  var d=document.documentElement,t=localStorage.getItem('${STORAGE_KEY}');
  var isDark;
  if(t==='dark') isDark=true;
  else if(t==='light') isDark=false;
  else isDark=!!(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches);
  d.classList.add(isDark?'dark':'light');
  d.style.colorScheme=isDark?'dark':'light';
  document.cookie='${THEME_COOKIE_NAME}='+(isDark?'dark':'light')+';path=/;max-age=31536000;SameSite=Lax';
}catch(e){}})();`;
