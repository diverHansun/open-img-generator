import type { GenerationStatus } from './types';

/** Internal, durable execution detail. It is deliberately not an API status. */
export const JOB_PHASES = [
  'queued',
  'dispatching',
  'polling',
  'storing',
  'cancelling',
  'terminal',
  'outcome_unknown',
] as const;

export type JobPhase = (typeof JOB_PHASES)[number];

export type AdvanceOutcome =
  | 'advanced'
  | 'retried'
  | 'completed'
  | 'failed'
  | 'unknown'
  | 'cancelled'
  | 'skipped';

const ALLOWED_PHASE_TRANSITIONS: Readonly<Record<JobPhase, readonly JobPhase[]>> = {
  queued: ['dispatching', 'cancelling', 'terminal', 'outcome_unknown'],
  dispatching: ['queued', 'polling', 'storing', 'cancelling', 'terminal', 'outcome_unknown'],
  polling: ['polling', 'storing', 'cancelling', 'terminal'],
  storing: ['storing', 'cancelling', 'terminal'],
  cancelling: ['cancelling', 'terminal'],
  terminal: [],
  outcome_unknown: [],
};

export function isJobPhase(value: unknown): value is JobPhase {
  return typeof value === 'string' && (JOB_PHASES as readonly string[]).includes(value);
}

export function isTerminalPhase(phase: JobPhase): boolean {
  return phase === 'terminal' || phase === 'outcome_unknown';
}

export function isTerminalGenerationStatus(status: GenerationStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

export function canTransitionJobPhase(from: JobPhase, to: JobPhase): boolean {
  return from === to || ALLOWED_PHASE_TRANSITIONS[from].includes(to);
}

/**
 * Provider polling is allowed to report `pending` after it previously said
 * `running`; user-visible progress must never move backwards because of that.
 * Terminal status is likewise irreversible.
 */
export function keepMonotonicStatus(
  current: GenerationStatus,
  next: GenerationStatus,
): GenerationStatus {
  if (isTerminalGenerationStatus(current)) return current;
  if (current === 'running' && next === 'pending') return current;
  return next;
}
