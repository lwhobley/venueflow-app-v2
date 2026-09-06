import { afterEach, describe, expect, it, vi } from 'vitest';
import { InsightsController } from './insights.controller';

vi.mock('../../common/rate-limit', () => ({
  assertWithinSharedRateLimit: vi.fn().mockResolvedValue(undefined),
}));

import { assertWithinSharedRateLimit } from '../../common/rate-limit';

function makeController() {
  const prisma = {
    cosmicInsight: { findMany: vi.fn().mockResolvedValue([]) },
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
    it('applies a per-IP rate limit before querying insights', async () => {
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

    // CosmicInsight has no venueId/organizationId column, so the previous
    // unfiltered findMany returned every tenant's insights to every caller.
    it('never reads the untenanted CosmicInsight table', async () => {
      const { controller, prisma } = makeController();
      prisma.cosmicInsight.findMany.mockResolvedValue([
        { kind: 'tip', title: 'Another venue insight', body: 'Leaked.', batchAt: new Date() },
      ]);

      await expect(controller.getLatestInsights(makeRequest())).resolves.toEqual([]);
      expect(prisma.cosmicInsight.findMany).not.toHaveBeenCalled();
    });
  });
});
