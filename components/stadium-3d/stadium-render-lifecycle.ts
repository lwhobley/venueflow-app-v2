export function getRenderableViewport(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }

  return { width, height };
}

export function createLoadCompletionGate(onLoadComplete?: (fallback?: boolean) => void) {
  let pendingFallback: boolean | null = null;

  return {
    markModelReady(fallback = false) {
      pendingFallback = fallback;
    },
    reportRenderedFrame() {
      if (pendingFallback === null) return;
      const fallback = pendingFallback;
      pendingFallback = null;
      onLoadComplete?.(fallback || undefined);
    },
  };
}
