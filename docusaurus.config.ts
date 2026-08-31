import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const config: Config = {
  title: 'Neva MCP SDK',
  tagline: 'Blazingly fast, easily configurable and extremely powerful Model Context Protocol (MCP) server and client SDK for Rust.',
  //favicon: 'img/favicon.ico',

  // Future flags, see https://docusaurus.io/docs/api/docusaurus-config#future
  future: {
    v4: true, // Improve compatibility with the upcoming Docusaurus v4
  },

  // Set the production url of your site here
  url: 'https://romanemreis.github.io',

  // Set the /<baseUrl>/ pathname under which your site is served
  // For GitHub pages deployment, it is often '/<projectName>/'
  baseUrl: '/neva-docs/',

  // GitHub pages deployment config.
  // If you aren't using GitHub pages, you don't need these.
  organizationName: 'RomanEmreis', // Usually your GitHub org/user name.
  projectName: 'neva', // Usually your repo name.
  trailingSlash: false,
  onBrokenLinks: 'throw',

  // Even if you don't use internationalization, you can use this field to set
  // useful metadata like html lang. For example, if your site is Chinese, you
  // may want to replace "en" with "zh-Hans".
  i18n: {
    defaultLocale: 'en',
    locales: ['en','ru'],
  },

  // Offline search. Docusaurus ships no search of its own — the bundled option
  // is Algolia DocSearch, which means an external service and an application
  // to their crawler. This one builds a lunr index from the rendered HTML at
  // the end of `docusaurus build` and ships it as a static asset, so search
  // stays a property of the site rather than of a third party.
  //
  // Because the index is a build artifact, the search box is inert under
  // `npm start` — it says so in the dropdown. Use `npm run build && npm run
  // serve` to try it.
  themes: [
    [
      '@easyops-cn/docusaurus-search-local',
      {
        // One index per locale, built from that locale's own pages, so a
        // Russian query searches the Russian text. `ru` brings in the lunr
        // stemmer for it — without naming the locale here the index would be
        // stemmed as English and match badly.
        language: ['en', 'ru'],
        // Content-hash the index filename, so a redeploy can never be served
        // a stale index out of a browser cache.
        hashed: true,
        // There is no blog. The `src/pages/examples/*.md` files are bare code
        // fences imported into the landing page rather than pages anyone reads
        // on their own, so indexing them would only add noise.
        indexBlog: false,
        indexPages: false,
        docsRouteBasePath: 'docs',
        // Marks the query's terms on the page the reader lands on.
        highlightSearchTermsOnTargetPage: true,
      },
    ],
  ],

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
        },
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    colorMode: {
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'Neva',
      logo: {
        alt: 'Neva Logo',
        srcDark: 'img/logo.svg',
        src: 'img/logo_dark.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'tutorialSidebar',
          position: 'left',
          label: 'Tutorial',
        },
        {
          type: 'doc',
          docId: 'agent-skill',
          position: 'left',
          label: 'Skill',
        },
        {
          href: 'https://github.com/RomanEmreis/neva',
          label: 'GitHub',
          position: 'right',
        },
        {
          type: 'localeDropdown',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      copyright: `Copyright © ${new Date().getFullYear()} Neva`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ["bash", "toml"],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
