import {
  SearchMenuPicker,
  SearchMultiPickerSheet,
  SearchMultiPicker,
  type JsonValue,
  type Option,
  type SearchListField,
  type SortOption,
} from "@mana-app/types";

export const PROJECT_URL = "https://komga.org";
export const API = "/api/v1";
export const PAGE_SIZE = 30;
export const CONNECTION_TIMEOUT_MS = 8_000;
/** A Komga session is dropped after half an hour idle; renew it well before that. */
export const SESSION_IDLE_MS = 20 * 60_000;

export const SUPPORTED_IMAGE_TYPES: readonly string[] = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/heif",
  "image/jxl",
];

export const ListID = {
  KeepReading: "keep-reading",
  RecentlyAdded: "recently-added",
  RecentlyUpdated: "recently-updated",
  LatestBooks: "latest-books",
  ReadLists: "readlists",
} as const;

export const LIBRARY_PREFIX = "library:";
export const COLLECTION_PREFIX = "collection:";

/** Content ids: a bare id is a series; read lists and single books carry a prefix. */
export const READLIST_PREFIX = "readlist:";
export const BOOK_PREFIX = "book:";

export const FilterID = {
  Library: "library",
  ReadStatus: "read_status",
  SeriesStatus: "series_status",
  Publisher: "publisher",
  Genre: "genre",
  Tag: "tag",
  Type: "type",
  Collection: "collection",
} as const;

/** Author filters are one field per role: `author:writer`, `author:penciller`, … */
export const AUTHOR_FILTER_PREFIX = "author:";

export const AUTHOR_ROLE_ORDER: readonly string[] = [
  "writer",
  "penciller",
  "inker",
  "colorist",
  "letterer",
  "cover",
  "editor",
  "translator",
];

export const SearchType = {
  Series: "series",
  ReadLists: "readlists",
  Books: "books",
} as const;

export const TYPE_FIELD: SearchListField = SearchMenuPicker({
  id: FilterID.Type,
  title: "Search For",
  options: [
    { id: SearchType.Series, title: "Series" },
    { id: SearchType.ReadLists, title: "Read Lists" },
    { id: SearchType.Books, title: "Books" },
  ],
});

export const SortID = {
  Title: "metadata.titleSort",
  Added: "created",
  Updated: "lastModified",
  Released: "booksMetadata.releaseDate",
  Books: "booksCount",
  Random: "random",
} as const;

/** The same sorts for books, which Komga names differently. */
export const BOOK_SORT: Record<string, string> = {
  [SortID.Title]: "metadata.title",
  [SortID.Added]: "createdDate",
  [SortID.Updated]: "lastModifiedDate",
  [SortID.Released]: "metadata.releaseDate",
  [SortID.Books]: "metadata.numberSort",
  [SortID.Random]: "random",
};

export const PreferenceID = {
  ServerUrl: "server-url",
  DefaultLibraries: "default-libraries",
  ChapterTitle: "chapter-title",
} as const;

export const SecretID = {
  ApiKey: "api-key",
  Username: "username",
  Password: "password",
} as const;

export const PREFERENCE_DEFAULTS = {
  [PreferenceID.ServerUrl]: "",
  [PreferenceID.DefaultLibraries]: [] as string[],
  [PreferenceID.ChapterTitle]: "",
};

export const CHAPTER_TITLE_TOKENS =
  "{title}, {fullTitle}, {seriesTitle}, {number}, {releaseDate}, {createdDate}, {size}, {sizeBytes}";

export const READ_STATUS_OPTIONS: Option[] = [
  { id: "UNREAD", title: "Unread" },
  { id: "IN_PROGRESS", title: "In Progress" },
  { id: "READ", title: "Read" },
];

export const SERIES_STATUS_OPTIONS: Option[] = [
  { id: "ONGOING", title: "Ongoing" },
  { id: "ENDED", title: "Ended" },
  { id: "HIATUS", title: "Hiatus" },
  { id: "ABANDONED", title: "Abandoned" },
];

export const STATIC_FIELDS: SearchListField[] = [
  SearchMultiPicker({
    id: FilterID.ReadStatus,
    title: "Read Status",
    options: READ_STATUS_OPTIONS,
  }),
  SearchMultiPicker({
    id: FilterID.SeriesStatus,
    title: "Series Status",
    options: SERIES_STATUS_OPTIONS,
  }),
];

export function optionSheet(id: string, title: string, options: Option[]): SearchListField {
  return SearchMultiPickerSheet({ id, title, options });
}

export const SORT_OPTIONS: SortOption[] = [
  { id: SortID.Title, title: "Title", isDefault: true, isOrderable: true, defaultAscending: true },
  { id: SortID.Added, title: "Date Added", isOrderable: true, defaultAscending: false },
  { id: SortID.Updated, title: "Date Updated", isOrderable: true, defaultAscending: false },
  { id: SortID.Released, title: "Release Date", isOrderable: true, defaultAscending: false },
  { id: SortID.Books, title: "Book Count", isOrderable: true, defaultAscending: false },
  { id: SortID.Random, title: "Random", isOrderable: false },
];

export type Page<T> = {
  content: T[];
  last: boolean;
  number: number;
  totalElements: number;
  totalPages: number;
};

export type Library = { id: string; name: string; unavailable?: boolean };

export type Author = { name: string; role: string };

export type WebLink = { label: string; url: string };

export type Series = {
  id: string;
  libraryId: string;
  name: string;
  booksCount: number;
  booksReadCount?: number;
  booksUnreadCount?: number;
  booksInProgressCount?: number;
  deleted?: boolean;
  oneshot?: boolean;
  created?: string;
  lastModified?: string;
  metadata: {
    status: string;
    title: string;
    summary: string;
    readingDirection: string;
    publisher: string;
    ageRating: number | null;
    language: string;
    genres: string[];
    tags: string[];
    totalBookCount?: number | null;
    alternateTitles?: { label: string; title: string }[];
    links?: WebLink[];
  };
  booksMetadata: {
    authors: Author[];
    tags?: string[];
    summary: string;
    releaseDate: string | null;
  };
};

export type ReadProgress = {
  page: number;
  completed: boolean;
  readDate: string;
  lastModified?: string;
};

export type Book = {
  id: string;
  seriesId: string;
  seriesTitle: string;
  name: string;
  number: number;
  created?: string;
  lastModified?: string;
  fileLastModified?: string;
  size?: string;
  sizeBytes?: number;
  deleted?: boolean;
  media: {
    status: string;
    mediaType: string;
    pagesCount: number;
    mediaProfile?: string;
    epubDivinaCompatible?: boolean;
  };
  metadata: {
    title: string;
    number: string;
    numberSort: number;
    releaseDate: string | null;
    authors: Author[];
    summary?: string;
    tags?: string[];
  };
  readProgress?: ReadProgress | null;
};

export type ReadList = {
  id: string;
  name: string;
  summary?: string;
  ordered?: boolean;
  bookIds: string[];
  lastModifiedDate?: string;
};

export type Collection = {
  id: string;
  name: string;
  ordered?: boolean;
  seriesIds: string[];
};

export type BookPage = { number: number; fileName: string; mediaType: string };

export type User = { id: string; email: string; roles?: string[] };

export type SearchCondition = { [field: string]: JsonValue };
