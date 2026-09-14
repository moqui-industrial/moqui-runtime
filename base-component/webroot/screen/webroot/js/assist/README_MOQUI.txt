OpenUI lang-core (vendored)

Package: @openuidev/lang-core 0.2.18
License: MIT (see LICENSE)
Upstream: https://github.com/thesysdev/openui/tree/main/packages/lang-core

This is a browser IIFE bundle (global OpenUILang) of the parser, streaming parser,
mergeStatements, store, queryManager, evaluate, and generateSystemPrompt. Telemetry
is disabled (OPENUI_TELEMETRY_DISABLED=1 banner). ci-info is stubbed. No npm at runtime.

Rebuild (Node required, not part of the Moqui Gradle build):

  mkdir -p /tmp/openui-vendor && cd /tmp/openui-vendor
  npm pack @openuidev/lang-core@0.2.18
  tar -xzf openuidev-lang-core-0.2.18.tgz
  npm install --no-save zod@4 esbuild
  # vendor-entry.mjs exports createParser, createStreamingParser, mergeStatements,
  # createStore, createQueryManager, evaluate, evaluateElementProps,
  # BuiltinActionType, ACTION_STEPS, generateSystemPrompt from package/dist/index.mjs
  npx esbuild vendor-entry.mjs --bundle --format=iife --global-name=OpenUILang \
    --platform=browser --target=es2018 --alias:ci-info=./ci-info-stub.js \
    --minify --banner:js="globalThis.OPENUI_TELEMETRY_DISABLED=1;" \
    --outfile=lang-core.umd.min.js

Copy lang-core.umd.min.js and LICENSE.openui into this directory (js/assist/,
which is committed; webroot/libs is gitignored CDN downloads). Pin the same
version in this file when upgrading.
