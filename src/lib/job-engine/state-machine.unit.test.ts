import { describe, expect, it } from 'vitest';

import {
  canTransitionJobPhase,
  isTerminalPhase,
  keepMonotonicStatus,
} from './state-machine';

describe('job lifecycle state machine', () => {
  it('permits only documented phase transitions', () => {
    expect(canTransitionJobPhase('queued', 'dispatching')).toBe(true);
    expect(canTransitionJobPhase('dispatching', 'polling')).toBe(true);
    expect(canTransitionJobPhase('polling', 'storing')).toBe(true);
    expect(canTransitionJobPhase('storing', 'terminal')).toBe(true);
    expect(canTransitionJobPhase('queued', 'storing')).toBe(false);
    expect(canTransitionJobPhase('polling', 'dispatching')).toBe(false);
  });

  it('does not let terminal or outcome-unknown phases leave', () => {
    expect(isTerminalPhase('terminal')).toBe(true);
    expect(isTerminalPhase('outcome_unknown')).toBe(true);
    expect(canTransitionJobPhase('terminal', 'queued')).toBe(false);
    expect(canTransitionJobPhase('outcome_unknown', 'polling')).toBe(false);
  });

  it('keeps public status monotonic across late provider responses', () => {
    expect(keepMonotonicStatus('running', 'pending')).toBe('running');
    expect(keepMonotonicStatus('completed', 'running')).toBe('completed');
    expect(keepMonotonicStatus('pending', 'running')).toBe('running');
  });
});
