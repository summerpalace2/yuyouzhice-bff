/**
 * 渝游智策（Yuyouzhice）前端 TypeScript 领域契约定义
 * 严格与 Java Spring AI 后端及 Node Web BFF 契约保持 100% 对齐
 */

export type RoutePreference = 'walking' | 'transit' | 'driving';

export interface GeoCoordinate {
  longitude: number;
  latitude: number;
}

export interface Citation {
  title: string;
  endpoint: string;
  note?: string;
  confidence?: number;
}

export interface MapContext {
  coordinates: [number, number]; // [经度, 纬度]
  address: string;
  district: string;
  recommendedTransport: string;
  polyline?: Array<[number, number]>;
}

export interface FactItem {
  label: string;
  value: string;
  status: '确定' | '未知' | '动态' | '冲突' | string;
  note?: string;
}

export interface Stop {
  id: string;
  venueId: string;
  name: string;
  durationMinutes: number;
  arrivalTime: string;
  departureTime: string;
  routePreference: RoutePreference;
  recommendationReason: string;
  mapContext: MapContext;
  citations: Citation[];
  image?: string;
  imageStatus?: 'READY' | 'DEGRADED' | 'FALLBACK';
  imageReason?: string;
  imageSource?: string;
}

export interface DayRoute {
  day: number;
  date: string;
  weatherSummary?: string;
  theme?: string;
  totalDistanceMeters: number;
  totalDurationMinutes: number;
  stops: Stop[];
  polyline?: Array<[number, number]>;
}

export interface TripConstraints {
  duration?: string;
  companions?: string;
  pace?: string;
  stayArea?: string;
  transportPreference?: string;
  dietPreference?: string;
  themes?: string[];
  [key: string]: unknown;
}

export interface QualityMetrics {
  constraintSatisfaction?: {
    score: number;
    satisfied: string[];
    violated: string[];
  };
  unknownFactCount?: number;
  dataCoverage?: {
    overall: number;
    weather?: number;
    poi?: number;
    routes?: number;
  };
  avgConstraintSatisfaction?: number | null;
  available?: boolean;
}

export interface SourceStatus {
  citationCoverage: number;
  mode: 'VECTOR_HYBRID' | 'FALLBACK_LOCAL' | string;
}

export interface TripPlan {
  id?: string;
  sessionId: string;
  version: number;
  title?: string;
  summary?: string;
  prompt: string;
  constraints: TripConstraints;
  planContext?: {
    startingArea: string;
    routePreference: string;
    foodGuidance?: string;
  };
  sourceStatus?: SourceStatus;
  retrieval?: {
    mode: string;
    query?: string;
    topMatches?: number;
  };
  qualityMetrics?: QualityMetrics;
  days: DayRoute[];
}

export interface UserPreferences {
  duration: string;
  companions: string;
  pace: string;
  transport: string;
  dining: Set<string> | string[];
  themes: Set<string> | string[];
}

export interface User {
  id: string;
  username: string;
  email?: string;
  role: 'user' | 'admin';
  deviceCount?: number;
  preferences?: UserPreferences;
  createdAt?: string;
}

export interface ChatProposalCandidate {
  venueId: string;
  name: string;
  targetDay: number;
  targetStopId: string;
}

export interface ChatProposal {
  proposalId?: string;
  id?: string;
  type: 'REPLACE_STOP' | 'ADJUST_TIME' | 'CHANGE_ROUTE' | string;
  description: string;
  summary?: string;
  candidate?: ChatProposalCandidate;
  requiresConfirmation: boolean;
  options?: Array<{ id: string; title: string; desc: string }>;
}

export interface ChatMeta {
  model?: string;
  reasoningDurationMs?: number;
  citations?: Citation[];
  retrievalMode?: string;
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant' | 'system';
  content: string;
  meta?: ChatMeta;
  proposal?: ChatProposal;
  timestamp: number;
}

export interface AmapConfig {
  key?: string;
  securityJsCode?: string;
  keyConfigured: boolean;
  mode: string;
}

export interface KnowledgeDocument {
  id: string;
  title: string;
  topic: string;
  content: string;
  source: string;
  verifiedAt: string;
  tags?: string[];
}

export interface AdminOverview {
  serverStatus: string;
  activeSessions: number;
  totalTripsSaved: number;
  qualityMetrics?: QualityMetrics;
  feedbackSummary?: {
    total: number;
    helpful: number;
    needsWork: number;
    byReason: Record<string, number>;
    byVersion: Record<string, number>;
  };
  knowledgeCorpus?: {
    documentCount: number;
    lastVectorSyncedAt?: string;
  };
}
