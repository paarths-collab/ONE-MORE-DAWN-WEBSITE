import type { InitResponse, VillageResponse } from '../../shared/types';
import { api } from '../game/api';
import type { Handlers } from './handlers';
import { ActionsPanel, ExpeditionPanel } from './panels/actions';
import { ActivityPanel, CitizensPanel, LeaderboardPanel, useFetch } from './panels/community';
import { FactionsPanel } from './panels/FactionsPanel';
import { AlertStrip, TopBar } from './panels/header';
import { RolePanel } from './panels/role';
import { VitalsPanel } from './panels/VitalsPanel';
import { CouncilPanel, CrisisPanel } from './panels/votes';

export type DashboardProps = {
  data: InitResponse;
  handlers: Handlers;
  onTheme: () => void;
  onRefresh: () => void;
};

/** The one command-center screen: top bar, alert strip, and the panel grid. */
export function Dashboard({ data, handlers, onTheme, onRefresh }: DashboardProps) {
  const village = useFetch<VillageResponse>(() => api.village());
  const subreddit = village.kind === 'ready' ? village.data.subreddit : null;
  return (
    <div className="omd-shell">
      <TopBar data={data} subreddit={subreddit} onTheme={onTheme} onRefresh={onRefresh} />
      <AlertStrip data={data} />
      <div className="omd-grid">
        <VitalsPanel data={data} />
        <RolePanel data={data} handlers={handlers} />
        <CrisisPanel data={data} handlers={handlers} />
        <CouncilPanel data={data} handlers={handlers} />
        <ActionsPanel data={data} handlers={handlers} />
        <ExpeditionPanel data={data} handlers={handlers} />
        <FactionsPanel data={data} />
        <CitizensPanel village={village} />
        <ActivityPanel />
        <LeaderboardPanel />
      </div>
      <div className="omd-footer-tag">ONE MORE DAWN · SANDBOXED · MASKED · THE CITY DECIDES TOGETHER</div>
    </div>
  );
}
