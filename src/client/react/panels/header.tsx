import type { InitResponse } from '../../../shared/types';
import { Chip, Pill } from '../kit/bits';
import type { Trend } from '../kit/bits';

// Top bar (identity + resource pills + theme/refresh) and the alert strip.

const trendOf = (current: number, tomorrow: number, higherIsBad: boolean): Trend => {
  if (tomorrow === current) return 'flat';
  const up = tomorrow > current;
  if (up) return higherIsBad ? 'up-bad' : 'up-good';
  return higherIsBad ? 'down-good' : 'down-bad';
};

export type TopBarProps = {
  data: InitResponse;
  subreddit: string | null;
  onTheme: () => void;
  onRefresh: () => void;
};

export function TopBar({ data, subreddit, onTheme, onRefresh }: TopBarProps) {
  const { city, forecast } = data;
  return (
    <header className="omd-top">
      <div className="omd-top-id">
        <span className="omd-top-name">THE LAST CITY</span>
        <span className="omd-top-sub">
          {subreddit !== null ? `r/${subreddit.replace(/^r\//, '')} · ` : ''}cycle {city.cycle} ·
          every citizen is a real redditor
        </span>
      </div>
      <div className="omd-top-right">
        <div className="omd-daychip">
          <span className="omd-daychip-day">DAY {city.day}</span>
          <span className="omd-daychip-sub">ONE MORE DAWN</span>
        </div>
        <button type="button" className="omd-iconbtn" onClick={onTheme} title="Switch theme">
          🎨
        </button>
        <button type="button" className="omd-iconbtn" onClick={onRefresh} title="Refresh the city">
          🔄
        </button>
      </div>
      <div className="omd-pills" style={{ width: '100%' }}>
        <Pill icon="👥" label="POP" value={city.population} />
        <Pill
          icon="🍞"
          label="FOOD"
          value={city.food}
          trend={trendOf(city.food, forecast.food, false)}
        />
        <Pill
          icon="⚡"
          label="POWER"
          value={city.power}
          trend={trendOf(city.power, forecast.power, false)}
        />
        <Pill
          icon="🩹"
          label="MEDS"
          value={city.medicine}
          trend={trendOf(city.medicine, forecast.medicine, false)}
        />
        <Pill
          icon="🙂"
          label="MORALE"
          value={city.morale}
          trend={trendOf(city.morale, forecast.morale, false)}
        />
        <Pill
          icon="☠️"
          label="THREAT"
          value={city.threat}
          tone={city.threat >= 70 ? 'danger' : city.threat >= 40 ? 'warn' : 'ink'}
          trend={trendOf(city.threat, forecast.threat, true)}
        />
      </div>
    </header>
  );
}

export function AlertStrip({ data }: { data: InitResponse }) {
  const { raidInDays, activeLaw, trait, resolving } = data;
  const raidNow = raidInDays <= 0;
  return (
    <div className="omd-alerts">
      <span className={raidNow ? 'omd-alert omd-alert--now' : 'omd-alert'}>
        <span className="omd-alert-icon">⚠️</span>
        {raidNow ? 'RAID IMMINENT — THE WALL DECIDES TONIGHT' : `RAID PROJECTED IN ${raidInDays} DAY${raidInDays === 1 ? '' : 'S'}`}
      </span>
      {activeLaw !== null && (
        <Chip icon="📜">
          {activeLaw.label}
          <small>
            {activeLaw.buff} · {activeLaw.cost}
          </small>
        </Chip>
      )}
      <Chip icon="🏙️">
        {trait.label}
        <small>{trait.blurb}</small>
      </Chip>
      {resolving && (
        <Chip icon="⏳">
          Dawn is resolving…<small>numbers may shift</small>
        </Chip>
      )}
    </div>
  );
}
