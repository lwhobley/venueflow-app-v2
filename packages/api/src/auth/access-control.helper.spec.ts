import { describe, expect, it, vi } from 'vitest';
import { evaluateAccessRules, assertCanManageDepartment } from './access-control.helper';
import { ForbiddenException } from '@nestjs/common';

describe('access-control.helper (Unit)', () => {
  describe('evaluateAccessRules', () => {
    it('denies unassigned users when no department membership exists', () => {
      const result = evaluateAccessRules({
        role: 'staff',
        activeDepartmentCodes: [],
        action: 'view',
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Department assignment required');
    });

    it('allows platform_admin even without explicit department assignment', () => {
      const result = evaluateAccessRules({
        role: 'platform_admin',
        activeDepartmentCodes: [],
        action: 'view',
      });
      expect(result.allowed).toBe(true);
    });

    describe('Culinary vs Concessions strict isolation', () => {
      it('STRICTLY DENIES Culinary user from accessing Concessions operational areas without override', () => {
        const result = evaluateAccessRules({
          role: 'staff',
          activeDepartmentCodes: ['culinary'],
          operationalAreaType: 'concession',
          action: 'view',
        });
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('excluded from Concessions');
      });

      it('ALLOWS Culinary user to access Suites, Clubs, Catering, Kitchen, Distro', () => {
        for (const area of ['suite', 'club', 'catering', 'kitchen', 'distro']) {
          const result = evaluateAccessRules({
            role: 'staff',
            activeDepartmentCodes: ['culinary'],
            operationalAreaType: area,
            action: 'view',
          });
          expect(result.allowed).toBe(true);
        }
      });

      it('ALLOWS Culinary user with active override to access Concessions', () => {
        const result = evaluateAccessRules({
          role: 'staff',
          activeDepartmentCodes: ['culinary'],
          operationalAreaType: 'concession',
          action: 'view',
          hasActiveOverride: true,
        });
        expect(result.allowed).toBe(true);
      });
    });

    describe('Department-to-Area isolation', () => {
      it('restricts Suites department users to Suites only', () => {
        const allowed = evaluateAccessRules({
          role: 'staff',
          activeDepartmentCodes: ['suites'],
          operationalAreaType: 'suite',
          action: 'view',
        });
        expect(allowed.allowed).toBe(true);

        const denied = evaluateAccessRules({
          role: 'staff',
          activeDepartmentCodes: ['suites'],
          operationalAreaType: 'concession',
          action: 'view',
        });
        expect(denied.allowed).toBe(false);
      });

      it('restricts Clubs department users to Clubs only', () => {
        const allowed = evaluateAccessRules({
          role: 'staff',
          activeDepartmentCodes: ['clubs'],
          operationalAreaType: 'club',
          action: 'view',
        });
        expect(allowed.allowed).toBe(true);

        const denied = evaluateAccessRules({
          role: 'staff',
          activeDepartmentCodes: ['clubs'],
          operationalAreaType: 'catering',
          action: 'view',
        });
        expect(denied.allowed).toBe(false);
      });

      it('restricts Catering department users to Catering, Kitchen, Distro', () => {
        expect(evaluateAccessRules({
          role: 'staff',
          activeDepartmentCodes: ['catering'],
          operationalAreaType: 'catering',
          action: 'view',
        }).allowed).toBe(true);

        expect(evaluateAccessRules({
          role: 'staff',
          activeDepartmentCodes: ['catering'],
          operationalAreaType: 'concession',
          action: 'view',
        }).allowed).toBe(false);
      });

      it('restricts Concessions department users to Concessions only', () => {
        expect(evaluateAccessRules({
          role: 'staff',
          activeDepartmentCodes: ['concessions'],
          operationalAreaType: 'concession',
          action: 'view',
        }).allowed).toBe(true);

        expect(evaluateAccessRules({
          role: 'staff',
          activeDepartmentCodes: ['concessions'],
          operationalAreaType: 'suite',
          action: 'view',
        }).allowed).toBe(false);
      });
    });

    describe('Sensitive Resource Protections', () => {
      it('DENIES payroll data to operational managers and staff', () => {
        const staffRes = evaluateAccessRules({
          role: 'staff',
          activeDepartmentCodes: ['operations'],
          action: 'view',
          sensitiveCategory: 'payroll',
        });
        expect(staffRes.allowed).toBe(false);

        const mgrRes = evaluateAccessRules({
          role: 'manager',
          activeDepartmentCodes: ['operations'],
          action: 'view',
          sensitiveCategory: 'payroll',
        });
        expect(mgrRes.allowed).toBe(false);
      });

      it('ALLOWS payroll view to finance_viewer and admin', () => {
        const financeRes = evaluateAccessRules({
          role: 'finance_viewer',
          activeDepartmentCodes: ['operations'],
          action: 'view',
          sensitiveCategory: 'payroll',
        });
        expect(financeRes.allowed).toBe(true);

        const adminRes = evaluateAccessRules({
          role: 'admin',
          activeDepartmentCodes: ['operations'],
          action: 'view',
          sensitiveCategory: 'payroll',
        });
        expect(adminRes.allowed).toBe(true);
      });

      it('DENIES platform secrets to regular venue admin without platform privilege', () => {
        const res = evaluateAccessRules({
          role: 'admin',
          activeDepartmentCodes: ['operations'],
          action: 'view',
          sensitiveCategory: 'secrets',
        });
        expect(res.allowed).toBe(false);
      });
    });

    describe('Role & Action Scoping', () => {
      it('requires manager role for approve and closeout', () => {
        const staffApprove = evaluateAccessRules({
          role: 'staff',
          activeDepartmentCodes: ['catering'],
          action: 'approve',
        });
        expect(staffApprove.allowed).toBe(false);

        const mgrApprove = evaluateAccessRules({
          role: 'manager',
          activeDepartmentCodes: ['catering'],
          action: 'approve',
        });
        expect(mgrApprove.allowed).toBe(true);
      });

      it('prevents read-only finance_viewer from creating or updating', () => {
        const res = evaluateAccessRules({
          role: 'finance_viewer',
          activeDepartmentCodes: ['operations'],
          action: 'create',
        });
        expect(res.allowed).toBe(false);
      });

      it('allows operational staff to fire, ready, and pickup tickets within authorized areas', () => {
        for (const action of ['fire', 'ready', 'pickup'] as const) {
          const res = evaluateAccessRules({
            role: 'staff',
            activeDepartmentCodes: ['culinary'],
            operationalAreaType: 'kitchen',
            action,
          });
          expect(res.allowed).toBe(true);
        }
      });

      it('requires manager role for ticket cancellation and reopening', () => {
        for (const action of ['cancel', 'reopen'] as const) {
          const staffRes = evaluateAccessRules({
            role: 'staff',
            activeDepartmentCodes: ['culinary'],
            operationalAreaType: 'kitchen',
            action,
          });
          expect(staffRes.allowed).toBe(false);
          expect(staffRes.reason).toContain('operational manager authority');

          const mgrRes = evaluateAccessRules({
            role: 'manager',
            activeDepartmentCodes: ['culinary'],
            operationalAreaType: 'kitchen',
            action,
          });
          expect(mgrRes.allowed).toBe(true);
        }
      });
    });
  });

  describe('assertCanManageDepartment', () => {
    it('allows platform_admin venue-wide management', async () => {
      const prismaMock = {} as any;
      await expect(
        assertCanManageDepartment({
          actorUserId: 'u-admin',
          actorRole: 'platform_admin',
          facilityId: 'f-1',
          targetDepartmentId: 'd-1',
          prisma: prismaMock,
        }),
      ).resolves.toBeUndefined();
    });

    it('denies manager from managing a department they are not assigned to', async () => {
      const prismaMock = {
        departmentMembership: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
      } as any;

      await expect(
        assertCanManageDepartment({
          actorUserId: 'u-catering-mgr',
          actorRole: 'manager',
          facilityId: 'f-1',
          targetDepartmentId: 'd-concessions',
          prisma: prismaMock,
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows manager to manage a department they are actively assigned to', async () => {
      const prismaMock = {
        departmentMembership: {
          findFirst: vi.fn().mockResolvedValue({ id: 'mem-1' }),
        },
      } as any;

      await expect(
        assertCanManageDepartment({
          actorUserId: 'u-catering-mgr',
          actorRole: 'manager',
          facilityId: 'f-1',
          targetDepartmentId: 'd-catering',
          prisma: prismaMock,
        }),
      ).resolves.toBeUndefined();
    });
  });
});
