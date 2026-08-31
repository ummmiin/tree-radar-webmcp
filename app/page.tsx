import Image from "next/image";

import { ExternalLinkIcon } from "../src/challenge/external-link-icon.tsx";
import { TaichungChallengeExperience } from "../src/challenge/product-experience.tsx";

export function TreeRadarChallengeHeader() {
  return (
    <>
      <header className="site-header">
        <div className="brand-lockup">
          <Image
            alt=""
            aria-hidden="true"
            className="brand-mark"
            height={32}
            src="/icon.svg"
            width={32}
          />
          <div>
            <p className="brand">Tree Radar</p>
            <p className="product-label">WebMCP Challenge</p>
          </div>
        </div>
        <a
          aria-label="Umin Labs（於新分頁開啟）"
          className="parent-brand"
          href="https://www.uminlabs.com/"
          rel="noopener noreferrer"
          target="_blank"
        >
          Umin Labs
          <ExternalLinkIcon />
        </a>
      </header>
      <section
        aria-labelledby="challenge-title"
        className="challenge-introduction"
      >
        <p className="eyebrow">Tree Radar × WebMCP Challenge</p>
        <h1 id="challenge-title">臺中市行道樹</h1>
        <p className="challenge-copy">
          探索經完整性驗證的 118,403 筆臺中市官方行道樹資料，並體驗可由人與
          WebMCP 共用的地圖探索方式。
        </p>
      </section>
    </>
  );
}

export default function Home() {
  return (
    <>
      <TreeRadarChallengeHeader />
      <main id="main-content">
        <TaichungChallengeExperience />
      </main>
    </>
  );
}
