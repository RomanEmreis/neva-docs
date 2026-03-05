import type {ReactNode} from 'react';
import clsx from 'clsx';
import Heading from '@theme/Heading';
import Translate, {translate} from '@docusaurus/Translate';
import styles from './styles.module.css';

type FeatureItem = {
  title: string;
  description: ReactNode;
};

const FeatureList: FeatureItem[] = [
  {
    title: translate({id: 'homepage.feature.easyToUse.title', message: 'Easy to Use'}),
    description: (
      <Translate id="homepage.feature.easyToUse.desc">
        Easily configurable ergonomic APIs - one library to build both MCP clients and servers.
      </Translate>
    ),
  },
  {
    title: translate({id: 'homepage.feature.featureFullHouse.title', message: 'Feature Full-House'}),
    description: (
      <Translate id="homepage.feature.featureFullHouse.desc">
        Neva provides a rich feature list out of the box. Streamable HTTP, TLS, tracing, OAuth and many more.
      </Translate>
    ),
  },
  {
    title: translate({id: 'homepage.feature.poweredByRust.title', message: 'Powered by Rust'}),
    description: (
      <Translate id="homepage.feature.poweredByRust.desc">
        Blazingly fast, type safe and asynchronous by design.
      </Translate>
    ),
  },
];

function Feature({title, description}: FeatureItem) {
  return (
    <div className={clsx('col col--4')}>
      <div className="text--center padding-horiz--md">
        <div className={styles.circle} role="img" aria-label="small-circle"></div>
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
