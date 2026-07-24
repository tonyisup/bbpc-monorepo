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
        admin: {
            assignRole: FunctionReference<"mutation", "public", {
                clientApiVersion: string;
                roleId: Id<"roles">;
                userId: Id<"users">;
            }, {
                assignedAt: number | null;
                assignedBy: Id<"users"> | null;
                id: Id<"userRoles">;
                role: {
                    admin: boolean;
                    description: string;
                    id: Id<"roles">;
                    legacyId: number | null;
                    name: string;
                    permissions: Array<string>;
                };
            }>;
            createRole: FunctionReference<"mutation", "public", {
                admin: boolean;
                clientApiVersion: string;
                description: string;
                name: string;
            }, {
                admin: boolean;
                description: string;
                id: Id<"roles">;
                legacyId: number | null;
                name: string;
                permissions: Array<string>;
            }>;
            createUser: FunctionReference<"mutation", "public", {
                clientApiVersion: string;
                email: string;
                name: string;
            }, {
                createdAt: number;
                email: string | null;
                id: Id<"users">;
                image: string | null;
                isAdmin: boolean;
                legacyId: string | null;
                name: string | null;
                nextSyllabus: {
                    id: Id<"syllabusEntries">;
                    movie: {
                        id: Id<"movies">;
                        title: string;
                    };
                    notes: string | null;
                    order: number;
                } | null;
                roles: Array<{
                    assignedAt: number | null;
                    assignedBy: Id<"users"> | null;
                    id: Id<"userRoles">;
                    role: {
                        admin: boolean;
                        description: string;
                        id: Id<"roles">;
                        legacyId: number | null;
                        name: string;
                        permissions: Array<string>;
                    };
                }>;
                status: "active" | "disabled";
                updatedAt: number;
            }>;
            deleteRole: FunctionReference<"mutation", "public", {
                clientApiVersion: string;
                id: Id<"roles">;
            }, {
                id: Id<"roles">;
            }>;
            getRole: FunctionReference<"query", "public", {
                id: Id<"roles">;
            }, {
                admin: boolean;
                description: string;
                id: Id<"roles">;
                legacyId: number | null;
                name: string;
                permissions: Array<string>;
                userCount: number;
                userCountIsExact: boolean;
            } | null>;
            getUser: FunctionReference<"query", "public", {
                id: Id<"users">;
            }, {
                createdAt: number;
                email: string | null;
                id: Id<"users">;
                image: string | null;
                isAdmin: boolean;
                legacyId: string | null;
                name: string | null;
                nextSyllabus: {
                    id: Id<"syllabusEntries">;
                    movie: {
                        id: Id<"movies">;
                        title: string;
                    };
                    notes: string | null;
                    order: number;
                } | null;
                roles: Array<{
                    assignedAt: number | null;
                    assignedBy: Id<"users"> | null;
                    id: Id<"userRoles">;
                    role: {
                        admin: boolean;
                        description: string;
                        id: Id<"roles">;
                        legacyId: number | null;
                        name: string;
                        permissions: Array<string>;
                    };
                }>;
                status: "active" | "disabled";
                updatedAt: number;
            } | null>;
            listRoles: FunctionReference<"query", "public", Record<string, never>, Array<{
                admin: boolean;
                description: string;
                id: Id<"roles">;
                legacyId: number | null;
                name: string;
                permissions: Array<string>;
                userCount: number;
                userCountIsExact: boolean;
            }>>;
            listUsersPage: FunctionReference<"query", "public", {
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
                    createdAt: number;
                    email: string | null;
                    id: Id<"users">;
                    image: string | null;
                    isAdmin: boolean;
                    legacyId: string | null;
                    name: string | null;
                    nextSyllabus: {
                        id: Id<"syllabusEntries">;
                        movie: {
                            id: Id<"movies">;
                            title: string;
                        };
                        notes: string | null;
                        order: number;
                    } | null;
                    roles: Array<{
                        assignedAt: number | null;
                        assignedBy: Id<"users"> | null;
                        id: Id<"userRoles">;
                        role: {
                            admin: boolean;
                            description: string;
                            id: Id<"roles">;
                            legacyId: number | null;
                            name: string;
                            permissions: Array<string>;
                        };
                    }>;
                    status: "active" | "disabled";
                    updatedAt: number;
                }>;
                pageStatus?: "SplitRecommended" | "SplitRequired" | null;
                splitCursor?: string | null;
            }>;
            removeRoleMembership: FunctionReference<"mutation", "public", {
                clientApiVersion: string;
                id: Id<"userRoles">;
            }, {
                id: Id<"userRoles">;
            }>;
            setUserStatus: FunctionReference<"mutation", "public", {
                clientApiVersion: string;
                id: Id<"users">;
                status: "active" | "disabled";
            }, {
                createdAt: number;
                email: string | null;
                id: Id<"users">;
                image: string | null;
                isAdmin: boolean;
                legacyId: string | null;
                name: string | null;
                nextSyllabus: {
                    id: Id<"syllabusEntries">;
                    movie: {
                        id: Id<"movies">;
                        title: string;
                    };
                    notes: string | null;
                    order: number;
                } | null;
                roles: Array<{
                    assignedAt: number | null;
                    assignedBy: Id<"users"> | null;
                    id: Id<"userRoles">;
                    role: {
                        admin: boolean;
                        description: string;
                        id: Id<"roles">;
                        legacyId: number | null;
                        name: string;
                        permissions: Array<string>;
                    };
                }>;
                status: "active" | "disabled";
                updatedAt: number;
            }>;
            updateRole: FunctionReference<"mutation", "public", {
                admin: boolean;
                clientApiVersion: string;
                description: string;
                id: Id<"roles">;
                name: string;
            }, {
                admin: boolean;
                description: string;
                id: Id<"roles">;
                legacyId: number | null;
                name: string;
                permissions: Array<string>;
            }>;
            updateUser: FunctionReference<"mutation", "public", {
                clientApiVersion: string;
                email: string;
                id: Id<"users">;
                name: string;
            }, {
                createdAt: number;
                email: string | null;
                id: Id<"users">;
                image: string | null;
                isAdmin: boolean;
                legacyId: string | null;
                name: string | null;
                nextSyllabus: {
                    id: Id<"syllabusEntries">;
                    movie: {
                        id: Id<"movies">;
                        title: string;
                    };
                    notes: string | null;
                    order: number;
                } | null;
                roles: Array<{
                    assignedAt: number | null;
                    assignedBy: Id<"users"> | null;
                    id: Id<"userRoles">;
                    role: {
                        admin: boolean;
                        description: string;
                        id: Id<"roles">;
                        legacyId: number | null;
                        name: string;
                        permissions: Array<string>;
                    };
                }>;
                status: "active" | "disabled";
                updatedAt: number;
            }>;
        };
        roles: {
            mine: FunctionReference<"query", "public", Record<string, never>, Array<{
                assignedAt: number | null;
                assignedBy: Id<"users"> | null;
                id: Id<"userRoles">;
                role: {
                    admin: boolean;
                    description: string;
                    id: Id<"roles">;
                    legacyId: number | null;
                    name: string;
                    permissions: Array<string>;
                };
            }>>;
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
            getByLegacyId: FunctionReference<"query", "public", {
                legacyId: string;
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
            search: FunctionReference<"query", "public", {
                limit: number;
                query: string;
            }, Array<{
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
            }>>;
        };
        audio: {
            deleteMine: FunctionReference<"mutation", "public", {
                clientApiVersion: string;
                id: Id<"episodeAudioMessages">;
            }, {
                id: Id<"episodeAudioMessages">;
            }>;
            listMine: FunctionReference<"query", "public", {
                episodeId: Id<"episodes">;
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
                    createdAt: number;
                    episodeId: Id<"episodes"> | null;
                    fileKey: string | null;
                    id: Id<"episodeAudioMessages">;
                    notes: string | null;
                    url: string;
                }>;
                pageStatus?: "SplitRecommended" | "SplitRequired" | null;
                splitCursor?: string | null;
            }>;
            updateMine: FunctionReference<"mutation", "public", {
                clientApiVersion: string;
                episodeId: Id<"episodes">;
                fileKey: string;
                id: Id<"episodeAudioMessages">;
                notes?: string;
            }, {
                createdAt: number;
                episodeId: Id<"episodes"> | null;
                fileKey: string | null;
                id: Id<"episodeAudioMessages">;
                notes: string | null;
                url: string;
            }>;
            usageForEpisode: FunctionReference<"query", "public", {
                episodeId: Id<"episodes">;
            }, {
                canUpload: boolean;
                count: number;
                limit: number;
            }>;
        };
        admin: {
            addAudioMessage: FunctionReference<"mutation", "public", {
                clientApiVersion: string;
                episodeId: Id<"episodes">;
                fileKey?: string;
                notes?: string;
                url: string;
            }, {
                createdAt: number;
                episodeId: Id<"episodes"> | null;
                fileKey: string | null;
                id: Id<"episodeAudioMessages">;
                notes: string | null;
                url: string;
                user: {
                    email: string | null;
                    id: Id<"users">;
                    image: string | null;
                    name: string | null;
                    status: "active" | "disabled";
                };
            }>;
            addLink: FunctionReference<"mutation", "public", {
                clientApiVersion: string;
                episodeId: Id<"episodes">;
                text: string;
                url: string;
            }, {
                id: Id<"episodeLinks">;
                text: string;
                url: string;
            }>;
            createEpisode: FunctionReference<"mutation", "public", {
                clientApiVersion: string;
                number: number;
                title: string;
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
                notes: string | null;
                number: number;
                recording: string | null;
                seoDescription: string | null;
                seoKeywords: string | null;
                seoTitle: string | null;
                slug: string | null;
                status: string | null;
                title: string;
            }>;
            getById: FunctionReference<"query", "public", {
                id: Id<"episodes">;
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
                notes: string | null;
                number: number;
                recording: string | null;
                seoDescription: string | null;
                seoKeywords: string | null;
                seoTitle: string | null;
                slug: string | null;
                status: string | null;
                title: string;
            } | null>;
            getByNumber: FunctionReference<"query", "public", {
                number: number;
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
                notes: string | null;
                number: number;
                recording: string | null;
                seoDescription: string | null;
                seoKeywords: string | null;
                seoTitle: string | null;
                slug: string | null;
                status: string | null;
                title: string;
            } | null>;
            listAudioMessages: FunctionReference<"query", "public", {
                episodeId: Id<"episodes">;
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
                    createdAt: number;
                    episodeId: Id<"episodes"> | null;
                    fileKey: string | null;
                    id: Id<"episodeAudioMessages">;
                    notes: string | null;
                    url: string;
                    user: {
                        email: string | null;
                        id: Id<"users">;
                        image: string | null;
                        name: string | null;
                        status: "active" | "disabled";
                    };
                }>;
                pageStatus?: "SplitRecommended" | "SplitRequired" | null;
                splitCursor?: string | null;
            }>;
            removeLink: FunctionReference<"mutation", "public", {
                clientApiVersion: string;
                id: Id<"episodeLinks">;
            }, {
                id: Id<"episodeLinks">;
            }>;
            updateEpisode: FunctionReference<"mutation", "public", {
                clientApiVersion: string;
                date?: string | null;
                description?: string | null;
                id: Id<"episodes">;
                notes?: string | null;
                number?: number;
                recording?: string | null;
                seoDescription?: string | null;
                seoKeywords?: string | null;
                seoTitle?: string | null;
                slug?: string | null;
                status?: string;
                title?: string;
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
                notes: string | null;
                number: number;
                recording: string | null;
                seoDescription: string | null;
                seoKeywords: string | null;
                seoTitle: string | null;
                slug: string | null;
                status: string | null;
                title: string;
            }>;
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
        admin: {
            deleteMovie: FunctionReference<"mutation", "public", {
                clientApiVersion: string;
                id: Id<"movies">;
            }, {
                id: Id<"movies">;
            }>;
            deleteShow: FunctionReference<"mutation", "public", {
                clientApiVersion: string;
                id: Id<"shows">;
            }, {
                id: Id<"shows">;
            }>;
            updateShow: FunctionReference<"mutation", "public", {
                clientApiVersion: string;
                id: Id<"shows">;
                poster?: string;
                title: string;
                url: string;
                year: number;
            }, {
                id: Id<"shows">;
                poster: string | null;
                title: string;
                url: string;
                year: number;
            }>;
        };
        write: {
            upsertMovieByUrl: FunctionReference<"mutation", "public", {
                clientApiVersion: string;
                poster: string;
                title: string;
                tmdbId?: number;
                url: string;
                year: number;
            }, {
                id: Id<"movies">;
                poster: string | null;
                title: string;
                tmdbId: number | null;
                url: string;
                year: number;
            }>;
            upsertShowByUrl: FunctionReference<"mutation", "public", {
                clientApiVersion: string;
                poster: string;
                title: string;
                url: string;
                year: number;
            }, {
                id: Id<"shows">;
                poster: string | null;
                title: string;
                url: string;
                year: number;
            }>;
        };
        external: {
            getMovie: FunctionReference<"action", "public", {
                id: number;
            }, {
                backdrop_path: string | null;
                first_air_date: string | null;
                id: number;
                imdb_id: string | null;
                imdb_path: string | null;
                media_type: string;
                overview: string;
                popularity: number;
                poster_path: string | null;
                release_date: string;
                title: string;
                vote_average: number;
                vote_count: number;
            }>;
            getShow: FunctionReference<"action", "public", {
                id: number;
            }, {
                backdrop_path: string | null;
                first_air_date: string | null;
                id: number;
                imdb_id: string | null;
                imdb_path: string | null;
                media_type: string;
                overview: string;
                popularity: number;
                poster_path: string | null;
                release_date: string;
                title: string;
                vote_average: number;
                vote_count: number;
            }>;
            searchMovies: FunctionReference<"action", "public", {
                page?: number;
                query: string;
            }, {
                page: number;
                results: Array<{
                    backdrop_path: string | null;
                    first_air_date: string | null;
                    id: number;
                    imdb_id: string | null;
                    imdb_path: string | null;
                    media_type: string;
                    overview: string;
                    popularity: number;
                    poster_path: string | null;
                    release_date: string;
                    title: string;
                    vote_average: number;
                    vote_count: number;
                }>;
            }>;
            searchShows: FunctionReference<"action", "public", {
                page?: number;
                query: string;
            }, {
                page: number;
                results: Array<{
                    backdrop_path: string | null;
                    first_air_date: string | null;
                    id: number;
                    imdb_id: string | null;
                    imdb_path: string | null;
                    media_type: string;
                    overview: string;
                    popularity: number;
                    poster_path: string | null;
                    release_date: string;
                    title: string;
                    vote_average: number;
                    vote_count: number;
                }>;
            }>;
        };
    };
    assignments: {
        admin: {
            create: FunctionReference<"mutation", "public", {
                clientApiVersion: string;
                episodeId: Id<"episodes">;
                movieId: Id<"movies">;
                type: string;
                userId: Id<"users">;
            }, {
                episode: {
                    id: Id<"episodes">;
                    number: number;
                    slug: string | null;
                    status: string | null;
                    title: string;
                };
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
                type: "HOMEWORK" | "EXTRA_CREDIT" | "BONUS";
                user: {
                    id: Id<"users">;
                    image: string | null;
                    name: string | null;
                    status: "active" | "disabled";
                };
            }>;
            getById: FunctionReference<"query", "public", {
                id: Id<"assignments">;
            }, {
                episode: {
                    id: Id<"episodes">;
                    number: number;
                    slug: string | null;
                    status: string | null;
                    title: string;
                };
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
                type: "HOMEWORK" | "EXTRA_CREDIT" | "BONUS";
                user: {
                    id: Id<"users">;
                    image: string | null;
                    name: string | null;
                    status: "active" | "disabled";
                };
            } | null>;
            listForEpisode: FunctionReference<"query", "public", {
                episodeId: Id<"episodes">;
            }, Array<{
                episode: {
                    id: Id<"episodes">;
                    number: number;
                    slug: string | null;
                    status: string | null;
                    title: string;
                };
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
                type: "HOMEWORK" | "EXTRA_CREDIT" | "BONUS";
                user: {
                    id: Id<"users">;
                    image: string | null;
                    name: string | null;
                    status: "active" | "disabled";
                };
            }>>;
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
                    episode: {
                        id: Id<"episodes">;
                        number: number;
                        slug: string | null;
                        status: string | null;
                        title: string;
                    };
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
                    type: "HOMEWORK" | "EXTRA_CREDIT" | "BONUS";
                    user: {
                        id: Id<"users">;
                        image: string | null;
                        name: string | null;
                        status: "active" | "disabled";
                    };
                }>;
                pageStatus?: "SplitRecommended" | "SplitRequired" | null;
                splitCursor?: string | null;
            }>;
            removeIfUnreferenced: FunctionReference<"mutation", "public", {
                clientApiVersion: string;
                id: Id<"assignments">;
            }, {
                id: Id<"assignments">;
            }>;
            setType: FunctionReference<"mutation", "public", {
                clientApiVersion: string;
                id: Id<"assignments">;
                type: string;
            }, {
                episode: {
                    id: Id<"episodes">;
                    number: number;
                    slug: string | null;
                    status: string | null;
                    title: string;
                };
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
                type: "HOMEWORK" | "EXTRA_CREDIT" | "BONUS";
                user: {
                    id: Id<"users">;
                    image: string | null;
                    name: string | null;
                    status: "active" | "disabled";
                };
            }>;
            updateSlug: FunctionReference<"mutation", "public", {
                clientApiVersion: string;
                id: Id<"assignments">;
                slug?: string;
            }, {
                episode: {
                    id: Id<"episodes">;
                    number: number;
                    slug: string | null;
                    status: string | null;
                    title: string;
                };
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
                type: "HOMEWORK" | "EXTRA_CREDIT" | "BONUS";
                user: {
                    id: Id<"users">;
                    image: string | null;
                    name: string | null;
                    status: "active" | "disabled";
                };
            }>;
        };
    };
    syllabus: {
        admin: {
            assignEpisode: FunctionReference<"mutation", "public", {
                assignmentType: string;
                clientApiVersion: string;
                episodeNumber: number;
                syllabusId: Id<"syllabusEntries">;
            }, {
                assignment: {
                    episode: {
                        id: Id<"episodes">;
                        number: number;
                        slug: string | null;
                        status: string | null;
                        title: string;
                    };
                    id: Id<"assignments">;
                    playable: boolean;
                    slug: string | null;
                    type: string;
                } | null;
                createdAt: number;
                id: Id<"syllabusEntries">;
                movie: {
                    id: Id<"movies">;
                    poster: string | null;
                    title: string;
                    tmdbId: number | null;
                    url: string;
                    year: number;
                };
                notes: string | null;
                order: number;
                user: {
                    email: string | null;
                    id: Id<"users">;
                    name: string | null;
                    status: "active" | "disabled";
                };
            }>;
            getById: FunctionReference<"query", "public", {
                id: Id<"syllabusEntries">;
            }, {
                assignment: {
                    episode: {
                        id: Id<"episodes">;
                        number: number;
                        slug: string | null;
                        status: string | null;
                        title: string;
                    };
                    id: Id<"assignments">;
                    playable: boolean;
                    slug: string | null;
                    type: string;
                } | null;
                createdAt: number;
                id: Id<"syllabusEntries">;
                movie: {
                    id: Id<"movies">;
                    poster: string | null;
                    title: string;
                    tmdbId: number | null;
                    url: string;
                    year: number;
                };
                notes: string | null;
                order: number;
                user: {
                    email: string | null;
                    id: Id<"users">;
                    name: string | null;
                    status: "active" | "disabled";
                };
            } | null>;
            listForUser: FunctionReference<"query", "public", {
                userId: Id<"users">;
            }, Array<{
                assignment: {
                    episode: {
                        id: Id<"episodes">;
                        number: number;
                        slug: string | null;
                        status: string | null;
                        title: string;
                    };
                    id: Id<"assignments">;
                    playable: boolean;
                    slug: string | null;
                    type: string;
                } | null;
                createdAt: number;
                id: Id<"syllabusEntries">;
                movie: {
                    id: Id<"movies">;
                    poster: string | null;
                    title: string;
                    tmdbId: number | null;
                    url: string;
                    year: number;
                };
                notes: string | null;
                order: number;
                user: {
                    email: string | null;
                    id: Id<"users">;
                    name: string | null;
                    status: "active" | "disabled";
                };
            }>>;
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
                    assignment: {
                        episode: {
                            id: Id<"episodes">;
                            number: number;
                            slug: string | null;
                            status: string | null;
                            title: string;
                        };
                        id: Id<"assignments">;
                        playable: boolean;
                        slug: string | null;
                        type: string;
                    } | null;
                    createdAt: number;
                    id: Id<"syllabusEntries">;
                    movie: {
                        id: Id<"movies">;
                        poster: string | null;
                        title: string;
                        tmdbId: number | null;
                        url: string;
                        year: number;
                    };
                    notes: string | null;
                    order: number;
                    user: {
                        email: string | null;
                        id: Id<"users">;
                        name: string | null;
                        status: "active" | "disabled";
                    };
                }>;
                pageStatus?: "SplitRecommended" | "SplitRequired" | null;
                splitCursor?: string | null;
            }>;
            removeEntry: FunctionReference<"mutation", "public", {
                clientApiVersion: string;
                id: Id<"syllabusEntries">;
            }, {
                id: Id<"syllabusEntries">;
            }>;
            unlinkEpisode: FunctionReference<"mutation", "public", {
                clientApiVersion: string;
                syllabusId: Id<"syllabusEntries">;
            }, {
                assignment: {
                    episode: {
                        id: Id<"episodes">;
                        number: number;
                        slug: string | null;
                        status: string | null;
                        title: string;
                    };
                    id: Id<"assignments">;
                    playable: boolean;
                    slug: string | null;
                    type: string;
                } | null;
                createdAt: number;
                id: Id<"syllabusEntries">;
                movie: {
                    id: Id<"movies">;
                    poster: string | null;
                    title: string;
                    tmdbId: number | null;
                    url: string;
                    year: number;
                };
                notes: string | null;
                order: number;
                user: {
                    email: string | null;
                    id: Id<"users">;
                    name: string | null;
                    status: "active" | "disabled";
                };
            }>;
        };
        mine: {
            add: FunctionReference<"mutation", "public", {
                clientApiVersion: string;
                movieId: Id<"movies">;
                position?: "TOP" | "AFTER_NEXT" | "END";
            }, {
                assignment: {
                    episode: {
                        id: Id<"episodes">;
                        number: number;
                        slug: string | null;
                        status: string | null;
                        title: string;
                    };
                    id: Id<"assignments">;
                    playable: boolean;
                    slug: string | null;
                    type: string;
                } | null;
                createdAt: number;
                id: Id<"syllabusEntries">;
                movie: {
                    id: Id<"movies">;
                    poster: string | null;
                    title: string;
                    tmdbId: number | null;
                    url: string;
                    year: number;
                };
                notes: string | null;
                order: number;
            }>;
            list: FunctionReference<"query", "public", Record<string, never>, Array<{
                assignment: {
                    episode: {
                        id: Id<"episodes">;
                        number: number;
                        slug: string | null;
                        status: string | null;
                        title: string;
                    };
                    id: Id<"assignments">;
                    playable: boolean;
                    slug: string | null;
                    type: string;
                } | null;
                createdAt: number;
                id: Id<"syllabusEntries">;
                movie: {
                    id: Id<"movies">;
                    poster: string | null;
                    title: string;
                    tmdbId: number | null;
                    url: string;
                    year: number;
                };
                notes: string | null;
                order: number;
            }>>;
            remove: FunctionReference<"mutation", "public", {
                clientApiVersion: string;
                id: Id<"syllabusEntries">;
            }, {
                id: Id<"syllabusEntries">;
            }>;
            reorderPending: FunctionReference<"mutation", "public", {
                clientApiVersion: string;
                orderedPendingIds: Array<Id<"syllabusEntries">>;
            }, {
                success: true;
            }>;
            updateNotes: FunctionReference<"mutation", "public", {
                clientApiVersion: string;
                id: Id<"syllabusEntries">;
                notes: string | null;
            }, {
                assignment: {
                    episode: {
                        id: Id<"episodes">;
                        number: number;
                        slug: string | null;
                        status: string | null;
                        title: string;
                    };
                    id: Id<"assignments">;
                    playable: boolean;
                    slug: string | null;
                    type: string;
                } | null;
                createdAt: number;
                id: Id<"syllabusEntries">;
                movie: {
                    id: Id<"movies">;
                    poster: string | null;
                    title: string;
                    tmdbId: number | null;
                    url: string;
                    year: number;
                };
                notes: string | null;
                order: number;
            }>;
        };
    };
    ratings: {
        admin: {
            create: FunctionReference<"mutation", "public", {
                category?: string;
                clientApiVersion: string;
                icon?: string;
                name: string;
                sound?: string;
                value: number;
            }, {
                category: string | null;
                icon: string | null;
                id: Id<"ratings">;
                name: string;
                sound: string | null;
                value: number;
            }>;
            getById: FunctionReference<"query", "public", {
                id: Id<"ratings">;
            }, {
                category: string | null;
                icon: string | null;
                id: Id<"ratings">;
                name: string;
                sound: string | null;
                value: number;
            } | null>;
            list: FunctionReference<"query", "public", Record<string, never>, Array<{
                category: string | null;
                icon: string | null;
                id: Id<"ratings">;
                name: string;
                sound: string | null;
                value: number;
            }>>;
            removeIfUnreferenced: FunctionReference<"mutation", "public", {
                clientApiVersion: string;
                id: Id<"ratings">;
            }, {
                id: Id<"ratings">;
            }>;
            update: FunctionReference<"mutation", "public", {
                category?: string | null;
                clientApiVersion: string;
                icon?: string | null;
                id: Id<"ratings">;
                name?: string;
                sound?: string | null;
                value?: number;
            }, {
                category: string | null;
                icon: string | null;
                id: Id<"ratings">;
                name: string;
                sound: string | null;
                value: number;
            }>;
        };
        public: {
            getById: FunctionReference<"query", "public", {
                id: Id<"ratings">;
            }, {
                category: string | null;
                icon: string | null;
                id: Id<"ratings">;
                name: string;
                sound: string | null;
                value: number;
            } | null>;
            getByValue: FunctionReference<"query", "public", {
                value: number;
            }, {
                category: string | null;
                icon: string | null;
                id: Id<"ratings">;
                name: string;
                sound: string | null;
                value: number;
            } | null>;
            list: FunctionReference<"query", "public", Record<string, never>, Array<{
                category: string | null;
                icon: string | null;
                id: Id<"ratings">;
                name: string;
                sound: string | null;
                value: number;
            }>>;
        };
    };
    reviews: {
        admin: {
            createExtra: FunctionReference<"mutation", "public", {
                clientApiVersion: string;
                episodeId: Id<"episodes">;
                movieId?: Id<"movies">;
                ratingId?: Id<"ratings">;
                showId?: Id<"shows">;
                userId: Id<"users">;
            }, {
                episode: {
                    id: Id<"episodes">;
                    number: number;
                    slug: string | null;
                    status: string | null;
                    title: string;
                };
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
                    rating: {
                        category: string | null;
                        icon: string | null;
                        id: Id<"ratings">;
                        name: string;
                        sound: string | null;
                        value: number;
                    } | null;
                    reviewedAt: number | null;
                    show: {
                        id: Id<"shows">;
                        poster: string | null;
                        title: string;
                        url: string;
                        year: number;
                    } | null;
                    user: {
                        id: Id<"users">;
                        image: string | null;
                        name: string | null;
                        status: "active" | "disabled";
                    } | null;
                };
            }>;
            createForAssignment: FunctionReference<"mutation", "public", {
                assignmentId: Id<"assignments">;
                clientApiVersion: string;
                ratingId?: Id<"ratings">;
                userId: Id<"users">;
            }, {
                assignment: {
                    episode: {
                        id: Id<"episodes">;
                        number: number;
                        slug: string | null;
                        status: string | null;
                        title: string;
                    };
                    id: Id<"assignments">;
                    playable: boolean;
                    type: string;
                };
                id: Id<"assignmentReviews">;
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
                    rating: {
                        category: string | null;
                        icon: string | null;
                        id: Id<"ratings">;
                        name: string;
                        sound: string | null;
                        value: number;
                    } | null;
                    reviewedAt: number | null;
                    show: {
                        id: Id<"shows">;
                        poster: string | null;
                        title: string;
                        url: string;
                        year: number;
                    } | null;
                    user: {
                        id: Id<"users">;
                        image: string | null;
                        name: string | null;
                        status: "active" | "disabled";
                    } | null;
                };
            }>;
            getById: FunctionReference<"query", "public", {
                id: Id<"reviews">;
            }, {
                assignmentReviews: Array<{
                    assignment: {
                        episode: {
                            id: Id<"episodes">;
                            number: number;
                            slug: string | null;
                            status: string | null;
                            title: string;
                        };
                        id: Id<"assignments">;
                        playable: boolean;
                        type: string;
                    };
                    id: Id<"assignmentReviews">;
                }>;
                extraReviews: Array<{
                    episode: {
                        id: Id<"episodes">;
                        number: number;
                        slug: string | null;
                        status: string | null;
                        title: string;
                    };
                    id: Id<"extraReviews">;
                }>;
                id: Id<"reviews">;
                movie: {
                    id: Id<"movies">;
                    poster: string | null;
                    title: string;
                    tmdbId: number | null;
                    url: string;
                    year: number;
                } | null;
                rating: {
                    category: string | null;
                    icon: string | null;
                    id: Id<"ratings">;
                    name: string;
                    sound: string | null;
                    value: number;
                } | null;
                reviewedAt: number | null;
                show: {
                    id: Id<"shows">;
                    poster: string | null;
                    title: string;
                    url: string;
                    year: number;
                } | null;
                user: {
                    id: Id<"users">;
                    image: string | null;
                    name: string | null;
                    status: "active" | "disabled";
                } | null;
            } | null>;
            listExtrasForEpisode: FunctionReference<"query", "public", {
                episodeId: Id<"episodes">;
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
                    episode: {
                        id: Id<"episodes">;
                        number: number;
                        slug: string | null;
                        status: string | null;
                        title: string;
                    };
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
                        rating: {
                            category: string | null;
                            icon: string | null;
                            id: Id<"ratings">;
                            name: string;
                            sound: string | null;
                            value: number;
                        } | null;
                        reviewedAt: number | null;
                        show: {
                            id: Id<"shows">;
                            poster: string | null;
                            title: string;
                            url: string;
                            year: number;
                        } | null;
                        user: {
                            id: Id<"users">;
                            image: string | null;
                            name: string | null;
                            status: "active" | "disabled";
                        } | null;
                    };
                }>;
                pageStatus?: "SplitRecommended" | "SplitRequired" | null;
                splitCursor?: string | null;
            }>;
            listForAssignment: FunctionReference<"query", "public", {
                assignmentId: Id<"assignments">;
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
                    assignment: {
                        episode: {
                            id: Id<"episodes">;
                            number: number;
                            slug: string | null;
                            status: string | null;
                            title: string;
                        };
                        id: Id<"assignments">;
                        playable: boolean;
                        type: string;
                    };
                    id: Id<"assignmentReviews">;
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
                        rating: {
                            category: string | null;
                            icon: string | null;
                            id: Id<"ratings">;
                            name: string;
                            sound: string | null;
                            value: number;
                        } | null;
                        reviewedAt: number | null;
                        show: {
                            id: Id<"shows">;
                            poster: string | null;
                            title: string;
                            url: string;
                            year: number;
                        } | null;
                        user: {
                            id: Id<"users">;
                            image: string | null;
                            name: string | null;
                            status: "active" | "disabled";
                        } | null;
                    };
                }>;
                pageStatus?: "SplitRecommended" | "SplitRequired" | null;
                splitCursor?: string | null;
            }>;
            listPage: FunctionReference<"query", "public", {
                paginationOpts: {
                    cursor: string | null;
                    endCursor?: string | null;
                    id?: number;
                    maximumBytesRead?: number;
                    maximumRowsRead?: number;
                    numItems: number;
                };
                ratingId?: Id<"ratings">;
                userId?: Id<"users">;
            }, {
                continueCursor: string;
                isDone: boolean;
                page: Array<{
                    assignmentReviews: Array<{
                        assignment: {
                            episode: {
                                id: Id<"episodes">;
                                number: number;
                                slug: string | null;
                                status: string | null;
                                title: string;
                            };
                            id: Id<"assignments">;
                            playable: boolean;
                            type: string;
                        };
                        id: Id<"assignmentReviews">;
                    }>;
                    extraReviews: Array<{
                        episode: {
                            id: Id<"episodes">;
                            number: number;
                            slug: string | null;
                            status: string | null;
                            title: string;
                        };
                        id: Id<"extraReviews">;
                    }>;
                    id: Id<"reviews">;
                    movie: {
                        id: Id<"movies">;
                        poster: string | null;
                        title: string;
                        tmdbId: number | null;
                        url: string;
                        year: number;
                    } | null;
                    rating: {
                        category: string | null;
                        icon: string | null;
                        id: Id<"ratings">;
                        name: string;
                        sound: string | null;
                        value: number;
                    } | null;
                    reviewedAt: number | null;
                    show: {
                        id: Id<"shows">;
                        poster: string | null;
                        title: string;
                        url: string;
                        year: number;
                    } | null;
                    user: {
                        id: Id<"users">;
                        image: string | null;
                        name: string | null;
                        status: "active" | "disabled";
                    } | null;
                }>;
                pageStatus?: "SplitRecommended" | "SplitRequired" | null;
                splitCursor?: string | null;
            }>;
            remove: FunctionReference<"mutation", "public", {
                clientApiVersion: string;
                id: Id<"reviews">;
            }, {
                assignmentReviewCount: number;
                extraReviewCount: number;
                guessCount: number;
                id: Id<"reviews">;
            }>;
            removeAssignmentIfNoGuesses: FunctionReference<"mutation", "public", {
                clientApiVersion: string;
                id: Id<"assignmentReviews">;
            }, {
                id: Id<"assignmentReviews">;
            }>;
            setRating: FunctionReference<"mutation", "public", {
                clientApiVersion: string;
                ratingId: Id<"ratings"> | null;
                reviewId: Id<"reviews">;
            }, {
                assignmentReviews: Array<{
                    assignment: {
                        episode: {
                            id: Id<"episodes">;
                            number: number;
                            slug: string | null;
                            status: string | null;
                            title: string;
                        };
                        id: Id<"assignments">;
                        playable: boolean;
                        type: string;
                    };
                    id: Id<"assignmentReviews">;
                }>;
                extraReviews: Array<{
                    episode: {
                        id: Id<"episodes">;
                        number: number;
                        slug: string | null;
                        status: string | null;
                        title: string;
                    };
                    id: Id<"extraReviews">;
                }>;
                id: Id<"reviews">;
                movie: {
                    id: Id<"movies">;
                    poster: string | null;
                    title: string;
                    tmdbId: number | null;
                    url: string;
                    year: number;
                } | null;
                rating: {
                    category: string | null;
                    icon: string | null;
                    id: Id<"ratings">;
                    name: string;
                    sound: string | null;
                    value: number;
                } | null;
                reviewedAt: number | null;
                show: {
                    id: Id<"shows">;
                    poster: string | null;
                    title: string;
                    url: string;
                    year: number;
                } | null;
                user: {
                    id: Id<"users">;
                    image: string | null;
                    name: string | null;
                    status: "active" | "disabled";
                } | null;
            }>;
        };
        mine: {
            addMovieExtra: FunctionReference<"mutation", "public", {
                clientApiVersion: string;
                episodeId: Id<"episodes">;
                movieId: Id<"movies">;
            }, {
                episode: {
                    id: Id<"episodes">;
                    number: number;
                    slug: string | null;
                    status: string | null;
                    title: string;
                };
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
                    rating: {
                        category: string | null;
                        icon: string | null;
                        id: Id<"ratings">;
                        name: string;
                        sound: string | null;
                        value: number;
                    } | null;
                    reviewedAt: number | null;
                    show: {
                        id: Id<"shows">;
                        poster: string | null;
                        title: string;
                        url: string;
                        year: number;
                    } | null;
                    user: {
                        id: Id<"users">;
                        image: string | null;
                        name: string | null;
                        status: "active" | "disabled";
                    } | null;
                };
            }>;
            addShowExtra: FunctionReference<"mutation", "public", {
                clientApiVersion: string;
                episodeId: Id<"episodes">;
                showId: Id<"shows">;
            }, {
                episode: {
                    id: Id<"episodes">;
                    number: number;
                    slug: string | null;
                    status: string | null;
                    title: string;
                };
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
                    rating: {
                        category: string | null;
                        icon: string | null;
                        id: Id<"ratings">;
                        name: string;
                        sound: string | null;
                        value: number;
                    } | null;
                    reviewedAt: number | null;
                    show: {
                        id: Id<"shows">;
                        poster: string | null;
                        title: string;
                        url: string;
                        year: number;
                    } | null;
                    user: {
                        id: Id<"users">;
                        image: string | null;
                        name: string | null;
                        status: "active" | "disabled";
                    } | null;
                };
            }>;
        };
    };
    games: {
        config: {
            createGamePointType: FunctionReference<"mutation", "public", {
                clientApiVersion: string;
                description?: string;
                gameTypeId: Id<"gameTypes">;
                lookupId: string;
                points: number;
                title: string;
            }, {
                description: string | null;
                gameType: {
                    description: string | null;
                    id: Id<"gameTypes">;
                    lookupId: string;
                    title: string;
                };
                id: Id<"gamePointTypes">;
                lookupId: string;
                points: number;
                title: string;
            }>;
            createGameType: FunctionReference<"mutation", "public", {
                clientApiVersion: string;
                description?: string;
                lookupId: string;
                title: string;
            }, {
                description: string | null;
                id: Id<"gameTypes">;
                lookupId: string;
                title: string;
            }>;
            listGamePointTypes: FunctionReference<"query", "public", {
                gameTypeId?: Id<"gameTypes">;
            }, Array<{
                description: string | null;
                gameType: {
                    description: string | null;
                    id: Id<"gameTypes">;
                    lookupId: string;
                    title: string;
                };
                id: Id<"gamePointTypes">;
                lookupId: string;
                points: number;
                title: string;
            }>>;
            listGameTypes: FunctionReference<"query", "public", Record<string, never>, Array<{
                description: string | null;
                id: Id<"gameTypes">;
                lookupId: string;
                title: string;
            }>>;
            removeGamePointType: FunctionReference<"mutation", "public", {
                clientApiVersion: string;
                id: Id<"gamePointTypes">;
            }, {
                id: Id<"gamePointTypes">;
            }>;
            removeGameType: FunctionReference<"mutation", "public", {
                clientApiVersion: string;
                id: Id<"gameTypes">;
            }, {
                id: Id<"gameTypes">;
            }>;
            updateGamePointType: FunctionReference<"mutation", "public", {
                clientApiVersion: string;
                description?: string | null;
                gameTypeId?: Id<"gameTypes">;
                id: Id<"gamePointTypes">;
                lookupId?: string;
                points?: number;
                title?: string;
            }, {
                description: string | null;
                gameType: {
                    description: string | null;
                    id: Id<"gameTypes">;
                    lookupId: string;
                    title: string;
                };
                id: Id<"gamePointTypes">;
                lookupId: string;
                points: number;
                title: string;
            }>;
            updateGameType: FunctionReference<"mutation", "public", {
                clientApiVersion: string;
                description?: string | null;
                id: Id<"gameTypes">;
                lookupId?: string;
                title?: string;
            }, {
                description: string | null;
                id: Id<"gameTypes">;
                lookupId: string;
                title: string;
            }>;
        };
        public: {
            currentPerformance: FunctionReference<"query", "public", {
                today: string;
            }, {
                points: Array<{
                    earnedAt: number;
                    pointValue: number;
                    userId: Id<"users">;
                }>;
                season: {
                    description: string | null;
                    endedOn: string | null;
                    gameType: {
                        description: string | null;
                        id: Id<"gameTypes">;
                        lookupId: string;
                        title: string;
                    };
                    id: Id<"seasons">;
                    startedOn: string | null;
                    title: string;
                };
                userSummary: Array<{
                    total: number;
                    user: {
                        id: Id<"users">;
                        image: string | null;
                        name: string | null;
                    };
                }>;
            } | null>;
            currentSeason: FunctionReference<"query", "public", {
                today: string;
            }, {
                description: string | null;
                endedOn: string | null;
                gameType: {
                    description: string | null;
                    id: Id<"gameTypes">;
                    lookupId: string;
                    title: string;
                };
                id: Id<"seasons">;
                startedOn: string | null;
                title: string;
            } | null>;
            hasActiveSeason: FunctionReference<"query", "public", {
                today: string;
            }, boolean>;
            predictionScoring: FunctionReference<"query", "public", Record<string, never>, {
                allCorrectBonus: number | null;
                allIncorrect: number | null;
                correctHost: number | null;
            }>;
        };
        seasons: {
            create: FunctionReference<"mutation", "public", {
                clientApiVersion: string;
                description?: string;
                endedOn?: string | null;
                gameTypeId: Id<"gameTypes">;
                startedOn: string;
                title: string;
            }, {
                counts: {
                    gamblingEntries: {
                        count: number;
                        isExact: boolean;
                    };
                    guesses: {
                        count: number;
                        isExact: boolean;
                    };
                    points: {
                        count: number;
                        isExact: boolean;
                    };
                    quoteSubmissions: {
                        count: number;
                        isExact: boolean;
                    };
                };
                description: string | null;
                endedOn: string | null;
                gameType: {
                    description: string | null;
                    id: Id<"gameTypes">;
                    lookupId: string;
                    title: string;
                };
                id: Id<"seasons">;
                startedOn: string | null;
                title: string;
            }>;
            getById: FunctionReference<"query", "public", {
                id: Id<"seasons">;
            }, {
                counts: {
                    gamblingEntries: {
                        count: number;
                        isExact: boolean;
                    };
                    guesses: {
                        count: number;
                        isExact: boolean;
                    };
                    points: {
                        count: number;
                        isExact: boolean;
                    };
                    quoteSubmissions: {
                        count: number;
                        isExact: boolean;
                    };
                };
                description: string | null;
                endedOn: string | null;
                gameType: {
                    description: string | null;
                    id: Id<"gameTypes">;
                    lookupId: string;
                    title: string;
                };
                id: Id<"seasons">;
                startedOn: string | null;
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
                    counts: {
                        gamblingEntries: {
                            count: number;
                            isExact: boolean;
                        };
                        guesses: {
                            count: number;
                            isExact: boolean;
                        };
                        points: {
                            count: number;
                            isExact: boolean;
                        };
                        quoteSubmissions: {
                            count: number;
                            isExact: boolean;
                        };
                    };
                    description: string | null;
                    endedOn: string | null;
                    gameType: {
                        description: string | null;
                        id: Id<"gameTypes">;
                        lookupId: string;
                        title: string;
                    };
                    id: Id<"seasons">;
                    startedOn: string | null;
                    title: string;
                }>;
                pageStatus?: "SplitRecommended" | "SplitRequired" | null;
                splitCursor?: string | null;
            }>;
            removeIfUnreferenced: FunctionReference<"mutation", "public", {
                clientApiVersion: string;
                id: Id<"seasons">;
            }, {
                id: Id<"seasons">;
            }>;
            update: FunctionReference<"mutation", "public", {
                clientApiVersion: string;
                description?: string | null;
                endedOn?: string | null;
                gameTypeId?: Id<"gameTypes">;
                id: Id<"seasons">;
                startedOn?: string;
                title?: string;
            }, {
                counts: {
                    gamblingEntries: {
                        count: number;
                        isExact: boolean;
                    };
                    guesses: {
                        count: number;
                        isExact: boolean;
                    };
                    points: {
                        count: number;
                        isExact: boolean;
                    };
                    quoteSubmissions: {
                        count: number;
                        isExact: boolean;
                    };
                };
                description: string | null;
                endedOn: string | null;
                gameType: {
                    description: string | null;
                    id: Id<"gameTypes">;
                    lookupId: string;
                    title: string;
                };
                id: Id<"seasons">;
                startedOn: string | null;
                title: string;
            }>;
        };
        points: {
            create: FunctionReference<"mutation", "public", {
                adjustment: number | null;
                clientApiVersion: string;
                earnedAt?: number;
                gamePointTypeId?: Id<"gamePointTypes">;
                reason?: string;
                season: {
                    kind: "current";
                    today: string;
                } | {
                    kind: "season";
                    seasonId: Id<"seasons">;
                };
                userId: Id<"users">;
            }, {
                adjustment: number | null;
                earnedAt: number;
                gamePointType: {
                    description: string | null;
                    gameType: {
                        description: string | null;
                        id: Id<"gameTypes">;
                        lookupId: string;
                        title: string;
                    };
                    id: Id<"gamePointTypes">;
                    lookupId: string;
                    points: number;
                    title: string;
                } | null;
                id: Id<"points">;
                reason: string | null;
                season: {
                    description: string | null;
                    endedOn: string | null;
                    gameType: {
                        description: string | null;
                        id: Id<"gameTypes">;
                        lookupId: string;
                        title: string;
                    };
                    id: Id<"seasons">;
                    startedOn: string | null;
                    title: string;
                };
                total: number;
                user: {
                    id: Id<"users">;
                    image: string | null;
                    name: string | null;
                };
            }>;
            createByLookup: FunctionReference<"mutation", "public", {
                adjustment?: number;
                clientApiVersion: string;
                earnedAt?: number;
                gamePointLookupId: string;
                reason: string;
                season: {
                    kind: "current";
                    today: string;
                } | {
                    kind: "season";
                    seasonId: Id<"seasons">;
                };
                userId: Id<"users">;
            }, {
                adjustment: number | null;
                earnedAt: number;
                gamePointType: {
                    description: string | null;
                    gameType: {
                        description: string | null;
                        id: Id<"gameTypes">;
                        lookupId: string;
                        title: string;
                    };
                    id: Id<"gamePointTypes">;
                    lookupId: string;
                    points: number;
                    title: string;
                } | null;
                id: Id<"points">;
                reason: string | null;
                season: {
                    description: string | null;
                    endedOn: string | null;
                    gameType: {
                        description: string | null;
                        id: Id<"gameTypes">;
                        lookupId: string;
                        title: string;
                    };
                    id: Id<"seasons">;
                    startedOn: string | null;
                    title: string;
                };
                total: number;
                user: {
                    id: Id<"users">;
                    image: string | null;
                    name: string | null;
                };
            }>;
            createForAssignmentByLookup: FunctionReference<"mutation", "public", {
                adjustment?: number;
                assignmentId: Id<"assignments">;
                clientApiVersion: string;
                earnedAt?: number;
                gamePointLookupId: string;
                reason: string;
                season: {
                    kind: "current";
                    today: string;
                } | {
                    kind: "season";
                    seasonId: Id<"seasons">;
                };
                userId: Id<"users">;
            }, {
                adjustment: number | null;
                assignmentLinks: Array<{
                    assignment: {
                        episode: {
                            id: Id<"episodes">;
                            number: number;
                            slug: string | null;
                            status: string | null;
                            title: string;
                        };
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
                        type: "HOMEWORK" | "EXTRA_CREDIT" | "BONUS";
                        user: {
                            id: Id<"users">;
                            image: string | null;
                            name: string | null;
                            status: "active" | "disabled";
                        };
                    };
                    id: Id<"assignmentPointLinks">;
                }>;
                earnedAt: number;
                gamblingEntries: Array<{
                    id: Id<"gamblingEntries">;
                }>;
                gamePointType: {
                    description: string | null;
                    gameType: {
                        description: string | null;
                        id: Id<"gameTypes">;
                        lookupId: string;
                        title: string;
                    };
                    id: Id<"gamePointTypes">;
                    lookupId: string;
                    points: number;
                    title: string;
                } | null;
                guesses: Array<{
                    assignmentReviewId: Id<"assignmentReviews">;
                    id: Id<"guesses">;
                }>;
                id: Id<"points">;
                quoteSubmissions: Array<{
                    id: Id<"quoteSubmissions">;
                }>;
                reason: string | null;
                season: {
                    description: string | null;
                    endedOn: string | null;
                    gameType: {
                        description: string | null;
                        id: Id<"gameTypes">;
                        lookupId: string;
                        title: string;
                    };
                    id: Id<"seasons">;
                    startedOn: string | null;
                    title: string;
                };
                tagVotes: Array<{
                    id: Id<"tagVotes">;
                    tag: string;
                }>;
                total: number;
                user: {
                    id: Id<"users">;
                    image: string | null;
                    name: string | null;
                };
            }>;
            getById: FunctionReference<"query", "public", {
                id: Id<"points">;
            }, {
                adjustment: number | null;
                assignmentLinks: Array<{
                    assignment: {
                        episode: {
                            id: Id<"episodes">;
                            number: number;
                            slug: string | null;
                            status: string | null;
                            title: string;
                        };
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
                        type: "HOMEWORK" | "EXTRA_CREDIT" | "BONUS";
                        user: {
                            id: Id<"users">;
                            image: string | null;
                            name: string | null;
                            status: "active" | "disabled";
                        };
                    };
                    id: Id<"assignmentPointLinks">;
                }>;
                earnedAt: number;
                gamblingEntries: Array<{
                    id: Id<"gamblingEntries">;
                }>;
                gamePointType: {
                    description: string | null;
                    gameType: {
                        description: string | null;
                        id: Id<"gameTypes">;
                        lookupId: string;
                        title: string;
                    };
                    id: Id<"gamePointTypes">;
                    lookupId: string;
                    points: number;
                    title: string;
                } | null;
                guesses: Array<{
                    assignmentReviewId: Id<"assignmentReviews">;
                    id: Id<"guesses">;
                }>;
                id: Id<"points">;
                quoteSubmissions: Array<{
                    id: Id<"quoteSubmissions">;
                }>;
                reason: string | null;
                season: {
                    description: string | null;
                    endedOn: string | null;
                    gameType: {
                        description: string | null;
                        id: Id<"gameTypes">;
                        lookupId: string;
                        title: string;
                    };
                    id: Id<"seasons">;
                    startedOn: string | null;
                    title: string;
                };
                tagVotes: Array<{
                    id: Id<"tagVotes">;
                    tag: string;
                }>;
                total: number;
                user: {
                    id: Id<"users">;
                    image: string | null;
                    name: string | null;
                };
            } | null>;
            linkAssignment: FunctionReference<"mutation", "public", {
                assignmentId: Id<"assignments">;
                clientApiVersion: string;
                pointId: Id<"points">;
            }, {
                assignment: {
                    episode: {
                        id: Id<"episodes">;
                        number: number;
                        slug: string | null;
                        status: string | null;
                        title: string;
                    };
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
                    type: "HOMEWORK" | "EXTRA_CREDIT" | "BONUS";
                    user: {
                        id: Id<"users">;
                        image: string | null;
                        name: string | null;
                        status: "active" | "disabled";
                    };
                };
                id: Id<"assignmentPointLinks">;
            }>;
            listForAssignmentAndUser: FunctionReference<"query", "public", {
                assignmentId: Id<"assignments">;
                userId: Id<"users">;
            }, Array<{
                id: Id<"assignmentPointLinks">;
                point: {
                    adjustment: number | null;
                    earnedAt: number;
                    gamePointType: {
                        description: string | null;
                        gameType: {
                            description: string | null;
                            id: Id<"gameTypes">;
                            lookupId: string;
                            title: string;
                        };
                        id: Id<"gamePointTypes">;
                        lookupId: string;
                        points: number;
                        title: string;
                    } | null;
                    id: Id<"points">;
                    reason: string | null;
                    season: {
                        description: string | null;
                        endedOn: string | null;
                        gameType: {
                            description: string | null;
                            id: Id<"gameTypes">;
                            lookupId: string;
                            title: string;
                        };
                        id: Id<"seasons">;
                        startedOn: string | null;
                        title: string;
                    };
                    total: number;
                    user: {
                        id: Id<"users">;
                        image: string | null;
                        name: string | null;
                    };
                };
            }>>;
            listForSeasonPage: FunctionReference<"query", "public", {
                paginationOpts: {
                    cursor: string | null;
                    endCursor?: string | null;
                    id?: number;
                    maximumBytesRead?: number;
                    maximumRowsRead?: number;
                    numItems: number;
                };
                seasonId: Id<"seasons">;
            }, {
                continueCursor: string;
                isDone: boolean;
                page: Array<{
                    adjustment: number | null;
                    earnedAt: number;
                    gamePointType: {
                        description: string | null;
                        gameType: {
                            description: string | null;
                            id: Id<"gameTypes">;
                            lookupId: string;
                            title: string;
                        };
                        id: Id<"gamePointTypes">;
                        lookupId: string;
                        points: number;
                        title: string;
                    } | null;
                    id: Id<"points">;
                    reason: string | null;
                    season: {
                        description: string | null;
                        endedOn: string | null;
                        gameType: {
                            description: string | null;
                            id: Id<"gameTypes">;
                            lookupId: string;
                            title: string;
                        };
                        id: Id<"seasons">;
                        startedOn: string | null;
                        title: string;
                    };
                    total: number;
                    user: {
                        id: Id<"users">;
                        image: string | null;
                        name: string | null;
                    };
                }>;
                pageStatus?: "SplitRecommended" | "SplitRequired" | null;
                splitCursor?: string | null;
            }>;
            listForUserPage: FunctionReference<"query", "public", {
                paginationOpts: {
                    cursor: string | null;
                    endCursor?: string | null;
                    id?: number;
                    maximumBytesRead?: number;
                    maximumRowsRead?: number;
                    numItems: number;
                };
                season: {
                    kind: "all";
                } | {
                    kind: "current";
                    today: string;
                } | {
                    kind: "season";
                    seasonId: Id<"seasons">;
                };
                userId: Id<"users">;
            }, {
                continueCursor: string;
                isDone: boolean;
                page: Array<{
                    adjustment: number | null;
                    earnedAt: number;
                    gamePointType: {
                        description: string | null;
                        gameType: {
                            description: string | null;
                            id: Id<"gameTypes">;
                            lookupId: string;
                            title: string;
                        };
                        id: Id<"gamePointTypes">;
                        lookupId: string;
                        points: number;
                        title: string;
                    } | null;
                    id: Id<"points">;
                    reason: string | null;
                    season: {
                        description: string | null;
                        endedOn: string | null;
                        gameType: {
                            description: string | null;
                            id: Id<"gameTypes">;
                            lookupId: string;
                            title: string;
                        };
                        id: Id<"seasons">;
                        startedOn: string | null;
                        title: string;
                    };
                    total: number;
                    user: {
                        id: Id<"users">;
                        image: string | null;
                        name: string | null;
                    };
                }>;
                pageStatus?: "SplitRecommended" | "SplitRequired" | null;
                splitCursor?: string | null;
            }>;
            remove: FunctionReference<"mutation", "public", {
                clientApiVersion: string;
                id: Id<"points">;
            }, {
                id: Id<"points">;
            }>;
            totalForUser: FunctionReference<"query", "public", {
                season: {
                    kind: "all";
                } | {
                    kind: "current";
                    today: string;
                } | {
                    kind: "season";
                    seasonId: Id<"seasons">;
                };
                userId: Id<"users">;
            }, number>;
            totalsForAssignments: FunctionReference<"query", "public", {
                assignmentIds: Array<Id<"assignments">>;
                userIds: Array<Id<"users">>;
            }, Array<{
                assignmentId: Id<"assignments">;
                total: number;
                userId: Id<"users">;
            }>>;
            unlinkAssignment: FunctionReference<"mutation", "public", {
                assignmentId: Id<"assignments">;
                clientApiVersion: string;
                pointId: Id<"points">;
            }, {
                count: number;
            }>;
            update: FunctionReference<"mutation", "public", {
                adjustment?: number | null;
                clientApiVersion: string;
                earnedAt?: number;
                gamePointTypeId?: Id<"gamePointTypes"> | null;
                id: Id<"points">;
                reason?: string | null;
            }, {
                adjustment: number | null;
                earnedAt: number;
                gamePointType: {
                    description: string | null;
                    gameType: {
                        description: string | null;
                        id: Id<"gameTypes">;
                        lookupId: string;
                        title: string;
                    };
                    id: Id<"gamePointTypes">;
                    lookupId: string;
                    points: number;
                    title: string;
                } | null;
                id: Id<"points">;
                reason: string | null;
                season: {
                    description: string | null;
                    endedOn: string | null;
                    gameType: {
                        description: string | null;
                        id: Id<"gameTypes">;
                        lookupId: string;
                        title: string;
                    };
                    id: Id<"seasons">;
                    startedOn: string | null;
                    title: string;
                };
                total: number;
                user: {
                    id: Id<"users">;
                    image: string | null;
                    name: string | null;
                };
            }>;
        };
        member: {
            myAvailablePoints: FunctionReference<"query", "public", {
                season: {
                    kind: "current";
                    today: string;
                } | {
                    kind: "season";
                    seasonId: Id<"seasons">;
                };
            }, number>;
        };
        guesses: {
            awardPoint: FunctionReference<"mutation", "public", {
                adjustment: number;
                clientApiVersion: string;
                earnedAt?: number;
                gamePointTypeId?: Id<"gamePointTypes">;
                id: Id<"guesses">;
                reason: string;
            }, {
                assignmentReview: {
                    assignment: {
                        episode: {
                            id: Id<"episodes">;
                            number: number;
                            slug: string | null;
                            status: string | null;
                            title: string;
                        };
                        id: Id<"assignments">;
                        playable: boolean;
                        type: string;
                    };
                    id: Id<"assignmentReviews">;
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
                        rating: {
                            category: string | null;
                            icon: string | null;
                            id: Id<"ratings">;
                            name: string;
                            sound: string | null;
                            value: number;
                        } | null;
                        reviewedAt: number | null;
                        show: {
                            id: Id<"shows">;
                            poster: string | null;
                            title: string;
                            url: string;
                            year: number;
                        } | null;
                        user: {
                            id: Id<"users">;
                            image: string | null;
                            name: string | null;
                            status: "active" | "disabled";
                        } | null;
                    };
                };
                createdAt: number;
                id: Id<"guesses">;
                point: {
                    adjustment: number | null;
                    earnedAt: number;
                    gamePointType: {
                        description: string | null;
                        gameType: {
                            description: string | null;
                            id: Id<"gameTypes">;
                            lookupId: string;
                            title: string;
                        };
                        id: Id<"gamePointTypes">;
                        lookupId: string;
                        points: number;
                        title: string;
                    } | null;
                    id: Id<"points">;
                    reason: string | null;
                    season: {
                        description: string | null;
                        endedOn: string | null;
                        gameType: {
                            description: string | null;
                            id: Id<"gameTypes">;
                            lookupId: string;
                            title: string;
                        };
                        id: Id<"seasons">;
                        startedOn: string | null;
                        title: string;
                    };
                    total: number;
                    user: {
                        id: Id<"users">;
                        image: string | null;
                        name: string | null;
                    };
                } | null;
                rating: {
                    category: string | null;
                    icon: string | null;
                    id: Id<"ratings">;
                    name: string;
                    sound: string | null;
                    value: number;
                };
                season: {
                    description: string | null;
                    endedOn: string | null;
                    gameType: {
                        description: string | null;
                        id: Id<"gameTypes">;
                        lookupId: string;
                        title: string;
                    };
                    id: Id<"seasons">;
                    startedOn: string | null;
                    title: string;
                };
                user: {
                    id: Id<"users">;
                    image: string | null;
                    name: string | null;
                };
            }>;
            create: FunctionReference<"mutation", "public", {
                assignmentReviewId: Id<"assignmentReviews">;
                clientApiVersion: string;
                createdAt?: number;
                ratingId: Id<"ratings">;
                seasonId: Id<"seasons">;
                userId: Id<"users">;
            }, {
                assignmentReview: {
                    assignment: {
                        episode: {
                            id: Id<"episodes">;
                            number: number;
                            slug: string | null;
                            status: string | null;
                            title: string;
                        };
                        id: Id<"assignments">;
                        playable: boolean;
                        type: string;
                    };
                    id: Id<"assignmentReviews">;
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
                        rating: {
                            category: string | null;
                            icon: string | null;
                            id: Id<"ratings">;
                            name: string;
                            sound: string | null;
                            value: number;
                        } | null;
                        reviewedAt: number | null;
                        show: {
                            id: Id<"shows">;
                            poster: string | null;
                            title: string;
                            url: string;
                            year: number;
                        } | null;
                        user: {
                            id: Id<"users">;
                            image: string | null;
                            name: string | null;
                            status: "active" | "disabled";
                        } | null;
                    };
                };
                createdAt: number;
                id: Id<"guesses">;
                point: {
                    adjustment: number | null;
                    earnedAt: number;
                    gamePointType: {
                        description: string | null;
                        gameType: {
                            description: string | null;
                            id: Id<"gameTypes">;
                            lookupId: string;
                            title: string;
                        };
                        id: Id<"gamePointTypes">;
                        lookupId: string;
                        points: number;
                        title: string;
                    } | null;
                    id: Id<"points">;
                    reason: string | null;
                    season: {
                        description: string | null;
                        endedOn: string | null;
                        gameType: {
                            description: string | null;
                            id: Id<"gameTypes">;
                            lookupId: string;
                            title: string;
                        };
                        id: Id<"seasons">;
                        startedOn: string | null;
                        title: string;
                    };
                    total: number;
                    user: {
                        id: Id<"users">;
                        image: string | null;
                        name: string | null;
                    };
                } | null;
                rating: {
                    category: string | null;
                    icon: string | null;
                    id: Id<"ratings">;
                    name: string;
                    sound: string | null;
                    value: number;
                };
                season: {
                    description: string | null;
                    endedOn: string | null;
                    gameType: {
                        description: string | null;
                        id: Id<"gameTypes">;
                        lookupId: string;
                        title: string;
                    };
                    id: Id<"seasons">;
                    startedOn: string | null;
                    title: string;
                };
                user: {
                    id: Id<"users">;
                    image: string | null;
                    name: string | null;
                };
            }>;
            getById: FunctionReference<"query", "public", {
                id: Id<"guesses">;
            }, {
                assignmentReview: {
                    assignment: {
                        episode: {
                            id: Id<"episodes">;
                            number: number;
                            slug: string | null;
                            status: string | null;
                            title: string;
                        };
                        id: Id<"assignments">;
                        playable: boolean;
                        type: string;
                    };
                    id: Id<"assignmentReviews">;
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
                        rating: {
                            category: string | null;
                            icon: string | null;
                            id: Id<"ratings">;
                            name: string;
                            sound: string | null;
                            value: number;
                        } | null;
                        reviewedAt: number | null;
                        show: {
                            id: Id<"shows">;
                            poster: string | null;
                            title: string;
                            url: string;
                            year: number;
                        } | null;
                        user: {
                            id: Id<"users">;
                            image: string | null;
                            name: string | null;
                            status: "active" | "disabled";
                        } | null;
                    };
                };
                createdAt: number;
                id: Id<"guesses">;
                point: {
                    adjustment: number | null;
                    earnedAt: number;
                    gamePointType: {
                        description: string | null;
                        gameType: {
                            description: string | null;
                            id: Id<"gameTypes">;
                            lookupId: string;
                            title: string;
                        };
                        id: Id<"gamePointTypes">;
                        lookupId: string;
                        points: number;
                        title: string;
                    } | null;
                    id: Id<"points">;
                    reason: string | null;
                    season: {
                        description: string | null;
                        endedOn: string | null;
                        gameType: {
                            description: string | null;
                            id: Id<"gameTypes">;
                            lookupId: string;
                            title: string;
                        };
                        id: Id<"seasons">;
                        startedOn: string | null;
                        title: string;
                    };
                    total: number;
                    user: {
                        id: Id<"users">;
                        image: string | null;
                        name: string | null;
                    };
                } | null;
                rating: {
                    category: string | null;
                    icon: string | null;
                    id: Id<"ratings">;
                    name: string;
                    sound: string | null;
                    value: number;
                };
                season: {
                    description: string | null;
                    endedOn: string | null;
                    gameType: {
                        description: string | null;
                        id: Id<"gameTypes">;
                        lookupId: string;
                        title: string;
                    };
                    id: Id<"seasons">;
                    startedOn: string | null;
                    title: string;
                };
                user: {
                    id: Id<"users">;
                    image: string | null;
                    name: string | null;
                };
            } | null>;
            listForAssignment: FunctionReference<"query", "public", {
                assignmentId: Id<"assignments">;
            }, Array<{
                assignmentReview: {
                    assignment: {
                        episode: {
                            id: Id<"episodes">;
                            number: number;
                            slug: string | null;
                            status: string | null;
                            title: string;
                        };
                        id: Id<"assignments">;
                        playable: boolean;
                        type: string;
                    };
                    id: Id<"assignmentReviews">;
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
                        rating: {
                            category: string | null;
                            icon: string | null;
                            id: Id<"ratings">;
                            name: string;
                            sound: string | null;
                            value: number;
                        } | null;
                        reviewedAt: number | null;
                        show: {
                            id: Id<"shows">;
                            poster: string | null;
                            title: string;
                            url: string;
                            year: number;
                        } | null;
                        user: {
                            id: Id<"users">;
                            image: string | null;
                            name: string | null;
                            status: "active" | "disabled";
                        } | null;
                    };
                };
                createdAt: number;
                id: Id<"guesses">;
                point: {
                    adjustment: number | null;
                    earnedAt: number;
                    gamePointType: {
                        description: string | null;
                        gameType: {
                            description: string | null;
                            id: Id<"gameTypes">;
                            lookupId: string;
                            title: string;
                        };
                        id: Id<"gamePointTypes">;
                        lookupId: string;
                        points: number;
                        title: string;
                    } | null;
                    id: Id<"points">;
                    reason: string | null;
                    season: {
                        description: string | null;
                        endedOn: string | null;
                        gameType: {
                            description: string | null;
                            id: Id<"gameTypes">;
                            lookupId: string;
                            title: string;
                        };
                        id: Id<"seasons">;
                        startedOn: string | null;
                        title: string;
                    };
                    total: number;
                    user: {
                        id: Id<"users">;
                        image: string | null;
                        name: string | null;
                    };
                } | null;
                rating: {
                    category: string | null;
                    icon: string | null;
                    id: Id<"ratings">;
                    name: string;
                    sound: string | null;
                    value: number;
                };
                season: {
                    description: string | null;
                    endedOn: string | null;
                    gameType: {
                        description: string | null;
                        id: Id<"gameTypes">;
                        lookupId: string;
                        title: string;
                    };
                    id: Id<"seasons">;
                    startedOn: string | null;
                    title: string;
                };
                user: {
                    id: Id<"users">;
                    image: string | null;
                    name: string | null;
                };
            }>>;
            listForUserPage: FunctionReference<"query", "public", {
                paginationOpts: {
                    cursor: string | null;
                    endCursor?: string | null;
                    id?: number;
                    maximumBytesRead?: number;
                    maximumRowsRead?: number;
                    numItems: number;
                };
                season: {
                    kind: "all";
                } | {
                    kind: "current";
                    today: string;
                } | {
                    kind: "season";
                    seasonId: Id<"seasons">;
                };
                userId: Id<"users">;
            }, {
                continueCursor: string;
                isDone: boolean;
                page: Array<{
                    assignmentReview: {
                        assignment: {
                            episode: {
                                id: Id<"episodes">;
                                number: number;
                                slug: string | null;
                                status: string | null;
                                title: string;
                            };
                            id: Id<"assignments">;
                            playable: boolean;
                            type: string;
                        };
                        id: Id<"assignmentReviews">;
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
                            rating: {
                                category: string | null;
                                icon: string | null;
                                id: Id<"ratings">;
                                name: string;
                                sound: string | null;
                                value: number;
                            } | null;
                            reviewedAt: number | null;
                            show: {
                                id: Id<"shows">;
                                poster: string | null;
                                title: string;
                                url: string;
                                year: number;
                            } | null;
                            user: {
                                id: Id<"users">;
                                image: string | null;
                                name: string | null;
                                status: "active" | "disabled";
                            } | null;
                        };
                    };
                    createdAt: number;
                    id: Id<"guesses">;
                    point: {
                        adjustment: number | null;
                        earnedAt: number;
                        gamePointType: {
                            description: string | null;
                            gameType: {
                                description: string | null;
                                id: Id<"gameTypes">;
                                lookupId: string;
                                title: string;
                            };
                            id: Id<"gamePointTypes">;
                            lookupId: string;
                            points: number;
                            title: string;
                        } | null;
                        id: Id<"points">;
                        reason: string | null;
                        season: {
                            description: string | null;
                            endedOn: string | null;
                            gameType: {
                                description: string | null;
                                id: Id<"gameTypes">;
                                lookupId: string;
                                title: string;
                            };
                            id: Id<"seasons">;
                            startedOn: string | null;
                            title: string;
                        };
                        total: number;
                        user: {
                            id: Id<"users">;
                            image: string | null;
                            name: string | null;
                        };
                    } | null;
                    rating: {
                        category: string | null;
                        icon: string | null;
                        id: Id<"ratings">;
                        name: string;
                        sound: string | null;
                        value: number;
                    };
                    season: {
                        description: string | null;
                        endedOn: string | null;
                        gameType: {
                            description: string | null;
                            id: Id<"gameTypes">;
                            lookupId: string;
                            title: string;
                        };
                        id: Id<"seasons">;
                        startedOn: string | null;
                        title: string;
                    };
                    user: {
                        id: Id<"users">;
                        image: string | null;
                        name: string | null;
                    };
                }>;
                pageStatus?: "SplitRecommended" | "SplitRequired" | null;
                splitCursor?: string | null;
            }>;
            mineForAssignment: FunctionReference<"query", "public", {
                assignmentId: Id<"assignments">;
            }, Array<{
                assignmentReview: {
                    assignment: {
                        episode: {
                            id: Id<"episodes">;
                            number: number;
                            slug: string | null;
                            status: string | null;
                            title: string;
                        };
                        id: Id<"assignments">;
                        playable: boolean;
                        type: string;
                    };
                    id: Id<"assignmentReviews">;
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
                        rating: {
                            category: string | null;
                            icon: string | null;
                            id: Id<"ratings">;
                            name: string;
                            sound: string | null;
                            value: number;
                        } | null;
                        reviewedAt: number | null;
                        show: {
                            id: Id<"shows">;
                            poster: string | null;
                            title: string;
                            url: string;
                            year: number;
                        } | null;
                        user: {
                            id: Id<"users">;
                            image: string | null;
                            name: string | null;
                            status: "active" | "disabled";
                        } | null;
                    };
                };
                createdAt: number;
                id: Id<"guesses">;
                point: {
                    adjustment: number | null;
                    earnedAt: number;
                    gamePointType: {
                        description: string | null;
                        gameType: {
                            description: string | null;
                            id: Id<"gameTypes">;
                            lookupId: string;
                            title: string;
                        };
                        id: Id<"gamePointTypes">;
                        lookupId: string;
                        points: number;
                        title: string;
                    } | null;
                    id: Id<"points">;
                    reason: string | null;
                    season: {
                        description: string | null;
                        endedOn: string | null;
                        gameType: {
                            description: string | null;
                            id: Id<"gameTypes">;
                            lookupId: string;
                            title: string;
                        };
                        id: Id<"seasons">;
                        startedOn: string | null;
                        title: string;
                    };
                    total: number;
                    user: {
                        id: Id<"users">;
                        image: string | null;
                        name: string | null;
                    };
                } | null;
                rating: {
                    category: string | null;
                    icon: string | null;
                    id: Id<"ratings">;
                    name: string;
                    sound: string | null;
                    value: number;
                };
                season: {
                    description: string | null;
                    endedOn: string | null;
                    gameType: {
                        description: string | null;
                        id: Id<"gameTypes">;
                        lookupId: string;
                        title: string;
                    };
                    id: Id<"seasons">;
                    startedOn: string | null;
                    title: string;
                };
                user: {
                    id: Id<"users">;
                    image: string | null;
                    name: string | null;
                };
            }>>;
            mineForAssignments: FunctionReference<"query", "public", {
                assignmentIds: Array<Id<"assignments">>;
            }, Array<{
                assignmentId: Id<"assignments">;
                guesses: Array<{
                    assignmentReview: {
                        assignment: {
                            episode: {
                                id: Id<"episodes">;
                                number: number;
                                slug: string | null;
                                status: string | null;
                                title: string;
                            };
                            id: Id<"assignments">;
                            playable: boolean;
                            type: string;
                        };
                        id: Id<"assignmentReviews">;
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
                            rating: {
                                category: string | null;
                                icon: string | null;
                                id: Id<"ratings">;
                                name: string;
                                sound: string | null;
                                value: number;
                            } | null;
                            reviewedAt: number | null;
                            show: {
                                id: Id<"shows">;
                                poster: string | null;
                                title: string;
                                url: string;
                                year: number;
                            } | null;
                            user: {
                                id: Id<"users">;
                                image: string | null;
                                name: string | null;
                                status: "active" | "disabled";
                            } | null;
                        };
                    };
                    createdAt: number;
                    id: Id<"guesses">;
                    point: {
                        adjustment: number | null;
                        earnedAt: number;
                        gamePointType: {
                            description: string | null;
                            gameType: {
                                description: string | null;
                                id: Id<"gameTypes">;
                                lookupId: string;
                                title: string;
                            };
                            id: Id<"gamePointTypes">;
                            lookupId: string;
                            points: number;
                            title: string;
                        } | null;
                        id: Id<"points">;
                        reason: string | null;
                        season: {
                            description: string | null;
                            endedOn: string | null;
                            gameType: {
                                description: string | null;
                                id: Id<"gameTypes">;
                                lookupId: string;
                                title: string;
                            };
                            id: Id<"seasons">;
                            startedOn: string | null;
                            title: string;
                        };
                        total: number;
                        user: {
                            id: Id<"users">;
                            image: string | null;
                            name: string | null;
                        };
                    } | null;
                    rating: {
                        category: string | null;
                        icon: string | null;
                        id: Id<"ratings">;
                        name: string;
                        sound: string | null;
                        value: number;
                    };
                    season: {
                        description: string | null;
                        endedOn: string | null;
                        gameType: {
                            description: string | null;
                            id: Id<"gameTypes">;
                            lookupId: string;
                            title: string;
                        };
                        id: Id<"seasons">;
                        startedOn: string | null;
                        title: string;
                    };
                    user: {
                        id: Id<"users">;
                        image: string | null;
                        name: string | null;
                    };
                }>;
            }>>;
            remove: FunctionReference<"mutation", "public", {
                clientApiVersion: string;
                id: Id<"guesses">;
            }, {
                id: Id<"guesses">;
            }>;
            removeForAssignmentUser: FunctionReference<"mutation", "public", {
                assignmentId: Id<"assignments">;
                clientApiVersion: string;
                userId: Id<"users">;
            }, {
                deletedGuesses: number;
                deletedPoints: number;
            }>;
            setPoint: FunctionReference<"mutation", "public", {
                clientApiVersion: string;
                id: Id<"guesses">;
                pointId: Id<"points"> | null;
            }, {
                assignmentReview: {
                    assignment: {
                        episode: {
                            id: Id<"episodes">;
                            number: number;
                            slug: string | null;
                            status: string | null;
                            title: string;
                        };
                        id: Id<"assignments">;
                        playable: boolean;
                        type: string;
                    };
                    id: Id<"assignmentReviews">;
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
                        rating: {
                            category: string | null;
                            icon: string | null;
                            id: Id<"ratings">;
                            name: string;
                            sound: string | null;
                            value: number;
                        } | null;
                        reviewedAt: number | null;
                        show: {
                            id: Id<"shows">;
                            poster: string | null;
                            title: string;
                            url: string;
                            year: number;
                        } | null;
                        user: {
                            id: Id<"users">;
                            image: string | null;
                            name: string | null;
                            status: "active" | "disabled";
                        } | null;
                    };
                };
                createdAt: number;
                id: Id<"guesses">;
                point: {
                    adjustment: number | null;
                    earnedAt: number;
                    gamePointType: {
                        description: string | null;
                        gameType: {
                            description: string | null;
                            id: Id<"gameTypes">;
                            lookupId: string;
                            title: string;
                        };
                        id: Id<"gamePointTypes">;
                        lookupId: string;
                        points: number;
                        title: string;
                    } | null;
                    id: Id<"points">;
                    reason: string | null;
                    season: {
                        description: string | null;
                        endedOn: string | null;
                        gameType: {
                            description: string | null;
                            id: Id<"gameTypes">;
                            lookupId: string;
                            title: string;
                        };
                        id: Id<"seasons">;
                        startedOn: string | null;
                        title: string;
                    };
                    total: number;
                    user: {
                        id: Id<"users">;
                        image: string | null;
                        name: string | null;
                    };
                } | null;
                rating: {
                    category: string | null;
                    icon: string | null;
                    id: Id<"ratings">;
                    name: string;
                    sound: string | null;
                    value: number;
                };
                season: {
                    description: string | null;
                    endedOn: string | null;
                    gameType: {
                        description: string | null;
                        id: Id<"gameTypes">;
                        lookupId: string;
                        title: string;
                    };
                    id: Id<"seasons">;
                    startedOn: string | null;
                    title: string;
                };
                user: {
                    id: Id<"users">;
                    image: string | null;
                    name: string | null;
                };
            }>;
            submit: FunctionReference<"mutation", "public", {
                assignmentId: Id<"assignments">;
                clientApiVersion: string;
                createdAt?: number;
                hostId: Id<"users">;
                ratingId: Id<"ratings">;
                today: string;
            }, {
                assignmentReview: {
                    assignment: {
                        episode: {
                            id: Id<"episodes">;
                            number: number;
                            slug: string | null;
                            status: string | null;
                            title: string;
                        };
                        id: Id<"assignments">;
                        playable: boolean;
                        type: string;
                    };
                    id: Id<"assignmentReviews">;
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
                        rating: {
                            category: string | null;
                            icon: string | null;
                            id: Id<"ratings">;
                            name: string;
                            sound: string | null;
                            value: number;
                        } | null;
                        reviewedAt: number | null;
                        show: {
                            id: Id<"shows">;
                            poster: string | null;
                            title: string;
                            url: string;
                            year: number;
                        } | null;
                        user: {
                            id: Id<"users">;
                            image: string | null;
                            name: string | null;
                            status: "active" | "disabled";
                        } | null;
                    };
                };
                createdAt: number;
                id: Id<"guesses">;
                point: {
                    adjustment: number | null;
                    earnedAt: number;
                    gamePointType: {
                        description: string | null;
                        gameType: {
                            description: string | null;
                            id: Id<"gameTypes">;
                            lookupId: string;
                            title: string;
                        };
                        id: Id<"gamePointTypes">;
                        lookupId: string;
                        points: number;
                        title: string;
                    } | null;
                    id: Id<"points">;
                    reason: string | null;
                    season: {
                        description: string | null;
                        endedOn: string | null;
                        gameType: {
                            description: string | null;
                            id: Id<"gameTypes">;
                            lookupId: string;
                            title: string;
                        };
                        id: Id<"seasons">;
                        startedOn: string | null;
                        title: string;
                    };
                    total: number;
                    user: {
                        id: Id<"users">;
                        image: string | null;
                        name: string | null;
                    };
                } | null;
                rating: {
                    category: string | null;
                    icon: string | null;
                    id: Id<"ratings">;
                    name: string;
                    sound: string | null;
                    value: number;
                };
                season: {
                    description: string | null;
                    endedOn: string | null;
                    gameType: {
                        description: string | null;
                        id: Id<"gameTypes">;
                        lookupId: string;
                        title: string;
                    };
                    id: Id<"seasons">;
                    startedOn: string | null;
                    title: string;
                };
                user: {
                    id: Id<"users">;
                    image: string | null;
                    name: string | null;
                };
            }>;
            updateRating: FunctionReference<"mutation", "public", {
                clientApiVersion: string;
                id: Id<"guesses">;
                ratingId: Id<"ratings">;
            }, {
                assignmentReview: {
                    assignment: {
                        episode: {
                            id: Id<"episodes">;
                            number: number;
                            slug: string | null;
                            status: string | null;
                            title: string;
                        };
                        id: Id<"assignments">;
                        playable: boolean;
                        type: string;
                    };
                    id: Id<"assignmentReviews">;
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
                        rating: {
                            category: string | null;
                            icon: string | null;
                            id: Id<"ratings">;
                            name: string;
                            sound: string | null;
                            value: number;
                        } | null;
                        reviewedAt: number | null;
                        show: {
                            id: Id<"shows">;
                            poster: string | null;
                            title: string;
                            url: string;
                            year: number;
                        } | null;
                        user: {
                            id: Id<"users">;
                            image: string | null;
                            name: string | null;
                            status: "active" | "disabled";
                        } | null;
                    };
                };
                createdAt: number;
                id: Id<"guesses">;
                point: {
                    adjustment: number | null;
                    earnedAt: number;
                    gamePointType: {
                        description: string | null;
                        gameType: {
                            description: string | null;
                            id: Id<"gameTypes">;
                            lookupId: string;
                            title: string;
                        };
                        id: Id<"gamePointTypes">;
                        lookupId: string;
                        points: number;
                        title: string;
                    } | null;
                    id: Id<"points">;
                    reason: string | null;
                    season: {
                        description: string | null;
                        endedOn: string | null;
                        gameType: {
                            description: string | null;
                            id: Id<"gameTypes">;
                            lookupId: string;
                            title: string;
                        };
                        id: Id<"seasons">;
                        startedOn: string | null;
                        title: string;
                    };
                    total: number;
                    user: {
                        id: Id<"users">;
                        image: string | null;
                        name: string | null;
                    };
                } | null;
                rating: {
                    category: string | null;
                    icon: string | null;
                    id: Id<"ratings">;
                    name: string;
                    sound: string | null;
                    value: number;
                };
                season: {
                    description: string | null;
                    endedOn: string | null;
                    gameType: {
                        description: string | null;
                        id: Id<"gameTypes">;
                        lookupId: string;
                        title: string;
                    };
                    id: Id<"seasons">;
                    startedOn: string | null;
                    title: string;
                };
                user: {
                    id: Id<"users">;
                    image: string | null;
                    name: string | null;
                };
            }>;
            upsertForUser: FunctionReference<"mutation", "public", {
                assignmentId: Id<"assignments">;
                clientApiVersion: string;
                createdAt?: number;
                guesses: Array<{
                    hostId: Id<"users">;
                    ratingId: Id<"ratings">;
                }>;
                today: string;
                userId: Id<"users">;
            }, Array<{
                assignmentReview: {
                    assignment: {
                        episode: {
                            id: Id<"episodes">;
                            number: number;
                            slug: string | null;
                            status: string | null;
                            title: string;
                        };
                        id: Id<"assignments">;
                        playable: boolean;
                        type: string;
                    };
                    id: Id<"assignmentReviews">;
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
                        rating: {
                            category: string | null;
                            icon: string | null;
                            id: Id<"ratings">;
                            name: string;
                            sound: string | null;
                            value: number;
                        } | null;
                        reviewedAt: number | null;
                        show: {
                            id: Id<"shows">;
                            poster: string | null;
                            title: string;
                            url: string;
                            year: number;
                        } | null;
                        user: {
                            id: Id<"users">;
                            image: string | null;
                            name: string | null;
                            status: "active" | "disabled";
                        } | null;
                    };
                };
                createdAt: number;
                id: Id<"guesses">;
                point: {
                    adjustment: number | null;
                    earnedAt: number;
                    gamePointType: {
                        description: string | null;
                        gameType: {
                            description: string | null;
                            id: Id<"gameTypes">;
                            lookupId: string;
                            title: string;
                        };
                        id: Id<"gamePointTypes">;
                        lookupId: string;
                        points: number;
                        title: string;
                    } | null;
                    id: Id<"points">;
                    reason: string | null;
                    season: {
                        description: string | null;
                        endedOn: string | null;
                        gameType: {
                            description: string | null;
                            id: Id<"gameTypes">;
                            lookupId: string;
                            title: string;
                        };
                        id: Id<"seasons">;
                        startedOn: string | null;
                        title: string;
                    };
                    total: number;
                    user: {
                        id: Id<"users">;
                        image: string | null;
                        name: string | null;
                    };
                } | null;
                rating: {
                    category: string | null;
                    icon: string | null;
                    id: Id<"ratings">;
                    name: string;
                    sound: string | null;
                    value: number;
                };
                season: {
                    description: string | null;
                    endedOn: string | null;
                    gameType: {
                        description: string | null;
                        id: Id<"gameTypes">;
                        lookupId: string;
                        title: string;
                    };
                    id: Id<"seasons">;
                    startedOn: string | null;
                    title: string;
                };
                user: {
                    id: Id<"users">;
                    image: string | null;
                    name: string | null;
                };
            }>>;
        };
    };
};
export type InternalApiType = {};
