import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView } from '@codemirror/view';
import { invertedEffects } from '@codemirror/commands';

/**
 * Отслеживает, какие участки документа ученик набрал или вставил сам,
 * а какие появились из развёртывания Emmet. Хранится список интервалов [from, to).
 *
 * - «чистыми» считаются только развёртывание Emmet (userEvent «input.complete»)
 *   и отмена/повтор — их участки вырезаются из пометок;
 * - всё остальное (набор, вставка, перенос строк, комментирование и любые
 *   будущие команды редактора) помечается как ручной ввод — новая команда
 *   не может «отмыть» HTML, даже если о ней забыли;
 * - отмена/повтор восстанавливают пометки через invertedEffects, поэтому
 *   Ctrl+Z не «отмывает» набранный вручную HTML.
 */

const EMMET_EVENT = 'input.complete';

const mapIntervals = (intervals, changes) =>
  normalize(intervals.map(([from, to]) => [changes.mapPos(from, 1), changes.mapPos(to, -1)]));

const restoreHandwritten = StateEffect.define({ map: mapIntervals });

/** Показ участков, из-за которых проверка не пройдена. */
const showHandwritten = StateEffect.define({ map: mapIntervals });

function normalize(intervals) {
  const sorted = intervals.filter(([from, to]) => to > from).sort((a, b) => a[0] - b[0]);
  const result = [];
  for (const [from, to] of sorted) {
    const last = result[result.length - 1];
    if (last && from <= last[1]) last[1] = Math.max(last[1], to);
    else result.push([from, to]);
  }
  return result;
}

function subtract(intervals, removed) {
  let result = intervals;
  for (const [cutFrom, cutTo] of removed) {
    result = result.flatMap(([from, to]) => {
      if (cutTo <= from || cutFrom >= to) return [[from, to]];
      return [[from, cutFrom], [cutTo, to]].filter(([a, b]) => b > a);
    });
  }
  return result;
}

function intersect(intervals, from, to) {
  return intervals
    .map(([a, b]) => [Math.max(a, from), Math.min(b, to)])
    .filter(([a, b]) => b > a);
}

const isClean = (tr) => tr.isUserEvent(EMMET_EVENT) || tr.isUserEvent('undo') || tr.isUserEvent('redo');

const handwrittenField = StateField.define({
  create: () => [],
  update(intervals, tr) {
    let next = intervals;
    if (tr.docChanged) {
      const inserted = [];
      tr.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
        if (toB > fromB) inserted.push([fromB, toB]);
      });
      next = mapIntervals(next, tr.changes);
      next = isClean(tr) ? subtract(next, inserted) : normalize([...next, ...inserted]);
    }
    for (const effect of tr.effects) {
      if (effect.is(restoreHandwritten)) next = normalize([...next, ...effect.value]);
    }
    return next;
  },
});

// Удаляемые вручную набранные участки при отмене должны вернуться с пометкой.
const keepThroughHistory = invertedEffects.of((tr) => {
  if (!tr.docChanged) return [];
  const before = tr.startState.field(handwrittenField);
  const removed = [];
  tr.changes.iterChangedRanges((fromA, toA) => {
    removed.push(...intersect(before, fromA, toA));
  });
  return removed.length ? [restoreHandwritten.of(removed)] : [];
});

const highlightMark = Decoration.mark({ class: 'cm-handwritten' });

const highlightField = StateField.define({
  create: () => Decoration.none,
  update(decorations, tr) {
    // Подсветка живёт до следующей правки — дальше ученик уже исправляет код.
    if (tr.docChanged) return Decoration.none;
    for (const effect of tr.effects) {
      if (effect.is(showHandwritten)) {
        return Decoration.set(effect.value.map(([from, to]) => highlightMark.range(from, to)));
      }
    }
    return decorations;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export const handwrittenTracking = () => [handwrittenField, keepThroughHistory, highlightField];

export const handwrittenRanges = (state) => state.field(handwrittenField);

export const highlightHandwritten = (view, ranges) =>
  view.dispatch({ effects: showHandwritten.of(ranges) });
