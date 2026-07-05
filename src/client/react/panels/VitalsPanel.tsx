import type { InitResponse } from '../../../shared/types';
import { MeterBar } from '../kit/bars';
import type { MeterTone } from '../kit/bars';
import { Panel } from '../kit/Panel';

// CITY VITALS — resources as color-coded meters with tomorrow's forecast as
// ghost tick marks (init.forecast = "tomorrow if nobody acts").

// Display caps mirror shared/balance.ts stores (food 300, medicine 120); the
// rest are 0-100 percentages by contract (src/shared/types.ts).
const FOOD_CAP = 300;
const MEDS_CAP = 120;

const toneFor = (valuePct: number): MeterTone =>
  valuePct < 25 ? 'danger' : valuePct < 50 ? 'warn' : 'good';

const threatTone = (threat: number): MeterTone =>
  threat >= 70 ? 'danger' : threat >= 40 ? 'warn' : 'good';

export function VitalsPanel({ data }: { data: InitResponse }) {
  const { city, forecast } = data;
  return (
    <Panel icon="🏙️" title="CITY VITALS" sub="ghost tick = tomorrow if nobody acts" span2>
      <MeterBar
        icon="🍞"
        label="FOOD"
        value={city.food}
        max={FOOD_CAP}
        tone={toneFor((city.food / FOOD_CAP) * 100)}
        forecast={forecast.food}
      />
      <MeterBar
        icon="⚡"
        label="POWER"
        value={city.power}
        max={100}
        tone={toneFor(city.power)}
        forecast={forecast.power}
      />
      <MeterBar
        icon="🩹"
        label="MEDICINE"
        value={city.medicine}
        max={MEDS_CAP}
        tone={toneFor((city.medicine / MEDS_CAP) * 100)}
        forecast={forecast.medicine}
      />
      <MeterBar
        icon="🙂"
        label="MORALE"
        value={city.morale}
        max={100}
        tone={toneFor(city.morale)}
        forecast={forecast.morale}
      />
      <MeterBar
        icon="☠️"
        label="THREAT"
        value={city.threat}
        max={100}
        tone={threatTone(city.threat)}
        forecast={forecast.threat}
      />
      <MeterBar
        icon="🛡️"
        label="DEFENSE"
        value={city.defense}
        max={100}
        tone={toneFor(city.defense)}
      />
      <div className="omd-forecast-note">
        <span className="omd-forecast-mark" />
        TOMORROW IF NOBODY ACTS
        {forecast.raidLikely && <span className="tone-danger">· RAID LIKELY ☠️</span>}
      </div>
    </Panel>
  );
}
