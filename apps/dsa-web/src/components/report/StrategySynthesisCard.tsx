import type React from 'react';
import { GitCompareArrows, ShieldCheck } from 'lucide-react';
import type { ReportLanguage, StrategyOpinionItem, StrategySignal, StrategySynthesis } from '../../types/analysis';
import { Badge, Card } from '../common';

interface Props { synthesis?: StrategySynthesis | null; language?: ReportLanguage }

const COPY = {
  zh: { eyebrow: '多策略综合', title: '观点共识与分歧', authoritative: '权威结论', signal: '最终信号', score: '加权得分', confidence: '综合置信度', consensus: '共识度', distribution: '信号分布', bullish: '看多', neutral: '中性', bearish: '看空', support: '支持观点', oppose: '反方观点', dissent: '主要异议', conflicts: '冲突详情', weight: '实际权重', noOpinions: '暂无', deliberation: '协同推理', rounds: '轮次', valid: '有效观点', invalid: '无效观点', revision: '修订投影', preview: '预览（不改变权威结论）' },
  en: { eyebrow: 'MULTI-STRATEGY', title: 'Consensus and Dissent', authoritative: 'Authoritative result', signal: 'Final signal', score: 'Weighted score', confidence: 'Confidence', consensus: 'Consensus', distribution: 'Signal distribution', bullish: 'Bullish', neutral: 'Neutral', bearish: 'Bearish', support: 'Supporting opinions', oppose: 'Opposing opinions', dissent: 'Primary dissent', conflicts: 'Conflicts', weight: 'Applied weight', noOpinions: 'None', deliberation: 'Deliberation', rounds: 'Rounds', valid: 'Valid opinions', invalid: 'Invalid opinions', revision: 'Revision projection', preview: 'Preview (authoritative result unchanged)' },
  ko: { eyebrow: '다중 전략 종합', title: '합의와 이견', authoritative: '권위 있는 결론', signal: '최종 신호', score: '가중 점수', confidence: '종합 확신도', consensus: '합의 수준', distribution: '신호 분포', bullish: '상승', neutral: '중립', bearish: '하락', support: '지지 의견', oppose: '반대 의견', dissent: '주요 이견', conflicts: '충돌 상세', weight: '적용 가중치', noOpinions: '없음', deliberation: '협업 추론', rounds: '라운드', valid: '유효 의견', invalid: '무효 의견', revision: '수정 투영', preview: '미리보기(권위 결론 변경 없음)' },
} as const;

const SIGNAL: Record<ReportLanguage, Record<StrategySignal, string>> = {
  zh: { strong_buy: '强烈买入', buy: '买入', hold: '观望', sell: '卖出', strong_sell: '强烈卖出' },
  en: { strong_buy: 'Strong Buy', buy: 'Buy', hold: 'Hold', sell: 'Sell', strong_sell: 'Strong Sell' },
  ko: { strong_buy: '적극 매수', buy: '매수', hold: '보유', sell: '매도', strong_sell: '적극 매도' },
};

const consensusLabel = (value: StrategySynthesis['consensusLevel'], language: ReportLanguage) => {
  const labels = {
    zh: { high: '高', medium: '中', low: '低', insufficient: '证据不足' },
    en: { high: 'High', medium: 'Medium', low: 'Low', insufficient: 'Insufficient' },
    ko: { high: '높음', medium: '중간', low: '낮음', insufficient: '근거 부족' },
  } as const;
  return labels[language][value];
};

const conflictLabel = (value: string, language: ReportLanguage) => {
  const labels: Record<ReportLanguage, Record<string, string>> = {
    zh: { directional_opposition: '方向对立', wide_score_dispersion: '评分分散', high_confidence_dissent: '高置信少数派', adjustment_contradiction: '加减分矛盾' },
    en: { directional_opposition: 'Directional opposition', wide_score_dispersion: 'Wide score dispersion', high_confidence_dissent: 'High-confidence dissent', adjustment_contradiction: 'Adjustment contradiction' },
    ko: { directional_opposition: '방향 대립', wide_score_dispersion: '점수 분산', high_confidence_dissent: '고확신 소수 의견', adjustment_contradiction: '조정 충돌' },
  };
  return labels[language][value] || value;
};

const severityLabel = (value: StrategySynthesis['conflictSeverity'], language: ReportLanguage) => {
  const labels = {
    zh: { none: '无', low: '低', medium: '中', high: '高' },
    en: { none: 'None', low: 'Low', medium: 'Medium', high: 'High' },
    ko: { none: '없음', low: '낮음', medium: '중간', high: '높음' },
  } as const;
  return labels[language][value];
};

const OpinionList: React.FC<{ title: string; opinions: StrategyOpinionItem[]; language: ReportLanguage; empty: string; weightLabel: string }> = ({ title, opinions, language, empty, weightLabel }) => (
  <div>
    <h4 className="mb-2 text-sm font-semibold text-foreground">{title}</h4>
    <div className="space-y-2">
      {opinions.length === 0 ? <p className="text-sm text-muted-text">{empty}</p> : opinions.map((opinion) => (
        <details key={opinion.skillId} className="rounded-xl border border-border/50 bg-elevated/45 p-3">
          <summary className="cursor-pointer list-none">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium text-foreground">{opinion.agentName || opinion.skillId}</span>
              <div className="flex items-center gap-2">
                <Badge variant={opinion.signal.includes('buy') ? 'success' : opinion.signal.includes('sell') ? 'danger' : 'default'}>{SIGNAL[language][opinion.signal]}</Badge>
                <span className="text-xs text-muted-text">{Math.round(opinion.confidence * 100)}%</span>
              </div>
            </div>
          </summary>
          <div className="mt-2 border-t border-border/40 pt-2 text-sm text-secondary-text">
            {opinion.appliedWeight != null && <p>{weightLabel}: {opinion.appliedWeight.toFixed(3)}</p>}
            {opinion.reasoning && <p className="mt-1 whitespace-pre-wrap">{opinion.reasoning}</p>}
          </div>
        </details>
      ))}
    </div>
  </div>
);

export const StrategySynthesisCard: React.FC<Props> = ({ synthesis, language = 'zh' }) => {
  if (!synthesis || synthesis.schemaVersion !== 'strategy-synthesis-v1') return null;
  const text = COPY[language];
  const buckets = [[text.bullish, synthesis.signalDistribution.bullish], [text.neutral, synthesis.signalDistribution.neutral], [text.bearish, synthesis.signalDistribution.bearish]] as const;
  return (
    <Card variant="gradient" className="overflow-hidden" padding="lg">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div><p className="label-uppercase flex items-center gap-2"><GitCompareArrows size={14} />{text.eyebrow}</p><h3 className="mt-1 text-xl font-semibold text-foreground">{text.title}</h3></div>
        <Badge variant="info"><ShieldCheck size={13} />{text.authoritative}</Badge>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[[text.signal, SIGNAL[language][synthesis.finalSignal]], [text.score, synthesis.weightedScore.toFixed(2)], [text.confidence, `${Math.round(synthesis.confidence * 100)}%`], [text.consensus, consensusLabel(synthesis.consensusLevel, language)]].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-border/50 bg-elevated/50 p-3"><p className="text-xs text-muted-text">{label}</p><p className="mt-1 font-semibold text-foreground">{value}</p></div>
        ))}
      </div>
      <div className="mt-5"><h4 className="mb-2 text-sm font-semibold text-foreground">{text.distribution}</h4><div className="grid grid-cols-3 gap-2">
        {buckets.map(([label, bucket]) => <div key={label} className="rounded-xl bg-elevated/45 p-3 text-center"><p className="text-xs text-muted-text">{label}</p><p className="mt-1 font-semibold text-foreground">{bucket.count} · {bucket.weightShare == null ? '—' : `${Math.round(bucket.weightShare * 100)}%`}</p></div>)}
      </div></div>
      <p className="mt-3 text-xs text-muted-text">{text.valid}: {synthesis.summaryParams.opinionCount} · {text.invalid}: {synthesis.summaryParams.invalidOpinionCount} · {text.conflicts}: {synthesis.conflictCount} ({severityLabel(synthesis.conflictSeverity, language)})</p>
      {synthesis.primaryDissent && <div className="mt-5 rounded-xl border border-warning/25 bg-warning/5 p-3"><p className="text-xs font-semibold uppercase tracking-wide text-warning">{text.dissent}</p><p className="mt-1 font-medium text-foreground">{synthesis.primaryDissent.agentName || synthesis.primaryDissent.skillId} · {SIGNAL[language][synthesis.primaryDissent.signal]}</p>{synthesis.primaryDissent.reasoning && <p className="mt-1 text-sm text-secondary-text">{synthesis.primaryDissent.reasoning}</p>}</div>}
      <div className="mt-5 grid gap-5 lg:grid-cols-2"><OpinionList title={text.support} opinions={synthesis.supportingSkills} language={language} empty={text.noOpinions} weightLabel={text.weight} /><OpinionList title={text.oppose} opinions={synthesis.opposingSkills} language={language} empty={text.noOpinions} weightLabel={text.weight} /></div>
      {synthesis.conflicts.length > 0 && <div className="mt-5"><h4 className="mb-2 text-sm font-semibold text-foreground">{text.conflicts}</h4><div className="flex flex-wrap gap-2">{synthesis.conflicts.map((conflict) => <Badge key={`${conflict.conflictType}-${conflict.participants.join('-')}`} variant={conflict.severity === 'high' ? 'danger' : 'warning'}>{conflictLabel(conflict.conflictType, language)} · {conflict.participants.join(', ')}</Badge>)}</div></div>}
      {synthesis.deliberation && <p className="mt-5 text-sm text-muted-text">{text.deliberation}: {synthesis.deliberation.mode} · {synthesis.deliberation.rounds} {text.rounds}</p>}
      {synthesis.revisionProjection && <div className="mt-3 rounded-xl border border-border/50 bg-elevated/45 p-3"><p className="text-xs font-semibold text-muted-text">{text.revision} · {text.preview}</p><p className="mt-1 font-medium text-foreground">{SIGNAL[language][synthesis.revisionProjection.projectedSignal]} · {Math.round(synthesis.revisionProjection.projectedConfidence * 100)}%</p></div>}
    </Card>
  );
};
