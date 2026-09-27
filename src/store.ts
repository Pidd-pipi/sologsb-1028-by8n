import { createInitialState } from './data';
import type {
  BulkCopyOutcome,
  ComponentSnapshot,
  ComponentSpec,
  CopyConflict,
  CopyDirection,
  CopyOutcome,
  PropertySpec,
  ValidationIssue,
  WorkspaceState
} from './types';

const STORAGE_KEY = 'sologsb-1028-workspace-v1';

const clone = <T>(value: T): T => structuredClone(value);
const uid = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const signature = (component: ComponentSpec) => `${component.properties.map((item) => `${item.name}:${item.required}`).join('|')}::${component.interactionSignature}`;

/**
 * After a property is copied in from a comparison, examples that reference it
 * (by id at copy time or by name in their code) become pending review.
 * Returns how many examples were newly marked. Snapshots are never touched.
 */
function markExamplesPendingReview(target: ComponentSpec, ...propertyNames: string[]): number {
  const names = new Set(propertyNames.map((name) => name.trim()));
  let staleCount = 0;
  const referencedIds = new Set(
    target.properties.filter((property) => names.has(property.name.trim())).map((property) => property.id)
  );
  for (const example of target.examples) {
    const referencesById = example.propertyIds.some((id) => referencedIds.has(id));
    const referencesByName = [...names].some((name) => example.code.includes(name));
    if (referencesById || referencesByName) {
      if (!example.stale) staleCount += 1;
      example.stale = true;
      example.staleReason = `对照复制了属性 ${[...names].join('、')}，示例引用需要复核。`;
    }
  }
  return staleCount;
}

export class SpecStore extends EventTarget {
  state: WorkspaceState;
  private undoStack: WorkspaceState[] = [];
  private redoStack: WorkspaceState[] = [];
  private lastAction = '';

  constructor() {
    super();
    this.state = this.load();
  }

  get selected(): ComponentSpec | undefined {
    return this.state.components.find((item) => item.id === this.state.selectedId);
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  get lastUndoLabel() { return this.lastAction; }

  select(id: string) {
    if (!this.state.components.some((item) => item.id === id)) return;
    this.state = { ...this.state, selectedId: id };
    this.persist(false);
    this.emit();
  }

  addComponent() {
    const id = uid('component');
    const component: ComponentSpec = {
      id,
      name: 'Untitled component',
      category: 'Uncategorised',
      status: 'draft',
      purpose: '说明该组件解决的用户问题。',
      usage: '说明何时使用、何时不要使用。',
      properties: [],
      states: 'default、hover、focus-visible、disabled。',
      keyboardBehavior: '记录 Tab、Enter、Space、方向键和 Esc 等行为。',
      screenReader: '记录角色、名称、状态和动态播报。',
      disabledScenarios: '记录不应使用该组件的场景。',
      interactionSignature: '',
      examples: [],
      revision: 1,
      updatedAt: new Date().toISOString(),
      snapshots: []
    };
    this.commit('新建组件', (state) => {
      state.components.unshift(component);
      state.selectedId = id;
    });
  }

  updateComponent(patch: Partial<ComponentSpec>, markExamplesStale = false) {
    const selected = this.selected;
    if (!selected) return;
    this.commit('编辑组件', (state) => {
      const target = state.components.find((item) => item.id === selected.id);
      if (!target) return;
      Object.assign(target, patch, { updatedAt: new Date().toISOString() });
      if (markExamplesStale) {
        target.examples.forEach((example) => {
          example.stale = true;
          example.staleReason = '组件交互或属性契约已修改，示例需要重新验证。';
        });
      }
    });
  }

  addProperty() {
    const selected = this.selected;
    if (!selected) return;
    this.commit('新增属性', (state) => {
      state.components.find((item) => item.id === selected.id)?.properties.push({
        id: uid('property'),
        name: 'newProperty',
        type: 'string',
        required: false,
        defaultValue: '',
        description: '描述该属性对开发者和用户的影响。'
      });
    });
  }

  updateProperty(propertyId: string, patch: Partial<ComponentSpec['properties'][number]>) {
    const selected = this.selected;
    if (!selected) return;
    this.commit('编辑属性', (state) => {
      const target = state.components.find((item) => item.id === selected.id);
      const property = target?.properties.find((item) => item.id === propertyId);
      if (target && property) Object.assign(property, patch);
    });
  }

  removeProperty(propertyId: string) {
    const selected = this.selected;
    if (!selected) return;
    this.commit('删除属性', (state) => {
      const target = state.components.find((item) => item.id === selected.id);
      const property = target?.properties.find((item) => item.id === propertyId);
      if (!target || !property) return;
      target.properties = target.properties.filter((item) => item.id !== propertyId);
      target.examples.forEach((example) => {
        if (example.propertyIds.includes(propertyId) || example.code.includes(property.name)) {
          example.stale = true;
          example.staleReason = `属性 ${property.name} 已删除，示例代码或说明仍可能引用它。`;
        }
      });
    });
  }

  addExample() {
    const selected = this.selected;
    if (!selected) return;
    const exampleId = uid('example');
    this.commit('新增示例', (state) => {
      const target = state.components.find((item) => item.id === selected.id);
      if (!target) return;
      target.examples.push({
        id: exampleId,
        title: '新示例',
        code: `<${target.name.toLowerCase().replaceAll(' ', '-')}>示例</${target.name.toLowerCase().replaceAll(' ', '-')}>`,
        propertyIds: [],
        stale: false,
        staleReason: '',
        createdFromRevision: target.revision
      });
    });
  }

  updateExample(exampleId: string, patch: Partial<ComponentSpec['examples'][number]>) {
    const selected = this.selected;
    if (!selected) return;
    this.commit('编辑示例', (state) => {
      const target = state.components.find((item) => item.id === selected.id);
      const example = target?.examples.find((item) => item.id === exampleId);
      if (example) Object.assign(example, patch);
    });
  }

  removeExample(exampleId: string) {
    const selected = this.selected;
    if (!selected) return;
    this.commit('删除示例', (state) => {
      const target = state.components.find((item) => item.id === selected.id);
      if (target) target.examples = target.examples.filter((item) => item.id !== exampleId);
    });
  }

  createSnapshot(reason = '手动版本') {
    const selected = this.selected;
    if (!selected) return;
    this.commit('创建版本快照', (state) => {
      const target = state.components.find((item) => item.id === selected.id);
      if (!target) return;
      const { snapshots: _ignored, ...component } = clone(target);
      const nextRevision = target.revision + 1;
      const snapshot: ComponentSnapshot = {
        revision: target.revision,
        savedAt: new Date().toISOString(),
        reason,
        component: { ...component, revision: target.revision }
      };
      target.snapshots.unshift(snapshot);
      target.snapshots = target.snapshots.slice(0, 12);
      target.revision = nextRevision;
      target.updatedAt = new Date().toISOString();
    });
  }

  migrateExamples() {
    const selected = this.selected;
    if (!selected) return;
    this.commit('迁移示例到当前版本', (state) => {
      const target = state.components.find((item) => item.id === selected.id);
      if (!target) return;
      const currentSignature = signature(target);
      const activePropertyIds = new Set(target.properties.map((item) => item.id));
      target.examples.forEach((example) => {
        example.propertyIds = example.propertyIds.filter((id) => activePropertyIds.has(id));
        example.stale = false;
        example.staleReason = '';
        example.createdFromRevision = target.revision;
      });
      target.interactionSignature = currentSignature.split('::')[1] ?? target.interactionSignature;
      target.revision += 1;
      target.updatedAt = new Date().toISOString();
    });
  }

  copyProperty(sourceComponentId: string, targetComponentId: string, propertyName: string, direction: CopyDirection): CopyOutcome {
    const source = this.state.components.find((item) => item.id === sourceComponentId);
    const target = this.state.components.find((item) => item.id === targetComponentId);
    if (!source || !target) {
      return { ok: false, propertyName, targetRevision: target?.revision ?? 0, reason: '对照的组件不存在，请重新选择。' };
    }
    const sourceProperty = this.findPropertyByName(source, propertyName);
    if (!sourceProperty) {
      return { ok: false, propertyName, targetRevision: target.revision, reason: `源组件上找不到属性 ${propertyName}。` };
    }
    const existing = this.findPropertyByName(target, propertyName);
    if (existing) {
      const conflict = this.buildConflict(sourceProperty, existing, source.id, target.id, direction);
      if (conflict) return { ok: false, propertyName, targetRevision: target.revision, reason: conflict.detail, conflict };
    }

    let outcome: CopyOutcome = { ok: false, propertyName, targetRevision: target.revision, reason: '复制未执行。' };
    this.commit('对照复制属性', (state) => {
      const targetInState = state.components.find((item) => item.id === targetComponentId);
      if (!targetInState) return;
      const counterpart = targetInState.properties.find((item) => item.name.trim() === propertyName.trim());
      if (counterpart) {
        // Same name and an equal contract: sync only the description and default.
        counterpart.description = sourceProperty.description;
        counterpart.defaultValue = sourceProperty.defaultValue;
      } else {
        const added: PropertySpec = { ...structuredClone(sourceProperty), id: uid('property') };
        targetInState.properties.push(added);
      }
      const staleCount = markExamplesPendingReview(targetInState, propertyName);
      targetInState.revision += 1;
      targetInState.updatedAt = new Date().toISOString();
      outcome = {
        ok: true,
        propertyName,
        mode: counterpart ? 'updated' : 'added',
        staleCount,
        targetRevision: targetInState.revision
      };
    });
    return outcome;
  }

  bulkCopyProperties(sourceComponentId: string, targetComponentId: string, propertyNames: string[], direction: CopyDirection): BulkCopyOutcome {
    const source = this.state.components.find((item) => item.id === sourceComponentId);
    const target = this.state.components.find((item) => item.id === targetComponentId);
    if (!source || !target) return { copied: [], staleCount: 0, targetRevision: target?.revision ?? 0 };

    // Pre-flight the whole batch: a single conflicting name aborts everything and changes no state.
    for (const name of propertyNames) {
      const sourceProperty = this.findPropertyByName(source, name);
      const existing = this.findPropertyByName(target, name);
      if (!sourceProperty || !existing) continue;
      const conflict = this.buildConflict(sourceProperty, existing, source.id, target.id, direction);
      if (conflict) return { copied: [], staleCount: 0, targetRevision: target.revision, conflict };
    }

    let result: BulkCopyOutcome = { copied: [], staleCount: 0, targetRevision: target.revision };
    this.commit('对照批量复制属性', (state) => {
      const sourceInState = state.components.find((item) => item.id === sourceComponentId);
      const targetInState = state.components.find((item) => item.id === targetComponentId);
      if (!sourceInState || !targetInState) return;
      const staleNames = new Set<string>();
      for (const name of propertyNames) {
        const sourceProperty = this.findPropertyByName(sourceInState, name);
        if (!sourceProperty) continue;
        const counterpart = this.findPropertyByName(targetInState, name);
        if (counterpart) {
          counterpart.description = sourceProperty.description;
          counterpart.defaultValue = sourceProperty.defaultValue;
        } else {
          targetInState.properties.push({ ...structuredClone(sourceProperty), id: uid('property') });
        }
        staleNames.add(sourceProperty.name.trim());
      }
      const staleCount = markExamplesPendingReview(targetInState, ...staleNames);
      targetInState.revision += 1;
      targetInState.updatedAt = new Date().toISOString();
      result = { copied: [...staleNames], staleCount, targetRevision: targetInState.revision };
    });
    return result;
  }

  private findPropertyByName(component: ComponentSpec, name: string): PropertySpec | undefined {
    return component.properties.find((property) => property.name.trim() === name.trim());
  }

  private buildConflict(
    sourceProperty: PropertySpec,
    targetProperty: PropertySpec,
    sourceComponentId: string,
    targetComponentId: string,
    direction: CopyDirection
  ): CopyConflict | undefined {
    const typeDiffer = sourceProperty.type.trim() !== targetProperty.type.trim();
    const requiredDiffer = sourceProperty.required !== targetProperty.required;
    if (!typeDiffer && !requiredDiffer) return undefined;
    const fragments: string[] = [];
    if (typeDiffer) fragments.push(`类型 ${sourceProperty.type} ↔ ${targetProperty.type}`);
    if (requiredDiffer) fragments.push(`必填 ${sourceProperty.required ? '是' : '否'} ↔ ${targetProperty.required ? '是' : '否'}`);
    return {
      name: sourceProperty.name,
      direction,
      sourceComponentId,
      targetComponentId,
      source: sourceProperty,
      target: targetProperty,
      detail: `同名属性 ${sourceProperty.name} 契约不同：${fragments.join('；')}。已停下，未改动目标组件。`
    };
  }

  validate(): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    for (const component of this.state.components) {
      const names = new Map<string, number>();
      component.properties.forEach((property) => names.set(property.name.trim(), (names.get(property.name.trim()) ?? 0) + 1));
      for (const [name, count] of names) {
        if (name && count > 1) {
          issues.push({ id: `${component.id}-duplicate-${name}`, level: 'error', componentId: component.id, target: component.name, message: `属性名称 ${name} 重复。`, field: 'properties' });
        }
      }
      const contractChanged = component.examples.some((example) => example.createdFromRevision < component.revision);
      component.examples.forEach((example) => {
        const missingReferences = example.propertyIds.filter((id) => !component.properties.some((property) => property.id === id));
        if (example.stale || missingReferences.length) {
          issues.push({ id: `${component.id}-${example.id}-stale`, level: 'warning', componentId: component.id, target: example.title, message: example.staleReason || '示例引用了已删除属性。', field: 'examples' });
        }
        if (!example.code.trim()) {
          issues.push({ id: `${component.id}-${example.id}-empty`, level: 'error', componentId: component.id, target: example.title, message: '示例代码不能为空。', field: 'examples' });
        }
      });
      if (!component.keyboardBehavior.trim()) {
        issues.push({ id: `${component.id}-keyboard`, level: 'error', componentId: component.id, target: component.name, message: '缺少键盘行为说明。', field: 'keyboard' });
      }
      if (!component.screenReader.trim()) {
        issues.push({ id: `${component.id}-screenreader`, level: 'error', componentId: component.id, target: component.name, message: '缺少读屏说明。', field: 'screenReader' });
      }
      if (contractChanged && component.examples.length) {
        issues.push({ id: `${component.id}-contract`, level: 'info', componentId: component.id, target: component.name, message: '属性契约或交互签名发生变化，建议创建快照并迁移示例。', field: 'properties' });
      }
    }
    return issues;
  }

  undo() {
    const previous = this.undoStack.pop();
    if (!previous) return;
    this.redoStack.push(clone(this.state));
    this.state = previous;
    this.persist(false);
    this.emit();
  }

  redo() {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(clone(this.state));
    this.state = next;
    this.persist(false);
    this.emit();
  }

  reset() {
    this.undoStack = [];
    this.redoStack = [];
    this.state = createInitialState();
    this.persist(false);
    this.emit();
  }

  private commit(label: string, mutator: (state: WorkspaceState) => void) {
    const before = clone(this.state);
    const next = clone(this.state);
    mutator(next);
    this.undoStack.push(before);
    this.undoStack = this.undoStack.slice(-40);
    this.redoStack = [];
    this.lastAction = label;
    this.state = next;
    this.persist();
    this.emit();
  }

  private load(): WorkspaceState {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return JSON.parse(saved) as WorkspaceState;
    } catch {
      // A corrupted local draft falls back to the bundled demo data.
    }
    return createInitialState();
  }

  private persist(_notify = true) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
  }

  private emit() {
    this.dispatchEvent(new CustomEvent('change'));
  }
}
