import { TaichungChallengeExperience } from "../src/challenge/product-experience.tsx";

export default function Home() {
  return (
    <>
      <header className="site-header">
        <p className="eyebrow">Tree Radar × WebMCP Challenge</p>
        <h1>臺中市行道樹</h1>
        <p>Explore the admitted 118,403-record government data package.</p>
      </header>
      <TaichungChallengeExperience />
    </>
  );
}
