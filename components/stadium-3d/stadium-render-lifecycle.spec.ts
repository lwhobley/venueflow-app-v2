import { describe, expect, it, vi } from 'vitest';
import { createLoadCompletionGate, getRenderableViewport } from './stadium-render-lifecycle';

describe('stadium render lifecycle', () => {
  it('waits for a positive-size rendered frame before reporting model readiness', () => {
    const onLoadComplete = vi.fn();
    const gate = createLoadCompletionGate(onLoadComplete);

    gate.markModelReady(true);
    expect(onLoadComplete).not.toHaveBeenCalled();
    expect(getRenderableViewport(390, 0)).toBeNull();

    expect(getRenderableViewport(390, 480)).toEqual({ width: 390, height: 480 });
    gate.reportRenderedFrame();
    expect(onLoadComplete).toHaveBeenCalledOnce();
    expect(onLoadComplete).toHaveBeenCalledWith(true);
  });

  it('reports each completed model only once', () => {
    const onLoadComplete = vi.fn();
    const gate = createLoadCompletionGate(onLoadComplete);

    gate.markModelReady();
    gate.reportRenderedFrame();
    gate.reportRenderedFrame();

    expect(onLoadComplete).toHaveBeenCalledOnce();
    expect(onLoadComplete).toHaveBeenCalledWith(undefined);
  });

  it('rejects invalid viewport measurements', () => {
    expect(getRenderableViewport(0, 480)).toBeNull();
    expect(getRenderableViewport(Number.NaN, 480)).toBeNull();
    expect(getRenderableViewport(390, Number.POSITIVE_INFINITY)).toBeNull();
  });
});
