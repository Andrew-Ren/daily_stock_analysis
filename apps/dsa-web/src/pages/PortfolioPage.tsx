import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BellRing, CalendarDays, Clock3 } from 'lucide-react';
import { Pie, PieChart, ResponsiveContainer, Tooltip, Legend, Cell } from 'recharts';
import { decisionSignalsApi } from '../api/decisionSignals';
import { portfolioApi } from '../api/portfolio';
import type { ParsedApiError } from '../api/error';
import { getParsedApiError } from '../api/error';
import { ApiErrorAlert, Card, Badge, ConfirmDialog, EmptyState, InlineAlert, StatusDot } from '../components/common';
import { PortfolioSignalSummary } from '../components/decision-signals/DecisionSignalDisplay';
import { useUiLanguage } from '../contexts/UiLanguageContext';
import { formatUiText } from '../i18n/uiText';
import { PORTFOLIO_TEXT } from '../locales/featureText';
import type { FxRefreshFeedback } from '../utils/portfolioFormat';
import {
  buildFxRefreshFeedback,
  formatBrokerLabel,
  formatCashDirectionLabel,
  formatCorporateActionLabel,
  formatMoney,
  formatPct,
  formatPositionMoney,
  formatPositionPrice,
  formatSideLabel,
  formatSignedPct,
  getCsvCommitVariant,
  getCsvParseVariant,
  getFxRefreshFeedbackVariant,
  getPositionPriceLabel,
  getTodayIso,
  hasPositionPrice,
} from '../utils/portfolioFormat';
import type {
  DecisionSignalItem,
  DecisionSignalMarket,
} from '../types/decisionSignals';
import type {
  PortfolioAccountItem,
  PortfolioCashDirection,
  PortfolioCashLedgerListItem,
  PortfolioCorporateActionListItem,
  PortfolioCorporateActionType,
  PortfolioCostMethod,
  PortfolioImportBrokerItem,
  PortfolioImportCommitResponse,
  PortfolioImportParseResponse,
  PortfolioPositionItem,
  PortfolioRiskResponse,
  PortfolioSide,
  PortfolioSnapshotResponse,
  PortfolioTradeListItem,
} from '../types/portfolio';
import { areStockCodesEquivalent, normalizeStockCode } from '../utils/stockCode';
import { parseDecisionSignalDate } from '../utils/decisionSignalTime';
import { buildDecisionActionLabelMap, getDecisionActionLabel } from '../utils/decisionAction';

const PIE_COLORS = ['#00d4ff', '#00ff88', '#ffaa00', '#ff7a45', '#7f8cff', '#ff4466'];
const DEFAULT_PAGE_SIZE = 20;
const FINANCE_CALENDAR_PAGE_SIZE = 100;
const FINANCE_CALENDAR_LOOKBACK_DAYS = 14;
const FINANCE_CALENDAR_LOOKAHEAD_DAYS = 45;
const PORTFOLIO_SIGNAL_LOOKUP_CONCURRENCY = 6;
const FALLBACK_BROKERS: PortfolioImportBrokerItem[] = [
  { broker: 'huatai', aliases: [], displayName: '华泰' },
  { broker: 'citic', aliases: ['zhongxin'], displayName: '中信' },
  { broker: 'cmb', aliases: ['cmbchina', 'zhaoshang'], displayName: '招商' },
];

type AccountOption = 'all' | number;
type EventType = 'trade' | 'cash' | 'corporate';

type FlatPosition = PortfolioPositionItem & {
  accountId: number;
  accountName: string;
};

type PortfolioSignalLookup = {
  stockCode: string;
  market?: DecisionSignalMarket;
};

type PortfolioSignalLookupResult = {
  items: DecisionSignalItem[];
  error: string | null;
};

type PortfolioPageLanguage = 'zh' | 'en';

type FinanceCalendarText = {
  title: string;
  window: string;
  refresh: string;
  refreshing: string;
  reminders: string;
  timeline: string;
  needsAction: string;
  today: string;
  next7Days: string;
  completed: string;
  later: string;
  noEventsTitle: string;
  noEventsDescription: string;
  warningTitle: string;
  trade: string;
  cash: string;
  corporate: string;
  valuation: string;
  risk: string;
  buy: string;
  sell: string;
  cashIn: string;
  cashOut: string;
  cashDividend: string;
  splitAdjustment: string;
  fxStaleTitle: string;
  fxStaleDetail: string;
  priceQualityTitle: string;
  priceQualityDetail: string;
  stopLossTitle: string;
  stopLossDetail: string;
  drawdownTitle: string;
  drawdownDetail: string;
  aiRiskTitle: string;
  aiRiskDetail: string;
  account: string;
  quantity: string;
  price: string;
  amount: string;
  dividend: string;
  splitRatio: string;
  missingPrice: string;
  stalePrice: string;
};

type FinanceCalendarTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';
type FinanceCalendarKind = 'trade' | 'cash' | 'corporate' | 'valuation' | 'risk';
type FinanceCalendarStatus = 'completed' | 'today' | 'next7' | 'later';

type FinanceCalendarItem = {
  id: string;
  date: string;
  kind: FinanceCalendarKind;
  tone: FinanceCalendarTone;
  title: string;
  detail: string;
  status: FinanceCalendarStatus;
  needsAction: boolean;
};

type FinanceCalendarStats = {
  needsAction: number;
  today: number;
  next7Days: number;
  completed: number;
};

type FinanceCalendarSourceEvents = {
  trades: PortfolioTradeListItem[];
  cash: PortfolioCashLedgerListItem[];
  corporate: PortfolioCorporateActionListItem[];
};

const FINANCE_CALENDAR_TEXT: Record<PortfolioPageLanguage, FinanceCalendarText> = {
  zh: {
    title: '个人财务日历',
    window: '近 14 天 / 未来 45 天',
    refresh: '刷新日历',
    refreshing: '刷新中...',
    reminders: '提醒',
    timeline: '事件时间线',
    needsAction: '需处理',
    today: '今日',
    next7Days: '7 日内',
    completed: '已记录',
    later: '后续',
    noEventsTitle: '暂无日历事件',
    noEventsDescription: '当前范围没有交易、资金、公司行为或组合提醒。',
    warningTitle: '日历加载失败',
    trade: '交易',
    cash: '资金',
    corporate: '公司行为',
    valuation: '估值',
    risk: '风控',
    buy: '买入',
    sell: '卖出',
    cashIn: '资金流入',
    cashOut: '资金流出',
    cashDividend: '现金分红',
    splitAdjustment: '拆并股调整',
    fxStaleTitle: '汇率过期',
    fxStaleDetail: '当前账户范围仍有汇率使用 stale/fallback 口径。',
    priceQualityTitle: '价格数据待补齐',
    priceQualityDetail: '缺价 {missing} 项，过期价 {stale} 项。',
    stopLossTitle: '止损提醒',
    stopLossDetail: '已触发 {triggered} 项，接近 {near} 项。',
    drawdownTitle: '回撤提醒',
    drawdownDetail: '最大回撤 {max}，当前回撤 {current}。',
    aiRiskTitle: 'AI 风险信号',
    aiRiskDetail: '当前组合有 {total} 条防御型信号。',
    account: '账户',
    quantity: '数量',
    price: '价格',
    amount: '金额',
    dividend: '每股分红',
    splitRatio: '拆并股比例',
    missingPrice: '缺价',
    stalePrice: '过期价',
  },
  en: {
    title: 'Personal finance calendar',
    window: 'Last 14 days / next 45 days',
    refresh: 'Refresh calendar',
    refreshing: 'Refreshing...',
    reminders: 'Reminders',
    timeline: 'Event timeline',
    needsAction: 'Needs action',
    today: 'Today',
    next7Days: 'Next 7 days',
    completed: 'Recorded',
    later: 'Later',
    noEventsTitle: 'No calendar events',
    noEventsDescription: 'No trades, cash flows, corporate actions, or portfolio reminders in this scope.',
    warningTitle: 'Calendar load failed',
    trade: 'Trade',
    cash: 'Cash',
    corporate: 'Corporate action',
    valuation: 'Valuation',
    risk: 'Risk',
    buy: 'Buy',
    sell: 'Sell',
    cashIn: 'Cash inflow',
    cashOut: 'Cash outflow',
    cashDividend: 'Cash dividend',
    splitAdjustment: 'Split adjustment',
    fxStaleTitle: 'Stale FX',
    fxStaleDetail: 'This account scope still uses stale/fallback FX rates.',
    priceQualityTitle: 'Price data gap',
    priceQualityDetail: '{missing} missing prices, {stale} stale prices.',
    stopLossTitle: 'Stop-loss reminder',
    stopLossDetail: '{triggered} triggered, {near} near.',
    drawdownTitle: 'Drawdown reminder',
    drawdownDetail: 'Max drawdown {max}, current drawdown {current}.',
    aiRiskTitle: 'AI risk signals',
    aiRiskDetail: '{total} defensive signals in this portfolio.',
    account: 'Account',
    quantity: 'Quantity',
    price: 'Price',
    amount: 'Amount',
    dividend: 'Dividend/share',
    splitRatio: 'Split ratio',
    missingPrice: 'Missing',
    stalePrice: 'Stale',
  },
};

const PORTFOLIO_LIMITATION_LABELS: Record<string, Record<PortfolioPageLanguage, string>> = {
  realtime_quote_best_effort: {
    zh: '实时行情为尽力获取',
    en: 'Realtime quotes are best-effort',
  },
  fx_and_cost_basis_partial: {
    zh: '汇率与成本基础为部分口径',
    en: 'FX and cost basis are partial',
  },
  sector_and_risk_metrics_limited: {
    zh: '行业与风险指标覆盖有限',
    en: 'Sector and risk metrics are limited',
  },
};

type PendingDelete =
  | { eventType: 'trade'; id: number; message: string }
  | { eventType: 'cash'; id: number; message: string }
  | { eventType: 'corporate'; id: number; message: string };

type PendingAccountDelete = {
  accountId: number;
  accountName: string;
};

type FxRefreshContext = {
  viewKey: string;
  requestId: number;
};

const PORTFOLIO_INPUT_CLASS =
  'input-surface input-focus-glow h-11 w-full rounded-xl border bg-transparent px-4 text-sm transition-all focus:outline-none disabled:cursor-not-allowed disabled:opacity-60';
const PORTFOLIO_SELECT_CLASS = `${PORTFOLIO_INPUT_CLASS} appearance-none pr-10`;
const PORTFOLIO_FILE_PICKER_CLASS =
  'input-surface input-focus-glow flex h-11 w-full cursor-pointer items-center justify-center rounded-xl border bg-transparent px-4 text-sm transition-all focus:outline-none disabled:cursor-not-allowed disabled:opacity-60';

function getSignalTime(item: DecisionSignalItem): number {
  return parseDecisionSignalDate(item.createdAt)?.getTime()
    ?? parseDecisionSignalDate(item.updatedAt)?.getTime()
    ?? 0;
}

function isNewerSignal(left: DecisionSignalItem | undefined, right: DecisionSignalItem): boolean {
  if (!left) return true;
  return getSignalTime(right) > getSignalTime(left);
}

function formatPortfolioLimitation(limitation: string, language: PortfolioPageLanguage): string {
  return PORTFOLIO_LIMITATION_LABELS[limitation]?.[language] ?? limitation;
}

function parseIsoDay(value: string | null | undefined): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function toIsoDay(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addIsoDays(value: string, days: number): string {
  const date = parseIsoDay(value) ?? parseIsoDay(getTodayIso()) ?? new Date();
  date.setDate(date.getDate() + days);
  return toIsoDay(date);
}

function diffIsoDays(date: string, referenceDate: string): number {
  const target = parseIsoDay(date);
  const reference = parseIsoDay(referenceDate);
  if (!target || !reference) return 0;
  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  return Math.round((target.getTime() - reference.getTime()) / millisecondsPerDay);
}

function buildFinanceCalendarWindow(referenceDate: string): { dateFrom: string; dateTo: string } {
  return {
    dateFrom: addIsoDays(referenceDate, -FINANCE_CALENDAR_LOOKBACK_DAYS),
    dateTo: addIsoDays(referenceDate, FINANCE_CALENDAR_LOOKAHEAD_DAYS),
  };
}

function getFinanceCalendarStatus(date: string, referenceDate: string): FinanceCalendarStatus {
  const dayDelta = diffIsoDays(date, referenceDate);
  if (dayDelta < 0) return 'completed';
  if (dayDelta === 0) return 'today';
  if (dayDelta <= 7) return 'next7';
  return 'later';
}

function getFinanceCalendarStatusLabel(status: FinanceCalendarStatus, text: FinanceCalendarText): string {
  if (status === 'today') return text.today;
  if (status === 'next7') return text.next7Days;
  if (status === 'completed') return text.completed;
  return text.later;
}

function getFinanceCalendarStatusVariant(status: FinanceCalendarStatus): 'default' | 'success' | 'warning' | 'info' {
  if (status === 'today') return 'warning';
  if (status === 'next7') return 'info';
  if (status === 'completed') return 'success';
  return 'default';
}

function getFinanceCalendarKindLabel(kind: FinanceCalendarKind, text: FinanceCalendarText): string {
  if (kind === 'trade') return text.trade;
  if (kind === 'cash') return text.cash;
  if (kind === 'corporate') return text.corporate;
  if (kind === 'valuation') return text.valuation;
  return text.risk;
}

function getFinanceCalendarToneVariant(tone: FinanceCalendarTone): 'default' | 'success' | 'warning' | 'danger' | 'info' {
  if (tone === 'neutral') return 'default';
  return tone;
}

function getFinanceCalendarSeverity(tone: FinanceCalendarTone): number {
  if (tone === 'danger') return 0;
  if (tone === 'warning') return 1;
  if (tone === 'info') return 2;
  if (tone === 'success') return 3;
  return 4;
}

function getFinanceCalendarAccountLabel(accountId: number, accountNameById: ReadonlyMap<number, string>, text: FinanceCalendarText): string {
  return `${text.account}: ${accountNameById.get(accountId) || `#${accountId}`}`;
}

function formatFinanceCalendarSide(side: PortfolioSide, text: FinanceCalendarText): string {
  return side === 'buy' ? text.buy : text.sell;
}

function formatFinanceCalendarCashDirection(direction: PortfolioCashDirection, text: FinanceCalendarText): string {
  return direction === 'in' ? text.cashIn : text.cashOut;
}

function formatFinanceCalendarCorporateAction(actionType: PortfolioCorporateActionType, text: FinanceCalendarText): string {
  return actionType === 'cash_dividend' ? text.cashDividend : text.splitAdjustment;
}

function compareFinanceCalendarItems(left: FinanceCalendarItem, right: FinanceCalendarItem): number {
  const leftTime = parseIsoDay(left.date)?.getTime() ?? 0;
  const rightTime = parseIsoDay(right.date)?.getTime() ?? 0;
  if (leftTime !== rightTime) return leftTime - rightTime;
  const severityDelta = getFinanceCalendarSeverity(left.tone) - getFinanceCalendarSeverity(right.tone);
  if (severityDelta !== 0) return severityDelta;
  return left.title.localeCompare(right.title);
}

function buildFinanceCalendarLedgerItems(
  sourceEvents: FinanceCalendarSourceEvents,
  referenceDate: string,
  accountNameById: ReadonlyMap<number, string>,
  text: FinanceCalendarText,
): FinanceCalendarItem[] {
  const items: FinanceCalendarItem[] = [];

  for (const item of sourceEvents.trades) {
    const sideLabel = formatFinanceCalendarSide(item.side, text);
    const status = getFinanceCalendarStatus(item.tradeDate, referenceDate);
    items.push({
      id: `trade-${item.id}`,
      date: item.tradeDate,
      kind: 'trade',
      tone: item.side === 'buy' ? 'info' : 'warning',
      title: `${sideLabel} ${item.symbol}`,
      detail: [
        getFinanceCalendarAccountLabel(item.accountId, accountNameById, text),
        `${text.quantity}: ${item.quantity}`,
        `${text.price}: ${item.price}`,
        item.currency,
      ].join(' · '),
      status,
      needsAction: false,
    });
  }

  for (const item of sourceEvents.cash) {
    const status = getFinanceCalendarStatus(item.eventDate, referenceDate);
    items.push({
      id: `cash-${item.id}`,
      date: item.eventDate,
      kind: 'cash',
      tone: item.direction === 'out' ? 'warning' : 'success',
      title: formatFinanceCalendarCashDirection(item.direction, text),
      detail: [
        getFinanceCalendarAccountLabel(item.accountId, accountNameById, text),
        `${text.amount}: ${formatMoney(item.amount, item.currency)}`,
      ].join(' · '),
      status,
      needsAction: item.direction === 'out' && status !== 'completed',
    });
  }

  for (const item of sourceEvents.corporate) {
    const status = getFinanceCalendarStatus(item.effectiveDate, referenceDate);
    const actionLabel = formatFinanceCalendarCorporateAction(item.actionType, text);
    const actionDetail = item.actionType === 'cash_dividend'
      ? `${text.dividend}: ${item.cashDividendPerShare ?? '--'} ${item.currency}`
      : `${text.splitRatio}: ${item.splitRatio ?? '--'}`;
    items.push({
      id: `corporate-${item.id}`,
      date: item.effectiveDate,
      kind: 'corporate',
      tone: status === 'completed' ? 'success' : 'info',
      title: `${actionLabel} ${item.symbol}`,
      detail: [
        getFinanceCalendarAccountLabel(item.accountId, accountNameById, text),
        actionDetail,
      ].join(' · '),
      status,
      needsAction: status !== 'completed',
    });
  }

  return items;
}

function buildFinanceCalendarReminderItems(
  snapshot: PortfolioSnapshotResponse | null,
  risk: PortfolioRiskResponse | null,
  positions: FlatPosition[],
  referenceDate: string,
  text: FinanceCalendarText,
): FinanceCalendarItem[] {
  const items: FinanceCalendarItem[] = [];
  const status = getFinanceCalendarStatus(referenceDate, referenceDate);

  if (snapshot?.fxStale) {
    items.push({
      id: 'valuation-fx-stale',
      date: referenceDate,
      kind: 'valuation',
      tone: 'warning',
      title: text.fxStaleTitle,
      detail: text.fxStaleDetail,
      status,
      needsAction: true,
    });
  }

  const missingPriceCount = positions.filter((item) => !hasPositionPrice(item)).length;
  const stalePriceCount = positions.filter((item) => hasPositionPrice(item) && item.priceStale).length;
  if (missingPriceCount > 0 || stalePriceCount > 0) {
    items.push({
      id: 'valuation-price-quality',
      date: referenceDate,
      kind: 'valuation',
      tone: missingPriceCount > 0 ? 'danger' : 'warning',
      title: text.priceQualityTitle,
      detail: formatUiText(text.priceQualityDetail, {
        missing: missingPriceCount,
        stale: stalePriceCount,
      }),
      status,
      needsAction: true,
    });
  }

  if ((risk?.stopLoss?.triggeredCount ?? 0) > 0 || (risk?.stopLoss?.nearCount ?? 0) > 0) {
    items.push({
      id: 'risk-stop-loss',
      date: referenceDate,
      kind: 'risk',
      tone: (risk?.stopLoss?.triggeredCount ?? 0) > 0 ? 'danger' : 'warning',
      title: text.stopLossTitle,
      detail: formatUiText(text.stopLossDetail, {
        triggered: risk?.stopLoss?.triggeredCount ?? 0,
        near: risk?.stopLoss?.nearCount ?? 0,
      }),
      status,
      needsAction: true,
    });
  }

  if (risk?.drawdown?.alert) {
    items.push({
      id: 'risk-drawdown',
      date: referenceDate,
      kind: 'risk',
      tone: 'warning',
      title: text.drawdownTitle,
      detail: formatUiText(text.drawdownDetail, {
        max: formatPct(risk.drawdown.maxDrawdownPct),
        current: formatPct(risk.drawdown.currentDrawdownPct),
      }),
      status,
      needsAction: true,
    });
  }

  if ((risk?.decisionSignalRisk?.total ?? 0) > 0) {
    items.push({
      id: 'risk-ai-signals',
      date: referenceDate,
      kind: 'risk',
      tone: 'warning',
      title: text.aiRiskTitle,
      detail: formatUiText(text.aiRiskDetail, { total: risk?.decisionSignalRisk?.total ?? 0 }),
      status,
      needsAction: true,
    });
  }

  return items;
}

function buildFinanceCalendarItems(
  sourceEvents: FinanceCalendarSourceEvents,
  snapshot: PortfolioSnapshotResponse | null,
  risk: PortfolioRiskResponse | null,
  positions: FlatPosition[],
  accountNameById: ReadonlyMap<number, string>,
  text: FinanceCalendarText,
): FinanceCalendarItem[] {
  const referenceDate = snapshot?.asOf || getTodayIso();
  return [
    ...buildFinanceCalendarReminderItems(snapshot, risk, positions, referenceDate, text),
    ...buildFinanceCalendarLedgerItems(sourceEvents, referenceDate, accountNameById, text),
  ].sort(compareFinanceCalendarItems);
}

function buildFinanceCalendarStats(items: FinanceCalendarItem[]): FinanceCalendarStats {
  return items.reduce<FinanceCalendarStats>(
    (stats, item) => ({
      needsAction: stats.needsAction + (item.needsAction ? 1 : 0),
      today: stats.today + (item.status === 'today' ? 1 : 0),
      next7Days: stats.next7Days + (item.status === 'next7' ? 1 : 0),
      completed: stats.completed + (item.status === 'completed' ? 1 : 0),
    }),
    { needsAction: 0, today: 0, next7Days: 0, completed: 0 },
  );
}

function FinanceCalendarStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
      <div className="text-[11px] text-secondary">{label}</div>
      <div className="mt-1 text-lg font-semibold text-foreground">{value}</div>
    </div>
  );
}

function FinanceCalendarItemRow({
  item,
  text,
}: {
  item: FinanceCalendarItem;
  text: FinanceCalendarText;
}) {
  return (
    <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-3 border-b border-white/5 py-3 last:border-0">
      <div className="min-w-0">
        <div className="font-mono text-xs text-foreground">{item.date}</div>
        <div className="mt-1">
          <Badge variant={getFinanceCalendarStatusVariant(item.status)} className="whitespace-nowrap">
            {getFinanceCalendarStatusLabel(item.status, text)}
          </Badge>
        </div>
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <StatusDot tone={item.tone} />
          <span className="text-sm font-medium text-foreground">{item.title}</span>
          <Badge variant={getFinanceCalendarToneVariant(item.tone)}>
            {getFinanceCalendarKindLabel(item.kind, text)}
          </Badge>
          {item.needsAction ? <Badge variant="danger">{text.needsAction}</Badge> : null}
        </div>
        <div className="mt-1 truncate text-xs text-secondary">{item.detail}</div>
      </div>
    </div>
  );
}

function PortfolioFinanceCalendar({
  items,
  stats,
  text,
  loading,
  warning,
  onRefresh,
}: {
  items: FinanceCalendarItem[];
  stats: FinanceCalendarStats;
  text: FinanceCalendarText;
  loading: boolean;
  warning: string | null;
  onRefresh: () => void;
}) {
  const reminderItems = items.filter((item) => item.needsAction).slice(0, 4);

  return (
    <section>
      <Card padding="md">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-cyan" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-foreground">{text.title}</h2>
            </div>
            <div className="mt-1 flex items-center gap-2 text-xs text-secondary">
              <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{text.window}</span>
            </div>
          </div>
          <button
            type="button"
            className="btn-secondary text-sm"
            onClick={onRefresh}
            disabled={loading}
          >
            {loading ? text.refreshing : text.refresh}
          </button>
        </div>

        {warning ? (
          <InlineAlert
            variant="warning"
            title={text.warningTitle}
            message={warning}
            className="mt-3 rounded-xl px-3 py-2 text-xs shadow-none"
          />
        ) : null}

        <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
          <FinanceCalendarStat label={text.needsAction} value={stats.needsAction} />
          <FinanceCalendarStat label={text.today} value={stats.today} />
          <FinanceCalendarStat label={text.next7Days} value={stats.next7Days} />
          <FinanceCalendarStat label={text.completed} value={stats.completed} />
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
            <div className="mb-3 flex items-center gap-2">
              <BellRing className="h-4 w-4 text-warning" aria-hidden="true" />
              <h3 className="text-sm font-semibold text-foreground">{text.reminders}</h3>
            </div>
            {reminderItems.length > 0 ? (
              <div className="space-y-2">
                {reminderItems.map((item) => (
                  <div key={`reminder-${item.id}`} className="rounded-lg border border-white/10 px-3 py-2">
                    <div className="flex items-center gap-2">
                      <StatusDot tone={item.tone} pulse={item.tone === 'danger'} />
                      <span className="text-sm font-medium text-foreground">{item.title}</span>
                    </div>
                    <div className="mt-1 text-xs text-secondary">{item.detail}</div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                title={text.noEventsTitle}
                description={text.noEventsDescription}
                className="border-none bg-transparent px-3 py-6 shadow-none"
              />
            )}
          </div>

          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
            <h3 className="mb-1 text-sm font-semibold text-foreground">{text.timeline}</h3>
            <div className="max-h-80 overflow-auto">
              {items.length > 0 ? (
                items.map((item) => (
                  <FinanceCalendarItemRow key={item.id} item={item} text={text} />
                ))
              ) : (
                <EmptyState
                  title={text.noEventsTitle}
                  description={text.noEventsDescription}
                  className="border-none bg-transparent px-3 py-8 shadow-none"
                />
              )}
            </div>
          </div>
        </div>
      </Card>
    </section>
  );
}

const DECISION_SIGNAL_MARKETS = new Set<DecisionSignalMarket>(['cn', 'hk', 'us', 'jp', 'kr', 'tw']);
type PortfolioAccountMarket = 'cn' | 'hk' | 'us' | 'jp' | 'kr' | 'tw';

function toDecisionSignalMarket(value: string | null | undefined): DecisionSignalMarket | undefined {
  const normalized = String(value || '').toLowerCase();
  return DECISION_SIGNAL_MARKETS.has(normalized as DecisionSignalMarket)
    ? normalized as DecisionSignalMarket
    : undefined;
}

function toPositionSignalLookupKey(stockCode: string, market?: DecisionSignalMarket): string {
  return `${market || ''}:${normalizeStockCode(stockCode).toUpperCase()}`;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex]);
    }
  }));

  return results;
}

async function loadPortfolioSignalLookup(lookup: PortfolioSignalLookup): Promise<PortfolioSignalLookupResult> {
  try {
    const response = await decisionSignalsApi.getLatest(lookup.stockCode, {
      market: lookup.market,
      limit: 1,
    });
    return { items: response.items, error: null };
  } catch (err) {
    return { items: [], error: getParsedApiError(err).message };
  }
}

const PortfolioPage: React.FC = () => {
  const { language, t } = useUiLanguage();
  const text = PORTFOLIO_TEXT[language];
  const financeCalendarText = FINANCE_CALENDAR_TEXT[language];
  const decisionActionLabels = useMemo(() => buildDecisionActionLabelMap(t), [t]);

  // Set page title
  useEffect(() => {
    document.title = text.documentTitle;
  }, [text.documentTitle]);

  const [accounts, setAccounts] = useState<PortfolioAccountItem[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<AccountOption>('all');
  const [showCreateAccount, setShowCreateAccount] = useState(false);
  const [accountCreating, setAccountCreating] = useState(false);
  const [accountCreateError, setAccountCreateError] = useState<string | null>(null);
  const [accountCreateSuccess, setAccountCreateSuccess] = useState<string | null>(null);
  const [accountForm, setAccountForm] = useState({
    name: '',
    broker: 'Demo',
    market: 'cn' as PortfolioAccountMarket,
    baseCurrency: 'CNY',
  });
  const [costMethod, setCostMethod] = useState<PortfolioCostMethod>('fifo');
  const [snapshot, setSnapshot] = useState<PortfolioSnapshotResponse | null>(null);
  const [risk, setRisk] = useState<PortfolioRiskResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [fxRefreshing, setFxRefreshing] = useState(false);
  const [fxRefreshFeedback, setFxRefreshFeedback] = useState<FxRefreshFeedback | null>(null);
  const [error, setError] = useState<ParsedApiError | null>(null);
  const [riskWarning, setRiskWarning] = useState<string | null>(null);
  const [writeWarning, setWriteWarning] = useState<string | null>(null);
  const [portfolioSignals, setPortfolioSignals] = useState<DecisionSignalItem[]>([]);
  const [portfolioSignalsLoading, setPortfolioSignalsLoading] = useState(false);
  const [portfolioSignalsWarning, setPortfolioSignalsWarning] = useState<string | null>(null);
  const [portfolioSignalsRefreshKey, setPortfolioSignalsRefreshKey] = useState(0);
  const portfolioSignalsRequestRef = useRef(0);
  const [positionAnalysisLoadingKey, setPositionAnalysisLoadingKey] = useState<string | null>(null);
  const [positionAnalysisMessage, setPositionAnalysisMessage] = useState<string | null>(null);

  const [brokers, setBrokers] = useState<PortfolioImportBrokerItem[]>([]);
  const [selectedBroker, setSelectedBroker] = useState('huatai');
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvDryRun, setCsvDryRun] = useState(true);
  const [csvParsing, setCsvParsing] = useState(false);
  const [csvCommitting, setCsvCommitting] = useState(false);
  const [csvParseResult, setCsvParseResult] = useState<PortfolioImportParseResponse | null>(null);
  const [csvCommitResult, setCsvCommitResult] = useState<PortfolioImportCommitResponse | null>(null);
  const [brokerLoadWarning, setBrokerLoadWarning] = useState<string | null>(null);

  const [eventType, setEventType] = useState<EventType>('trade');
  const [eventDateFrom, setEventDateFrom] = useState('');
  const [eventDateTo, setEventDateTo] = useState('');
  const [eventSymbol, setEventSymbol] = useState('');
  const [eventSide, setEventSide] = useState<'' | PortfolioSide>('');
  const [eventDirection, setEventDirection] = useState<'' | PortfolioCashDirection>('');
  const [eventActionType, setEventActionType] = useState<'' | PortfolioCorporateActionType>('');
  const [eventPage, setEventPage] = useState(1);
  const [eventTotal, setEventTotal] = useState(0);
  const [eventLoading, setEventLoading] = useState(false);
  const [tradeEvents, setTradeEvents] = useState<PortfolioTradeListItem[]>([]);
  const [cashEvents, setCashEvents] = useState<PortfolioCashLedgerListItem[]>([]);
  const [corporateEvents, setCorporateEvents] = useState<PortfolioCorporateActionListItem[]>([]);
  const [financeCalendarEvents, setFinanceCalendarEvents] = useState<FinanceCalendarSourceEvents>({
    trades: [],
    cash: [],
    corporate: [],
  });
  const [financeCalendarLoading, setFinanceCalendarLoading] = useState(false);
  const [financeCalendarWarning, setFinanceCalendarWarning] = useState<string | null>(null);
  const [financeCalendarRefreshKey, setFinanceCalendarRefreshKey] = useState(0);
  const financeCalendarRequestRef = useRef(0);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [pendingAccountDelete, setPendingAccountDelete] = useState<PendingAccountDelete | null>(null);
  const [accountDeleteLoading, setAccountDeleteLoading] = useState(false);

  const [tradeForm, setTradeForm] = useState({
    symbol: '',
    tradeDate: getTodayIso(),
    side: 'buy' as PortfolioSide,
    quantity: '',
    price: '',
    fee: '',
    tax: '',
    tradeUid: '',
    note: '',
  });
  const [cashForm, setCashForm] = useState({
    eventDate: getTodayIso(),
    direction: 'in' as PortfolioCashDirection,
    amount: '',
    currency: '',
    note: '',
  });
  const [corpForm, setCorpForm] = useState({
    symbol: '',
    effectiveDate: getTodayIso(),
    actionType: 'cash_dividend' as PortfolioCorporateActionType,
    cashDividendPerShare: '',
    splitRatio: '',
    note: '',
  });

  const queryAccountId = selectedAccount === 'all' ? undefined : selectedAccount;
  const refreshViewKey = `${selectedAccount === 'all' ? 'all' : `account:${selectedAccount}`}:cost:${costMethod}`;
  const refreshContextRef = useRef<FxRefreshContext>({ viewKey: refreshViewKey, requestId: 0 });
  const hasAccounts = accounts.length > 0;
  const writableAccount = selectedAccount === 'all' ? undefined : accounts.find((item) => item.id === selectedAccount);
  const writableAccountId = writableAccount?.id;
  const writeBlocked = !writableAccountId;
  const canDeleteSelectedAccount = Boolean(writableAccountId) && !isLoading && !fxRefreshing && !accountDeleteLoading;
  const totalEventPages = Math.max(1, Math.ceil(eventTotal / DEFAULT_PAGE_SIZE));
  const currentEventCount = eventType === 'trade'
    ? tradeEvents.length
    : eventType === 'cash'
      ? cashEvents.length
      : corporateEvents.length;
  const financeCalendarReferenceDate = snapshot?.asOf || null;

  const isActiveRefreshContext = (requestedViewKey: string, requestedRequestId: number) => {
    return (
      refreshContextRef.current.viewKey === requestedViewKey
      && refreshContextRef.current.requestId === requestedRequestId
    );
  };

  const loadAccounts = useCallback(async () => {
    try {
      const response = await portfolioApi.getAccounts(false);
      const items = response.accounts || [];
      setAccounts(items);
      setSelectedAccount((prev) => {
        if (items.length === 0) return 'all';
        if (prev !== 'all' && !items.some((item) => item.id === prev)) return items[0].id;
        return prev;
      });
      if (items.length === 0) setShowCreateAccount(true);
    } catch (err) {
      setError(getParsedApiError(err));
    }
  }, []);

  const loadBrokers = useCallback(async () => {
    try {
      const response = await portfolioApi.listImportBrokers();
      const brokerItems = response.brokers || [];
      if (brokerItems.length === 0) {
        setBrokers(FALLBACK_BROKERS);
        setBrokerLoadWarning('券商列表接口返回为空，已回退为内置券商列表（华泰/中信/招商）。');
        if (!FALLBACK_BROKERS.some((item) => item.broker === selectedBroker)) {
          setSelectedBroker(FALLBACK_BROKERS[0].broker);
        }
        return;
      }
      setBrokers(brokerItems);
      setBrokerLoadWarning(null);
      if (!brokerItems.some((item) => item.broker === selectedBroker)) {
        setSelectedBroker(brokerItems[0].broker);
      }
    } catch {
      setBrokers(FALLBACK_BROKERS);
      setBrokerLoadWarning('券商列表接口不可用，已回退为内置券商列表（华泰/中信/招商）。');
      if (!FALLBACK_BROKERS.some((item) => item.broker === selectedBroker)) {
        setSelectedBroker(FALLBACK_BROKERS[0].broker);
      }
    }
  }, [selectedBroker]);

  const loadSnapshotAndRisk = useCallback(async () => {
    setIsLoading(true);
    setRiskWarning(null);
    try {
      const snapshotData = await portfolioApi.getSnapshot({
        accountId: queryAccountId,
        costMethod,
        includeRealtime: false,
      });
      setSnapshot(snapshotData);
      setError(null);

      try {
        const riskData = await portfolioApi.getRisk({
          accountId: queryAccountId,
          costMethod,
          includeRealtime: false,
        });
        setRisk(riskData);
      } catch (riskErr) {
        setRisk(null);
        const parsed = getParsedApiError(riskErr);
        setRiskWarning(parsed.message || '风险数据获取失败，已降级为仅展示快照数据。');
      }
    } catch (err) {
      setSnapshot(null);
      setRisk(null);
      setError(getParsedApiError(err));
    } finally {
      setIsLoading(false);
    }
  }, [queryAccountId, costMethod]);

  const loadEventsPage = useCallback(async (page: number) => {
    setEventLoading(true);
    try {
      if (eventType === 'trade') {
        const response = await portfolioApi.listTrades({
          accountId: queryAccountId,
          dateFrom: eventDateFrom || undefined,
          dateTo: eventDateTo || undefined,
          symbol: eventSymbol || undefined,
          side: eventSide || undefined,
          page,
          pageSize: DEFAULT_PAGE_SIZE,
        });
        setTradeEvents(response.items || []);
        setEventTotal(response.total || 0);
      } else if (eventType === 'cash') {
        const response = await portfolioApi.listCashLedger({
          accountId: queryAccountId,
          dateFrom: eventDateFrom || undefined,
          dateTo: eventDateTo || undefined,
          direction: eventDirection || undefined,
          page,
          pageSize: DEFAULT_PAGE_SIZE,
        });
        setCashEvents(response.items || []);
        setEventTotal(response.total || 0);
      } else {
        const response = await portfolioApi.listCorporateActions({
          accountId: queryAccountId,
          dateFrom: eventDateFrom || undefined,
          dateTo: eventDateTo || undefined,
          symbol: eventSymbol || undefined,
          actionType: eventActionType || undefined,
          page,
          pageSize: DEFAULT_PAGE_SIZE,
        });
        setCorporateEvents(response.items || []);
        setEventTotal(response.total || 0);
      }
    } catch (err) {
      setError(getParsedApiError(err));
    } finally {
      setEventLoading(false);
    }
  }, [
    eventActionType,
    eventDateFrom,
    eventDateTo,
    eventDirection,
    eventSide,
    eventSymbol,
    eventType,
    queryAccountId,
  ]);

  const loadEvents = useCallback(async () => {
    await loadEventsPage(eventPage);
  }, [eventPage, loadEventsPage]);

  const loadFinanceCalendar = useCallback(async () => {
    if (!financeCalendarReferenceDate) {
      setFinanceCalendarEvents({ trades: [], cash: [], corporate: [] });
      setFinanceCalendarWarning(null);
      setFinanceCalendarLoading(false);
      return;
    }

    const requestId = financeCalendarRequestRef.current + 1;
    financeCalendarRequestRef.current = requestId;
    const referenceDate = financeCalendarReferenceDate;
    const calendarWindow = buildFinanceCalendarWindow(referenceDate);
    const query = {
      accountId: queryAccountId,
      dateFrom: calendarWindow.dateFrom,
      dateTo: calendarWindow.dateTo,
      page: 1,
      pageSize: FINANCE_CALENDAR_PAGE_SIZE,
    };

    setFinanceCalendarLoading(true);
    setFinanceCalendarWarning(null);

    try {
      const [tradeResult, cashResult, corporateResult] = await Promise.allSettled([
        portfolioApi.listTrades(query),
        portfolioApi.listCashLedger(query),
        portfolioApi.listCorporateActions(query),
      ] as const);
      if (financeCalendarRequestRef.current !== requestId) {
        return;
      }

      const failures: string[] = [];
      const nextEvents: FinanceCalendarSourceEvents = {
        trades: [],
        cash: [],
        corporate: [],
      };

      if (tradeResult.status === 'fulfilled') {
        nextEvents.trades = tradeResult.value.items || [];
      } else {
        failures.push(getParsedApiError(tradeResult.reason).message);
      }

      if (cashResult.status === 'fulfilled') {
        nextEvents.cash = cashResult.value.items || [];
      } else {
        failures.push(getParsedApiError(cashResult.reason).message);
      }

      if (corporateResult.status === 'fulfilled') {
        nextEvents.corporate = corporateResult.value.items || [];
      } else {
        failures.push(getParsedApiError(corporateResult.reason).message);
      }

      setFinanceCalendarEvents(nextEvents);
      setFinanceCalendarWarning(failures[0] || null);
    } finally {
      if (financeCalendarRequestRef.current === requestId) {
        setFinanceCalendarLoading(false);
      }
    }
  }, [financeCalendarReferenceDate, queryAccountId]);

  const refreshPortfolioData = useCallback(async (page = eventPage) => {
    await Promise.all([loadSnapshotAndRisk(), loadEventsPage(page)]);
  }, [eventPage, loadEventsPage, loadSnapshotAndRisk]);

  useEffect(() => {
    void loadAccounts();
    void loadBrokers();
  }, [loadAccounts, loadBrokers]);

  useEffect(() => {
    void loadSnapshotAndRisk();
  }, [loadSnapshotAndRisk]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  useEffect(() => {
    if (!hasAccounts || !financeCalendarReferenceDate) {
      setFinanceCalendarEvents({ trades: [], cash: [], corporate: [] });
      setFinanceCalendarWarning(null);
      setFinanceCalendarLoading(false);
      return;
    }
    void loadFinanceCalendar();
  }, [financeCalendarReferenceDate, financeCalendarRefreshKey, hasAccounts, loadFinanceCalendar]);

  useEffect(() => {
    refreshContextRef.current = {
      viewKey: refreshViewKey,
      requestId: refreshContextRef.current.requestId + 1,
    };
    setFxRefreshing(false);
    setFxRefreshFeedback(null);
  }, [refreshViewKey]);

  useEffect(() => {
    setEventPage(1);
  }, [eventType, queryAccountId, eventDateFrom, eventDateTo, eventSymbol, eventSide, eventDirection, eventActionType]);

  useEffect(() => {
    if (!writeBlocked) {
      setWriteWarning(null);
    }
  }, [writeBlocked]);

  const positionRows: FlatPosition[] = useMemo(() => {
    if (!snapshot) return [];
    const rows: FlatPosition[] = [];
    for (const account of snapshot.accounts || []) {
      for (const position of account.positions || []) {
        rows.push({
          ...position,
          accountId: account.accountId,
          accountName: account.accountName,
        });
      }
    }
    rows.sort((a, b) => Number(b.marketValueBase || 0) - Number(a.marketValueBase || 0));
    return rows;
  }, [snapshot]);

  const financeCalendarAccountNameById = useMemo(() => (
    new Map(accounts.map((account) => [account.id, account.name]))
  ), [accounts]);

  const financeCalendarItems = useMemo(() => buildFinanceCalendarItems(
    financeCalendarEvents,
    snapshot,
    risk,
    positionRows,
    financeCalendarAccountNameById,
    financeCalendarText,
  ), [
    financeCalendarAccountNameById,
    financeCalendarEvents,
    financeCalendarText,
    positionRows,
    risk,
    snapshot,
  ]);

  const financeCalendarStats = useMemo(
    () => buildFinanceCalendarStats(financeCalendarItems),
    [financeCalendarItems],
  );

  const snapshotMatchesAccountScope = useMemo(() => {
    if (!snapshot) return false;
    const snapshotAccountIds = new Set((snapshot.accounts || []).map((account) => account.accountId));
    if (queryAccountId !== undefined) {
      return snapshotAccountIds.size === 1 && snapshotAccountIds.has(queryAccountId);
    }
    return accounts.length === 0 || Number(snapshot.accountCount || 0) === accounts.length;
  }, [accounts.length, queryAccountId, snapshot]);

  const positionSignalLookups = useMemo(() => {
    const lookups = new Map<string, PortfolioSignalLookup>();
    for (const row of positionRows) {
      const stockCode = String(row.symbol || '').trim();
      if (!stockCode) continue;
      const market = toDecisionSignalMarket(row.market);
      const key = toPositionSignalLookupKey(stockCode, market);
      if (!lookups.has(key)) {
        lookups.set(key, { stockCode, market });
      }
    }
    return Array.from(lookups.values());
  }, [positionRows]);

  useEffect(() => {
    const requestId = portfolioSignalsRequestRef.current + 1;
    portfolioSignalsRequestRef.current = requestId;

    if (positionSignalLookups.length === 0 || !snapshotMatchesAccountScope) {
      setPortfolioSignals([]);
      setPortfolioSignalsWarning(null);
      setPortfolioSignalsLoading(false);
      return;
    }

    const isActiveRequest = () => portfolioSignalsRequestRef.current === requestId;

    const loadPortfolioSignals = async () => {
      setPortfolioSignalsLoading(true);
      setPortfolioSignalsWarning(null);
      const results = await mapWithConcurrency(
        positionSignalLookups,
        PORTFOLIO_SIGNAL_LOOKUP_CONCURRENCY,
        loadPortfolioSignalLookup,
      );
      if (!isActiveRequest()) return;
      const collected = results.flatMap((result) => result.items);
      const failures = results.flatMap((result) => (result.error ? [result.error] : []));
      setPortfolioSignals(collected);
      setPortfolioSignalsWarning(
        failures.length > 0
          ? (
              collected.length > 0
                ? formatUiText(t('decisionSignals.portfolioPartialWarning'), { message: failures[0] })
                : failures[0]
            )
          : null,
      );
      if (isActiveRequest()) {
        setPortfolioSignalsLoading(false);
      }
    };

    void loadPortfolioSignals();

    return () => {
      portfolioSignalsRequestRef.current += 1;
    };
  }, [portfolioSignalsRefreshKey, positionSignalLookups, snapshotMatchesAccountScope, t]);

  const signalByPositionKey = useMemo(() => {
    const mapped = new Map<string, DecisionSignalItem>();
    for (const row of positionRows) {
      const rowMarket = String(row.market || '').toLowerCase();
      for (const signal of portfolioSignals) {
        const signalMarket = String(signal.market || '').toLowerCase();
        if (rowMarket && signalMarket && rowMarket !== signalMarket) {
          continue;
        }
        if (!areStockCodesEquivalent(row.symbol, signal.stockCode)) {
          continue;
        }
        const key = `${row.accountId}-${row.symbol}-${row.market}`;
        const existing = mapped.get(key);
        if (isNewerSignal(existing, signal)) {
          mapped.set(key, signal);
        }
      }
    }
    return mapped;
  }, [portfolioSignals, positionRows]);

  const handleAnalyzePosition = async (row: FlatPosition) => {
    const key = `${row.accountId}-${row.symbol}-${row.market}`;
    setPositionAnalysisLoadingKey(key);
    setPositionAnalysisMessage(null);
    setError(null);
    try {
      const task = await portfolioApi.analyzePosition(row.symbol, {
        accountId: row.accountId,
        analysisPhase: 'auto',
        force: false,
      });
      setPositionAnalysisMessage(`已提交 ${row.symbol} 分析任务：${task.taskId}`);
    } catch (err) {
      setError(getParsedApiError(err));
    } finally {
      setPositionAnalysisLoadingKey(null);
    }
  };

  const sectorPieData = useMemo(() => {
    const sectors = risk?.sectorConcentration?.topSectors || [];
    return sectors
      .slice(0, 6)
      .map((item) => ({
        name: item.sector,
        value: Number(item.weightPct || 0),
      }))
      .filter((item) => item.value > 0);
  }, [risk]);

  const positionFallbackPieData = useMemo(() => {
    if (!risk?.concentration?.topPositions?.length) {
      return [];
    }
    return risk.concentration.topPositions
      .slice(0, 6)
      .map((item) => ({
        name: item.symbol,
        value: Number(item.weightPct || 0),
      }))
      .filter((item) => item.value > 0);
  }, [risk]);

  const concentrationPieData = sectorPieData.length > 0 ? sectorPieData : positionFallbackPieData;
  const concentrationMode = sectorPieData.length > 0 ? 'sector' : 'position';

  const handleTradeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!writableAccountId) {
      setWriteWarning('请先在右上角选择具体账户，再进行录入或导入提交。');
      return;
    }
    try {
      setWriteWarning(null);
      await portfolioApi.createTrade({
        accountId: writableAccountId,
        symbol: tradeForm.symbol,
        tradeDate: tradeForm.tradeDate,
        side: tradeForm.side,
        quantity: Number(tradeForm.quantity),
        price: Number(tradeForm.price),
        fee: Number(tradeForm.fee || 0),
        tax: Number(tradeForm.tax || 0),
        tradeUid: tradeForm.tradeUid || undefined,
        note: tradeForm.note || undefined,
      });
      await refreshPortfolioData();
      setFinanceCalendarRefreshKey((current) => current + 1);
      setTradeForm((prev) => ({ ...prev, symbol: '', tradeUid: '', note: '' }));
    } catch (err) {
      setError(getParsedApiError(err));
    }
  };

  const handleCashSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!writableAccountId) {
      setWriteWarning('请先在右上角选择具体账户，再进行录入或导入提交。');
      return;
    }
    try {
      setWriteWarning(null);
      await portfolioApi.createCashLedger({
        accountId: writableAccountId,
        eventDate: cashForm.eventDate,
        direction: cashForm.direction,
        amount: Number(cashForm.amount),
        currency: cashForm.currency || undefined,
        note: cashForm.note || undefined,
      });
      await refreshPortfolioData();
      setFinanceCalendarRefreshKey((current) => current + 1);
      setCashForm((prev) => ({ ...prev, note: '' }));
    } catch (err) {
      setError(getParsedApiError(err));
    }
  };

  const handleCorporateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!writableAccountId) {
      setWriteWarning('请先在右上角选择具体账户，再进行录入或导入提交。');
      return;
    }
    try {
      setWriteWarning(null);
      await portfolioApi.createCorporateAction({
        accountId: writableAccountId,
        symbol: corpForm.symbol,
        effectiveDate: corpForm.effectiveDate,
        actionType: corpForm.actionType,
        cashDividendPerShare: corpForm.cashDividendPerShare ? Number(corpForm.cashDividendPerShare) : undefined,
        splitRatio: corpForm.splitRatio ? Number(corpForm.splitRatio) : undefined,
        note: corpForm.note || undefined,
      });
      await refreshPortfolioData();
      setFinanceCalendarRefreshKey((current) => current + 1);
      setCorpForm((prev) => ({ ...prev, symbol: '', note: '' }));
    } catch (err) {
      setError(getParsedApiError(err));
    }
  };

  const handleParseCsv = async () => {
    if (!csvFile) return;
    try {
      setCsvParsing(true);
      const parsed = await portfolioApi.parseCsvImport(selectedBroker, csvFile);
      setCsvParseResult(parsed);
      setCsvCommitResult(null);
    } catch (err) {
      setError(getParsedApiError(err));
    } finally {
      setCsvParsing(false);
    }
  };

  const handleCommitCsv = async () => {
    if (!csvFile) return;
    if (!writableAccountId) {
      setWriteWarning('请先在右上角选择具体账户，再进行录入或导入提交。');
      return;
    }
    try {
      setWriteWarning(null);
      setCsvCommitting(true);
      const committed = await portfolioApi.commitCsvImport(writableAccountId, selectedBroker, csvFile, csvDryRun);
      setCsvCommitResult(committed);
      if (!csvDryRun) {
        await refreshPortfolioData();
      }
    } catch (err) {
      setError(getParsedApiError(err));
    } finally {
      setCsvCommitting(false);
    }
  };

  const openDeleteDialog = (item: PendingDelete) => {
    if (!writableAccountId) {
      setWriteWarning('请先在右上角选择具体账户，再进行删除修正。');
      return;
    }
    setPendingDelete(item);
  };

  const openAccountDeleteDialog = () => {
    if (!writableAccount) {
      setWriteWarning('请先选择具体账户，再删除持仓账户。');
      return;
    }
    setPendingAccountDelete({
      accountId: writableAccount.id,
      accountName: writableAccount.name,
    });
  };

  const handleConfirmAccountDelete = async () => {
    if (!pendingAccountDelete || accountDeleteLoading) return;

    try {
      setAccountDeleteLoading(true);
      setWriteWarning(null);
      await portfolioApi.deleteAccount(pendingAccountDelete.accountId);
      const nextAccount = accounts.find((item) => item.id !== pendingAccountDelete.accountId);
      setSelectedAccount(nextAccount?.id ?? 'all');
      setPendingAccountDelete(null);
      setShowCreateAccount(!nextAccount);
      await loadAccounts();
      setEventPage(1);
    } catch (err) {
      setError(getParsedApiError(err));
    } finally {
      setAccountDeleteLoading(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete || deleteLoading) return;
    if (!writableAccountId) {
      setWriteWarning('请先在右上角选择具体账户，再进行删除修正。');
      setPendingDelete(null);
      return;
    }

    const nextPage = currentEventCount === 1 && eventPage > 1 ? eventPage - 1 : eventPage;
    try {
      setDeleteLoading(true);
      setWriteWarning(null);
      if (pendingDelete.eventType === 'trade') {
        await portfolioApi.deleteTrade(pendingDelete.id);
      } else if (pendingDelete.eventType === 'cash') {
        await portfolioApi.deleteCashLedger(pendingDelete.id);
      } else {
        await portfolioApi.deleteCorporateAction(pendingDelete.id);
      }
      setPendingDelete(null);
      if (nextPage !== eventPage) {
        setEventPage(nextPage);
      }
      await refreshPortfolioData(nextPage);
      setFinanceCalendarRefreshKey((current) => current + 1);
    } catch (err) {
      setError(getParsedApiError(err));
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = accountForm.name.trim();
    if (!name) {
      setAccountCreateError('账户名称不能为空。');
      setAccountCreateSuccess(null);
      return;
    }
    try {
      setAccountCreating(true);
      setAccountCreateError(null);
      setAccountCreateSuccess(null);
      const created = await portfolioApi.createAccount({
        name,
        broker: accountForm.broker.trim() || undefined,
        market: accountForm.market,
        baseCurrency: accountForm.baseCurrency.trim() || 'CNY',
      });
      await loadAccounts();
      setSelectedAccount(created.id);
      setShowCreateAccount(false);
      setWriteWarning(null);
      setAccountForm({
        name: '',
        broker: 'Demo',
        market: accountForm.market,
        baseCurrency: accountForm.baseCurrency,
      });
      setAccountCreateSuccess('账户创建成功，已自动切换到该账户。');
    } catch (err) {
      const parsed = getParsedApiError(err);
      setAccountCreateError(parsed.message || '创建账户失败，请稍后重试。');
      setAccountCreateSuccess(null);
    } finally {
      setAccountCreating(false);
    }
  };

  const handleRefresh = async () => {
    await Promise.all([loadAccounts(), loadSnapshotAndRisk(), loadEvents(), loadBrokers()]);
    setPortfolioSignalsRefreshKey((current) => current + 1);
    setFinanceCalendarRefreshKey((current) => current + 1);
  };

  const reloadSnapshotAndRiskForScope = useCallback(async (
    requestedViewKey: string,
    requestedRequestId: number,
    requestedAccountId: number | undefined,
    requestedCostMethod: PortfolioCostMethod,
  ): Promise<boolean> => {
    if (!isActiveRefreshContext(requestedViewKey, requestedRequestId)) {
      return false;
    }

    setRiskWarning(null);

    try {
      const snapshotData = await portfolioApi.getSnapshot({
        accountId: requestedAccountId,
        costMethod: requestedCostMethod,
        includeRealtime: false,
      });
      if (!isActiveRefreshContext(requestedViewKey, requestedRequestId)) {
        return false;
      }
      setSnapshot(snapshotData);
      setError(null);

      try {
        const riskData = await portfolioApi.getRisk({
          accountId: requestedAccountId,
          costMethod: requestedCostMethod,
          includeRealtime: false,
        });
        if (!isActiveRefreshContext(requestedViewKey, requestedRequestId)) {
          return false;
        }
        setRisk(riskData);
        setRiskWarning(null);
      } catch (riskErr) {
        if (!isActiveRefreshContext(requestedViewKey, requestedRequestId)) {
          return false;
        }
        setRisk(null);
        const parsed = getParsedApiError(riskErr);
        setRiskWarning(parsed.message || '风险数据获取失败，已降级为仅展示快照数据。');
      }
      return true;
    } catch (err) {
      if (!isActiveRefreshContext(requestedViewKey, requestedRequestId)) {
        return false;
      }
      setSnapshot(null);
      setRisk(null);
      setError(getParsedApiError(err));
      return false;
    }
  }, []);

  const handleRefreshFx = async () => {
    if (!hasAccounts || isLoading || fxRefreshing) {
      return;
    }

    const requestedViewKey = refreshViewKey;
    const requestedAccountId = queryAccountId;
    const requestedCostMethod = costMethod;
    const requestedRequestId = refreshContextRef.current.requestId + 1;
    refreshContextRef.current = {
      viewKey: requestedViewKey,
      requestId: requestedRequestId,
    };

    try {
      setFxRefreshing(true);
      setFxRefreshFeedback(null);
      const result = await portfolioApi.refreshFx({
        accountId: requestedAccountId,
      });
      if (!isActiveRefreshContext(requestedViewKey, requestedRequestId)) {
        return;
      }
      const reloaded = await reloadSnapshotAndRiskForScope(
        requestedViewKey,
        requestedRequestId,
        requestedAccountId,
        requestedCostMethod,
      );
      if (!reloaded || !isActiveRefreshContext(requestedViewKey, requestedRequestId)) {
        return;
      }
      setFxRefreshFeedback(buildFxRefreshFeedback(result));
    } catch (err) {
      if (!isActiveRefreshContext(requestedViewKey, requestedRequestId)) {
        return;
      }
      setError(getParsedApiError(err));
    } finally {
      if (isActiveRefreshContext(requestedViewKey, requestedRequestId)) {
        setFxRefreshing(false);
      }
    }
  };

  const decisionSignalRiskPreviewItems = (risk?.decisionSignalRisk?.items ?? []).slice(0, 3);
  const formatDecisionSignalRiskAction = (signal: Partial<DecisionSignalItem>): string => (
    getDecisionActionLabel(
      signal.action,
      signal.actionLabel,
      null,
      text.alert,
      decisionActionLabels,
    ) ?? text.alert
  );
  const snapshotQualityMessage = snapshot?.dataQuality === 'partial' && snapshot.limitations?.length
    ? snapshot.limitations
      .map((limitation) => formatPortfolioLimitation(limitation, language))
      .join(language === 'en' ? '; ' : '；')
    : null;

  return (
    <div className="portfolio-page min-h-screen space-y-4 p-4 md:p-6">
      <section className="space-y-3">
        <div className="space-y-2">
          <h1 className="text-xl md:text-2xl font-semibold text-foreground">{text.title}</h1>
          <p className="text-xs md:text-sm text-secondary">
            {text.description}
          </p>
        </div>
        {hasAccounts ? (
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_220px_280px] gap-2 items-end">
              <div>
                <p className="text-xs text-secondary mb-1">{text.accountView}</p>
                <select
                  value={String(selectedAccount)}
                  onChange={(e) => setSelectedAccount(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                  className={PORTFOLIO_SELECT_CLASS}
                >
                  <option value="all">{text.allAccounts}</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name} (#{account.id})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <p className="text-xs text-secondary mb-1">{text.costMethod}</p>
                <select
                  value={costMethod}
                  onChange={(e) => setCostMethod(e.target.value as PortfolioCostMethod)}
                  className={PORTFOLIO_SELECT_CLASS}
                >
                  <option value="fifo">{text.fifo}</option>
                  <option value="avg">{text.avg}</option>
                </select>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-secondary text-sm flex-1"
                  onClick={() => {
                    setShowCreateAccount((prev) => !prev);
                    setAccountCreateError(null);
                    setAccountCreateSuccess(null);
                  }}
                >
                  {showCreateAccount ? text.collapseCreate : text.createAccount}
                </button>
                <button
                  type="button"
                  onClick={() => void handleRefresh()}
                  disabled={isLoading || fxRefreshing}
                  className="btn-secondary text-sm flex-1"
                >
                  {isLoading ? text.refreshing : text.refreshData}
                </button>
                <button
                  type="button"
                  onClick={openAccountDeleteDialog}
                  disabled={!canDeleteSelectedAccount}
                  className="btn-secondary text-sm flex-1 border-red-400/40 text-red-100 hover:bg-red-500/15 disabled:border-white/10 disabled:text-secondary"
                >
                  {accountDeleteLoading ? text.deletingAccount : text.deleteAccount}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <InlineAlert
            variant="warning"
            className="inline-block rounded-lg px-3 py-2 text-xs shadow-none"
            message={text.noAccounts}
          />
        )}
      </section>

      {error ? <ApiErrorAlert error={error} onDismiss={() => setError(null)} /> : null}
      {riskWarning ? (
        <InlineAlert
          variant="warning"
          title={text.riskDegraded}
          message={riskWarning}
        />
      ) : null}
      {writeWarning ? (
        <InlineAlert
          variant="warning"
          title={text.operationHint}
          message={writeWarning}
        />
      ) : null}
      {positionAnalysisMessage ? (
        <InlineAlert
          variant="success"
          title={text.analysisTask}
          message={positionAnalysisMessage}
        />
      ) : null}

      {(showCreateAccount || !hasAccounts) ? (
        <Card padding="md">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-foreground">新建账户</h2>
            {hasAccounts ? (
              <button
                type="button"
                className="btn-secondary text-xs px-3 py-1"
                onClick={() => {
                  setShowCreateAccount(false);
                  setAccountCreateError(null);
                  setAccountCreateSuccess(null);
                }}
              >
                收起
              </button>
            ) : (
              <span className="text-xs text-secondary">创建后自动切换到该账户</span>
            )}
          </div>
          {accountCreateError ? (
            <InlineAlert
              variant="danger"
              className="mt-2 rounded-lg px-2 py-1 text-xs shadow-none"
              title="创建账户失败"
              message={accountCreateError}
            />
          ) : null}
          {accountCreateSuccess ? (
            <InlineAlert
              variant="success"
              className="mt-2 rounded-lg px-2 py-1 text-xs shadow-none"
              title="创建账户成功"
              message={accountCreateSuccess}
            />
          ) : null}
          <form className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2" onSubmit={handleCreateAccount}>
            <input
              className={`${PORTFOLIO_INPUT_CLASS} md:col-span-2`}
              placeholder="账户名称（必填）"
              value={accountForm.name}
              onChange={(e) => setAccountForm((prev) => ({ ...prev, name: e.target.value }))}
            />
            <input
              className={PORTFOLIO_INPUT_CLASS}
              placeholder="券商（可选，如 Demo/华泰）"
              value={accountForm.broker}
              onChange={(e) => setAccountForm((prev) => ({ ...prev, broker: e.target.value }))}
            />
            <input
              className={PORTFOLIO_INPUT_CLASS}
              placeholder="基准币（如 CNY/USD/HKD）"
              value={accountForm.baseCurrency}
              onChange={(e) => setAccountForm((prev) => ({ ...prev, baseCurrency: e.target.value.toUpperCase() }))}
            />
            <select
              className={PORTFOLIO_SELECT_CLASS}
              value={accountForm.market}
              onChange={(e) => setAccountForm((prev) => ({ ...prev, market: e.target.value as PortfolioAccountMarket }))}
            >
              <option value="cn">市场：A 股（cn）</option>
              <option value="hk">市场：港股（hk）</option>
              <option value="us">市场：美股（us）</option>
              <option value="jp">市场：日股（jp）</option>
              <option value="kr">市场：韩股（kr）</option>
              <option value="tw">市场：台股（tw）</option>
            </select>
            <button type="submit" className="btn-secondary text-sm" disabled={accountCreating}>
              {accountCreating ? '创建中...' : '创建账户'}
            </button>
          </form>
        </Card>
      ) : null}

      {snapshotQualityMessage ? (
        <InlineAlert
          variant="warning"
          title={text.snapshotPartialTitle}
          message={snapshotQualityMessage}
          className="rounded-xl px-3 py-2 text-xs shadow-none"
        />
      ) : null}

      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        <Card variant="gradient" padding="md">
          <p className="text-xs text-secondary">{text.totalEquity}</p>
          <p className="mt-1 text-xl font-semibold text-foreground">{formatMoney(snapshot?.totalEquity, snapshot?.currency || 'CNY')}</p>
        </Card>
        <Card variant="gradient" padding="md">
          <p className="text-xs text-secondary">{text.totalMarketValue}</p>
          <p className="mt-1 text-xl font-semibold text-foreground">{formatMoney(snapshot?.totalMarketValue, snapshot?.currency || 'CNY')}</p>
        </Card>
        <Card variant="gradient" padding="md">
          <p className="text-xs text-secondary">{text.totalCash}</p>
          <p className="mt-1 text-xl font-semibold text-foreground">{formatMoney(snapshot?.totalCash, snapshot?.currency || 'CNY')}</p>
        </Card>
        <Card variant="gradient" padding="md">
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs text-secondary">{text.fxStatus}</p>
            <button
              type="button"
              className="btn-secondary !px-3 !py-1 !text-xs shrink-0"
              onClick={() => void handleRefreshFx()}
              disabled={!hasAccounts || isLoading || fxRefreshing}
            >
              {fxRefreshing ? text.refreshing : text.refreshFx}
            </button>
          </div>
          <div className="mt-2">{snapshot?.fxStale ? <Badge variant="warning">{text.stale}</Badge> : <Badge variant="success">{text.latest}</Badge>}</div>
          {fxRefreshFeedback ? (
            <InlineAlert
              variant={getFxRefreshFeedbackVariant(fxRefreshFeedback.tone)}
              title={text.fxRefreshResult}
              message={fxRefreshFeedback.text}
              className="mt-3 rounded-xl px-3 py-2 text-xs shadow-none"
            />
          ) : null}
        </Card>
      </section>

      <PortfolioFinanceCalendar
        items={financeCalendarItems}
        stats={financeCalendarStats}
        text={financeCalendarText}
        loading={financeCalendarLoading}
        warning={financeCalendarWarning}
        onRefresh={() => setFinanceCalendarRefreshKey((current) => current + 1)}
      />

      <section className="grid grid-cols-1 xl:grid-cols-3 gap-3">
        <Card className="xl:col-span-2" padding="md">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-foreground">{text.positionsTitle}</h2>
            <span className="text-xs text-secondary">{formatUiText(text.countItems, { count: positionRows.length })}</span>
          </div>
          {portfolioSignalsWarning ? (
            <InlineAlert
              variant="warning"
              title={t('decisionSignals.portfolioWarningTitle')}
              message={portfolioSignalsWarning}
              className="mb-3 rounded-xl px-3 py-2 text-xs shadow-none"
            />
          ) : null}
          {positionRows.length === 0 ? (
            <EmptyState
              title={text.noPositionsTitle}
              description={text.noPositionsDescription}
              className="border-none bg-transparent px-4 py-8 shadow-none"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-[860px] w-full text-sm">
                <thead className="text-xs text-secondary border-b border-white/10">
                  <tr>
                    <th className="text-left py-2 pr-2">{text.account}</th>
                    <th className="text-left py-2 pr-2">{text.code}</th>
                    <th className="text-right py-2 pr-2">{text.quantity}</th>
                    <th className="text-right py-2 pr-2">{text.avgCost}</th>
                    <th className="text-right py-2 pr-2">{text.lastPrice}</th>
                    <th className="text-right py-2 pr-2">{text.marketValue}</th>
                    <th className="text-right py-2 pr-3">{text.unrealizedPnl}</th>
                    <th className="text-right py-2 pr-3">{text.returnPct}</th>
                    <th className="min-w-[9rem] text-right py-2 pr-3">{t('decisionSignals.portfolioColumn')}</th>
                    <th className="w-20 text-right py-2">{text.action}</th>
                  </tr>
                </thead>
                <tbody>
                  {positionRows.map((row) => {
                    const rowKey = `${row.accountId}-${row.symbol}-${row.market}`;
                    const analyzing = positionAnalysisLoadingKey === rowKey;
                    const signal = signalByPositionKey.get(rowKey);
                    return (
                    <tr key={rowKey} className="border-b border-white/5">
                      <td className="py-2 pr-2 text-secondary">{row.accountName}</td>
                      <td className="py-2 pr-2 font-mono text-foreground">{row.symbol}</td>
                      <td className="py-2 pr-2 text-right">{row.quantity.toFixed(2)}</td>
                      <td className="py-2 pr-2 text-right">{row.avgCost.toFixed(4)}</td>
                      <td className="py-2 pr-2 text-right">
                        <div>{formatPositionPrice(row)}</div>
                        <div className={`text-[11px] ${hasPositionPrice(row) ? 'text-secondary' : 'text-warning'}`}>
                          {getPositionPriceLabel(row)}
                        </div>
                      </td>
                      <td className="py-2 pr-2 text-right">{formatPositionMoney(row.marketValueBase, row)}</td>
                      <td
                        className={`py-2 pr-3 text-right ${
                          hasPositionPrice(row)
                            ? row.unrealizedPnlBase >= 0
                              ? 'text-success'
                              : 'text-danger'
                            : 'text-secondary'
                        }`}
                      >
                        {formatPositionMoney(row.unrealizedPnlBase, row)}
                      </td>
                      <td
                        className={`py-2 pr-3 text-right ${
                          hasPositionPrice(row) && row.unrealizedPnlPct !== null && row.unrealizedPnlPct !== undefined
                            ? row.unrealizedPnlPct >= 0
                              ? 'text-success'
                              : 'text-danger'
                            : 'text-secondary'
                        }`}
                      >
                        {formatSignedPct(row.unrealizedPnlPct)}
                      </td>
                      <td className="py-2 pr-3 text-right align-top">
                        <PortfolioSignalSummary item={signal} loading={portfolioSignalsLoading} />
                      </td>
                      <td className="py-2 text-right">
                        <button
                          type="button"
                          onClick={() => void handleAnalyzePosition(row)}
                          disabled={analyzing}
                          className="btn-secondary px-2 py-1 text-xs disabled:cursor-wait disabled:opacity-60"
                        >
                          {analyzing ? text.submitting : text.analyze}
                        </button>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card padding="md">
          <h2 className="text-sm font-semibold text-foreground mb-3">
            {concentrationMode === 'sector' ? text.sectorConcentration : text.positionConcentrationFallback}
          </h2>
          {concentrationPieData.length > 0 ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={concentrationPieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90}>
                    {concentrationPieData.map((entry, index) => (
                      <Cell key={`cell-${entry.name}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => `${Number(value).toFixed(2)}%`} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState
              title={text.noConcentrationTitle}
              description={text.noConcentrationDescription}
              className="border-none bg-transparent px-4 py-10 shadow-none"
            />
          )}
          <div className="mt-3 text-xs text-secondary space-y-1">
            <div>{text.displayScope}: {concentrationMode === 'sector' ? text.sectorDimension : text.positionDimensionFallback}</div>
            <div>{text.sectorAlert}: {risk?.sectorConcentration?.alert ? text.yes : text.no}</div>
            <div>{text.topWeight}: {formatPct(risk?.sectorConcentration?.topWeightPct ?? risk?.concentration?.topWeightPct)}</div>
          </div>
        </Card>
      </section>

      {writeBlocked && hasAccounts ? (
        <InlineAlert
          variant="warning"
          className="rounded-lg px-3 py-2 text-xs shadow-none"
          message={text.writeBlocked}
        />
      ) : null}

      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        <Card padding="md">
          <h3 className="text-sm font-semibold text-foreground mb-2">{text.drawdownMonitor}</h3>
          <div className="text-xs text-secondary space-y-1">
            <div>{text.maxDrawdown}: {formatPct(risk?.drawdown?.maxDrawdownPct)}</div>
            <div>{text.currentDrawdown}: {formatPct(risk?.drawdown?.currentDrawdownPct)}</div>
            <div>{text.alert}: {risk?.drawdown?.alert ? text.yes : text.no}</div>
          </div>
        </Card>
        <Card padding="md">
          <h3 className="text-sm font-semibold text-foreground mb-2">{text.stopLossWarning}</h3>
          <div className="text-xs text-secondary space-y-1">
            <div>{text.triggeredCount}: {risk?.stopLoss?.triggeredCount ?? 0}</div>
            <div>{text.nearCount}: {risk?.stopLoss?.nearCount ?? 0}</div>
            <div>{text.alert}: {risk?.stopLoss?.nearAlert ? text.yes : text.no}</div>
          </div>
        </Card>
        <Card padding="md">
          <h3 className="text-sm font-semibold text-foreground mb-2">{text.scope}</h3>
          <div className="text-xs text-secondary space-y-1">
            <div>{text.accountCount}: {snapshot?.accountCount ?? 0}</div>
            <div>{text.currency}: {snapshot?.currency || 'CNY'}</div>
            <div>{text.costMethodShort}: {(snapshot?.costMethod || costMethod).toUpperCase()}</div>
          </div>
        </Card>
        <Card padding="md">
          <h3 className="text-sm font-semibold text-foreground mb-2">{text.aiRiskSignals}</h3>
          <div className="text-xs text-secondary space-y-1">
            {risk?.decisionSignalRisk?.available === false ? (
              <div className="text-warning">{text.aiRiskUnavailable}</div>
            ) : (
              <>
                <div>{text.aiRiskTotal}: {risk?.decisionSignalRisk?.total ?? 0}</div>
                <div>
                  {text.sellSignals}: {risk?.decisionSignalRisk?.actions?.sell ?? 0} · {text.reduceSignals}: {risk?.decisionSignalRisk?.actions?.reduce ?? 0} · {text.alertSignals}: {risk?.decisionSignalRisk?.actions?.alert ?? 0}
                </div>
                {decisionSignalRiskPreviewItems.length > 0 ? (
                  <div className="space-y-1 pt-1">
                    {decisionSignalRiskPreviewItems.map((item) => (
                      <div key={`${item.accountId ?? 'all'}-${item.market}-${item.symbol}-${item.signal.id ?? item.signal.action}`} className="truncate text-foreground">
                        {item.symbol} · {formatDecisionSignalRiskAction(item.signal)}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div>{text.noAiRiskSignals}</div>
                )}
              </>
            )}
          </div>
        </Card>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-3 gap-3">
        <Card padding="md">
          <h3 className="text-sm font-semibold text-foreground mb-3">手工录入：交易</h3>
          <form className="space-y-2" onSubmit={handleTradeSubmit}>
            <input className={PORTFOLIO_INPUT_CLASS} placeholder="股票代码（例如 600519）" value={tradeForm.symbol}
              onChange={(e) => setTradeForm((prev) => ({ ...prev, symbol: e.target.value }))} required />
            <div className="grid grid-cols-2 gap-2">
              <input className={PORTFOLIO_INPUT_CLASS} type="date" value={tradeForm.tradeDate}
                onChange={(e) => setTradeForm((prev) => ({ ...prev, tradeDate: e.target.value }))} required />
              <select className={PORTFOLIO_SELECT_CLASS} value={tradeForm.side}
                onChange={(e) => setTradeForm((prev) => ({ ...prev, side: e.target.value as PortfolioSide }))}>
                <option value="buy">买入</option>
                <option value="sell">卖出</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input className={PORTFOLIO_INPUT_CLASS} type="number" min="0" step="0.0001" placeholder="数量（必填）" value={tradeForm.quantity}
                onChange={(e) => setTradeForm((prev) => ({ ...prev, quantity: e.target.value }))} required />
              <input className={PORTFOLIO_INPUT_CLASS} type="number" min="0" step="0.0001" placeholder="成交价（必填）" value={tradeForm.price}
                onChange={(e) => setTradeForm((prev) => ({ ...prev, price: e.target.value }))} required />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input className={PORTFOLIO_INPUT_CLASS} type="number" min="0" step="0.0001" placeholder="手续费（可选）" value={tradeForm.fee}
                onChange={(e) => setTradeForm((prev) => ({ ...prev, fee: e.target.value }))} />
              <input className={PORTFOLIO_INPUT_CLASS} type="number" min="0" step="0.0001" placeholder="税费（可选）" value={tradeForm.tax}
                onChange={(e) => setTradeForm((prev) => ({ ...prev, tax: e.target.value }))} />
            </div>
            <p className="text-xs text-secondary">手续费和税费可留空，系统将按 0 处理。</p>
            <button type="submit" className="btn-secondary w-full" disabled={!writableAccountId}>提交交易</button>
          </form>
        </Card>

        <Card padding="md">
          <h3 className="text-sm font-semibold text-foreground mb-3">手工录入：资金流水</h3>
          <form className="space-y-2" onSubmit={handleCashSubmit}>
            <div className="grid grid-cols-2 gap-2">
              <input className={PORTFOLIO_INPUT_CLASS} type="date" value={cashForm.eventDate}
                onChange={(e) => setCashForm((prev) => ({ ...prev, eventDate: e.target.value }))} required />
              <select className={PORTFOLIO_SELECT_CLASS} value={cashForm.direction}
                onChange={(e) => setCashForm((prev) => ({ ...prev, direction: e.target.value as PortfolioCashDirection }))}>
                <option value="in">流入</option>
                <option value="out">流出</option>
              </select>
            </div>
            <input className={PORTFOLIO_INPUT_CLASS} type="number" min="0" step="0.0001" placeholder="金额"
              value={cashForm.amount} onChange={(e) => setCashForm((prev) => ({ ...prev, amount: e.target.value }))} required />
            <input className={PORTFOLIO_INPUT_CLASS} placeholder={`币种（可选，默认 ${writableAccount?.baseCurrency || '账户基准币'}）`} value={cashForm.currency}
              onChange={(e) => setCashForm((prev) => ({ ...prev, currency: e.target.value }))} />
            <button type="submit" className="btn-secondary w-full" disabled={!writableAccountId}>提交资金流水</button>
          </form>
        </Card>

        <Card padding="md">
          <h3 className="text-sm font-semibold text-foreground mb-3">手工录入：公司行为</h3>
          <form className="space-y-2" onSubmit={handleCorporateSubmit}>
            <input className={PORTFOLIO_INPUT_CLASS} placeholder="股票代码" value={corpForm.symbol}
              onChange={(e) => setCorpForm((prev) => ({ ...prev, symbol: e.target.value }))} required />
            <div className="grid grid-cols-2 gap-2">
              <input className={PORTFOLIO_INPUT_CLASS} type="date" value={corpForm.effectiveDate}
                onChange={(e) => setCorpForm((prev) => ({ ...prev, effectiveDate: e.target.value }))} required />
              <select className={PORTFOLIO_SELECT_CLASS} value={corpForm.actionType}
                onChange={(e) => setCorpForm((prev) => ({ ...prev, actionType: e.target.value as PortfolioCorporateActionType }))}>
                <option value="cash_dividend">现金分红</option>
                <option value="split_adjustment">拆并股调整</option>
              </select>
            </div>
            {corpForm.actionType === 'cash_dividend' ? (
              <input className={PORTFOLIO_INPUT_CLASS} type="number" min="0" step="0.000001" placeholder="每股分红"
                value={corpForm.cashDividendPerShare}
                onChange={(e) => setCorpForm((prev) => ({ ...prev, cashDividendPerShare: e.target.value, splitRatio: '' }))} required />
            ) : (
              <input className={PORTFOLIO_INPUT_CLASS} type="number" min="0" step="0.000001" placeholder="拆并股比例"
                value={corpForm.splitRatio}
                onChange={(e) => setCorpForm((prev) => ({ ...prev, splitRatio: e.target.value, cashDividendPerShare: '' }))} required />
            )}
            <button type="submit" className="btn-secondary w-full" disabled={!writableAccountId}>提交企业行为</button>
          </form>
        </Card>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <Card padding="md">
          <h3 className="text-sm font-semibold text-foreground mb-3">券商 CSV 导入</h3>
          <div className="space-y-2">
            {brokerLoadWarning ? (
              <InlineAlert
                variant="warning"
                className="rounded-lg px-2 py-1 text-xs shadow-none"
                message={brokerLoadWarning}
              />
            ) : null}
            <div className="grid grid-cols-2 gap-2">
              <select className={PORTFOLIO_SELECT_CLASS} value={selectedBroker} onChange={(e) => setSelectedBroker(e.target.value)}>
                {brokers.length > 0 ? (
                  brokers.map((item) => <option key={item.broker} value={item.broker}>{formatBrokerLabel(item.broker, item.displayName)}</option>)
                ) : (
                  <option value="huatai">huatai（华泰）</option>
                )}
              </select>
              <label className={PORTFOLIO_FILE_PICKER_CLASS}>
                选择 CSV
                <input type="file" accept=".csv" className="hidden"
                  onChange={(e) => setCsvFile(e.target.files && e.target.files[0] ? e.target.files[0] : null)} />
              </label>
            </div>
            <div className="flex items-center gap-2 text-xs text-secondary">
              <input id="csv-dry-run" type="checkbox" checked={csvDryRun} onChange={(e) => setCsvDryRun(e.target.checked)} />
              <label htmlFor="csv-dry-run">仅预演（不写入）</label>
            </div>
            <div className="flex gap-2">
              <button type="button" className="btn-secondary flex-1" disabled={!csvFile || csvParsing} onClick={() => void handleParseCsv()}>
                {csvParsing ? '解析中...' : '解析文件'}
              </button>
              <button type="button" className="btn-secondary flex-1"
                disabled={!csvFile || !writableAccountId || csvCommitting} onClick={() => void handleCommitCsv()}>
                {csvCommitting ? '提交中...' : '提交导入'}
              </button>
            </div>
            {csvParseResult ? (
              <InlineAlert
                variant={getCsvParseVariant(csvParseResult)}
                title="CSV 解析结果"
                message={`有效 ${csvParseResult.recordCount} 条，跳过 ${csvParseResult.skippedCount} 条，错误 ${csvParseResult.errorCount} 条。`}
                className="rounded-lg px-3 py-2 text-xs shadow-none"
              />
            ) : null}
            {csvCommitResult ? (
              <InlineAlert
                variant={getCsvCommitVariant(csvCommitResult, csvDryRun)}
                title={csvDryRun ? 'CSV 预演结果' : 'CSV 提交结果'}
                message={`${csvDryRun ? '预演检查' : '实际写入'}：写入 ${csvCommitResult.insertedCount} 条，重复 ${csvCommitResult.duplicateCount} 条，失败 ${csvCommitResult.failedCount} 条。`}
                className="rounded-lg px-3 py-2 text-xs shadow-none"
              />
            ) : null}
          </div>
        </Card>

        <Card padding="md">
          <h3 className="text-sm font-semibold text-foreground mb-3">事件记录</h3>
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <select className={PORTFOLIO_SELECT_CLASS} value={eventType} onChange={(e) => setEventType(e.target.value as EventType)}>
                <option value="trade">交易流水</option>
                <option value="cash">资金流水</option>
                <option value="corporate">公司行为</option>
              </select>
              <button type="button" className="btn-secondary text-sm" onClick={() => void loadEvents()} disabled={eventLoading}>
                {eventLoading ? '加载中...' : '刷新流水'}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input className={PORTFOLIO_INPUT_CLASS} type="date" value={eventDateFrom} onChange={(e) => setEventDateFrom(e.target.value)} />
              <input className={PORTFOLIO_INPUT_CLASS} type="date" value={eventDateTo} onChange={(e) => setEventDateTo(e.target.value)} />
            </div>
            {(eventType === 'trade' || eventType === 'corporate') ? (
              <input className={PORTFOLIO_INPUT_CLASS} placeholder="按股票代码筛选" value={eventSymbol}
                onChange={(e) => setEventSymbol(e.target.value)} />
            ) : null}
            {eventType === 'trade' ? (
              <select className={PORTFOLIO_SELECT_CLASS} value={eventSide} onChange={(e) => setEventSide(e.target.value as '' | PortfolioSide)}>
                <option value="">全部买卖方向</option>
                <option value="buy">买入</option>
                <option value="sell">卖出</option>
              </select>
            ) : null}
            {eventType === 'cash' ? (
              <select className={PORTFOLIO_SELECT_CLASS} value={eventDirection}
                onChange={(e) => setEventDirection(e.target.value as '' | PortfolioCashDirection)}>
                <option value="">全部资金方向</option>
                <option value="in">流入</option>
                <option value="out">流出</option>
              </select>
            ) : null}
            {eventType === 'corporate' ? (
              <select className={PORTFOLIO_SELECT_CLASS} value={eventActionType}
                onChange={(e) => setEventActionType(e.target.value as '' | PortfolioCorporateActionType)}>
                <option value="">全部公司行为</option>
                <option value="cash_dividend">现金分红</option>
                <option value="split_adjustment">拆并股调整</option>
              </select>
            ) : null}
            <div className="text-[11px] text-secondary">
              {writeBlocked ? '删除修正仅在单账户视图可用。请先选择具体账户后再删除错误流水。' : '如有错误流水，可直接删除后重新录入。'}
            </div>
            <div className="max-h-64 overflow-auto rounded-lg border border-white/10 p-2">
              {eventType === 'trade' && tradeEvents.map((item) => (
                <div key={`t-${item.id}`} className="flex items-start justify-between gap-3 border-b border-white/5 py-2 text-xs text-secondary">
                  <div className="min-w-0">
                    {item.tradeDate} {formatSideLabel(item.side)} {item.symbol} 数量={item.quantity} 价格={item.price}
                  </div>
                  {!writeBlocked ? (
                    <button
                      type="button"
                      className="btn-secondary shrink-0 !px-3 !py-1 !text-[11px]"
                      onClick={() => openDeleteDialog({
                        eventType: 'trade',
                        id: item.id,
                        message: `确认删除 ${item.tradeDate} 的${formatSideLabel(item.side)}流水 ${item.symbol}（数量 ${item.quantity}，价格 ${item.price}）吗？`,
                      })}
                    >
                      删除
                    </button>
                  ) : null}
                </div>
              ))}
              {eventType === 'cash' && cashEvents.map((item) => (
                <div key={`c-${item.id}`} className="flex items-start justify-between gap-3 border-b border-white/5 py-2 text-xs text-secondary">
                  <div className="min-w-0">
                    {item.eventDate} {formatCashDirectionLabel(item.direction)} {item.amount} {item.currency}
                  </div>
                  {!writeBlocked ? (
                    <button
                      type="button"
                      className="btn-secondary shrink-0 !px-3 !py-1 !text-[11px]"
                      onClick={() => openDeleteDialog({
                        eventType: 'cash',
                        id: item.id,
                        message: `确认删除 ${item.eventDate} 的资金流水（${formatCashDirectionLabel(item.direction)} ${item.amount} ${item.currency}）吗？`,
                      })}
                    >
                      删除
                    </button>
                  ) : null}
                </div>
              ))}
              {eventType === 'corporate' && corporateEvents.map((item) => (
                <div key={`ca-${item.id}`} className="flex items-start justify-between gap-3 border-b border-white/5 py-2 text-xs text-secondary">
                  <div className="min-w-0">
                    {item.effectiveDate} {formatCorporateActionLabel(item.actionType)} {item.symbol}
                  </div>
                  {!writeBlocked ? (
                    <button
                      type="button"
                      className="btn-secondary shrink-0 !px-3 !py-1 !text-[11px]"
                      onClick={() => openDeleteDialog({
                        eventType: 'corporate',
                        id: item.id,
                        message: `确认删除 ${item.effectiveDate} 的公司行为 ${formatCorporateActionLabel(item.actionType)}（${item.symbol}）吗？`,
                      })}
                    >
                      删除
                    </button>
                  ) : null}
                </div>
              ))}
              {!eventLoading
                && ((eventType === 'trade' && tradeEvents.length === 0)
                  || (eventType === 'cash' && cashEvents.length === 0)
                  || (eventType === 'corporate' && corporateEvents.length === 0)) ? (
                    <EmptyState
                      title="暂无流水"
                      description="调整筛选条件或先录入一笔交易、资金流水或公司行为。"
                      className="border-none bg-transparent px-3 py-6 shadow-none"
                    />
                  ) : null}
            </div>
            <div className="flex items-center justify-between text-xs text-secondary">
              <span>第 {eventPage} / {totalEventPages} 页</span>
              <div className="flex gap-2">
                <button type="button" className="btn-secondary text-xs px-3 py-1" disabled={eventPage <= 1}
                  onClick={() => setEventPage((prev) => Math.max(1, prev - 1))}>
                  上一页
                </button>
                <button type="button" className="btn-secondary text-xs px-3 py-1" disabled={eventPage >= totalEventPages}
                  onClick={() => setEventPage((prev) => Math.min(totalEventPages, prev + 1))}>
                  下一页
                </button>
              </div>
            </div>
          </div>
        </Card>
      </section>
      <ConfirmDialog
        isOpen={Boolean(pendingDelete)}
        title="删除错误流水"
        message={pendingDelete?.message || '确认删除这条流水吗？'}
        confirmText={deleteLoading ? '删除中...' : '确认删除'}
        cancelText="取消"
        isDanger
        onConfirm={() => void handleConfirmDelete()}
        onCancel={() => {
          if (!deleteLoading) {
            setPendingDelete(null);
          }
        }}
      />
      <ConfirmDialog
        isOpen={Boolean(pendingAccountDelete)}
        title={text.deleteAccountTitle}
        message={
          pendingAccountDelete
            ? formatUiText(text.deleteAccountMessage, {
              name: pendingAccountDelete.accountName,
              id: pendingAccountDelete.accountId,
            })
            : ''
        }
        confirmText={accountDeleteLoading ? text.deletingAccount : text.deleteAccountConfirm}
        isDanger
        onConfirm={() => void handleConfirmAccountDelete()}
        onCancel={() => {
          if (!accountDeleteLoading) {
            setPendingAccountDelete(null);
          }
        }}
      />
    </div>
  );
};

export default PortfolioPage;
