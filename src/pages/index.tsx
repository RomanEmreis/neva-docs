import type {ReactNode} from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import HomepageFeatures from '@site/src/components/HomepageFeatures';
import Heading from '@theme/Heading';
import MDXContent from '@theme/MDXContent';
import useBaseUrl from '@docusaurus/useBaseUrl';
import ThemedImage from '@theme/ThemedImage';
import Translate from '@docusaurus/Translate';

import ServerHello from './examples/server-hello.md';
import ClientHello from './examples/client-hello.md';
import PromptHello from './examples/prompt.md';
import ResourcesHello from './examples/resource.md';

import styles from './index.module.css';

function HomepageHeader() {
  const {siteConfig} = useDocusaurusContext();
  return (
    <header className={clsx('hero hero--primary', styles.heroBanner)}>
      <div className="container">
        <ThemedImage
          width={300}
          height={300}
          sources={{
            light: useBaseUrl('/img/logo.svg'),
            dark: useBaseUrl('/img/logo_dark.svg'),
          }}
        />
        <Heading as="h1" className="hero__title">
          {siteConfig.title}
        </Heading>
        <p className="hero__subtitle">
          <Translate id="homepage.tagline">
            Blazingly fast, easily configurable and extremely powerful Model Context Protocol (MCP) server and client SDK for Rust.
          </Translate>
        </p>
        <div className={styles.buttons}>
          <Link
            className="button button--secondary button--lg"
            to="/docs/intro">
            <Translate id="homepage.getStarted">Get Started</Translate>
          </Link>
        </div>
      </div>
    </header>
  );
}

function Examples() {
  return (
    <div className={styles.examples}>
      <div className={`${styles.example} ${styles.reverse}`}>
        <div className={styles.description}>
          <Heading as="h1">
            <Translate id="homepage.example.tool.title">Hello from MCP Tool</Translate>
          </Heading>
          <p>
            <Translate
              id="homepage.example.tool.desc"
              values={{
                toolLink: (
                  <a href='https://modelcontextprotocol.io/specification/draft/server/tools' target='_blank'>
                    <Translate id="homepage.example.tool.desc.linkText">tool</Translate>
                  </a>
                ),
              }}>
              {'Create an MCP server and add your first {toolLink} in just a few lines.'}
            </Translate>
          </p>
        </div>
        <div className={styles.code}>
          <MDXContent>
            <ServerHello />
          </MDXContent>
        </div>
      </div>

      <div className={styles.example}>
        <div className={styles.description}>
          <Heading as="h1">
            <Translate id="homepage.example.prompts.title">Power of Prompts</Translate>
          </Heading>
          <p>
            <Translate
              id="homepage.example.prompts.desc"
              values={{
                promptsLink: (
                  <a href='https://modelcontextprotocol.io/specification/draft/server/prompts' target='_blank'>
                    <Translate id="homepage.example.prompts.desc.linkText">prompts</Translate>
                  </a>
                ),
              }}>
              {'Define rich, flexible {promptsLink} with ease.'}
            </Translate>
          </p>
        </div>
        <div className={styles.code}>
          <MDXContent>
            <PromptHello />
          </MDXContent>
        </div>
      </div>

      <div className={`${styles.example} ${styles.reverse}`}>
        <div className={styles.description}>
          <Heading as="h1">
            <Translate id="homepage.example.resources.title">Resources Made Simple</Translate>
          </Heading>
          <p>
            <Translate
              id="homepage.example.resources.desc"
              values={{
                resourcesLink: (
                  <a href='https://modelcontextprotocol.io/specification/draft/server/resources' target='_blank'>
                    <Translate id="homepage.example.resources.desc.linkText">resources</Translate>
                  </a>
                ),
              }}>
              {'Expose {resourcesLink} with intuitive APIs. Design reusable resource templates for ultimate flexibility.'}
            </Translate>
          </p>
        </div>
        <div className={styles.code}>
          <MDXContent>
            <ResourcesHello />
          </MDXContent>
        </div>
      </div>

      <div className={styles.example}>
        <div className={styles.description}>
          <Heading as="h1">
            <Translate id="homepage.example.client.title">Flexible MCP Client</Translate>
          </Heading>
          <p>
            <Translate id="homepage.example.client.desc">
              An intuitive API with effortless configuration and smooth interaction with MCP servers.
            </Translate>
          </p>
        </div>
        <div className={styles.code}>
          <MDXContent>
            <ClientHello />
          </MDXContent>
        </div>
      </div>
    </div>
  );
}

export default function Home(): ReactNode {
  const {siteConfig} = useDocusaurusContext();
  return (
    <Layout
      title={`${siteConfig.title} MCP SDK`}
      description="MCP client and server SDK for Rust">
      <HomepageHeader />
      <main>
        <HomepageFeatures />
        <Examples />
      </main>
    </Layout>
  );
}
