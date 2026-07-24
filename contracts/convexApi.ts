import { type FunctionReference, anyApi } from "convex/server";
import { type GenericId as Id } from "convex/values";

export const api: PublicApiType = anyApi as unknown as PublicApiType;
export const internal: InternalApiType = anyApi as unknown as InternalApiType;

export type PublicApiType = {
  identity: {
    profile: {
      actionGateProbe: FunctionReference<
        "action",
        "public",
        { clientApiVersion: string },
        {
          allowed: true;
          cutoverStage: "S0" | "S1" | "S2" | "S3" | "S4";
          isAdmin: boolean;
        }
      >;
      me: FunctionReference<
        "query",
        "public",
        Record<string, never>,
        {
          email: string | null;
          id: Id<"users">;
          image: string | null;
          isAdmin: boolean;
          name: string | null;
        }
      >;
      updateMyName: FunctionReference<
        "mutation",
        "public",
        { clientApiVersion: string; name: string },
        { name: string; updatedAt: number }
      >;
    };
    admin: {
      assignRole: FunctionReference<
        "mutation",
        "public",
        { clientApiVersion: string; roleId: Id<"roles">; userId: Id<"users"> },
        {
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
        }
      >;
      createRole: FunctionReference<
        "mutation",
        "public",
        {
          admin: boolean;
          clientApiVersion: string;
          description: string;
          name: string;
        },
        {
          admin: boolean;
          description: string;
          id: Id<"roles">;
          legacyId: number | null;
          name: string;
          permissions: Array<string>;
        }
      >;
      createUser: FunctionReference<
        "mutation",
        "public",
        { clientApiVersion: string; email: string; name: string },
        {
          createdAt: number;
          email: string | null;
          id: Id<"users">;
          image: string | null;
          isAdmin: boolean;
          legacyId: string | null;
          name: string | null;
          nextSyllabus: {
            id: Id<"syllabusEntries">;
            movie: { id: Id<"movies">; title: string };
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
        }
      >;
      deleteRole: FunctionReference<
        "mutation",
        "public",
        { clientApiVersion: string; id: Id<"roles"> },
        { id: Id<"roles"> }
      >;
      getRole: FunctionReference<
        "query",
        "public",
        { id: Id<"roles"> },
        {
          admin: boolean;
          description: string;
          id: Id<"roles">;
          legacyId: number | null;
          name: string;
          permissions: Array<string>;
          userCount: number;
          userCountIsExact: boolean;
        } | null
      >;
      getUser: FunctionReference<
        "query",
        "public",
        { id: Id<"users"> },
        {
          createdAt: number;
          email: string | null;
          id: Id<"users">;
          image: string | null;
          isAdmin: boolean;
          legacyId: string | null;
          name: string | null;
          nextSyllabus: {
            id: Id<"syllabusEntries">;
            movie: { id: Id<"movies">; title: string };
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
        } | null
      >;
      listRoles: FunctionReference<
        "query",
        "public",
        Record<string, never>,
        Array<{
          admin: boolean;
          description: string;
          id: Id<"roles">;
          legacyId: number | null;
          name: string;
          permissions: Array<string>;
          userCount: number;
          userCountIsExact: boolean;
        }>
      >;
      listUsersPage: FunctionReference<
        "query",
        "public",
        {
          paginationOpts: {
            cursor: string | null;
            endCursor?: string | null;
            id?: number;
            maximumBytesRead?: number;
            maximumRowsRead?: number;
            numItems: number;
          };
        },
        {
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
              movie: { id: Id<"movies">; title: string };
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
        }
      >;
      removeRoleMembership: FunctionReference<
        "mutation",
        "public",
        { clientApiVersion: string; id: Id<"userRoles"> },
        { id: Id<"userRoles"> }
      >;
      setUserStatus: FunctionReference<
        "mutation",
        "public",
        {
          clientApiVersion: string;
          id: Id<"users">;
          status: "active" | "disabled";
        },
        {
          createdAt: number;
          email: string | null;
          id: Id<"users">;
          image: string | null;
          isAdmin: boolean;
          legacyId: string | null;
          name: string | null;
          nextSyllabus: {
            id: Id<"syllabusEntries">;
            movie: { id: Id<"movies">; title: string };
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
        }
      >;
      updateRole: FunctionReference<
        "mutation",
        "public",
        {
          admin: boolean;
          clientApiVersion: string;
          description: string;
          id: Id<"roles">;
          name: string;
        },
        {
          admin: boolean;
          description: string;
          id: Id<"roles">;
          legacyId: number | null;
          name: string;
          permissions: Array<string>;
        }
      >;
      updateUser: FunctionReference<
        "mutation",
        "public",
        {
          clientApiVersion: string;
          email: string;
          id: Id<"users">;
          name: string;
        },
        {
          createdAt: number;
          email: string | null;
          id: Id<"users">;
          image: string | null;
          isAdmin: boolean;
          legacyId: string | null;
          name: string | null;
          nextSyllabus: {
            id: Id<"syllabusEntries">;
            movie: { id: Id<"movies">; title: string };
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
        }
      >;
    };
    roles: {
      mine: FunctionReference<
        "query",
        "public",
        Record<string, never>,
        Array<{
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
        }>
      >;
    };
  };
  pipeline: {
    status: {
      actionGateProbe: FunctionReference<
        "action",
        "public",
        { clientApiVersion: string; requiredPermission: string },
        { allowed: true; cutoverStage: "S0" | "S1" | "S2" | "S3" | "S4" }
      >;
      capabilities: FunctionReference<
        "query",
        "public",
        Record<string, never>,
        {
          name: string;
          permissions: Array<string>;
          servicePrincipalId: Id<"servicePrincipals">;
        }
      >;
      heartbeat: FunctionReference<
        "mutation",
        "public",
        { clientApiVersion: string; requiredPermission: string },
        { lastSeenAt: number }
      >;
    };
  };
  system: {
    cutover: {
      getStatus: FunctionReference<
        "query",
        "public",
        Record<string, never>,
        | { applicationWriteMode: "disabled"; initialized: false }
        | {
            apiVersion: string;
            applicationWriteMode: "disabled" | "enabled";
            cutoverRunId: string;
            cutoverStage: "S0" | "S1" | "S2" | "S3" | "S4";
            firstApplicationWriteAt: number | null;
            initialized: true;
            updatedAt: number;
          }
      >;
    };
    health: {
      readiness: FunctionReference<
        "query",
        "public",
        Record<string, never>,
        {
          apiVersion: string;
          applicationWritesEnabled: boolean;
          initialized: boolean;
        }
      >;
    };
  };
  episodes: {
    public: {
      getByLegacyId: FunctionReference<
        "query",
        "public",
        { legacyId: string },
        {
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
          links: Array<{ id: Id<"episodeLinks">; text: string; url: string }>;
          number: number;
          recording: string | null;
          slug: string | null;
          status: string | null;
          title: string;
        } | null
      >;
      getBySlug: FunctionReference<
        "query",
        "public",
        { slug: string },
        {
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
          links: Array<{ id: Id<"episodeLinks">; text: string; url: string }>;
          number: number;
          recording: string | null;
          slug: string | null;
          status: string | null;
          title: string;
        } | null
      >;
      latestPublished: FunctionReference<
        "query",
        "public",
        { onOrBefore: string },
        {
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
          links: Array<{ id: Id<"episodeLinks">; text: string; url: string }>;
          number: number;
          recording: string | null;
          slug: string | null;
          status: string | null;
          title: string;
        } | null
      >;
      listPage: FunctionReference<
        "query",
        "public",
        {
          paginationOpts: {
            cursor: string | null;
            endCursor?: string | null;
            id?: number;
            maximumBytesRead?: number;
            maximumRowsRead?: number;
            numItems: number;
          };
        },
        {
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
            links: Array<{ id: Id<"episodeLinks">; text: string; url: string }>;
            number: number;
            recording: string | null;
            slug: string | null;
            status: string | null;
            title: string;
          }>;
          pageStatus?: "SplitRecommended" | "SplitRequired" | null;
          splitCursor?: string | null;
        }
      >;
      nextScheduled: FunctionReference<
        "query",
        "public",
        Record<string, never>,
        {
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
          links: Array<{ id: Id<"episodeLinks">; text: string; url: string }>;
          number: number;
          recording: string | null;
          slug: string | null;
          status: string | null;
          title: string;
        } | null
      >;
      search: FunctionReference<
        "query",
        "public",
        { limit: number; query: string },
        Array<{
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
          links: Array<{ id: Id<"episodeLinks">; text: string; url: string }>;
          number: number;
          recording: string | null;
          slug: string | null;
          status: string | null;
          title: string;
        }>
      >;
    };
    audio: {
      deleteMine: FunctionReference<
        "mutation",
        "public",
        { clientApiVersion: string; id: Id<"episodeAudioMessages"> },
        { id: Id<"episodeAudioMessages"> }
      >;
      listMine: FunctionReference<
        "query",
        "public",
        {
          episodeId: Id<"episodes">;
          paginationOpts: {
            cursor: string | null;
            endCursor?: string | null;
            id?: number;
            maximumBytesRead?: number;
            maximumRowsRead?: number;
            numItems: number;
          };
        },
        {
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
        }
      >;
      updateMine: FunctionReference<
        "mutation",
        "public",
        {
          clientApiVersion: string;
          episodeId: Id<"episodes">;
          fileKey: string;
          id: Id<"episodeAudioMessages">;
          notes?: string;
        },
        {
          createdAt: number;
          episodeId: Id<"episodes"> | null;
          fileKey: string | null;
          id: Id<"episodeAudioMessages">;
          notes: string | null;
          url: string;
        }
      >;
      usageForEpisode: FunctionReference<
        "query",
        "public",
        { episodeId: Id<"episodes"> },
        { canUpload: boolean; count: number; limit: number }
      >;
    };
    admin: {
      addAudioMessage: FunctionReference<
        "mutation",
        "public",
        {
          clientApiVersion: string;
          episodeId: Id<"episodes">;
          fileKey?: string;
          notes?: string;
          url: string;
        },
        {
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
        }
      >;
      addLink: FunctionReference<
        "mutation",
        "public",
        {
          clientApiVersion: string;
          episodeId: Id<"episodes">;
          text: string;
          url: string;
        },
        { id: Id<"episodeLinks">; text: string; url: string }
      >;
      createEpisode: FunctionReference<
        "mutation",
        "public",
        { clientApiVersion: string; number: number; title: string },
        {
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
          links: Array<{ id: Id<"episodeLinks">; text: string; url: string }>;
          notes: string | null;
          number: number;
          recording: string | null;
          seoDescription: string | null;
          seoKeywords: string | null;
          seoTitle: string | null;
          slug: string | null;
          status: string | null;
          title: string;
        }
      >;
      getById: FunctionReference<
        "query",
        "public",
        { id: Id<"episodes"> },
        {
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
          links: Array<{ id: Id<"episodeLinks">; text: string; url: string }>;
          notes: string | null;
          number: number;
          recording: string | null;
          seoDescription: string | null;
          seoKeywords: string | null;
          seoTitle: string | null;
          slug: string | null;
          status: string | null;
          title: string;
        } | null
      >;
      getByNumber: FunctionReference<
        "query",
        "public",
        { number: number },
        {
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
          links: Array<{ id: Id<"episodeLinks">; text: string; url: string }>;
          notes: string | null;
          number: number;
          recording: string | null;
          seoDescription: string | null;
          seoKeywords: string | null;
          seoTitle: string | null;
          slug: string | null;
          status: string | null;
          title: string;
        } | null
      >;
      listAudioMessages: FunctionReference<
        "query",
        "public",
        {
          episodeId: Id<"episodes">;
          paginationOpts: {
            cursor: string | null;
            endCursor?: string | null;
            id?: number;
            maximumBytesRead?: number;
            maximumRowsRead?: number;
            numItems: number;
          };
        },
        {
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
        }
      >;
      removeLink: FunctionReference<
        "mutation",
        "public",
        { clientApiVersion: string; id: Id<"episodeLinks"> },
        { id: Id<"episodeLinks"> }
      >;
      updateEpisode: FunctionReference<
        "mutation",
        "public",
        {
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
        },
        {
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
          links: Array<{ id: Id<"episodeLinks">; text: string; url: string }>;
          notes: string | null;
          number: number;
          recording: string | null;
          seoDescription: string | null;
          seoKeywords: string | null;
          seoTitle: string | null;
          slug: string | null;
          status: string | null;
          title: string;
        }
      >;
    };
  };
  catalog: {
    public: {
      getMovie: FunctionReference<
        "query",
        "public",
        { id: Id<"movies"> },
        {
          id: Id<"movies">;
          poster: string | null;
          title: string;
          tmdbId: number | null;
          url: string;
          year: number;
        } | null
      >;
      getShow: FunctionReference<
        "query",
        "public",
        { id: Id<"shows"> },
        {
          id: Id<"shows">;
          poster: string | null;
          title: string;
          url: string;
          year: number;
        } | null
      >;
      listMoviesPage: FunctionReference<
        "query",
        "public",
        {
          paginationOpts: {
            cursor: string | null;
            endCursor?: string | null;
            id?: number;
            maximumBytesRead?: number;
            maximumRowsRead?: number;
            numItems: number;
          };
        },
        {
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
        }
      >;
      listShowsPage: FunctionReference<
        "query",
        "public",
        {
          paginationOpts: {
            cursor: string | null;
            endCursor?: string | null;
            id?: number;
            maximumBytesRead?: number;
            maximumRowsRead?: number;
            numItems: number;
          };
        },
        {
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
        }
      >;
      searchMovies: FunctionReference<
        "query",
        "public",
        { limit: number; query: string },
        Array<{
          id: Id<"movies">;
          poster: string | null;
          title: string;
          tmdbId: number | null;
          url: string;
          year: number;
        }>
      >;
      searchShows: FunctionReference<
        "query",
        "public",
        { limit: number; query: string },
        Array<{
          id: Id<"shows">;
          poster: string | null;
          title: string;
          url: string;
          year: number;
        }>
      >;
    };
    admin: {
      deleteMovie: FunctionReference<
        "mutation",
        "public",
        { clientApiVersion: string; id: Id<"movies"> },
        { id: Id<"movies"> }
      >;
      deleteShow: FunctionReference<
        "mutation",
        "public",
        { clientApiVersion: string; id: Id<"shows"> },
        { id: Id<"shows"> }
      >;
      updateShow: FunctionReference<
        "mutation",
        "public",
        {
          clientApiVersion: string;
          id: Id<"shows">;
          poster?: string;
          title: string;
          url: string;
          year: number;
        },
        {
          id: Id<"shows">;
          poster: string | null;
          title: string;
          url: string;
          year: number;
        }
      >;
    };
    write: {
      upsertMovieByUrl: FunctionReference<
        "mutation",
        "public",
        {
          clientApiVersion: string;
          poster: string;
          title: string;
          tmdbId?: number;
          url: string;
          year: number;
        },
        {
          id: Id<"movies">;
          poster: string | null;
          title: string;
          tmdbId: number | null;
          url: string;
          year: number;
        }
      >;
      upsertShowByUrl: FunctionReference<
        "mutation",
        "public",
        {
          clientApiVersion: string;
          poster: string;
          title: string;
          url: string;
          year: number;
        },
        {
          id: Id<"shows">;
          poster: string | null;
          title: string;
          url: string;
          year: number;
        }
      >;
    };
    external: {
      getMovie: FunctionReference<
        "action",
        "public",
        { id: number },
        {
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
        }
      >;
      getShow: FunctionReference<
        "action",
        "public",
        { id: number },
        {
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
        }
      >;
      searchMovies: FunctionReference<
        "action",
        "public",
        { page?: number; query: string },
        {
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
        }
      >;
      searchShows: FunctionReference<
        "action",
        "public",
        { page?: number; query: string },
        {
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
        }
      >;
    };
  };
};
export type InternalApiType = {};
