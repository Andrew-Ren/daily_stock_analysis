import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { StrategySynthesis } from '../../../types/analysis';
import { StrategySynthesisCard } from '../StrategySynthesisCard';

const synthesis: StrategySynthesis = {
  schemaVersion: 'strategy-synthesis-v1',
  finalSignal: 'buy',
  weightedScore: 3.8,
  confidence: 0.72,
  originalConfidence: 0.8,
  conflictCount: 1,
  conflictSeverity: 'medium',
  conflicts: [{ conflictType: 'directional_opposition', severity: 'medium', participants: ['trend', 'value'] }],
  supportingSkills: [{ skillId: 'trend', agentName: 'Trend', signal: 'buy', confidence: 0.8, appliedWeight: 0.7, reasoning: 'Momentum remains intact.' }],
  opposingSkills: [{ skillId: 'value', agentName: 'Value', signal: 'sell', confidence: 0.9, appliedWeight: 0.3, reasoning: 'Valuation is stretched.' }],
  signalDistribution: {
    bullish: { count: 1, weightShare: 0.7 },
    neutral: { count: 0, weightShare: 0 },
    bearish: { count: 1, weightShare: 0.3 },
  },
  primaryDissent: { skillId: 'value', agentName: 'Value', signal: 'sell', confidence: 0.9, appliedWeight: 0.3, reasoning: 'Valuation is stretched.' },
  consensusLevel: 'medium',
  summaryKey: 'strategy_synthesis.with_conflicts',
  summaryParams: { opinionCount: 2, totalOpinionCount: 2, invalidOpinionCount: 0, finalSignal: 'buy', consensusLevel: 'medium', conflictSeverity: 'medium', conflictCount: 1 },
  revisionProjection: {
    status: 'computed', mode: 'preview_only', sourceMode: 'multi_round_v4',
    projectedSignal: 'hold', projectedWeightedScore: 3.1, projectedConfidence: 0.61,
    projectedOriginalConfidence: 0.68, projectedConflictCount: 0,
    projectedConflictSeverity: 'none', projectedConsensusLevel: 'medium',
    changedSkillCount: 1, changedSkills: ['value'], finalSignalOverridden: false,
  },
};

describe('StrategySynthesisCard', () => {
  it('renders the authoritative result, distribution, and primary dissent', () => {
    render(<StrategySynthesisCard synthesis={synthesis} language="en" />);
    expect(screen.getByText('Consensus and Dissent')).toBeInTheDocument();
    expect(screen.getByText('Authoritative result')).toBeInTheDocument();
    expect(screen.getByText('Primary dissent')).toBeInTheDocument();
    expect(screen.getAllByText('Value').length).toBeGreaterThan(0);
    expect(screen.getByText('1 · 70%')).toBeInTheDocument();
    expect(screen.getByText('Revision projection · Preview (authoritative result unchanged)')).toBeInTheDocument();
    expect(screen.getByText('Conflicts: 1 (Medium)', { exact: false })).toBeInTheDocument();
  });

  it('stays hidden when no typed projection exists', () => {
    const { container } = render(<StrategySynthesisCard synthesis={null} language="en" />);
    expect(container).toBeEmptyDOMElement();
  });

  it.each([
    ['zh', '观点共识与分歧'],
    ['en', 'Consensus and Dissent'],
    ['ko', '합의와 이견'],
  ] as const)('renders %s labels', (language, title) => {
    render(<StrategySynthesisCard synthesis={synthesis} language={language} />);
    expect(screen.getByText(title)).toBeInTheDocument();
  });

  it('renders an insufficient all-invalid projection without inventing opinions', () => {
    const insufficient: StrategySynthesis = {
      ...synthesis,
      finalSignal: 'hold', consensusLevel: 'insufficient', conflictCount: 0,
      conflictSeverity: 'none', conflicts: [], supportingSkills: [], opposingSkills: [],
      primaryDissent: null, revisionProjection: null,
      signalDistribution: {
        bullish: { count: 0, weightShare: null },
        neutral: { count: 0, weightShare: null },
        bearish: { count: 0, weightShare: null },
      },
      summaryParams: {
        opinionCount: 0, totalOpinionCount: 2, invalidOpinionCount: 2,
        finalSignal: 'hold', consensusLevel: 'insufficient', conflictSeverity: 'none', conflictCount: 0,
      },
    };
    render(<StrategySynthesisCard synthesis={insufficient} language="en" />);
    expect(screen.getByText('Insufficient')).toBeInTheDocument();
    expect(screen.getByText('Valid opinions: 0 · Invalid opinions: 2', { exact: false })).toBeInTheDocument();
    expect(screen.getAllByText('None').length).toBeGreaterThan(0);
  });
});
