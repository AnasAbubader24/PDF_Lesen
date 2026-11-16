import { setDefaultFontLoading } from '@ui5/webcomponents-base/dist/config/Fonts.js';
import { setTheme } from '@ui5/webcomponents-base/dist/config/Theme.js';
// Local demo must not depend on a public font CDN. System fonts cover RTL/CJK.
setDefaultFontLoading(false);
void setTheme('sap_horizon');
