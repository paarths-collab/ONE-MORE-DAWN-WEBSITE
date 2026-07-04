import * as Phaser from 'phaser';
import type { TimelineEntry } from '../../../shared/types';
import { api } from '../api';
import { backRow, bodyText, COLORS, FONT, H, heading, W } from '../ui';

const MAX_ENTRIES = 8;
const MAX_EVENTS_PER_ENTRY = 4;
const Y_CUTOFF = 1050;

export class Timeline extends Phaser.Scene {
  constructor() {
    super('Timeline');
  }

  create() {
    this.cameras.main.setBackgroundColor(COLORS.bg);
    heading(this, W / 2, 28, 'THE CITY REMEMBERS');

    const loading = this.add
      .text(W / 2, H / 2, 'Turning the pages…', {
        fontFamily: FONT,
        fontSize: '20px',
        color: COLORS.dim,
      })
      .setOrigin(0.5);

    api
      .timeline()
      .then((res) => {
        loading.destroy();
        this.renderEntries(res.entries);
      })
      .catch((err: Error) => {
        loading.setText(`The city cannot recall its story.\n${err.message}`);
      });

    backRow(this);
  }

  private renderEntries(entries: TimelineEntry[]) {
    if (entries.length === 0) {
      bodyText(
        this,
        40,
        140,
        'No dawns have passed yet. The story starts tomorrow.',
        W - 80,
      );
      return;
    }

    // getTimeline sorts newest-first server-side; keep that order.
    let y = 110;
    for (const entry of entries.slice(0, MAX_ENTRIES)) {
      if (y > Y_CUTOFF) break;

      this.add.text(30, y, entry.headline, {
        fontFamily: FONT,
        fontSize: '22px',
        color: COLORS.accentText,
        fontStyle: 'bold',
        wordWrap: { width: W - 60 },
      });
      y += 34;

      const events = entry.events.slice(0, MAX_EVENTS_PER_ENTRY);
      for (const line of events) {
        if (y > Y_CUTOFF) break;
        const text = this.add.text(48, y, `· ${line}`, {
          fontFamily: FONT,
          fontSize: '17px',
          color: COLORS.text,
          wordWrap: { width: W - 96 },
          lineSpacing: 4,
        });
        y += text.height + 6;
      }
      y += 14; // gap between entries
    }
  }
}
