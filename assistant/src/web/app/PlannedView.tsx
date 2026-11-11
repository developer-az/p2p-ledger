import { sectionLabel, type PlannedSection } from './AppShell.js';
import { Icon, type IconName } from './ui.js';
import './styles/shell.css';

/**
 * The shared empty state for a section that only exists in the plan. It says
 * what the section will do, which milestone builds it, and links the plan
 * rather than pretending the feature is on its way in this build.
 */

const REPO = 'https://github.com/developer-az/p2p-ledger';

const PLANNED: Record<PlannedSection, { milestone: string; copy: string; icon: IconName }> = {
  imports: {
    milestone: 'M3',
    icon: 'download',
    copy: 'Upload bank statements and watch each import run stage by stage.',
  },
  rules: {
    milestone: 'M4',
    icon: 'split',
    copy: 'Rules that set categories by merchant and amount, previewed before they apply.',
  },
};

export function PlannedView({ section }: { section: PlannedSection }) {
  const entry = PLANNED[section];
  return (
    <div className="planned-view">
      <span className="planned-mark glass-tint" aria-hidden="true">
        <Icon name={entry.icon} size={22} />
      </span>
      <h1>{sectionLabel(section)}</h1>
      <p className="planned-copy">{entry.copy}</p>
      <span className="planned-tag">Planned · {entry.milestone}</span>
      <a className="planned-link" href={`${REPO}/blob/main/PLAN.md`} target="_blank" rel="noopener noreferrer">
        Read the plan
      </a>
    </div>
  );
}
