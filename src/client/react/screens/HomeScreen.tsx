import { useEffect, useRef, useState } from 'react';
import type { InitResponse, Marked } from '../../../shared/types';
import { CitySky } from '../CitySky';
import type { Tab } from '../TabBar';
import { DRAMA_TINTS, MARKED_KIND_ICON, markedGoalWord, markedPct, markedShortName } from '../defs';
import type { Handlers } from '../handlers';
import { Chip, SectionHead } from '../kit/bits';

// HOME — the priority-ordered main screen (locked spec order):
// 1 standing bar (over the city sky) · 2 THE MARKED · 3 one-tap pledges ·
// 4 city status · 5 crisis preview · 6 drama feed preview.

const usePrev = <T,>(value: T): T | undefined => {
  const ref = useRef<T | undefined>(undefined);
  useEffect(() => {
    ref.current = value;
  });
  return ref.current;
};

// ---------- 1 · standing bar ----------

function Standing({ data, subreddit, onRefresh }: { data: InitResponse; subreddit: string | null; onRefresh: () => void }) {
  const { city, standing } = data;
  return (
    <div className="omd-standing">
      <div className="omd-standing-top">
        <span className="omd-standing-sub">
          {subreddit !== null ? `r/${subreddit.replace(/^r\//, '')}` : 'the last city'} · cycle {city.cycle}
        </span>
        <button type="button" className="omd-iconbtn" onClick={onRefresh} aria-label="Refresh the city" title="Refresh">
          ↻
        </button>
      </div>
      <div className="omd-standing-main">
        <div>
          <h1 className="omd-standing-name">The Last City</h1>
          <div className="omd-standing-tag">one more dawn</div>
        </div>
        <div className="omd-standing-day">
          <span className="omd-standing-day-num">DAY {city.day}</span>
          <span className="omd-standing-day-sub">{city.population} souls</span>
        </div>
      </div>
      <div className="omd-standing-chips">
        <Chip icon="🔥">{standing.rankLabel}</Chip>
        {standing.contributionRank !== null && (
          <Chip icon="🎖️" tone="accent">
            #{standing.contributionRank} citizen
          </Chip>
        )}
      </div>
    </div>
  );
}

// ---------- 2+3 · THE MARKED + one-tap pledge ----------

function SavedYesterday({ marked }: { marked: Marked }) {
  const y = marked.savedYesterday;
  if (y === null) return null;
  return (
    <div className={y.saved ? 'omd-yesterday omd-yesterday--saved' : 'omd-yesterday omd-yesterday--lost'}>
      {y.saved ? `Yesterday: ${y.name} was saved 🕯️` : `Yesterday: ${y.name} was lost. Remember it.`}
    </div>
  );
}

function MarkedCard({ data, handlers }: { data: InitResponse; handlers: Handlers }) {
  const { marked, pledge } = data;
  const pct = markedPct(marked);
  const short = markedShortName(marked);
  const goalWord = markedGoalWord(marked);

  // Surge: whenever the shared bar moves up (my pledge or a refetch), flare.
  const prevPledged = usePrev(marked.pledged);
  const [surge, setSurge] = useState<number | null>(null);
  useEffect(() => {
    if (prevPledged !== undefined && marked.pledged > prevPledged) {
      setSurge(marked.pledged - prevPledged);
      const t = window.setTimeout(() => setSurge(null), 1500);
      return () => window.clearTimeout(t);
    }
    return undefined;
    // deps intentionally track only marked.pledged (prevPledged is a ref echo)
  }, [marked.pledged]);

  return (
    <section className={surge !== null ? 'omd-marked omd-marked--surge' : 'omd-marked'}>
      <SavedYesterday marked={marked} />
      <div className="omd-marked-eyebrow">
        <span>✦ THE MARKED</span>
        <span className="omd-marked-dawn">resolves at dawn</span>
      </div>
      <div className="omd-marked-name">
        <span className="omd-marked-kind" aria-hidden="true">
          {MARKED_KIND_ICON[marked.kind]}
        </span>
        {marked.name}
      </div>
      <p className="omd-marked-blurb">{marked.blurb}</p>
      <div className="omd-marked-bar">
        <div className="omd-marked-track">
          <div className="omd-marked-fill" style={{ width: `${pct}%` }} />
          <div className="omd-marked-shimmer" />
        </div>
        {surge !== null && <span className="omd-marked-float">+{surge} {marked.unit}</span>}
      </div>
      <div className="omd-marked-nums">
        <span className="omd-mono">
          {marked.pledged} / {marked.goal} {marked.unit}
        </span>
        <span className="omd-marked-pct">
          {pct}% {goalWord}
        </span>
      </div>

      <div className="omd-pledge">
        {pledge.usedToday ? (
          <div className="omd-pledge-done">
            <span className="omd-pledge-done-icon" aria-hidden="true">
              🕯️
            </span>
            <span>
              <b>You&rsquo;ve helped today.</b> {short} is {pct}% {goalWord} — the city remembers.
              Come back at dawn.
            </span>
          </div>
        ) : (
          <>
            <div className="omd-pledge-head">MAKE YOUR PLEDGE · one tap · once a day</div>
            <div className="omd-pledge-grid">
              {pledge.options.map((o) => (
                <button key={o.id} type="button" className="omd-pledge-btn" onClick={() => handlers.onPledge(o.id)}>
                  <span className="omd-pledge-btn-icon" aria-hidden="true">
                    {o.icon}
                  </span>
                  <span className="omd-pledge-btn-label">{o.label}</span>
                  <span className="omd-pledge-btn-effect">{o.effect}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

// ---------- 4 · city status ----------

type VitalTone = 'good' | 'warn' | 'danger';

const toneFor = (pct: number): VitalTone => (pct < 25 ? 'danger' : pct < 50 ? 'warn' : 'good');

type VitalProps = {
  icon: string;
  label: string;
  value: number;
  max: number;
  tone: VitalTone;
  delta?: number;
  deltaBad?: boolean;
};

function Vital({ icon, label, value, max, tone, delta, deltaBad }: VitalProps) {
  const width = Math.max(0, Math.min(100, (value / Math.max(1, max)) * 100));
  return (
    <div className="omd-vital">
      <div className="omd-vital-top">
        <span className="omd-vital-label">
          {icon} {label}
        </span>
        <span className={`omd-vital-num tone-${tone}`}>
          {value}
          {delta !== undefined && delta !== 0 && (
            <small className={deltaBad === true ? 'tone-danger' : 'tone-muted'}>
              {' '}
              {delta > 0 ? '+' : '−'}
              {Math.abs(delta)}
            </small>
          )}
        </span>
      </div>
      <div className="omd-vital-track">
        <div className={`omd-vital-fill omd-vital-fill--${tone}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function CityStatus({ data }: { data: InitResponse }) {
  const { city, forecast, raidInDays } = data;
  const raidSoon = raidInDays <= 1;
  return (
    <section className="omd-card">
      <SectionHead
        icon="🏙️"
        title="CITY STATUS"
        sub={raidInDays <= 0 ? '⚠ raid tonight' : `🛡 ${city.defense} defense · raid in ${raidInDays}d`}
      />
      <div className={raidSoon ? 'omd-vitals omd-vitals--alert' : 'omd-vitals'}>
        <Vital icon="🍞" label="FOOD" value={city.food} max={300} tone={toneFor((city.food / 300) * 100)} delta={forecast.food - city.food} deltaBad={forecast.food < city.food} />
        <Vital icon="⚡" label="POWER" value={city.power} max={100} tone={toneFor(city.power)} delta={forecast.power - city.power} deltaBad={forecast.power < city.power} />
        <Vital icon="🩹" label="MEDS" value={city.medicine} max={120} tone={toneFor((city.medicine / 120) * 100)} delta={forecast.medicine - city.medicine} deltaBad={forecast.medicine < city.medicine} />
        <Vital icon="🙂" label="MORALE" value={city.morale} max={100} tone={toneFor(city.morale)} delta={forecast.morale - city.morale} deltaBad={forecast.morale < city.morale} />
        <Vital icon="☠️" label="THREAT" value={city.threat} max={100} tone={city.threat >= 70 ? 'danger' : city.threat >= 40 ? 'warn' : 'good'} delta={forecast.threat - city.threat} deltaBad={forecast.threat > city.threat} />
        <Vital icon="👥" label="SOULS" value={city.population} max={250} tone="good" />
      </div>
      {forecast.raidLikely && <div className="omd-status-note tone-danger">☠️ Raid likely at dawn — the wall decides.</div>}
    </section>
  );
}

// ---------- 5 · crisis preview ----------

function CrisisPreview({ data, go }: { data: InitResponse; go: (tab: Tab) => void }) {
  const { crisis, crisisVotes, yourCrisisVote } = data;
  const total = crisis.options.reduce((sum, o) => sum + (crisisVotes[o.id] ?? 0), 0);
  const mine = crisis.options.find((o) => o.id === yourCrisisVote);
  return (
    <button type="button" className="omd-card omd-preview omd-preview--crisis" onClick={() => go('crisis')}>
      <div className="omd-preview-eyebrow">
        <span>⚔️ TODAY&rsquo;S CRISIS</span>
        <span className="omd-preview-go">{mine !== undefined ? 'See the vote →' : 'Vote →'}</span>
      </div>
      <div className="omd-preview-title">{crisis.title}</div>
      <div className="omd-preview-sub">
        {total} have voted · {mine !== undefined ? `you: ${mine.label}` : 'your voice is missing'}
      </div>
    </button>
  );
}

// ---------- 6 · drama feed preview ----------

function DramaPreview({ data, go }: { data: InitResponse; go: (tab: Tab) => void }) {
  const latest = data.drama.slice(0, 4);
  return (
    <section className="omd-card">
      <SectionHead
        icon="📜"
        title="LIVE FROM THE CITY"
        action={
          <button type="button" className="omd-link" onClick={() => go('feed')}>
            See all →
          </button>
        }
      />
      <div className="omd-drama omd-drama--preview">
        {latest.map((e, i) => (
          <div key={i} className="omd-drama-row" style={{ borderLeftColor: DRAMA_TINTS[e.kind] }}>
            <span className="omd-drama-icon" aria-hidden="true">
              {e.icon}
            </span>
            <span className="omd-drama-text">{e.text}</span>
          </div>
        ))}
        {latest.length === 0 && <div className="omd-note">The wire is quiet. Make some news.</div>}
      </div>
    </section>
  );
}

// ---------- the screen ----------

export type HomeScreenProps = {
  data: InitResponse;
  handlers: Handlers;
  subreddit: string | null;
  onRefresh: () => void;
  go: (tab: Tab) => void;
};

export function HomeScreen({ data, handlers, subreddit, onRefresh, go }: HomeScreenProps) {
  return (
    <div className="omd-screen omd-screen--home">
      <CitySky data={data}>
        <Standing data={data} subreddit={subreddit} onRefresh={onRefresh} />
      </CitySky>
      <div className="omd-home-body">
        <MarkedCard data={data} handlers={handlers} />
        <CityStatus data={data} />
        <CrisisPreview data={data} go={go} />
        <DramaPreview data={data} go={go} />
        <footer className="omd-foot">every citizen is a real redditor · names masked · HL preview</footer>
      </div>
    </div>
  );
}
