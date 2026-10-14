# Supplied logo update

Updated 10 October 2026. The supplied ComicHuddle superhero artwork is used for the website header and footer, native prototype header, favicon and installable app icons. Original source JPEG is retained unchanged in public/brand/comichuddle-hero-logo.jpeg. SVG viewports remove only unused display margins; the lettering and superhero illustration are preserved. PNG icons are format/size conversions of the supplied artwork.

Headers use fixed, responsive bounds: 128 × 104 px on desktop, 114 × 92 px on mobile and the native preview, and 102 × 84 px for narrow web screens. The logo remains the Home button with an accessible label. Navigation and account behavior are unchanged. Versioned icon paths avoid reuse of the prior monogram, and the generic offline asset cache is bumped to version 3.

Verification: web TypeScript and PWA privacy checks passed; native TypeScript, 13 actual handler groups and seven cover-layout viewports passed; Expo web export succeeded. Browser visual/device checks were unavailable in this environment. Unsigned native export is a prototype, not an app-store build.
