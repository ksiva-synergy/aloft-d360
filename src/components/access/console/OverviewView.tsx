'use client';

import type { ReactNode } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import userStyles from '@/components/users/users.module.css';
import type { AccessStatus } from './api';
import { Card, Mono } from './parts';
import s from './console.module.css';

export type ConsoleTab = 'map' | 'people' | 'labels' | 'columns' | 'log' | 'setup';

type Step = {
  title: string;
  hint: ReactNode;
  done: boolean;
  progress?: string;
  go?: ConsoleTab;
  goLabel?: string;
};

export function OverviewView({ status, onGo }: { status: AccessStatus; onGo: (tab: ConsoleTab) => void }) {
  const c = status.counts;
  const steps: Step[] = [
    {
      title: 'Create departments',
      hint: 'Teams that use the same data, such as Marine, Crewing, or Finance. Data map › Department → data › New department.',
      done: c.departments > 0,
      progress: `${c.departments} created`,
      go: 'map',
      goLabel: 'Data map',
    },
    {
      title: 'Map data to app roles and departments',
      hint: (
        <>
          Tag catalogs, schemas, or tables with app roles (such as Member) or departments at Discover, Query, or
          Export. Data mapped to Member is the baseline for everyone. The first tag ends setup mode, where every path
          is open.
        </>
      ),
      done: c.departmentGrants > 0,
      progress: `${c.departmentGrants} mapped paths`,
      go: 'map',
      goLabel: 'Data map',
    },
    {
      title: 'Give people their departments',
      hint: 'On the People list, add each person to the departments they work in. Most people need nothing else.',
      done: c.peopleInDepartments > 0,
      progress: `${c.peopleInDepartments} of ${c.people} people`,
      go: 'people',
      goLabel: 'People',
    },
    {
      title: 'Label sensitive data',
      hint: 'Mark Confidential or Restricted tables. Labelled tables need clearance even inside a granted catalog.',
      done: c.labels > 0,
      progress: `${c.labels} labelled paths`,
      go: 'labels',
      goLabel: 'Labels',
    },
    {
      title: 'Give clearance to people who need labelled data',
      hint: 'Platform admins only. Only for people whose role or department already has the path. Platform admins need clearance too; another platform admin gives it.',
      done: c.clearances > 0,
      progress: `${c.clearances} people cleared`,
      go: 'people',
      goLabel: 'People',
    },
    {
      title: 'Turn on observe mode',
      hint: (
        <>
          Set <Mono>ACCESS_MODE=observe</Mono> in the server environment and restart. Nothing is blocked yet; every
          decision is logged.
        </>
      ),
      done: status.accessMode !== 'off',
      progress: `Now: ${status.accessMode}`,
    },
    {
      title: 'Review the log, then enforce',
      hint: (
        <>
          Check the “would block” entries with data owners for one to two weeks, fix grants, then set{' '}
          <Mono>ACCESS_MODE=enforce</Mono>.
        </>
      ),
      done: status.accessMode === 'enforce',
      progress: `${c.denies7d} would-block in 7 days`,
      go: 'log',
      goLabel: 'Access log',
    },
  ];
  const nextIndex = steps.findIndex((st) => !st.done);

  return (
    <div className={s.overview}>
      <Card title="Setup" hint="Work down the list. Each step can be revisited later.">
        <ol className={cn(s.steps, '-mx-4 -mb-4')}>
          {steps.map((st, i) => (
            <li key={st.title} className={cn(s.step, st.done && s.stepDone, i === nextIndex && s.stepNext)}>
              <span className={s.stepMark}>{st.done ? <Check className="h-3.5 w-3.5" /> : i + 1}</span>
              <div>
                <div className={s.stepTitle}>{st.title}</div>
                <div className={s.stepHint}>{st.hint}</div>
                {st.progress ? <div className={cn(s.stepHint, 'mt-1 font-medium')}>{st.progress}</div> : null}
              </div>
              {st.go ? (
                <Button
                  type="button"
                  size="sm"
                  variant={i === nextIndex ? 'default' : 'outline'}
                  className={i === nextIndex ? userStyles.primary : userStyles.secondaryButton}
                  onClick={() => onGo(st.go!)}
                >
                  {st.goLabel}
                </Button>
              ) : (
                <span />
              )}
            </li>
          ))}
        </ol>
      </Card>

      <div className="flex flex-col gap-[14px]">
        <Card title="How a decision is made" hint="Checked for every table a query touches.">
          <div className={s.flow}>
            <div className={s.flowStep}>
              <span className={s.flowNum}>1</span>
              <span>
                <strong>Is there a grant?</strong>
                From the person&apos;s app role, one of their departments, or to them directly, on the table or any
                parent. Highest level wins. A Block anywhere above wins over everything. Platform admins go through
                the same checks.
              </span>
            </div>
            <div className={s.flowStep}>
              <span className={s.flowNum}>2</span>
              <span>
                <strong>Is it labelled?</strong>
                The highest label on the table or its parents. Unlabelled is Internal.
              </span>
            </div>
            <div className={s.flowStep}>
              <span className={s.flowNum}>3</span>
              <span>
                <strong>Is the clearance high enough?</strong>
                Clearance must reach the label. Clearance alone never opens anything. Only platform admins can give
                clearance or open labelled data.
              </span>
            </div>
          </div>
        </Card>

        <Card
          title="Example"
          hint={
            <>
              Marine has Query on <Mono>ops_gold</Mono>. <Mono>ops_gold.finance.vessel_opex</Mono> is Confidential.
            </>
          }
        >
          <table className={s.exampleTable}>
            <thead>
              <tr>
                <th>Person</th>
                <th>Department · clearance</th>
                <th>vessel_opex</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Ana</td>
                <td>Marine · Internal</td>
                <td className="text-[var(--bad)]">Hidden: needs Confidential</td>
              </tr>
              <tr>
                <td>Ben</td>
                <td>Marine · Confidential</td>
                <td className="text-[var(--ok)]">Query</td>
              </tr>
              <tr>
                <td>Carla</td>
                <td>Crewing · Confidential</td>
                <td className="text-[var(--bad)]">No grant</td>
              </tr>
            </tbody>
          </table>
        </Card>

        <Card title="Not available yet" hint="Planned in the architecture document but not built.">
          <ul className="list-disc pl-5 text-caption leading-relaxed text-muted-foreground">
            <li>Row filters (for example, only a person&apos;s own vessels)</li>
            <li>Company scope and per-agent use grants</li>
            <li>Column masking</li>
            <li>Entra group sync for department membership</li>
            <li>Review queue for newly harvested and PII-flagged tables</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
