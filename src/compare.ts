import type { ComponentSpec, PropertyDiffRow, PropertySpec } from './types';

const compareFields = ['purpose', 'status', 'keyboardBehavior', 'screenReader'] as const;
export type CompareField = (typeof compareFields)[number];

export const compareFieldLabels: Record<CompareField, string> = {
  purpose: '用途',
  status: '状态',
  keyboardBehavior: '键盘行为',
  screenReader: '读屏说明'
};

export interface FieldComparison {
  field: CompareField;
  label: string;
  left: string;
  right: string;
  differ: boolean;
}

export function compareFieldsSideBySide(left: ComponentSpec, right: ComponentSpec): FieldComparison[] {
  return compareFields.map((field) => {
    const leftValue = String(left[field] ?? '');
    const rightValue = String(right[field] ?? '');
    return { field, label: compareFieldLabels[field], left: leftValue, right: rightValue, differ: leftValue !== rightValue };
  });
}

function normalizeName(name: string): string {
  return name.trim();
}

/**
 * Properties are paired by name. Every pair falls into exactly one bucket:
 * one side only, same name with a different contract (type/required),
 * or an aligned contract (possibly with stale description/default wording).
 */
export function compareProperties(left: ComponentSpec, right: ComponentSpec): PropertyDiffRow[] {
  const rows: PropertyDiffRow[] = [];
  const rightByName = new Map<string, PropertySpec>();
  right.properties.forEach((property) => rightByName.set(normalizeName(property.name), property));
  const pairedRightNames = new Set<string>();

  for (const leftProperty of left.properties) {
    const name = normalizeName(leftProperty.name);
    const rightProperty = rightByName.get(name);
    if (!rightProperty) {
      rows.push({ kind: 'left-only', name, left: leftProperty, typeDiffer: false, requiredDiffer: false, descriptionDiffer: false, defaultDiffer: false });
      continue;
    }
    pairedRightNames.add(name);
    rows.push(buildRow(name, leftProperty, rightProperty));
  }

  for (const rightProperty of right.properties) {
    const name = normalizeName(rightProperty.name);
    if (!pairedRightNames.has(name)) {
      rows.push({ kind: 'right-only', name, right: rightProperty, typeDiffer: false, requiredDiffer: false, descriptionDiffer: false, defaultDiffer: false });
    }
  }
  return rows;
}

function buildRow(name: string, left: PropertySpec, right: PropertySpec): PropertyDiffRow {
  const typeDiffer = left.type.trim() !== right.type.trim();
  const requiredDiffer = left.required !== right.required;
  return {
    name,
    left,
    right,
    kind: typeDiffer || requiredDiffer ? 'contract-diff' : 'aligned',
    typeDiffer,
    requiredDiffer,
    descriptionDiffer: left.description !== right.description,
    defaultDiffer: left.defaultValue !== right.defaultValue
  };
}

export function describeContractConflict(row: PropertyDiffRow): string {
  if (row.kind !== 'contract-diff' || !row.left || !row.right) return '';
  const fragments: string[] = [];
  if (row.typeDiffer) fragments.push(`类型 ${row.left.type} ↔ ${row.right.type}`);
  if (row.requiredDiffer) fragments.push(`必填 ${row.left.required ? '是' : '否'} ↔ ${row.right.required ? '是' : '否'}`);
  return fragments.join('；');
}
