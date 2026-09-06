import type { Id } from './ids';

/**
 * Mirrors the Prisma `Role` enum. The client used to know only the five
 * original venue roles, so every stadium/enterprise role (event_manager,
 * outlet_manager, platform_admin, ...) was a type error at the boundary and
 * fell through the permission helpers as plain staff — locking those users out
 * of the manager UI their server-side role grants them.
 */
export type Role =
  | 'admin'
  | 'owner'
  | 'manager'
  | 'server'
  | 'staff'
  | 'platform_admin'
  | 'organization_admin'
  | 'fnb_director'
  | 'event_manager'
  | 'outlet_manager'
  | 'executive_chef'
  | 'warehouse_manager'
  | 'premium_manager'
  | 'finance_viewer'
  | 'concourse_supervisor'
  | 'suite_manager'
  | 'auditor';

export type Venue = {
  id: Id<'venues'>;
  name: string;
  latitude: number;
  longitude: number;
  geofence_radius_m: number;
};

export type VenueSummary = {
  id: string;
  name: string;
  role: Role;
  profileId?: string;
};

export type UserSummary = {
  id: string;
  email: string;
  full_name: string;
  email_verified: boolean;
  role: Role;
  job_title: string;
  venue_id: Id<'venues'> | null;
  all_access: boolean;
};

export type TeamMember = {
  id: string;
  full_name: string;
  role: Role;
  job_title: string;
  venue_name: string;
  is_clocked_in: boolean;
};

export type ScheduleShift = {
  id: string;
  day_index: number;
  day_label: string;
  start_time: string;
  end_time: string;
  member_id: string | null;
  member_name: string;
  job_title: string;
  station: string;
  status: 'scheduled' | 'open' | 'covered';
  notes?: string;
};

export type ClockEntry = {
  _id: string;
  memberId: string;
  memberName: string;
  role: Role;
  jobTitle: string;
  venueId: string;
  venueName: string;
  clockInAt: number;
  clockOutAt: number | null;
  clockInLat: number | null;
  clockInLng: number | null;
  clockInAccuracyM: number | null;
  clockInMocked: boolean | null;
  clockOutLat: number | null;
  clockOutLng: number | null;
  clockOutAccuracyM: number | null;
  clockOutMocked: boolean | null;
  isOpen: boolean;
  breaks: unknown[] | null;
};

export type AvailabilityBlock = {
  day_index: number;
  start_minutes: number;
  end_minutes: number;
  available: boolean;
};

export type StaffRequestKind = 'add_shift' | 'drop_shift' | 'time_off' | 'sick_leave' | 'time_correction' | 'other';
export type StaffRequestStatus = 'pending' | 'approved' | 'denied' | 'cancelled';

export type StaffRequest = {
  _id: string;
  venueId: string;
  profileId: string;
  kind: StaffRequestKind;
  status: StaffRequestStatus;
  title: string;
  details: string;
  requestedForDate: string | null;
  requestedShiftId: string | null;
  requestedRangeStart: string | null;
  requestedRangeEnd: string | null;
  availability: AvailabilityBlock[] | null;
  reviewerId: string | null;
  reviewedAt: number | null;
  responseNotes: string | null;
  createdAt: number;
  updatedAt: number;
};

export type TimeEntry = ClockEntry;

export type DepartmentSummary = {
  id: string;
  code: string;
  name: string;
  defaultRoute: string;
  isPrimary?: boolean;
};

export type WorkspaceResolution = {
  assigned: boolean;
  primaryDepartment?: DepartmentSummary;
  departments: DepartmentSummary[];
  allowedOperationalAreas: string[];
  defaultRoute: string;
  effectiveRole: Role | string;
};
