import type { TrackerStatusOption } from "@mana-app/types";

export const SITE_URL = "https://example.com";
export const API_URL = "https://example.com/api";
export const AUTHORIZE_URL = `${SITE_URL}/oauth/authorize`;
export const REDIRECT_URL = "com.seyden.mana://oauth/template-tracker";

export const PAGE_SIZE = 30;

export const PreferenceID = {
  ClientId: "client-id",
  ShowAdult: "show-adult",
} as const;

export const PREFERENCE_DEFAULTS = {
  [PreferenceID.ClientId]: "",
  [PreferenceID.ShowAdult]: false,
};

export const ListStatus = {
  Reading: "reading",
  Planning: "planning",
  Completed: "completed",
  Paused: "paused",
  Dropped: "dropped",
} as const;

export const STATUS_OPTIONS: TrackerStatusOption[] = [
  { id: ListStatus.Reading, title: "Reading", isDefault: true },
  { id: ListStatus.Planning, title: "Plan to Read" },
  { id: ListStatus.Completed, title: "Completed" },
  { id: ListStatus.Paused, title: "Paused" },
  { id: ListStatus.Dropped, title: "Dropped" },
];

export const EntryField = {
  Status: "status",
  Progress: "progress",
} as const;

export type ApiTitle = {
  id: number;
  title: string;
  cover?: string;
  description?: string;
  chapters?: number;
  adult?: boolean;
};

export type ApiEntry = {
  status: string;
  progress: number;
};

export type ApiPage<T> = { items: T[]; hasNextPage: boolean };

export type ApiUser = { name: string; avatar?: string };
