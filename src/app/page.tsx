const safeguards = [
  "Signed and deduplicated issue intake",
  "Repository-scoped GitHub App tokens",
  "Secret-free Vercel Sandboxes",
  "Deterministic diff and path policy",
  "No merge, release, or deployment authority",
];

export default function Home() {
  return (
    <main>
      <div className="glow" />
      <section className="hero">
        <p className="eyebrow">Open-source · Vercel-first · Human-controlled</p>
        <h1>Issue Triage Agent</h1>
        <p className="lede">
          Turn authenticated support tickets and alerts into isolated repository
          investigations—and bounded pull requests ready for human review.
        </p>
        <div className="actions">
          <a href="https://github.com/Blazity/issue-triage-agent">
            View on GitHub
          </a>
          <a className="secondary" href="/api/health">
            Check health
          </a>
        </div>
      </section>

      <section className="flow" aria-label="Workflow">
        {[
          ["01", "Authenticate", "Verify the source and admit the event once."],
          [
            "02",
            "Investigate",
            "Inspect configured repositories in isolated sandboxes.",
          ],
          [
            "03",
            "Verify",
            "Run operator-approved checks and deterministic policy.",
          ],
          [
            "04",
            "Review",
            "Open independent draft PRs. A human decides what ships.",
          ],
        ].map(([number, title, copy]) => (
          <article key={number}>
            <span>{number}</span>
            <h2>{title}</h2>
            <p>{copy}</p>
          </article>
        ))}
      </section>

      <section className="safety">
        <div>
          <p className="eyebrow">The authority boundary</p>
          <h2>Useful automation without production authority.</h2>
        </div>
        <ul>
          {safeguards.map((safeguard) => (
            <li key={safeguard}>{safeguard}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
