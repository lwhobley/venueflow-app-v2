-- Organize the stadium / arena F&B map by operating department and physical zone.
CREATE TYPE "FnbDepartment" AS ENUM ('concessions', 'culinary_production', 'premium_hospitality', 'catering_banquets', 'beverage_operations', 'retail_fnb', 'vendor_partners');

ALTER TABLE "FnbOperationUnit"
  ADD COLUMN "department" "FnbDepartment" NOT NULL DEFAULT 'concessions',
  ADD COLUMN "stadiumZone" TEXT;

CREATE INDEX "FnbOperationUnit_venueId_department_stadiumZone_idx"
  ON "FnbOperationUnit"("venueId", "department", "stadiumZone");
