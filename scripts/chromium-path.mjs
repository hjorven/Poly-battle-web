// Welcher Chromium für Browser-Tests, UI-Prüfung und Screenshots?
// PB_CHROMIUM oder CHROMIUM gewinnt. Sonst Playwrights eigener Browser, und
// fehlt der (Cloud-Sitzungen haben nur den vorinstallierten unter
// /opt/pw-browsers/chromium), dieser.
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const PREINSTALLED = '/opt/pw-browsers/chromium';

export function chromiumPath() {
  const own = process.env.PB_CHROMIUM || process.env.CHROMIUM;
  if (own) return own;
  let bundled = null;
  try { bundled = chromium.executablePath(); } catch (e) { /* kein eigener Browser */ }
  if (bundled && existsSync(bundled)) return undefined;
  return existsSync(PREINSTALLED) ? PREINSTALLED : undefined;
}
