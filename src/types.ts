export type ComponentStatus = 'draft' | 'review' | 'published';
export type PreviewTheme = 'light' | 'dark';
export type PreviewDensity = 'compact' | 'regular' | 'spacious';

export interface PropertySpec {
  id: string;
  name: string;
  type: string;
  required: boolean;
  defaultValue: string;
  description: string;
}

export interface ComponentExample {
  id: string;
  title: string;
  code: string;
  propertyIds: string[];
  stale: boolean;
  staleReason: string;
  createdFromRevision: number;
}

export interface ComponentSpec {
  id: string;
  name: string;
  category: string;
  status: ComponentStatus;
  purpose: string;
  usage: string;
  properties: PropertySpec[];
  states: string;
  keyboardBehavior: string;
  screenReader: string;
  disabledScenarios: string;
  interactionSignature: string;
  examples: ComponentExample[];
  revision: number;
  updatedAt: string;
  snapshots: ComponentSnapshot[];
}

export interface ComponentSnapshot {
  revision: number;
  savedAt: string;
  reason: string;
  component: Omit<ComponentSpec, 'snapshots'>;
}

export interface WorkspaceState {
  components: ComponentSpec[];
  selectedId: string;
}

export interface ValidationIssue {
  id: string;
  level: 'error' | 'warning' | 'info';
  componentId: string;
  target: string;
  message: string;
  field: 'properties' | 'examples' | 'keyboard' | 'screenReader';
}

export interface DiffRow {
  field: string;
  before: string;
  after: string;
}

export type PropertyDiffKind = 'left-only' | 'right-only' | 'contract-diff' | 'aligned';

export interface PropertyDiffRow {
  kind: PropertyDiffKind;
  name: string;
  left?: PropertySpec;
  right?: PropertySpec;
  typeDiffer: boolean;
  requiredDiffer: boolean;
  descriptionDiffer: boolean;
  defaultDiffer: boolean;
}

export type CopyDirection = 'left-to-right' | 'right-to-left';

export interface CopyConflict {
  name: string;
  direction: CopyDirection;
  sourceComponentId: string;
  targetComponentId: string;
  source: PropertySpec;
  target: PropertySpec;
  detail: string;
}

export type CopyOutcome =
  | { ok: true; propertyName: string; mode: 'added' | 'updated'; staleCount: number; targetRevision: number }
  | { ok: false; propertyName: string; targetRevision: number; reason: string; conflict?: CopyConflict };

export interface BulkCopyOutcome {
  copied: string[];
  staleCount: number;
  targetRevision: number;
  conflict?: CopyConflict;
}
