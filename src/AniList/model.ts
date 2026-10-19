import {
  SectionStyle,
  SearchMenuPicker,
  SearchStepper,
  SearchToggle,
  type Option,
  type SearchListField,
  type SortOption,
  type TrackerStatusOption,
} from "@mana-app/types";

export const SITE_URL = "https://anilist.co";
export const API_URL = "https://graphql.anilist.co";
export const AUTHORIZE_URL = `${SITE_URL}/api/v2/oauth/authorize`;
export const PIN_REDIRECT_URL = `${SITE_URL}/api/v2/oauth/pin`;
export const REDIRECT_URL = "com.seyden.mana://oauth/anilist";
export const CLIENT_ID = "53586";
export const DIAGNOSTIC_URL = "https://postman-echo.com/get";
export const DEVELOPER_URL = `${SITE_URL}/settings/developer`;
export const MAL_URL = "https://myanimelist.net";

export const PAGE_SIZE = 30;
export const DETAIL_ITEMS = 10;
export const MIN_YEAR = 1940;

export const TAG_PREFIX = "tag:";

export const ListID = {
  Trending: "trending",
  Popular: "popular",
  TopRated: "top-rated",
  Manhwa: "manhwa",
  Releasing: "releasing",
} as const;

export const LIST_STATUS_PREFIX = "status:";

export type HomeSection = {
  id: string;
  alias: string;
  title: string;
  style?: SectionStyle;
  sort: string[];
  status?: string;
  country?: string;
};

export const HOME_SECTIONS: HomeSection[] = [
  {
    id: ListID.Trending,
    alias: "trending",
    title: "Trending Now",
    style: SectionStyle.SimpleHero,
    sort: ["TRENDING_DESC", "POPULARITY_DESC"],
  },
  {
    id: ListID.Releasing,
    alias: "releasing",
    title: "Popular Releasing",
    style: SectionStyle.DetailedDoubleRowPaged,
    sort: ["POPULARITY_DESC"],
    status: "RELEASING",
  },
  {
    id: ListID.Manhwa,
    alias: "manhwa",
    title: "Popular Manhwa",
    sort: ["POPULARITY_DESC"],
    country: "KR",
  },
  { id: ListID.Popular, alias: "popular", title: "All Time Popular", sort: ["POPULARITY_DESC"] },
  {
    id: ListID.TopRated,
    alias: "topRated",
    title: "Top Rated",
    style: SectionStyle.DetailedVerticalList,
    sort: ["SCORE_DESC"],
  },
];

export const InfoSectionID = {
  Characters: "characters",
  Staff: "staff",
  Relations: "relations",
  Recommendations: "recommendations",
  Links: "links",
} as const;

export const FilterID = {
  Tags: "tags",
  Format: "format",
  Status: "status",
  Country: "country",
  Year: "year",
  OnList: "on_list",
} as const;

export const SortID = {
  Popularity: "POPULARITY",
  Trending: "TRENDING",
  Score: "SCORE",
  Favourites: "FAVOURITES",
  Updated: "UPDATED_AT",
  StartDate: "START_DATE",
  Chapters: "CHAPTERS",
  Title: "TITLE_ROMAJI",
} as const;

export const PreferenceID = {
  ClientId: "client-id",
  TitleLanguage: "title-language",
  ShowAdult: "show-adult",
  AutoComplete: "auto-complete",
  AutoDates: "auto-dates",
  SignInDiagnostics: "sign-in-diagnostics",
} as const;

export const TitleLanguage = {
  Preferred: "userPreferred",
  Romaji: "romaji",
  English: "english",
  Native: "native",
} as const;

export const PREFERENCE_DEFAULTS = {
  [PreferenceID.ClientId]: "",
  [PreferenceID.TitleLanguage]: TitleLanguage.Preferred as string,
  [PreferenceID.ShowAdult]: false,
  [PreferenceID.AutoComplete]: true,
  [PreferenceID.AutoDates]: true,
  [PreferenceID.SignInDiagnostics]: false,
};

export const TITLE_LANGUAGE_OPTIONS: Option[] = [
  { id: TitleLanguage.Preferred, title: "AniList setting" },
  { id: TitleLanguage.Romaji, title: "Romaji" },
  { id: TitleLanguage.English, title: "English" },
  { id: TitleLanguage.Native, title: "Native" },
];

export const ListStatus = {
  Current: "CURRENT",
  Planning: "PLANNING",
  Completed: "COMPLETED",
  Paused: "PAUSED",
  Dropped: "DROPPED",
  Repeating: "REPEATING",
} as const;

export const STATUS_OPTIONS: TrackerStatusOption[] = [
  { id: ListStatus.Current, title: "Reading", isDefault: true },
  { id: ListStatus.Planning, title: "Plan to Read" },
  { id: ListStatus.Completed, title: "Completed" },
  { id: ListStatus.Repeating, title: "Rereading" },
  { id: ListStatus.Paused, title: "Paused" },
  { id: ListStatus.Dropped, title: "Dropped" },
];

export const EntryField = {
  Status: "status",
  Score: "score",
  Progress: "progress",
  ProgressVolumes: "progressVolumes",
  Repeat: "repeat",
  StartedAt: "startedAt",
  CompletedAt: "completedAt",
  Notes: "notes",
  CustomLists: "customLists",
  Private: "private",
  HiddenFromStatusLists: "hiddenFromStatusLists",
} as const;

export const ScoreFormat = {
  Point100: "POINT_100",
  Point10Decimal: "POINT_10_DECIMAL",
  Point10: "POINT_10",
  Point5: "POINT_5",
  Point3: "POINT_3",
} as const;

export const STAR_SCORES: Option[] = [
  { id: "0", title: "No score" },
  ...[1, 2, 3, 4, 5].map((stars) => ({ id: String(stars * 20), title: "★".repeat(stars) })),
];

export const SMILEY_SCORES: Option[] = [
  { id: "0", title: "No score" },
  { id: "35", title: "Disliked" },
  { id: "60", title: "Neutral" },
  { id: "85", title: "Liked" },
];

export const GENRES: readonly string[] = [
  "Action",
  "Adventure",
  "Comedy",
  "Drama",
  "Ecchi",
  "Fantasy",
  "Horror",
  "Mahou Shoujo",
  "Mecha",
  "Music",
  "Mystery",
  "Psychological",
  "Romance",
  "Sci-Fi",
  "Slice of Life",
  "Sports",
  "Supernatural",
  "Thriller",
];

export const ADULT_GENRES: readonly string[] = ["Hentai"];

export const FORMAT_OPTIONS: Option[] = [
  { id: "", title: "Any" },
  { id: "MANGA", title: "Manga" },
  { id: "NOVEL", title: "Light Novel" },
  { id: "ONE_SHOT", title: "One Shot" },
];

export const MEDIA_STATUS_OPTIONS: Option[] = [
  { id: "", title: "Any" },
  { id: "RELEASING", title: "Releasing" },
  { id: "FINISHED", title: "Finished" },
  { id: "NOT_YET_RELEASED", title: "Not Yet Released" },
  { id: "HIATUS", title: "Hiatus" },
  { id: "CANCELLED", title: "Cancelled" },
];

export const COUNTRY_OPTIONS: Option[] = [
  { id: "", title: "Any" },
  { id: "JP", title: "Japan" },
  { id: "KR", title: "South Korea" },
  { id: "CN", title: "China" },
  { id: "TW", title: "Taiwan" },
];

export const SEARCH_FIELDS: SearchListField[] = [
  SearchMenuPicker({ id: FilterID.Format, title: "Format", options: FORMAT_OPTIONS }),
  SearchMenuPicker({
    id: FilterID.Status,
    title: "Publishing Status",
    options: MEDIA_STATUS_OPTIONS,
  }),
  SearchMenuPicker({ id: FilterID.Country, title: "Country", options: COUNTRY_OPTIONS }),
  SearchStepper({
    id: FilterID.Year,
    title: "Year",
    subtitle: "Titles that started in this year",
    lowerBound: MIN_YEAR,
    upperBound: 2100,
    step: 1,
  }),
];

export const SIGNED_IN_FIELDS: SearchListField[] = [
  SearchToggle({
    id: FilterID.OnList,
    title: "On My List",
    subtitle: "Only titles already on your AniList",
  }),
];

export const SORT_OPTIONS: SortOption[] = [
  {
    id: SortID.Popularity,
    title: "Popularity",
    isDefault: true,
    isOrderable: true,
    defaultAscending: false,
  },
  { id: SortID.Trending, title: "Trending", isOrderable: true, defaultAscending: false },
  { id: SortID.Score, title: "Average Score", isOrderable: true, defaultAscending: false },
  { id: SortID.Favourites, title: "Favourites", isOrderable: true, defaultAscending: false },
  { id: SortID.Updated, title: "Last Updated", isOrderable: true, defaultAscending: false },
  { id: SortID.StartDate, title: "Release Date", isOrderable: true, defaultAscending: false },
  { id: SortID.Chapters, title: "Chapters", isOrderable: true, defaultAscending: false },
  { id: SortID.Title, title: "Title", isOrderable: true, defaultAscending: true },
];

export type FuzzyDate = {
  year?: number | null;
  month?: number | null;
  day?: number | null;
};

export type MediaTitle = {
  userPreferred?: string | null;
  romaji?: string | null;
  english?: string | null;
  native?: string | null;
};

export type MediaListEntry = {
  id: number;
  status: string;
  score?: number | null;
  progress?: number | null;
  progressVolumes?: number | null;
  repeat?: number | null;
  notes?: string | null;
  private?: boolean | null;
  hiddenFromStatusLists?: boolean | null;
  customLists?: { name: string; enabled: boolean }[] | null;
  startedAt?: FuzzyDate | null;
  completedAt?: FuzzyDate | null;
};

export type MediaSummary = {
  id: number;
  type?: string | null;
  format?: string | null;
  status?: string | null;
  title: MediaTitle;
  coverImage?: { extraLarge?: string | null; large?: string | null } | null;
  chapters?: number | null;
  volumes?: number | null;
  isAdult?: boolean | null;
  countryOfOrigin?: string | null;
  averageScore?: number | null;
  startDate?: FuzzyDate | null;
  siteUrl?: string | null;
  mediaListEntry?: MediaListEntry | null;
};

export type MediaTag = {
  id: number;
  name: string;
  rank?: number | null;
  isAdult?: boolean | null;
  isGeneralSpoiler?: boolean | null;
  isMediaSpoiler?: boolean | null;
};

export type PersonEdge = {
  role?: string | null;
  node?: {
    id: number;
    name?: { userPreferred?: string | null } | null;
    image?: { medium?: string | null } | null;
  } | null;
};

export type PersonConnection = {
  pageInfo?: PageInfo | null;
  edges?: PersonEdge[] | null;
};

export type RelationConnection = {
  edges?: { relationType?: string | null; node?: MediaSummary | null }[] | null;
};

export type RecommendationConnection = {
  pageInfo?: PageInfo | null;
  nodes?: { mediaRecommendation?: MediaSummary | null }[] | null;
};

export type MediaConnections = {
  staff?: PersonConnection | null;
  characters?: PersonConnection | null;
  relations?: RelationConnection | null;
  recommendations?: RecommendationConnection | null;
};

export type MediaDetail = MediaSummary &
  MediaConnections & {
    idMal?: number | null;
    description?: string | null;
    synonyms?: string[] | null;
    bannerImage?: string | null;
    genres?: string[] | null;
    tags?: MediaTag[] | null;
    popularity?: number | null;
    externalLinks?: { id: number; url?: string | null; site: string }[] | null;
  };

export type PageInfo = { hasNextPage?: boolean | null; total?: number | null };

export type MediaPageResponse = {
  Page: { pageInfo?: PageInfo | null; media: MediaSummary[] };
};

export type MediaListPageResponse = {
  Page: {
    pageInfo?: PageInfo | null;
    mediaList: {
      status: string;
      progress?: number | null;
      progressVolumes?: number | null;
      media: MediaSummary;
    }[];
  };
};

export type MediaDetailResponse = { Media: MediaDetail };

export type HomeResponse = Record<string, MediaPageResponse["Page"] | null | undefined>;

export type MediaEntryResponse = {
  Media: {
    id: number;
    chapters?: number | null;
    volumes?: number | null;
    mediaListEntry?: MediaListEntry | null;
  };
};

export type Viewer = {
  id: number;
  name: string;
  avatar?: { large?: string | null } | null;
  bannerImage?: string | null;
  options?: { displayAdultContent?: boolean | null } | null;
  mediaListOptions?: {
    scoreFormat?: string | null;
    mangaList?: { customLists?: string[] | null } | null;
  } | null;
  statistics?: {
    manga?: {
      count?: number | null;
      chaptersRead?: number | null;
      meanScore?: number | null;
    } | null;
  } | null;
};

export type ViewerResponse = { Viewer: Viewer };

export type TagCollectionResponse = {
  MediaTagCollection: { name: string; category?: string | null; isAdult?: boolean | null }[];
};

export type SaveEntryVariables = {
  mediaId: number;
  status?: string;
  scoreRaw?: number;
  progress?: number;
  progressVolumes?: number;
  repeat?: number;
  notes?: string;
  private?: boolean;
  hiddenFromStatusLists?: boolean;
  customLists?: string[];
  startedAt?: FuzzyDate;
  completedAt?: FuzzyDate;
};
