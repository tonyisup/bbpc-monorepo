import { type FunctionReference } from "convex/server";
import { type GenericId as Id } from "convex/values";
export declare const api: PublicApiType;
export declare const internal: InternalApiType;
export type PublicApiType = {
    identity: {
        profile: {
            actionGateProbe: FunctionReference<"action", "public", {
                clientApiVersion: string;
            }, {
                allowed: true;
                cutoverStage: "S0" | "S1" | "S2" | "S3" | "S4";
                isAdmin: boolean;
            }>;
            me: FunctionReference<"query", "public", Record<string, never>, {
                email: string | null;
                id: Id<"users">;
                image: string | null;
                isAdmin: boolean;
                name: string | null;
            }>;
            updateMyName: FunctionReference<"mutation", "public", {
                clientApiVersion: string;
                name: string;
            }, {
                name: string;
                updatedAt: number;
            }>;
        };
    };
    pipeline: {
        status: {
            actionGateProbe: FunctionReference<"action", "public", {
                clientApiVersion: string;
                requiredPermission: string;
            }, {
                allowed: true;
                cutoverStage: "S0" | "S1" | "S2" | "S3" | "S4";
            }>;
            capabilities: FunctionReference<"query", "public", Record<string, never>, {
                name: string;
                permissions: Array<string>;
                servicePrincipalId: Id<"servicePrincipals">;
            }>;
            heartbeat: FunctionReference<"mutation", "public", {
                clientApiVersion: string;
                requiredPermission: string;
            }, {
                lastSeenAt: number;
            }>;
        };
    };
    system: {
        cutover: {
            getStatus: FunctionReference<"query", "public", Record<string, never>, {
                applicationWriteMode: "disabled";
                initialized: false;
            } | {
                apiVersion: string;
                applicationWriteMode: "disabled" | "enabled";
                cutoverRunId: string;
                cutoverStage: "S0" | "S1" | "S2" | "S3" | "S4";
                firstApplicationWriteAt: number | null;
                initialized: true;
                updatedAt: number;
            }>;
        };
        health: {
            readiness: FunctionReference<"query", "public", Record<string, never>, {
                apiVersion: string;
                applicationWritesEnabled: boolean;
                initialized: boolean;
            }>;
        };
    };
    episodes: {
        public: {
            getBySlug: FunctionReference<"query", "public", {
                slug: string;
            }, {
                assignments: Array<{
                    id: Id<"assignments">;
                    movie: {
                        id: Id<"movies">;
                        poster: string | null;
                        title: string;
                        tmdbId: number | null;
                        url: string;
                        year: number;
                    };
                    playable: boolean;
                    slug: string | null;
                    type: string;
                    user: {
                        id: Id<"users">;
                        image: string | null;
                        name: string | null;
                    };
                }>;
                date: string | null;
                description: string | null;
                extras: Array<{
                    id: Id<"extraReviews">;
                    review: {
                        id: Id<"reviews">;
                        movie: {
                            id: Id<"movies">;
                            poster: string | null;
                            title: string;
                            tmdbId: number | null;
                            url: string;
                            year: number;
                        } | null;
                        show: {
                            id: Id<"shows">;
                            poster: string | null;
                            title: string;
                            url: string;
                            year: number;
                        } | null;
                    };
                }>;
                id: Id<"episodes">;
                links: Array<{
                    id: Id<"episodeLinks">;
                    text: string;
                    url: string;
                }>;
                number: number;
                recording: string | null;
                slug: string | null;
                status: string | null;
                title: string;
            } | null>;
            latestPublished: FunctionReference<"query", "public", {
                onOrBefore: string;
            }, {
                assignments: Array<{
                    id: Id<"assignments">;
                    movie: {
                        id: Id<"movies">;
                        poster: string | null;
                        title: string;
                        tmdbId: number | null;
                        url: string;
                        year: number;
                    };
                    playable: boolean;
                    slug: string | null;
                    type: string;
                    user: {
                        id: Id<"users">;
                        image: string | null;
                        name: string | null;
                    };
                }>;
                date: string | null;
                description: string | null;
                extras: Array<{
                    id: Id<"extraReviews">;
                    review: {
                        id: Id<"reviews">;
                        movie: {
                            id: Id<"movies">;
                            poster: string | null;
                            title: string;
                            tmdbId: number | null;
                            url: string;
                            year: number;
                        } | null;
                        show: {
                            id: Id<"shows">;
                            poster: string | null;
                            title: string;
                            url: string;
                            year: number;
                        } | null;
                    };
                }>;
                id: Id<"episodes">;
                links: Array<{
                    id: Id<"episodeLinks">;
                    text: string;
                    url: string;
                }>;
                number: number;
                recording: string | null;
                slug: string | null;
                status: string | null;
                title: string;
            } | null>;
            listPage: FunctionReference<"query", "public", {
                paginationOpts: {
                    cursor: string | null;
                    endCursor?: string | null;
                    id?: number;
                    maximumBytesRead?: number;
                    maximumRowsRead?: number;
                    numItems: number;
                };
            }, {
                continueCursor: string;
                isDone: boolean;
                page: Array<{
                    assignments: Array<{
                        id: Id<"assignments">;
                        movie: {
                            id: Id<"movies">;
                            poster: string | null;
                            title: string;
                            tmdbId: number | null;
                            url: string;
                            year: number;
                        };
                        playable: boolean;
                        slug: string | null;
                        type: string;
                        user: {
                            id: Id<"users">;
                            image: string | null;
                            name: string | null;
                        };
                    }>;
                    date: string | null;
                    description: string | null;
                    extras: Array<{
                        id: Id<"extraReviews">;
                        review: {
                            id: Id<"reviews">;
                            movie: {
                                id: Id<"movies">;
                                poster: string | null;
                                title: string;
                                tmdbId: number | null;
                                url: string;
                                year: number;
                            } | null;
                            show: {
                                id: Id<"shows">;
                                poster: string | null;
                                title: string;
                                url: string;
                                year: number;
                            } | null;
                        };
                    }>;
                    id: Id<"episodes">;
                    links: Array<{
                        id: Id<"episodeLinks">;
                        text: string;
                        url: string;
                    }>;
                    number: number;
                    recording: string | null;
                    slug: string | null;
                    status: string | null;
                    title: string;
                }>;
                pageStatus?: "SplitRecommended" | "SplitRequired" | null;
                splitCursor?: string | null;
            }>;
            nextScheduled: FunctionReference<"query", "public", Record<string, never>, {
                assignments: Array<{
                    id: Id<"assignments">;
                    movie: {
                        id: Id<"movies">;
                        poster: string | null;
                        title: string;
                        tmdbId: number | null;
                        url: string;
                        year: number;
                    };
                    playable: boolean;
                    slug: string | null;
                    type: string;
                    user: {
                        id: Id<"users">;
                        image: string | null;
                        name: string | null;
                    };
                }>;
                date: string | null;
                description: string | null;
                extras: Array<{
                    id: Id<"extraReviews">;
                    review: {
                        id: Id<"reviews">;
                        movie: {
                            id: Id<"movies">;
                            poster: string | null;
                            title: string;
                            tmdbId: number | null;
                            url: string;
                            year: number;
                        } | null;
                        show: {
                            id: Id<"shows">;
                            poster: string | null;
                            title: string;
                            url: string;
                            year: number;
                        } | null;
                    };
                }>;
                id: Id<"episodes">;
                links: Array<{
                    id: Id<"episodeLinks">;
                    text: string;
                    url: string;
                }>;
                number: number;
                recording: string | null;
                slug: string | null;
                status: string | null;
                title: string;
            } | null>;
        };
    };
    catalog: {
        public: {
            getMovie: FunctionReference<"query", "public", {
                id: Id<"movies">;
            }, {
                id: Id<"movies">;
                poster: string | null;
                title: string;
                tmdbId: number | null;
                url: string;
                year: number;
            } | null>;
            getShow: FunctionReference<"query", "public", {
                id: Id<"shows">;
            }, {
                id: Id<"shows">;
                poster: string | null;
                title: string;
                url: string;
                year: number;
            } | null>;
            listMoviesPage: FunctionReference<"query", "public", {
                paginationOpts: {
                    cursor: string | null;
                    endCursor?: string | null;
                    id?: number;
                    maximumBytesRead?: number;
                    maximumRowsRead?: number;
                    numItems: number;
                };
            }, {
                continueCursor: string;
                isDone: boolean;
                page: Array<{
                    id: Id<"movies">;
                    poster: string | null;
                    title: string;
                    tmdbId: number | null;
                    url: string;
                    year: number;
                }>;
                pageStatus?: "SplitRecommended" | "SplitRequired" | null;
                splitCursor?: string | null;
            }>;
            listShowsPage: FunctionReference<"query", "public", {
                paginationOpts: {
                    cursor: string | null;
                    endCursor?: string | null;
                    id?: number;
                    maximumBytesRead?: number;
                    maximumRowsRead?: number;
                    numItems: number;
                };
            }, {
                continueCursor: string;
                isDone: boolean;
                page: Array<{
                    id: Id<"shows">;
                    poster: string | null;
                    title: string;
                    url: string;
                    year: number;
                }>;
                pageStatus?: "SplitRecommended" | "SplitRequired" | null;
                splitCursor?: string | null;
            }>;
            searchMovies: FunctionReference<"query", "public", {
                limit: number;
                query: string;
            }, Array<{
                id: Id<"movies">;
                poster: string | null;
                title: string;
                tmdbId: number | null;
                url: string;
                year: number;
            }>>;
            searchShows: FunctionReference<"query", "public", {
                limit: number;
                query: string;
            }, Array<{
                id: Id<"shows">;
                poster: string | null;
                title: string;
                url: string;
                year: number;
            }>>;
        };
    };
};
export type InternalApiType = {};
