# Orange Jelly application identity

Use the supplied complete Orange Jelly horizontal logo instead of an icon beside The Anchor title. A small paper-coloured backing keeps the original orange and ink logo readable on the orange navigation without altering the asset.

Changed: src/ds/shell/Sidebar.tsx, src/ds/shell/MobileChrome.tsx, src/app/auth/_components/AuthCard.tsx and src/app/auth/login/_components/LoginClient.tsx for the wordmark; src/app/layout.tsx and public/manifest.json for application names; public/orange-jelly/logo-horizontal.png and social-avatar.png for original supplied assets; src/app/icon.png replaces the old favicon.ico and generated icon.tsx.

Deliberately unchanged: venue names in operational data and guest pages, public/logo.png used by venue documents, navigation order, hover behaviour, spacing, authentication logic and all business data. No migration or deployment.

The actual signed-in Firefox rota page displays the full wordmark with no Anchor title in the navigation. The tab reads Orange Jelly Management Tools and displays the supplied orange favicon. Original wordmark and avatar files were copied without modification. Lint and 42 focused shell/guard tests passed. Uncached typecheck and the isolated production build also passed. The build retains the existing spacing-* documentation warning. The local sign-in response contains the full wordmark and Orange Jelly page title, with the old auth title absent.

## Owner-supplied white logo

Sidebar.tsx and MobileChrome.tsx now use public/orange-jelly/logo-horizontal-white.png directly on orange, without the paper backing. The taller two-line asset is contained at 40px height without stretching; the desktop brand row is 48px. The supplied image bytes are unchanged. The colour wordmark remains on the light sign-in cards. Verified the actual Firefox booking page shows the full white Orange Jelly mark on orange. Targeted lint and 41 shell tests passed. No other application behaviour changed.
