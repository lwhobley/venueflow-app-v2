-- AlterTable: Allow null staffMemberId on VmsTimeAttendance for unassigned/unfilled shift no-shows
ALTER TABLE "VmsTimeAttendance" ALTER COLUMN "staffMemberId" DROP NOT NULL;
