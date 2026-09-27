import type { ComponentSpec, PropertySpec } from './types';

export type CompareKind = 'only-left' | 'only-right' | 'contract-diff' | 'same-contract';

export interface PropertyComparison {
  name: string;
  kind: CompareKind;
  left?: PropertySpec;
  right?: PropertySpec;
  /** 契约（类型 / 必填）差异说明，仅 contract-diff 时有内容。 */
  contractDiffs: string[];
  /** 契约一致但内容（描述 / 默认值）不同的字段名，仅 same-contract 时有内容。 */
  contentDiffs: string[];
}

export const sameContract = (a: PropertySpec, b: PropertySpec): boolean =>
  a.type.trim() === b.type.trim() && a.required === b.required;

const formatContract = (property: PropertySpec): string =>
  `${property.type.trim() || '（空类型）'} / ${property.required ? '必填' : '可选'}`;

export const describeContract = formatContract;

/**
 * 按属性名对齐两个组件的属性契约：
 * - 仅一侧存在 → only-left / only-right（一方新增、一方缺失）
 * - 同名但类型或必填不同 → contract-diff
 * - 同名且契约一致 → same-contract（描述 / 默认值可能仍有差异）
 */
export function compareProperties(left: ComponentSpec, right: ComponentSpec): PropertyComparison[] {
  const rows: PropertyComparison[] = [];
  const rightByName = new Map(right.properties.map((item) => [item.name.trim(), item]));
  const matched = new Set<string>();

  for (const property of left.properties) {
    const key = property.name.trim();
    matched.add(key);
    const counterpart = rightByName.get(key);
    if (!counterpart) {
      rows.push({ name: property.name, kind: 'only-left', left: property, contractDiffs: [], contentDiffs: [] });
      continue;
    }
    if (!sameContract(property, counterpart)) {
      const contractDiffs: string[] = [];
      if (property.type.trim() !== counterpart.type.trim()) {
        contractDiffs.push(`类型：${property.type.trim() || '（空）'} ↔ ${counterpart.type.trim() || '（空）'}`);
      }
      if (property.required !== counterpart.required) {
        contractDiffs.push(`必填：${property.required ? '必填' : '可选'} ↔ ${counterpart.required ? '必填' : '可选'}`);
      }
      rows.push({ name: property.name, kind: 'contract-diff', left: property, right: counterpart, contractDiffs, contentDiffs: [] });
      continue;
    }
    const contentDiffs: string[] = [];
    if (property.description !== counterpart.description) contentDiffs.push('描述');
    if (property.defaultValue !== counterpart.defaultValue) contentDiffs.push('默认值');
    rows.push({ name: property.name, kind: 'same-contract', left: property, right: counterpart, contractDiffs: [], contentDiffs });
  }

  for (const property of right.properties) {
    if (!matched.has(property.name.trim())) {
      rows.push({ name: property.name, kind: 'only-right', right: property, contractDiffs: [], contentDiffs: [] });
    }
  }
  return rows;
}
