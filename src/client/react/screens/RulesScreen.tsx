import type { CSSProperties, ReactNode } from 'react';

// RULES / HOW TO PLAY — the pixel command console. A friendly, scannable guide
// to One More Dawn, grounded in docs/game/ux-capabilities.md. Returns a fragment
// of `.pxl-panel card` panels (no scroll wrapper — the parent .pxl-content scrolls).

// ---------- shared bits ----------

/** A gold pixel-header panel with an icon, matches .pxl-phead style. */
function Panel({
  icon,
  title,
  meta,
  children,
}: {
  icon: string;
  title: string;
  meta?: string;
  children: ReactNode;
}) {
  return (
    <div className="pxl-panel card">
      <div className="pxl-phead">
        <span className="lbl">
          <span aria-hidden="true" style={{ marginRight: 7 }}>
            {icon}
          </span>
          {title}
        </span>
        {meta && <span className="meta">{meta}</span>}
      </div>
      {children}
    </div>
  );
}

const lead: CSSProperties = { fontSize: 12, color: 'var(--ink)', lineHeight: 1.6, margin: 0 };
const dim: CSSProperties = { fontSize: 11.5, color: 'var(--mut)', lineHeight: 1.6 };

/** A numbered / labeled step row using the .pxl-frows shell. */
function StepRows({ steps }: { steps: [string, string][] }) {
  return (
    <div className="pxl-frows" style={{ marginBottom: 0 }}>
      {steps.map(([k, v]) => (
        <div key={k} className="r">
          <span className="k" style={{ flex: 'none', minWidth: 78 }}>
            {k}
          </span>
          <span className="v" style={{ fontWeight: 600, color: 'var(--ink)', textAlign: 'right', marginLeft: 10 }}>
            {v}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------- roles ----------

const ROLES: { icon: string; name: string; perk: string; title: string }[] = [
  { icon: '🧭', name: 'Scout', perk: '+15s expedition air · reveals crates', title: 'Runner → Ruin Walker' },
  { icon: '🔧', name: 'Engineer', perk: 'Repair Power ×1.5', title: 'Tinkerer → Generator Saint' },
  { icon: '⛑️', name: 'Medic', perk: 'Treat Sick ×1.5', title: 'Bandager → Plague Breaker' },
  { icon: '🌾', name: 'Farmer', perk: 'Grow Food ×1.5', title: 'Sower → Harvest Warden' },
  { icon: '🛡️', name: 'Guard', perk: 'Guard Wall ×1.5 · dampens raids', title: 'Watchman → Red Signal Veteran' },
  { icon: '📣', name: 'Speaker', perk: 'Every action also +1 morale', title: 'Crier → The Conscience' },
];

function Roles() {
  return (
    <Panel icon="🎭" title="Roles & Perks" meta="pick one · free">
      <p style={{ ...dim, marginTop: 0, marginBottom: 12 }}>
        Choose a role and its matching action gets a boost. Earn <span style={{ color: 'var(--gold)' }}>titles</span> as
        your role rep climbs (25 / 75 / 150).
      </p>
      <div className="pxl-role-grid">
        {ROLES.map((r) => (
          <div key={r.name} className="pxl-role" style={{ cursor: 'default', textAlign: 'left', padding: '11px 10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="ri" style={{ fontSize: 22 }}>
                {r.icon}
              </span>
              <span className="rn" style={{ marginTop: 0 }}>
                {r.name}
              </span>
            </div>
            <div className="rb" style={{ marginTop: 7 }}>
              {r.perk}
            </div>
            <div
              style={{
                marginTop: 6,
                fontFamily: 'var(--pixel)',
                fontSize: 7,
                color: 'var(--gold)',
                letterSpacing: 0.5,
                lineHeight: 1.5,
              }}
            >
              {r.title}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

// ---------- actions ----------

const ACTIONS: { icon: string; name: string; effect: string; best: string }[] = [
  { icon: '🌱', name: 'Grow Food', effect: 'feeds the city', best: 'Farmer' },
  { icon: '⚙️', name: 'Repair Power', effect: 'keeps the lights on', best: 'Engineer' },
  { icon: '✚', name: 'Treat Sick', effect: 'heals citizens', best: 'Medic' },
  { icon: '🛡️', name: 'Guard Wall', effect: 'lowers threat', best: 'Guard' },
];

function Actions() {
  return (
    <Panel icon="⚡" title="Your Actions" meta="1 energy each">
      <p style={{ ...dim, marginTop: 0, marginBottom: 12 }}>
        You get <span style={{ color: 'var(--gold)' }}>3 energy</span> a day. Spend it on actions, one expedition, or
        both. Your role boosts its matching action ×1.5.
      </p>
      <div className="pxl-act-grid">
        {ACTIONS.map((a) => (
          <div key={a.name} className="pxl-act" style={{ cursor: 'default' }}>
            <span className="ai">{a.icon}</span>
            <span style={{ minWidth: 0 }}>
              <span className="an">{a.name}</span>
              <span className="ae">{a.effect}</span>
              <span style={{ display: 'block', fontSize: 9, color: 'var(--mut)', marginTop: 2 }}>best · {a.best}</span>
            </span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

// ---------- the screen ----------

export function RulesScreen() {
  return (
    <>
      {/* 1. premise */}
      <div className="pxl-marked card" style={{ paddingTop: 18 }}>
        <div className="eye">✦ HOW TO PLAY</div>
        <div className="nm" style={{ marginTop: 8 }}>
          Your subreddit is a last city.
        </div>
        <p style={{ ...lead, marginTop: 8 }}>
          Everyone in the sub is a citizen. Make <span style={{ color: 'var(--gold)' }}>one small choice a day</span> to
          keep it alive — and at dawn the whole sub sees who survived. Sessions run about 60 seconds, and you&rsquo;re
          never punished for missing a day.
        </p>
      </div>

      {/* 2. daily loop */}
      <Panel icon="🌅" title="Your Daily Loop" meta="~60 seconds">
        <StepRows
          steps={[
            ['OPEN', 'Read the Dawn Report — what changed overnight'],
            ['CHECK', 'Glance at vitals, the raid clock & the Marked'],
            ['SPEND', 'Use your 3 energy on actions and/or one expedition'],
            ['PLEDGE', 'One free tap to help tonight’s Marked'],
            ['DECIDE', 'Vote on the crisis · back a council plan'],
            ['LEAVE', 'Midnight UTC resolves the day — the story moves'],
          ]}
        />
      </Panel>

      {/* 3. roles */}
      <Roles />

      {/* 4. actions */}
      <Actions />

      {/* 5. the Marked */}
      <Panel icon="🕯️" title="The Marked" meta="nightly rally">
        <p style={{ ...lead, marginTop: 0 }}>
          Each night a named person or place is in danger. One free{' '}
          <span style={{ color: 'var(--gold)' }}>tap-pledge</span> — a vigil, rations, a message — helps save them
          before dawn. Watch the bar fill as the whole city rallies. At dawn you learn if they were saved or lost.
        </p>
      </Panel>

      {/* 6. crisis & council */}
      <Panel icon="⚔️" title="Crisis & Council" meta="one voice each">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="pxl-opt" style={{ marginBottom: 0, cursor: 'default' }}>
            <span className="oi">🗳️</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span className="on">Vote the crisis</span>
              <span className="oe">One vote a day on the day&rsquo;s dilemma. No switching.</span>
            </span>
          </div>
          <div className="pxl-opt" style={{ marginBottom: 0, cursor: 'default' }}>
            <span className="oi">👑</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span className="on">Back a council plan</span>
              <span className="oe">
                When the city&rsquo;s actions align with the leading plan, everyone gains morale.
              </span>
            </span>
          </div>
        </div>
      </Panel>

      {/* 7. the raid */}
      <Panel icon="🚨" title="The Raid — Red Signal" meta="threat → 100">
        <div className="pxl-track" style={{ height: 12, marginBottom: 12 }}>
          <i style={{ width: '78%', background: 'linear-gradient(90deg,#e29a4a,var(--red))' }} />
        </div>
        <p style={{ ...lead, marginTop: 0 }}>
          Threat climbs every day. When it reaches <span style={{ color: 'var(--red)' }}>100</span>, a raid strikes and
          the city takes losses. <span style={{ color: 'var(--gold)' }}>Guard Wall</span> lowers threat and softens the
          hit. If population collapses, the city falls — for real.
        </p>
      </Panel>

      {/* 8. world of cities */}
      <Panel icon="🗺️" title="World of Cities" meta="cross-sub">
        <p style={{ ...lead, marginTop: 0 }}>
          Subreddits with <span style={{ color: 'var(--gold)' }}>500+ subscribers</span> appear on a shared map, ranked
          by how long they&rsquo;ve survived. Your city rivals every other — outlast them.
        </p>
      </Panel>

      {/* 9. fair & safe */}
      <Panel icon="🤝" title="Fair & Safe" meta="the promise">
        <div className="pxl-frows" style={{ marginBottom: 0 }}>
          <div className="r">
            <span className="k" style={{ flex: 'none' }}>
              👥 REAL
            </span>
            <span className="v" style={{ color: 'var(--ink)', fontWeight: 600 }}>
              Every citizen is a real redditor
            </span>
          </div>
          <div className="r">
            <span className="k" style={{ flex: 'none' }}>
              🎭 MASKED
            </span>
            <span className="v" style={{ color: 'var(--ink)', fontWeight: 600 }}>
              Names are hidden — no one is exposed
            </span>
          </div>
          <div className="r">
            <span className="k" style={{ flex: 'none' }}>
              💬 OPEN
            </span>
            <span className="v" style={{ color: 'var(--ink)', fontWeight: 600 }}>
              Strategy lives in the comments, not a chat
            </span>
          </div>
          <div className="r">
            <span className="k" style={{ flex: 'none' }}>
              🚫 FREE
            </span>
            <span className="v" style={{ color: 'var(--green)', fontWeight: 700 }}>
              No purchases, ever
            </span>
          </div>
        </div>
      </Panel>
    </>
  );
}
