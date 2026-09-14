import { expect, it } from 'vitest';
import { assignNetworkTasks } from '../networkBindingDraft';
it('appends only new tasks and preserves both prior order and unselected nodes', () => {
  const bindings = { 1: ['a'], 2: ['a', 'b'] };
  const order = { a: [2, 1], b: [2] };
  const result = assignNetworkTasks(bindings, order, ['a'], [1, 3], true);
  expect(result.order).toEqual({ a: [2, 1, 3], b: [2] });
  expect(result.bindings[2]).toContain('b');
  expect(bindings).toEqual({ 1: ['a'], 2: ['a', 'b'] });
  expect(order).toEqual({ a: [2, 1], b: [2] });
});
it('clears only selected node bindings with an empty replacement', () => {
  const result = assignNetworkTasks({ 1: ['a', 'b'] }, { a: [1], b: [1] }, ['a'], []);
  expect(result.bindings[1]).toEqual(['b']);
  expect(result.order.a).toEqual([]);
  expect(result.order.b).toEqual([1]);
});
