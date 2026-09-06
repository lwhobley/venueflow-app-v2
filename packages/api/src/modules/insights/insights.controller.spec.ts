import { afterEach, describe, expect, it, vi } from 'vitest';
import { InsightsController } from './insights.controller';

vi.mock('../../common/rate-limit', () => ({
  assertWithinSharedRateLimit: vi.fn().mockResolvedValue(undefined),
}));

import { assertWithinSharedRateLimit } from '../../common/rate-limit';

function makeController() {
  const prisma = {
    cosmicInsight: { findMany: vi.fn() },
  } as any;
  const controller = new InsightsController(prisma);
  return { controller, prisma };
}

function makeRequest(ip = '203.0.113.5') {
  return { ip } as any;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('InsightsController', () => {
  describe('getLatestInsights', () => {
    it('applies a per-IP rate limit before returning insights', async () => {
      const { controller, prisma } = makeController();

      await controller.getLatestInsights(makeRequest());

      expect(assertWithinSharedRateLimit).toHaveBeenCalledWith(
        prisma,
        'insights:203.0.113.5',
        60,
        60_000,
        'Too many requests.',
      );
    });

    it('propagates a rate-limit rejection without querying insights', async () => {
      const { controller, prisma } = makeController();
      (assertWithinSharedRateLimit as any).mockRejectedValueOnce(new Error('Too many requests.'));

      await expect(controller.getLatestInsights(makeRequest())).rejects.toThrow('Too many requests.');
      expect(prisma.cosmicInsight.findMany).not.toHaveBeenCalled();
    });

    it('does not read the unscoped CosmicInsight table', async () => {
      const { controller, prisma } = makeController();

      const result = await controller.getLatestInsights(makeRequest());

      expect(prisma.cosmicInsight.findMany).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it('returns an empty array when no insights exist', async () => {
      const { controller, prisma } = makeController();
      prisma.cosmicInsight.findMany.mockResolvedValue([]);

      await expect(controller.getLatestInsights(makeRequest())).resolves.toEqual([]);
    });
  });
});
