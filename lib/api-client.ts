import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import Constants from "expo-constants";
import { useAuthStore } from "./auth-store";
import type { Role } from "./types";

const configuredApiBaseUrl =
  process.env.EXPO_PUBLIC_API_URL ??
  (Constants.expoConfig?.extra?.EXPO_PUBLIC_API_URL as string | undefined) ??
  null;

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type ApiProfile = {
  _id: string;
  email: string;
  fullName: string;
  emailVerified: boolean;
  role: Role;
  jobTitle: string;
  venueId: string | null;
  allAccess: boolean;
  trialEndsAt?: number | null;
};

type ApiVenue = {
  _id: string;
  name: string;
  latitude: number;
  longitude: number;
  geofenceRadiusM: number;
};

export type AuthSessionResponse = {
  token: string;
  profile: ApiProfile;
  venue: ApiVenue | null;
};

function getApiBaseUrl() {
  if (!configuredApiBaseUrl) {
    throw new ApiError(
      "The app is missing EXPO_PUBLIC_API_URL. Set it before signing in.",
      500,
    );
  }
  return configuredApiBaseUrl;
}

/**
 * Resolve a media reference to an absolute URL for <Image>. Server-stored chat
 * photos come back as relative paths (e.g. /v1/chat/images/<id>); legacy or
 * external URLs are already absolute and pass through unchanged.
 */
export function resolveMediaUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  return `${getApiBaseUrl()}${path}`;
}

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const token = useAuthStore.getState().token;
  const venueId = useAuthStore.getState().venue?.id;
  const timeout = options.timeoutMs ?? 30_000;
  const controller =
    typeof AbortController !== "undefined" ? new AbortController() : null;
  const signal = controller?.signal ?? options.signal;
  let timedOut = false;
  const abortFromCaller = () => controller?.abort();
  if (options.signal?.aborted) abortFromCaller();
  else options.signal?.addEventListener("abort", abortFromCaller);
  const timer =
    controller && timeout > 0
      ? setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeout)
      : null;

  let response: Response;
  try {
    response = await fetch(`${getApiBaseUrl()}${path}`, {
      method: options.method ?? "GET",
      headers: {
        Accept: "application/json, text/csv;q=0.9, text/plain;q=0.8",
        ...(options.body !== undefined
          ? { "Content-Type": "application/json" }
          : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(venueId ? { "X-Venue-Id": venueId } : {}),
      },
      body:
        options.body !== undefined ? JSON.stringify(options.body) : undefined,
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError" && timedOut) {
      throw new ApiError(
        "Request timed out. Check your connection and try again.",
        408,
      );
    }
    throw error;
  } finally {
    options.signal?.removeEventListener("abort", abortFromCaller);
    if (timer) clearTimeout(timer);
  }

  if (!response.ok) {
    if (response.status === 401 && token) {
      useAuthStore.getState().clearSession();
    }
    const errorText = await response.text().catch(() => "");
    let errorBody: { message?: string | string[] } | null = null;
    if (errorText) {
      try {
        errorBody = JSON.parse(errorText) as { message?: string | string[] };
      } catch {
        errorBody = { message: errorText };
      }
    }
    const message =
      typeof errorBody?.message === "string"
        ? errorBody.message
        : Array.isArray(errorBody?.message)
          ? errorBody.message.join(", ")
          : `Request failed (${response.status})`;
    throw new ApiError(message, response.status);
  }

  if (response.status === 204) return null as T;
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return response.json() as Promise<T>;
  }
  return response.text() as Promise<T>;
}

export function useApiQuery<T>(
  queryKey: QueryKey,
  path: string,
  enabled = true,
) {
  const authEpoch = useAuthStore((state) => state.authEpoch);
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const venueId = useAuthStore((state) => state.venue?.id ?? null);
  const token = useAuthStore((state) => state.token);
  return useQuery({
    queryKey: [...queryKey, authEpoch, userId, venueId],
    queryFn: ({ signal }) => apiRequest<T>(path, { signal }),
    enabled: enabled && Boolean(token),
  });
}

export function useApiMutation<TArgs, TResult>(
  mutationFn: (args: TArgs) => Promise<TResult>,
  invalidate: QueryKey[] = [],
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: async () => {
      await Promise.all(
        invalidate.map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      );
    },
  });
}

export type InviteCheckResult =
  | {
      status: "found";
      emailSent?: boolean;
      venueName?: string;
      jobTitle?: string;
      role?: string;
      expiresAt?: number;
    }
  | { status: "not_found" | "expired" | "used" };

export type JoinRequestResult = {
  requestId: string;
  status: "pending";
  venueName: string;
};
export type VenueSearchResult = {
  id: string;
  name: string;
  address: string | null;
};

export const appApi = {
  pinAuth: (body: { email: string; pin: string; flow: "signIn" }) =>
    apiRequest<AuthSessionResponse>("/v1/auth/password", {
      method: "POST",
      body,
    }),
  resendVerification: () =>
    apiRequest<{ ok: true; alreadyVerified?: boolean }>(
      "/v1/auth/verify-email/send",
      { method: "POST" },
    ),
  verifyEmail: (body: { code: string }) =>
    apiRequest<{ ok: true; alreadyVerified?: boolean }>(
      "/v1/auth/verify-email",
      { method: "POST", body },
    ),
  forgotPassword: (body: { email: string }) =>
    apiRequest<{ ok: true }>("/v1/auth/forgot-password", {
      method: "POST",
      body,
    }),
  resetPassword: (body: { email: string; code: string; newPassword: string }) =>
    apiRequest<{ ok: true }>("/v1/auth/reset-password", {
      method: "POST",
      body,
    }),
  // Public: preview which team an invite code belongs to before signing up.
  previewInvite: (code: string) =>
    apiRequest<{
      valid: boolean;
      venueName: string;
      role: string;
      jobTitle: string;
      expiresAt: number;
    }>("/v1/app/invite/" + encodeURIComponent(code.trim())),
  // Solo user joins an existing team later by code.
  joinByCode: (code: string) =>
    apiRequest<{ profile: ApiProfile; venue: ApiVenue | null }>(
      "/v1/app/join",
      { method: "POST", body: { code } },
    ),
  redeemInvite: (codeOrToken: string) =>
    apiRequest<{
      redeemed: boolean;
      profile?: ApiProfile;
      venue?: ApiVenue | null;
    }>("/v1/app/redeem-invite", { method: "POST", body: { codeOrToken } }),
  redeemMyInvite: () =>
    apiRequest<{
      redeemed: boolean;
      profile?: ApiProfile;
      venue?: ApiVenue | null;
    }>("/v1/app/redeem-my-invite", { method: "POST" }),
  getMe: () =>
    apiRequest<{ profile: ApiProfile; venue: ApiVenue | null } | null>(
      "/v1/app/me",
    ),
  getBilling: () => apiRequest<any | null>("/v1/app/billing"),
  syncAppleSubscription: (body: {
    productId: string;
    entitlementId?: string;
  }) => apiRequest<any>("/v1/app/billing/apple/sync", { method: "POST", body }),
  createStripeCheckout: (body?: { plan?: "single" | "multi_venue" }) =>
    apiRequest<{ url: string }>("/v1/app/billing/stripe/checkout", {
      method: "POST",
      body,
    }),
  createStripePortal: () =>
    apiRequest<{ url: string }>("/v1/app/billing/stripe/portal", {
      method: "POST",
    }),
  getDashboard: () => apiRequest<any | null>("/v1/app/dashboard"),
  getNotifications: () => apiRequest<any[]>("/v1/app/notifications"),
  markNotificationRead: (notificationId: string) =>
    apiRequest("/v1/app/notifications/" + notificationId + "/read", {
      method: "POST",
    }),
  getClockBoard: () => apiRequest<any | null>("/v1/time-clock/board"),
  getMyTimeClock: () => apiRequest<any | null>("/v1/time-clock/me"),
  clockIn: (body: {
    lat: number;
    lng: number;
    accuracy: number;
    mocked: boolean;
  }) => apiRequest("/v1/time-clock/clock-in", { method: "POST", body }),
  clockOut: (body: {
    lat: number;
    lng: number;
    accuracy: number;
    mocked: boolean;
  }) => apiRequest("/v1/time-clock/clock-out", { method: "POST", body }),
  breakStart: (body: { type: "paid" | "unpaid" }) =>
    apiRequest("/v1/time-clock/break-start", { method: "POST", body }),
  breakEnd: () => apiRequest("/v1/time-clock/break-end", { method: "POST" }),
  listVenueStaff: () => apiRequest<any[]>("/v1/app/staff"),
  upsertVenueStaff: (body: {
    venueId: string;
    email: string;
    fullName: string;
    role: string;
    jobTitle: string;
    phone?: string;
    altPhone?: string;
    address?: string;
    dateOfBirth?: string;
    certifications?: string[];
  }) => apiRequest("/v1/app/staff", { method: "POST", body }),
  deactivateVenueStaff: (staffId: string) =>
    apiRequest("/v1/app/staff/" + staffId, { method: "DELETE" }),
  createStaffRequest: (body: {
    kind: string;
    title: string;
    details: string;
    availability?: any;
    timeCorrection?: {
      timeEntryId?: string | null;
      clockInAt: number;
      clockOutAt?: number | null;
      reason?: string;
    };
  }) => apiRequest("/v1/staff-requests", { method: "POST", body }),
  updateVenue: (body: {
    name?: string;
    latitude?: number;
    longitude?: number;
    geofenceRadiusM?: number;
  }) => apiRequest<any>("/v1/app/venue", { method: "PATCH", body }),
  deleteMyAccount: () => apiRequest("/v1/app/me", { method: "DELETE" }),

  // ─── Workforce ───────────────────────────────────────────────────────────────
  inviteCheck: (body: { email?: string; phone?: string }) =>
    apiRequest<InviteCheckResult>("/v1/workforce/invite-check", {
      method: "POST",
      body,
    }),
  searchVenues: (q: string) =>
    apiRequest<{ venues: VenueSearchResult[] }>(
      `/v1/workforce/venues/search?q=${encodeURIComponent(q)}`,
    ),
  submitJoinRequest: (body: { venueId: string; code: string }) =>
    apiRequest<JoinRequestResult>("/v1/workforce/join-request", {
      method: "POST",
      body,
    }),
  listMyJoinRequests: () =>
    apiRequest<{ requests: any[] }>("/v1/workforce/join-requests"),
  cancelJoinRequest: (id: string) =>
    apiRequest("/v1/workforce/join-request/" + id, { method: "DELETE" }),
  listManagerJoinRequests: () =>
    apiRequest<{ requests: any[] }>("/v1/workforce/manager/join-requests"),
  approveJoinRequest: (id: string) =>
    apiRequest("/v1/workforce/manager/join-request/" + id + "/approve", {
      method: "POST",
      body: {},
    }),
  rejectJoinRequest: (id: string, note?: string) =>
    apiRequest("/v1/workforce/manager/join-request/" + id + "/reject", {
      method: "POST",
      body: { note },
    }),
};
