import type {ReactNode} from 'react';
import clsx from 'clsx';
import Heading from '@theme/Heading';
import styles from './styles.module.css';

type FeatureItem = {
  title: string;
  description: ReactNode;
};

const FeatureList: FeatureItem[] = [
  {
    title: 'Easy to Use',
    description: (
      <>
        Easily configurable ergonomic APIs - one library to build both MCP clients and servers.
      </>
    ),
  },
  {
    title: 'Feature Full-House',
    description: (
      <>
        Neva provides a rich feature list out of the box. Streamable HTTP, TLS, tracing, OAuth and many more.
      </>
    ),
  },
  {
    title: 'Powered by Rust',
    description: (
      <>
        Blazingly fast, type safe and asynchronous by design.
      </>
    ),
  },
];

function Feature({title, description}: FeatureItem) {
  return (
    <div className={clsx('col col--4')}>
      <div className="text--center padding-horiz--md">
        <Heading as="h3">{title}</Heading>
        <p>{description}</p>
      </div>
    </div>
  );
}

export default function HomepageFeatures(): ReactNode {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className="row">
          {FeatureList.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}
