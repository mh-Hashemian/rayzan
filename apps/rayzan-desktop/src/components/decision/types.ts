export const DECISION_GOALS = [
  'Compare options',
  'Design architecture',
  'Create implementation plan',
  'Analyze risk',
  'Other',
] as const;

export type DecisionGoal = (typeof DECISION_GOALS)[number];

export type WizardStep = 'question' | 'team' | 'review';

export interface DecisionDraft {
  readonly question: string;
  readonly context: string;
  readonly goal: DecisionGoal;
}
