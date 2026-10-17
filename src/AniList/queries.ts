const MEDIA_SUMMARY = `
  id
  type
  format
  status
  title { userPreferred romaji english native }
  coverImage { extraLarge large }
  chapters
  volumes
  isAdult
  countryOfOrigin
  averageScore
  startDate { year month day }
  siteUrl
`;

const LIST_ENTRY = `
  id
  status
  score(format: POINT_100)
  progress
  progressVolumes
  repeat
  notes
  private
  hiddenFromStatusLists
  customLists(asArray: true)
  startedAt { year month day }
  completedAt { year month day }
`;

export const SEARCH_QUERY = `
query (
  $page: Int
  $perPage: Int
  $search: String
  $sort: [MediaSort]
  $format: MediaFormat
  $status: MediaStatus
  $country: CountryCode
  $genreIn: [String]
  $genreNotIn: [String]
  $tagIn: [String]
  $tagNotIn: [String]
  $startAfter: FuzzyDateInt
  $startBefore: FuzzyDateInt
  $isAdult: Boolean
  $onList: Boolean
  $withEntry: Boolean!
) {
  Page(page: $page, perPage: $perPage) {
    pageInfo { hasNextPage total }
    media(
      type: MANGA
      search: $search
      sort: $sort
      format: $format
      status: $status
      countryOfOrigin: $country
      genre_in: $genreIn
      genre_not_in: $genreNotIn
      tag_in: $tagIn
      tag_not_in: $tagNotIn
      startDate_greater: $startAfter
      startDate_lesser: $startBefore
      isAdult: $isAdult
      onList: $onList
    ) {
      ${MEDIA_SUMMARY}
      mediaListEntry @include(if: $withEntry) { ${LIST_ENTRY} }
    }
  }
}`;

const PERSON_EDGES = `edges { role node { id name { userPreferred } image { medium } } }`;

const staff = (directive = "") =>
  `staff(perPage: $items, sort: [RELEVANCE, ID]) ${directive} {
    pageInfo { hasNextPage }
    ${PERSON_EDGES}
  }`;

const characters = (directive = "") =>
  `characters(perPage: $items, sort: [ROLE, RELEVANCE, ID]) ${directive} {
    pageInfo { hasNextPage }
    ${PERSON_EDGES}
  }`;

const relations = (directive = "") =>
  `relations ${directive} { edges { relationType(version: 2) node { ${MEDIA_SUMMARY} } } }`;

const recommendations = (directive = "") =>
  `recommendations(perPage: $items, sort: [RATING_DESC, ID]) ${directive} {
    pageInfo { hasNextPage }
    nodes { mediaRecommendation { ${MEDIA_SUMMARY} } }
  }`;

export const MEDIA_QUERY = `
query ($id: Int, $withEntry: Boolean!, $items: Int) {
  Media(id: $id, type: MANGA) {
    ${MEDIA_SUMMARY}
    idMal
    description(asHtml: false)
    synonyms
    bannerImage
    genres
    popularity
    tags { id name rank isAdult isGeneralSpoiler isMediaSpoiler }
    externalLinks { id url site }
    ${staff()}
    ${characters()}
    ${relations()}
    ${recommendations()}
    mediaListEntry @include(if: $withEntry) { ${LIST_ENTRY} }
  }
}`;

export const CONNECTIONS_QUERY = `
query (
  $id: Int
  $items: Int
  $staff: Boolean!
  $characters: Boolean!
  $relations: Boolean!
  $recommendations: Boolean!
) {
  Media(id: $id, type: MANGA) {
    ${staff("@include(if: $staff)")}
    ${characters("@include(if: $characters)")}
    ${relations("@include(if: $relations)")}
    ${recommendations("@include(if: $recommendations)")}
  }
}`;

export type HomeQuerySection = {
  alias: string;
  sort: readonly string[];
  status?: string;
  country?: string;
};

/**
 * Every home section in one request, each under its own alias. Sort and status
 * are GraphQL enums and go in bare; the country code is a string scalar.
 */
export function homeQuery(sections: readonly HomeQuerySection[]): string {
  const pages = sections.map((section) => {
    const args = [
      "type: MANGA",
      `sort: [${section.sort.join(", ")}]`,
      section.status ? `status: ${section.status}` : "",
      section.country ? `countryOfOrigin: ${JSON.stringify(section.country)}` : "",
      "isAdult: $isAdult",
    ].filter(Boolean);
    return `${section.alias}: Page(page: 1, perPage: $perPage) {
    pageInfo { hasNextPage }
    media(${args.join(", ")}) {
      ${MEDIA_SUMMARY}
      mediaListEntry @include(if: $withEntry) { ${LIST_ENTRY} }
    }
  }`;
  });
  return `
query ($perPage: Int, $isAdult: Boolean, $withEntry: Boolean!) {
  ${pages.join("\n  ")}
}`;
}

export const MEDIA_SUMMARY_QUERY = `
query ($id: Int, $withEntry: Boolean!) {
  Media(id: $id, type: MANGA) {
    ${MEDIA_SUMMARY}
    mediaListEntry @include(if: $withEntry) { ${LIST_ENTRY} }
  }
}`;

export const ENTRY_QUERY = `
query ($id: Int) {
  Media(id: $id, type: MANGA) {
    id
    chapters
    volumes
    mediaListEntry { ${LIST_ENTRY} }
  }
}`;

export const MEDIA_LIST_QUERY = `
query ($userId: Int, $status: MediaListStatus, $page: Int, $perPage: Int) {
  Page(page: $page, perPage: $perPage) {
    pageInfo { hasNextPage total }
    mediaList(userId: $userId, type: MANGA, status: $status, sort: [UPDATED_TIME_DESC]) {
      status
      progress
      progressVolumes
      media { ${MEDIA_SUMMARY} }
    }
  }
}`;

export const VIEWER_QUERY = `
query {
  Viewer {
    id
    name
    avatar { large }
    bannerImage
    options { displayAdultContent }
    mediaListOptions { scoreFormat mangaList { customLists } }
    statistics { manga { count chaptersRead meanScore } }
  }
}`;

export const TAG_COLLECTION_QUERY = `
query {
  MediaTagCollection { name category isAdult }
}`;

export const SAVE_ENTRY_MUTATION = `
mutation (
  $mediaId: Int
  $status: MediaListStatus
  $scoreRaw: Int
  $progress: Int
  $progressVolumes: Int
  $repeat: Int
  $notes: String
  $private: Boolean
  $hiddenFromStatusLists: Boolean
  $customLists: [String]
  $startedAt: FuzzyDateInput
  $completedAt: FuzzyDateInput
) {
  SaveMediaListEntry(
    mediaId: $mediaId
    status: $status
    scoreRaw: $scoreRaw
    progress: $progress
    progressVolumes: $progressVolumes
    repeat: $repeat
    notes: $notes
    private: $private
    hiddenFromStatusLists: $hiddenFromStatusLists
    customLists: $customLists
    startedAt: $startedAt
    completedAt: $completedAt
  ) { id }
}`;

export const DELETE_ENTRY_MUTATION = `
mutation ($id: Int) {
  DeleteMediaListEntry(id: $id) { deleted }
}`;
