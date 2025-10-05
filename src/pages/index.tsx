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
          {siteConfig.tagline}
        </p>
        <div className={styles.buttons}>
          <Link
            className="button button--secondary button--lg"
            to="/docs/intro">
            Get Started
          </Link>
        </div>
      </div>
    </header>
  );
}

function Examples() {
  return (
    <div className={styles.examples}>
      <div>
        <div className="container">
          <div className={styles.example}>
            <div className={styles.code}>
              <MDXContent>
                <ServerHello />
              </MDXContent>
            </div>
            <div className={styles.description}>
              <Heading as="h1">Hello from MCP Tool</Heading>
              <p>
                Create an MCP server and add your first <a href='https://modelcontextprotocol.io/specification/draft/server/tools' target='_blank'>tool</a> in just a few lines.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div>
        <div className="container">
          <div className={styles.example}>
            <div className={styles.description}>
              <Heading as="h1">Power of Prompts</Heading>
              <p>
                Define rich, flexible <a href='https://modelcontextprotocol.io/specification/draft/server/prompts' target='_blank'>prompts</a> with ease.
              </p>
            </div>
            <div className={styles.code}>
              <MDXContent>
                <PromptHello />
              </MDXContent>
            </div>
          </div>
        </div>
      </div>

      <div>
        <div className="container">
          <div className={styles.example}>
            <div className={styles.code}>
              <MDXContent>
                <ResourcesHello />
              </MDXContent>
            </div>
            <div className={styles.description}>
              <Heading as="h1">Resources Made Simple</Heading>
              <p>
                Expose <a href='https://modelcontextprotocol.io/specification/draft/server/resources' target='_blank'>resources</a> with intuitive APIs. Design reusable resource templates for ultimate flexibility.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container">
        <div className={styles.example}>
          <div className={styles.description}>
            <Heading as="h1">Flexible MCP Client</Heading>
            <p>
              An intuitive API with effortless configuration and smooth interaction with MCP servers.
            </p>
          </div>
          <div className={styles.code}>
            <MDXContent>
              <ClientHello />
            </MDXContent>
          </div>
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
