import { Prose } from "@agent-paste/ui";
import { FEATURES, type Feature, HERO, SIGN_IN_URL } from "../copy";

// The result gesture echoes the brand mark: a caret pointing along a wire into a
// node (the publish/hand-off motif). The wire is the box-drawing glyph U+2500,
// deliberately NOT U+2014 (the em dash): keep it that way so the no-em-dash rule
// and the apex banned-token test hold. The node is a separate span so it can take
// the accent color. index.test.ts pins the exact rendered string; if a formatter
// or an agent rewrites either glyph, that test fails.
const GESTURE_WIRE = ">─";
const GESTURE_NODE = "●";

// The one ID the publish command resolves to. The CLI prints this exact string;
// the resolve rows show it landing as a human URL. index.test.ts pins the
// copy-to-clipboard payload (origin + id).
const ARTIFACT_ORIGIN = "https://agent-paste.sh/";
const ARTIFACT_ID = "art_01HZ8K2X9NPQR3VW7TYBE5MCDF";

const LOGIN_CMD = "npx @zaks-io/agent-paste login";
const PUBLISH_CMD = "npx @zaks-io/agent-paste publish ./report";
const INSTALL_CMD = "curl -fsSL https://agent-paste.sh/install.sh | sh";

// A mono command box: accent prompt, the command, and a Copy button that flips to
// the accent on success (data-copied is set by the shared clipboard script bound
// to [data-clipboard]).
function CommandBox({ cmd }: { cmd: string }) {
  return (
    <div className="cmd">
      <code>
        <span className="prompt" aria-hidden="true">
          ${" "}
        </span>
        {cmd}
      </code>
      <button type="button" className="copy-btn" data-clipboard={cmd} aria-label={`Copy: ${cmd}`}>
        Copy
      </button>
    </div>
  );
}

// Left pane: the sticky hero. Eyebrow, the display headline with the one accent
// word, the lead, and the CTA row.
function HeroPane() {
  return (
    <section className="pane-left">
      <p className="home-eyebrow reveal d1">
        <span className="dot" aria-hidden="true" />
        {HERO.eyebrow}
      </p>
      <h1 className="home-headline reveal d2">
        Your <span className="accent">agent</span> built it. Open it anywhere.
      </h1>
      <p className="home-lead reveal d3">{HERO.lead}</p>
      <div className="cta-row reveal d4">
        <a className="btn-primary" href={SIGN_IN_URL}>
          {HERO.primary.label}
          <span className="arr" aria-hidden="true">
            →
          </span>
        </a>
        <a className="btn-quiet" href="/docs">
          Read the docs
        </a>
      </div>
    </section>
  );
}

// Right pane: the reading column of hairline-ruled blocks.
function DetailPane() {
  return (
    <section className="pane-right">
      <div className="block reveal d3">
        <p className="tagline">
          A URL for humans. A <span className="accent">manifest</span> for agents.
        </p>
      </div>

      <CommandBlock />
      <ProofBlock />
      <ClosingBlock />
    </section>
  );
}

function CommandBlock() {
  return (
    <div className="block reveal d4" id="how">
      <div className="marker">
        <span className="num">01</span> / The command
      </div>
      <p className="block-note">
        Sign in once over browser OAuth, then publish to hand off what your agent made. The same ID resolves to a page a
        person opens and a manifest another agent reads.
      </p>
      <CommandBox cmd={LOGIN_CMD} />
      <p className="cmd-note">Browser OAuth provisions a scoped key on your machine. No key to copy or paste.</p>
      <CommandBox cmd={PUBLISH_CMD} />

      <div className="resolve">
        <div className="res-row">
          <div className="res-label">Result</div>
          <div>
            <button
              type="button"
              className="res-url copyable"
              data-clipboard={`${ARTIFACT_ORIGIN}${ARTIFACT_ID}`}
              aria-label={`Copy artifact URL: ${ARTIFACT_ORIGIN}${ARTIFACT_ID}`}
            >
              <span className="t-gesture" aria-hidden="true">
                {GESTURE_WIRE}
                <span className="t-gesture-node">{GESTURE_NODE}</span>
              </span>
              {ARTIFACT_ORIGIN}
              <span className="t-id">{ARTIFACT_ID}</span>
            </button>
          </div>
        </div>
        <div className="res-row">
          <div className="res-label">Human</div>
          <div>
            <span className="res-url">opens the page in a browser</span>
          </div>
        </div>
        <div className="res-row">
          <div className="res-label">Agent</div>
          <div>
            <span className="res-url">reads the manifest.json</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProofBlock() {
  return (
    <div className="block reveal d5" id="features">
      <div className="marker">
        <span className="num">02</span> / Why it holds up
      </div>
      <ol className="proof">
        {FEATURES.map((feature, index) => (
          <ProofItem key={feature.title} feature={feature} index={index + 1} />
        ))}
      </ol>
    </div>
  );
}

function ProofItem({ feature, index }: { feature: Feature; index: number }) {
  return (
    <li>
      <span className="pf-num">{index.toString().padStart(2, "0")}</span>
      <div>
        <p className="pf-title">{feature.title}</p>
        <p className="pf-body">
          <Prose text={feature.body} />
        </p>
      </div>
    </li>
  );
}

function ClosingBlock() {
  return (
    <div className="block closing reveal d6" id="docs">
      <div className="marker">
        <span className="num">03</span> / Get started
      </div>
      <CommandBox cmd={INSTALL_CMD} />
      <p className="price">
        <b>Free to start.</b> Add <code className="code">--ephemeral</code> to publish with no account at all.
      </p>
      <a className="btn-primary" href={SIGN_IN_URL}>
        Get started free
        <span className="arr" aria-hidden="true">
          →
        </span>
      </a>
    </div>
  );
}

export function HomePage() {
  return (
    <main>
      <div className="wrap">
        <div className="two-pane">
          <HeroPane />
          <DetailPane />
        </div>
      </div>
    </main>
  );
}
