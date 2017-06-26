import {Channel, COLUMN, ROW, TEXT, TOOLTIP} from '../channel';
import {CellConfig, Config} from '../config';
import {field, FieldDef, isScaleFieldDef, OrderFieldDef} from '../fielddef';
import * as log from '../log';
import {Mark, MarkConfig, TextConfig} from '../mark';
import {ScaleType} from '../scale';
import {isConcatSpec, isFacetSpec, isLayerSpec, isRepeatSpec, isUnitSpec, LayoutSize, Spec} from '../spec';
import {TimeUnit} from '../timeunit';
import {formatExpression} from '../timeunit';
import {QUANTITATIVE, TEMPORAL} from '../type';
import {duplicate, isArray} from '../util';
import {VgEncodeEntry, VgSort} from '../vega.schema';
import {ConcatModel} from './concat';
import {FacetModel} from './facet';
import {LayerModel} from './layer';
import {Model} from './model';
import {RepeaterValue, RepeatModel} from './repeat';
import {UnitModel} from './unit';


export function buildModel(spec: Spec, parent: Model, parentGivenName: string,
  unitSize: LayoutSize, repeater: RepeaterValue, config: Config): Model {
  if (isFacetSpec(spec)) {
    return new FacetModel(spec, parent, parentGivenName, repeater, config);
  }

  if (isLayerSpec(spec)) {
    return new LayerModel(spec, parent, parentGivenName, unitSize, repeater, config);
  }

  if (isUnitSpec(spec)) {
    return new UnitModel(spec, parent, parentGivenName, unitSize, repeater, config);
  }

  if (isRepeatSpec(spec)) {
    return new RepeatModel(spec, parent, parentGivenName, repeater, config);
  }

  if (isConcatSpec(spec)) {
    return new ConcatModel(spec, parent, parentGivenName, repeater, config);
  }

  throw new Error(log.message.INVALID_SPEC);
}

export function applyConfig(e: VgEncodeEntry,
    config: CellConfig | MarkConfig | TextConfig, // TODO(#1842): consolidate MarkConfig | TextConfig?
    propsList: string[]) {
  for (const property of propsList) {
    const value = config[property];
    if (value !== undefined) {
      e[property] = {value: value};
    }
  }
  return e;
}

export function applyMarkConfig(e: VgEncodeEntry, model: UnitModel, propsList: (keyof MarkConfig)[]) {
  for (const property of propsList) {
    const value = getMarkConfig(property, model.mark(), model.config);
    if (value !== undefined) {
      e[property] = {value: value};
    }
  }
  return e;
}

/**
 * Return value mark specific config property if exists.
 * Otherwise, return general mark specific config.
 */
export function getMarkConfig<P extends keyof MarkConfig>(prop: P, mark: Mark, config: Config): MarkConfig[P] {
  const markSpecificConfig = config[mark];
  if (markSpecificConfig[prop] !== undefined) {
    return markSpecificConfig[prop];
  }
  return config.mark[prop];
}

export function formatSignalRef(fieldDef: FieldDef<string>, specifiedFormat: string, expr: 'datum' | 'parent', config: Config, formatType: 'number' | 'time' | 'utc', channel: Channel, useBinRange?: boolean) {
  if (channel === TEXT || channel === ROW || channel === COLUMN || channel === TOOLTIP) {
    if (specifiedFormat) {
      if (formatType === 'number') {
        if (fieldDef.type === 'quantitative') {
          const format = numberFormat(fieldDef, specifiedFormat, config);
          if (fieldDef.bin) {
            if (useBinRange) {
              // For bin range, no need to apply format as the formula that creates range already include format
              return {signal: field(fieldDef, {expr, binSuffix: 'range'})};
            } else {
              return {
                signal: `format(${field(fieldDef, {expr, binSuffix: 'start'})}, '${format}')+'-'+format(${field(fieldDef, {expr, binSuffix: 'end'})}, '${format}')`
              };
            }
          } else {
            return {
              signal: `format(${field(fieldDef, {expr})}, '${format}')`
            };
          }
        }
      } else {
        return {
          signal: timeFormatExpression(field(fieldDef, {expr}), fieldDef.timeUnit, specifiedFormat, config.text.shortTimeLabels, config.timeFormat, formatType === 'utc')
        };
      }
    }
  }
  if (fieldDef.type === 'quantitative') {
    const format = numberFormat(fieldDef, specifiedFormat, config);
    if (fieldDef.bin) {
      if (useBinRange) {
        // For bin range, no need to apply format as the formula that creates range already include format
        return {signal: field(fieldDef, {expr, binSuffix: 'range'})};
      } else {
        return {
          signal: `${formatExpr(field(fieldDef, {expr, binSuffix: 'start'}), format)} + '-' + ${formatExpr(field(fieldDef, {expr, binSuffix: 'end'}), format)}`
        };
      }
    } else {
      return {
        signal: `${formatExpr(field(fieldDef, {expr}), format)}`
      };
    }
  } else if (fieldDef.type === 'temporal') {
    const isUTCScale = isScaleFieldDef(fieldDef) && fieldDef['scale'] && fieldDef['scale'].type === ScaleType.UTC;
    return {
      signal: timeFormatExpression(field(fieldDef, {expr}), fieldDef.timeUnit, specifiedFormat, config.text.shortTimeLabels, config.timeFormat, isUTCScale)
    };
  }
  return {signal: field(fieldDef, {expr})};
}

/**
 * Returns number format for a fieldDef
 *
 * @param format explicitly specified format
 */
export function numberFormat(fieldDef: FieldDef<string>, specifiedFormat: string, config: Config) {
  if (fieldDef.type === QUANTITATIVE || fieldDef.type === TEMPORAL) {
    // add number format for quantitative type only

    // Specified format in axis/legend has higher precedence than fieldDef.format
    if (specifiedFormat) {
      return specifiedFormat;
    }

    // TODO: need to make this work correctly for numeric ordinal / nominal type
    return config.numberFormat;
  }
  return undefined;
}

function formatExpr(field: string, format: string) {
  return `format(${field}, ${format ? `'${format}'` : null})`;
}

export function numberFormatExpr(field: string, specifiedFormat: string, config: Config) {
  return formatExpr(field, specifiedFormat || config.numberFormat);
}

/**
 * Returns the time expression used for axis/legend labels or text mark for a temporal field
 */
export function timeFormatExpression(field: string, timeUnit: TimeUnit, format: string, shortTimeLabels: boolean, timeFormatConfig: string, isUTCScale: boolean): string {
  if (!timeUnit || format) {
    // If there is not time unit, or if user explicitly specify format for axis/legend/text.
    // only use config.timeFormat if there is no timeUnit.
    return `${isUTCScale ? 'utc' : 'time'}Format(${field}, '${format || timeFormatConfig}')`;
  } else {
    return formatExpression(timeUnit, field, shortTimeLabels, isUTCScale);
  }
}

/**
 * Return Vega sort parameters (tuple of field and order).
 */
export function sortParams(orderDef: OrderFieldDef<string> | OrderFieldDef<string>[]): VgSort {
  return (isArray(orderDef) ? orderDef : [orderDef]).reduce((s, orderChannelDef) => {
    s.field.push(field(orderChannelDef, {binSuffix: 'start'}));
    s.order.push(orderChannelDef.sort || 'ascending');
    return s;
  }, {field:[], order: []});
}
