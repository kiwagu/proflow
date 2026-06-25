import { prose } from './lexical.js';
import type { SeedScenario } from './types.js';

/**
 * Drive scenario — the flagship reference content: a nested resource tree (a small
 * company handbook) with folders, text docs carrying real bodies + descriptions,
 * and a cross-folder shortcut (one canonical home, many appearances). This is what
 * a new user sees when they open the demo Drive, and the worked example of how the
 * tree is built.
 */
export const DRIVE_SCENARIO: SeedScenario = {
  id: 'drive',
  title: 'Drive resource tree',
  summary:
    'A deep company-handbook tree — two branches three to four levels deep, docs with multi-paragraph bodies (mostly published, a couple of drafts), and a cross-folder shortcut (one canonical home, many appearances).',
  presets: ['drive'],
  tree: [
    {
      ref: 'drive/handbook',
      kind: 'folder',
      title: 'Company Handbook',
      description: 'Everything a new teammate needs in their first week.',
      starred: true,
      children: [
        {
          ref: 'drive/handbook/onboarding',
          kind: 'text',
          title: 'Onboarding Checklist',
          description: 'Day-one to week-one steps for a new hire.',
          starred: true,
          body: prose(
            "Welcome aboard — we're glad you're here. This checklist takes you from your first login to a fully set-up workspace, one step at a time.",
            'On day one, claim your account, join your team space, and read the team charter. Set up your development environment using the Engineering runbooks, and introduce yourself in the team channel.',
            'During your first week, complete the security training, pair with a teammate on a small task, and book short intro chats with the people you will work with most.',
            'By the end of your second week you should have shipped a small change end to end. If anything is unclear, ask early — questions are always welcome here.'
          ),
        },
        {
          ref: 'drive/handbook/benefits',
          kind: 'text',
          title: 'Benefits Overview',
          description: 'Health, time off, and learning budget.',
          openedBy: ['admin'],
          body: prose(
            'We offer comprehensive health cover, flexible time off, and an annual learning budget — designed to keep you healthy, rested, and growing.',
            'Health cover starts on your first day and includes medical, dental, and vision for you and your dependents.',
            'Time off is trust-based: take what you need, coordinate with your team, and log it so coverage stays clear. There is no fixed cap.',
            'Your learning budget can go toward courses, books, and conferences. When you learn something useful, share it back with the team.'
          ),
        },
        {
          ref: 'drive/handbook/policies',
          kind: 'folder',
          title: 'Policies',
          description: 'The handful of policies everyone should know.',
          children: [
            {
              ref: 'drive/handbook/policies/time-off',
              kind: 'text',
              title: 'Time Off Policy',
              body: prose(
                'Time off here is built on trust. You are responsible for planning your absences so your team stays covered while you are away.',
                'Request time off as far ahead as you can, and always for anything longer than a single day. Short, same-week breaks just need a heads-up in the team channel.',
                'Public holidays follow your country of residence. If you work across time zones, agree coverage with your manager before you go.',
                'Sick leave is separate from vacation — rest when you are unwell and simply let your team know you are offline.'
              ),
            },
            {
              ref: 'drive/handbook/policies/remote-work',
              kind: 'text',
              title: 'Remote Work Policy',
              description: 'Draft — under review, not yet finalized.',
              draft: true,
              body: prose(
                'This policy is a work in progress and is not yet finalized — expect changes before it is published.',
                'We are a remote-friendly company. Most roles can be done from anywhere within a few hours of your team’s core time zone.',
                'Core collaboration hours are 10:00–14:00 in your team’s primary time zone. Outside those hours, work when you are most productive.',
                'Home-office stipends and co-working allowances are still under review and will be confirmed once this policy is approved.'
              ),
            },
          ],
        },
      ],
    },
    {
      ref: 'drive/engineering',
      kind: 'folder',
      title: 'Engineering',
      description: 'Standards, runbooks, and operational guides.',
      children: [
        {
          ref: 'drive/engineering/standards',
          kind: 'text',
          title: 'Coding Standards',
          description: 'How we write code that reads like one author wrote it.',
          openedBy: ['admin'],
          body: prose(
            'We write code that reads as if a single author wrote it. Match the surrounding code: its naming, its idioms, and its comment density.',
            'Prefer one clear implementation over compatibility shims. Until we ship to production we break cleanly rather than maintaining two parallel paths.',
            'Every change is reviewed. Keep pull requests small and focused, write a clear description of the why, and respond to feedback promptly.',
            'Tests are part of the change, not an afterthought. A bug fix arrives with a test that would have caught it.'
          ),
          // A few successive published edits → version history in the reader.
          revisions: [
            prose(
              'We write code that reads as if a single author wrote it — match the surrounding naming, idioms, and comment density.',
              'Prefer one clear implementation over compatibility shims; until first production we break cleanly rather than keep two paths.',
              'Reviews are timely: aim to review within one business day, keep pull requests small, and explain the why.',
              'Tests ship with the change. A bug fix arrives with a test that would have caught it.',
              'New in this revision: link the relevant runbook in any change that affects on-call.'
            ),
            prose(
              'We write code that reads as if one author wrote it. Match the surrounding naming, idioms, and comment density — consistency beats personal preference.',
              'Prefer a single clear implementation. We break cleanly rather than maintain compatibility shims until we have shipped to production.',
              'Reviews are timely and kind: review within one business day, keep changes small and focused, and explain the reasoning.',
              'Tests are part of the change. Any behaviour change — including a bug fix — ships with a test that proves it.',
              'If a change affects on-call, link the relevant runbook so the next responder has context.'
            ),
          ],
        },
        {
          ref: 'drive/engineering/runbooks',
          kind: 'folder',
          title: 'Runbooks',
          description: 'Step-by-step operational responses.',
          children: [
            {
              ref: 'drive/engineering/runbooks/oncall',
              kind: 'text',
              title: 'On-call Runbook',
              openedBy: ['admin'],
              body: prose(
                'When you are paged, acknowledge within five minutes, assess the blast radius, communicate status, and only then start fixing.',
                'Open an incident channel and post a short summary: what is broken, who is affected, and what you are trying. Update it as you learn more.',
                'Always prefer a safe rollback over a risky forward fix while customers are affected. Stabilize first, find the root cause second.',
                'After the incident, write a blameless postmortem within two business days and file concrete follow-up actions.'
              ),
            },
            {
              ref: 'drive/engineering/runbooks/deployments',
              kind: 'folder',
              title: 'Deployments',
              description: 'Release and recovery procedures.',
              children: [
                {
                  ref: 'drive/engineering/runbooks/deployments/rollback',
                  kind: 'text',
                  title: 'Rollback Procedure',
                  body: prose(
                    'A rollback returns the system to the last known-good release. It is the fastest way to stop customer impact during a bad deploy.',
                    'Identify the last healthy version from the deployment log, then trigger the rollback pipeline for exactly that version.',
                    'Verify that health checks return green and error rates drop before you declare the incident mitigated.',
                    'Record the rollback in the incident channel and open a ticket to fix forward once the fire is fully out.'
                  ),
                },
                {
                  ref: 'drive/engineering/runbooks/deployments/blue-green',
                  kind: 'text',
                  title: 'Blue-Green Cutover',
                  description: 'Draft — being validated against new infra.',
                  draft: true,
                  body: prose(
                    'Draft: this runbook is still being validated against our new infrastructure — do not rely on it yet.',
                    'Blue-green keeps two identical environments. Traffic serves from one (blue) while the next release is deployed to the other (green).',
                    'Cut over by switching the load balancer from blue to green once green passes its smoke tests. Keep blue warm for an instant rollback.',
                    'After a stable soak period, blue becomes the staging target for the following release.'
                  ),
                },
              ],
            },
          ],
        },
      ],
    },
  ],
  // The onboarding checklist's canonical home is the Handbook, but Engineering
  // shortcuts to it too — a symlink, not a copy.
  shortcuts: [
    { folder: 'drive/engineering', target: 'drive/handbook/onboarding' },
  ],
};

/**
 * Drive cascade fixture — the canonical shape for the delete/trash soft-cascade:
 * a `Parent` with an only-child `Only` and a `Shared` child that is ALSO filed
 * under `Other`. Trashing `Parent` orphans `Only` (cascades) but `Shared`
 * survives (a living parent). Shared verbatim by the folder-actions and trash
 * e2e specs so the cascade vocabulary lives in one place.
 */
export const DRIVE_CASCADE_SCENARIO: SeedScenario = {
  id: 'drive-cascade',
  title: 'Drive cascade fixture',
  summary:
    'A folder whose only-child orphans on trash while a multi-parent child survives — the soft-cascade fixture shared by the e2e specs.',
  presets: ['drive'],
  tree: [
    {
      ref: 'cascade/parent',
      kind: 'folder',
      title: 'Parent',
      children: [
        { ref: 'cascade/only', kind: 'folder', title: 'Only' },
        { ref: 'cascade/shared', kind: 'folder', title: 'Shared' },
      ],
    },
    { ref: 'cascade/other', kind: 'folder', title: 'Other' },
  ],
  // `Shared` also lives under `Other` (a second living parent).
  contains: [{ folder: 'cascade/other', child: 'cascade/shared' }],
};

/**
 * Drive copy-chain fixture — a strict Root → Child → Doc chain (the Doc a text
 * node with a real body). The canonical input for deep-copy: copying Root clones
 * the whole subtree into private owner drafts. Shared by the copy e2e spec.
 */
export const DRIVE_COPY_CHAIN_SCENARIO: SeedScenario = {
  id: 'drive-copy-chain',
  title: 'Drive copy-chain fixture',
  summary:
    'A Root → Child → Doc chain — the deep-copy input proving a subtree clones into private owner drafts.',
  presets: ['drive'],
  tree: [
    {
      ref: 'copy/root',
      kind: 'folder',
      title: 'Root',
      children: [
        {
          ref: 'copy/child',
          kind: 'folder',
          title: 'Child',
          children: [
            {
              ref: 'copy/doc',
              kind: 'text',
              title: 'Doc',
              body: prose(
                'A small document that travels with its folder on copy.'
              ),
            },
          ],
        },
      ],
    },
  ],
};
