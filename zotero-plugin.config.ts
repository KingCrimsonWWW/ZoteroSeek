import { defineConfig } from "zotero-plugin-scaffold"
import postCssPlugin from "esbuild-style-plugin"
import tailwind from "tailwindcss"
import autoprefixer from "autoprefixer"
import pkg from "./package.json"

export default defineConfig({
  source: ["plugin", "plugin/src", "plugin/chrome"],
  dist: ".scaffold/build",
  name: pkg.config.addonName,
  id: pkg.config.addonID,
  namespace: pkg.config.addonRef,
  updateURL: `https://github.com/KingCrimsonWWW/ZoteroSeek/releases/download/release/${pkg.version.includes("-") ? "update-beta.json" : "update.json"}`,
  xpiDownloadLink: "https://github.com/KingCrimsonWWW/ZoteroSeek/releases/download/v{{version}}/{{xpiName}}.xpi",

  build: {
    assets: ["plugin/chrome/**/*.*", "plugin/manifest.json", "plugin/bootstrap.js"],
    define: {
      ...pkg.config,
      author: pkg.author,
      description: pkg.description,
      homepage: pkg.homepage,
      buildVersion: pkg.version,
      buildTime: "{{buildTime}}",
    },
    esbuildOptions: [
      {
        entryPoints: ["plugin/src/launcher.ts"],
        define: {
          __env__: `"${process.env.NODE_ENV}"`,
        },
        plugins: [
          postCssPlugin({
            postcss: {
              plugins: [tailwind(), autoprefixer()]
            },
          }),
        ],
        bundle: true,
        target: "firefox115",
        outfile: `.scaffold/build/addon/chrome/content/scripts/${pkg.config.addonRef}.js`,
      },
      // Web Worker entry — runs Dexie off main thread
      {
        entryPoints: ["plugin/src/bridge.ts"],
        define: {
          __env__: `"${process.env.NODE_ENV}"`,
        },
        bundle: true,
        target: "firefox115",
        outfile: `.scaffold/build/addon/chrome/content/scripts/dbWorkers.js`,
      },
    ],
  },
})
