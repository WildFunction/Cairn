import type { ElectrobunConfig } from 'electrobun';

// A checkout without the certificate still packages; release.yml refuses to publish an unnotarized app.
const signed = Boolean(process.env.ELECTROBUN_DEVELOPER_ID);
const notarized = signed && Boolean(process.env.ELECTROBUN_APPLEIDPASS);

export default {
  app: { name: 'Cairn', identifier: 'dev.jasper.cairn', version: '0.1.4' },
  build: {
    mainProcess: 'cottontail',
    cottontail: { entrypoint: 'src/main/index.ts' },
    // Vite builds the renderer; the generated bundle ships beside it.
    // `public/` is deliberately not copied: its only contents are the generated
    // library, which lives in the user data dir and is served over loopback
    // (see src/main/library.ts). It is also gitignored, so copying it made the
    // build fail outright in any checkout that had never run `bun run dev`.
    copy: {
      'dist/index.html': 'views/mainview/index.html',
      'dist/assets': 'views/mainview/assets',
    },
    watchIgnore: ['dist/**'],
    // `icons` is the default path, named here because it is generated:
    // scripts/make-iconset.py rebuilds it from icon.src.png.
    mac: { bundleCEF: false, icons: 'icon.iconset', codesign: signed, notarize: notarized },
    win: { icon: 'icon.iconset/icon_256x256.png' },
  },
} satisfies ElectrobunConfig;
