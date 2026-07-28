import { type FunctionReference, anyApi } from "convex/server";
import { type GenericId as Id } from "convex/values";

export const api: PublicApiType = anyApi as unknown as PublicApiType;
export const internal: InternalApiType = anyApi as unknown as InternalApiType;

export type PublicApiType = {
  admin: {
    dashboard: {
      overview: FunctionReference<
        "query",
        "public",
        Record<string, never>,
        {
          counts: {
            episodes: number;
            movies: number;
            reviews: number;
            users: number;
          };
          guessStats: Array<{
            fullTitle: string;
            guesses: number;
            id: Id<"episodes">;
            name: string;
            slug: string | null;
          }>;
          latestEpisode: {
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
          } | null;
          latestSyllabus: Array<{
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
            user: { id: Id<"users">; name: string | null };
          }>;
          upcomingEpisode: {
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
          } | null;
        }
      >;
    };
  };
  assignments: {
    admin: {
      create: FunctionReference<
        "mutation",
        "public",
        {
          clientApiVersion: string;
          episodeId: Id<"episodes">;
          movieId: Id<"movies">;
          type: string;
          userId: Id<"users">;
        },
        {
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
        }
      >;
      getById: FunctionReference<
        "query",
        "public",
        { id: Id<"assignments"> },
        {
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
        } | null
      >;
      getWorkbench: FunctionReference<
        "query",
        "public",
        { id: Id<"assignments"> },
        {
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
          reviews: Array<{
            guesses: Array<{
              createdAt: number;
              hasPoint: boolean;
              id: Id<"guesses">;
              rating: { id: Id<"ratings">; name: string; value: number };
              season: { id: Id<"seasons">; title: string };
              user: {
                id: Id<"users">;
                name: string | null;
                status: "active" | "disabled";
              };
            }>;
            id: Id<"assignmentReviews">;
            rating: { id: Id<"ratings">; name: string; value: number } | null;
            reviewId: Id<"reviews">;
            reviewedAt: number | null;
            reviewer: {
              id: Id<"users">;
              name: string | null;
              status: "active" | "disabled";
            } | null;
          }>;
          wagers: Array<{
            awardAdjustment: number | null;
            createdAt: number;
            gamblingType: {
              id: Id<"gamblingTypes">;
              multiplier: number;
              title: string;
            };
            id: Id<"gamblingEntries">;
            points: number;
            status: "pending" | "locked" | "won" | "lost" | "rejected";
            targetUser: {
              id: Id<"users">;
              name: string | null;
              status: "active" | "disabled";
            } | null;
            user: {
              id: Id<"users">;
              name: string | null;
              status: "active" | "disabled";
            };
          }>;
        } | null
      >;
      listAudioMessages: FunctionReference<
        "query",
        "public",
        {
          assignmentId: Id<"assignments">;
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
            assignmentId: Id<"assignments"> | null;
            createdAt: number;
            fileKey: string | null;
            id: Id<"assignmentAudioMessages">;
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
      listForEpisode: FunctionReference<
        "query",
        "public",
        { episodeId: Id<"episodes"> },
        Array<{
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
        }>
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
        }
      >;
      removeAudioMessage: FunctionReference<
        "mutation",
        "public",
        {
          clientApiVersion: string;
          expected: {
            assignmentId: Id<"assignments"> | null;
            createdAt: number;
            fileKey: string | null;
            url: string;
            userId: Id<"users">;
          };
          id: Id<"assignmentAudioMessages">;
        },
        { id: Id<"assignmentAudioMessages"> }
      >;
      removeIfUnreferenced: FunctionReference<
        "mutation",
        "public",
        {
          clientApiVersion: string;
          expected?: {
            episodeId: Id<"episodes">;
            movieId: Id<"movies">;
            slug: string | null;
            type: "HOMEWORK" | "EXTRA_CREDIT" | "BONUS";
            userId: Id<"users">;
          };
          id: Id<"assignments">;
        },
        { id: Id<"assignments"> }
      >;
      setType: FunctionReference<
        "mutation",
        "public",
        {
          clientApiVersion: string;
          expectedType?: "HOMEWORK" | "EXTRA_CREDIT" | "BONUS";
          id: Id<"assignments">;
          type: string;
        },
        {
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
        }
      >;
      updateSlug: FunctionReference<
        "mutation",
        "public",
        {
          clientApiVersion: string;
          expectedSlug?: string | null;
          id: Id<"assignments">;
          slug?: string;
        },
        {
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
        }
      >;
    };
    public: {
      getByLegacyId: FunctionReference<
        "query",
        "public",
        { legacyId: string },
        {
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
          user: { id: Id<"users">; image: string | null; name: string | null };
        } | null
      >;
      getBySlug: FunctionReference<
        "query",
        "public",
        { slug: string },
        {
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
          user: { id: Id<"users">; image: string | null; name: string | null };
        } | null
      >;
    };
  };
  catalog: {
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
      getMovieDetail: FunctionReference<
        "query",
        "public",
        { id: Id<"movies"> },
        {
          media: {
            id: Id<"movies">;
            poster: string | null;
            title: string;
            tmdbId: number | null;
            url: string;
            year: number;
          };
          reviews: Array<{
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
        } | null
      >;
      getShowDetail: FunctionReference<
        "query",
        "public",
        { id: Id<"shows"> },
        {
          media: {
            id: Id<"shows">;
            poster: string | null;
            title: string;
            url: string;
            year: number;
          };
          reviews: Array<{
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
        } | null
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
  };
  episodes: {
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
      removeAudioMessage: FunctionReference<
        "mutation",
        "public",
        {
          clientApiVersion: string;
          expected: {
            createdAt: number;
            episodeId: Id<"episodes"> | null;
            fileKey: string | null;
            url: string;
          };
          id: Id<"episodeAudioMessages">;
        },
        { id: Id<"episodeAudioMessages"> }
      >;
      removeLink: FunctionReference<
        "mutation",
        "public",
        {
          clientApiVersion: string;
          expected?: {
            episodeId: Id<"episodes"> | null;
            text: string;
            url: string;
          };
          id: Id<"episodeLinks">;
        },
        { id: Id<"episodeLinks"> }
      >;
      updateEpisode: FunctionReference<
        "mutation",
        "public",
        {
          clientApiVersion: string;
          date?: string | null;
          description?: string | null;
          expected?: {
            date: string | null;
            description: string | null;
            notes: string | null;
            number: number;
            recording: string | null;
            seoDescription: string | null;
            seoKeywords: string | null;
            seoTitle: string | null;
            slug: string | null;
            status: string | null;
            title: string;
          };
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
    bangers: {
      create: FunctionReference<
        "mutation",
        "public",
        {
          artist: string;
          clientApiVersion: string;
          episodeId: Id<"episodes"> | null;
          title: string;
          url: string;
          userId: Id<"users"> | null;
        },
        {
          artist: string;
          episode: {
            id: Id<"episodes">;
            number: number;
            status: string | null;
            title: string;
          } | null;
          episodeId: Id<"episodes"> | null;
          id: Id<"bangers">;
          title: string;
          url: string;
          user: {
            email: string | null;
            id: Id<"users">;
            image: string | null;
            name: string | null;
            status: "active" | "disabled";
          } | null;
          userId: Id<"users"> | null;
        }
      >;
      getAdminById: FunctionReference<
        "query",
        "public",
        { id: Id<"bangers"> },
        {
          artist: string;
          episode: {
            id: Id<"episodes">;
            number: number;
            status: string | null;
            title: string;
          } | null;
          episodeId: Id<"episodes"> | null;
          id: Id<"bangers">;
          title: string;
          url: string;
          user: {
            email: string | null;
            id: Id<"users">;
            image: string | null;
            name: string | null;
            status: "active" | "disabled";
          } | null;
          userId: Id<"users"> | null;
        } | null
      >;
      listAdminPage: FunctionReference<
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
            artist: string;
            episode: {
              id: Id<"episodes">;
              number: number;
              status: string | null;
              title: string;
            } | null;
            episodeId: Id<"episodes"> | null;
            id: Id<"bangers">;
            title: string;
            url: string;
            user: {
              email: string | null;
              id: Id<"users">;
              image: string | null;
              name: string | null;
              status: "active" | "disabled";
            } | null;
            userId: Id<"users"> | null;
          }>;
          pageStatus?: "SplitRecommended" | "SplitRequired" | null;
          splitCursor?: string | null;
        }
      >;
      remove: FunctionReference<
        "mutation",
        "public",
        {
          clientApiVersion: string;
          expected?: {
            artist: string;
            episodeId: Id<"episodes"> | null;
            title: string;
            url: string;
            userId: Id<"users"> | null;
          };
          id: Id<"bangers">;
        },
        { id: Id<"bangers"> }
      >;
      update: FunctionReference<
        "mutation",
        "public",
        {
          artist: string;
          clientApiVersion: string;
          episodeId: Id<"episodes"> | null;
          id: Id<"bangers">;
          title: string;
          url: string;
          userId: Id<"users"> | null;
        },
        {
          artist: string;
          episode: {
            id: Id<"episodes">;
            number: number;
            status: string | null;
            title: string;
          } | null;
          episodeId: Id<"episodes"> | null;
          id: Id<"bangers">;
          title: string;
          url: string;
          user: {
            email: string | null;
            id: Id<"users">;
            image: string | null;
            name: string | null;
            status: "active" | "disabled";
          } | null;
          userId: Id<"users"> | null;
        }
      >;
    };
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
      results: FunctionReference<
        "query",
        "public",
        { episodeId: Id<"episodes"> },
        {
          gamblingWinners: Array<{
            gamblingType: { multiplier: number; title: string };
            id: Id<"gamblingEntries">;
            movie: {
              id: Id<"movies">;
              poster: string | null;
              title: string;
              tmdbId: number | null;
              url: string;
              year: number;
            };
            points: number;
            user: {
              id: Id<"users">;
              image: string | null;
              name: string | null;
            };
          }>;
          guessWinners: Array<{
            actualRating: number;
            host: {
              id: Id<"users">;
              image: string | null;
              name: string | null;
            };
            id: Id<"guesses">;
            movie: {
              id: Id<"movies">;
              poster: string | null;
              title: string;
              tmdbId: number | null;
              url: string;
              year: number;
            };
            user: {
              id: Id<"users">;
              image: string | null;
              name: string | null;
            };
          }>;
        }
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
  };
  games: {
    config: {
      createGamePointType: FunctionReference<
        "mutation",
        "public",
        {
          clientApiVersion: string;
          description?: string;
          gameTypeId: Id<"gameTypes">;
          lookupId: string;
          points: number;
          title: string;
        },
        {
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
        }
      >;
      createGameType: FunctionReference<
        "mutation",
        "public",
        {
          clientApiVersion: string;
          description?: string;
          lookupId: string;
          title: string;
        },
        {
          description: string | null;
          id: Id<"gameTypes">;
          lookupId: string;
          title: string;
        }
      >;
      listGamePointTypes: FunctionReference<
        "query",
        "public",
        { gameTypeId?: Id<"gameTypes"> },
        Array<{
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
        }>
      >;
      listGameTypes: FunctionReference<
        "query",
        "public",
        Record<string, never>,
        Array<{
          description: string | null;
          id: Id<"gameTypes">;
          lookupId: string;
          title: string;
        }>
      >;
      removeGamePointType: FunctionReference<
        "mutation",
        "public",
        { clientApiVersion: string; id: Id<"gamePointTypes"> },
        { id: Id<"gamePointTypes"> }
      >;
      removeGameType: FunctionReference<
        "mutation",
        "public",
        { clientApiVersion: string; id: Id<"gameTypes"> },
        { id: Id<"gameTypes"> }
      >;
      updateGamePointType: FunctionReference<
        "mutation",
        "public",
        {
          clientApiVersion: string;
          description?: string | null;
          gameTypeId?: Id<"gameTypes">;
          id: Id<"gamePointTypes">;
          lookupId?: string;
          points?: number;
          title?: string;
        },
        {
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
        }
      >;
      updateGameType: FunctionReference<
        "mutation",
        "public",
        {
          clientApiVersion: string;
          description?: string | null;
          id: Id<"gameTypes">;
          lookupId?: string;
          title?: string;
        },
        {
          description: string | null;
          id: Id<"gameTypes">;
          lookupId: string;
          title: string;
        }
      >;
    };
    gambling: {
      confirm: FunctionReference<
        "mutation",
        "public",
        {
          clientApiVersion: string;
          earnedAt?: number;
          id: Id<"gamblingEntries">;
          season?:
            | { kind: "current"; today: string }
            | { kind: "season"; seasonId: Id<"seasons"> };
        },
        {
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
          } | null;
          awardPoint: {
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
          createdAt: number;
          gamblingType: {
            createdAt: number;
            description: string | null;
            id: Id<"gamblingTypes">;
            isActive: boolean;
            lookupId: string;
            multiplier: number;
            title: string;
          };
          id: Id<"gamblingEntries">;
          notes: string | null;
          points: number;
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
          } | null;
          status: "pending" | "locked" | "won" | "lost" | "rejected";
          targetUser: {
            id: Id<"users">;
            image: string | null;
            name: string | null;
          } | null;
          user: { id: Id<"users">; image: string | null; name: string | null };
        }
      >;
      create: FunctionReference<
        "mutation",
        "public",
        {
          assignmentId?: Id<"assignments">;
          clientApiVersion: string;
          createdAt?: number;
          gamblingTypeId?: Id<"gamblingTypes">;
          notes?: string;
          points: number;
          season:
            | { kind: "current"; today: string }
            | { kind: "season"; seasonId: Id<"seasons"> };
          targetUserId?: Id<"users">;
          userId: Id<"users">;
        },
        {
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
          } | null;
          awardPoint: {
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
          createdAt: number;
          gamblingType: {
            createdAt: number;
            description: string | null;
            id: Id<"gamblingTypes">;
            isActive: boolean;
            lookupId: string;
            multiplier: number;
            title: string;
          };
          id: Id<"gamblingEntries">;
          notes: string | null;
          points: number;
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
          } | null;
          status: "pending" | "locked" | "won" | "lost" | "rejected";
          targetUser: {
            id: Id<"users">;
            image: string | null;
            name: string | null;
          } | null;
          user: { id: Id<"users">; image: string | null; name: string | null };
        }
      >;
      createType: FunctionReference<
        "mutation",
        "public",
        {
          clientApiVersion: string;
          createdAt?: number;
          description?: string;
          isActive?: boolean;
          lookupId: string;
          multiplier?: number;
          title: string;
        },
        {
          createdAt: number;
          description: string | null;
          id: Id<"gamblingTypes">;
          isActive: boolean;
          lookupId: string;
          multiplier: number;
          title: string;
        }
      >;
      getById: FunctionReference<
        "query",
        "public",
        { id: Id<"gamblingEntries"> },
        {
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
          } | null;
          awardPoint: {
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
          createdAt: number;
          gamblingType: {
            createdAt: number;
            description: string | null;
            id: Id<"gamblingTypes">;
            isActive: boolean;
            lookupId: string;
            multiplier: number;
            title: string;
          };
          id: Id<"gamblingEntries">;
          notes: string | null;
          points: number;
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
          } | null;
          status: "pending" | "locked" | "won" | "lost" | "rejected";
          targetUser: {
            id: Id<"users">;
            image: string | null;
            name: string | null;
          } | null;
          user: { id: Id<"users">; image: string | null; name: string | null };
        } | null
      >;
      getTypeById: FunctionReference<
        "query",
        "public",
        { id: Id<"gamblingTypes"> },
        {
          createdAt: number;
          description: string | null;
          id: Id<"gamblingTypes">;
          isActive: boolean;
          lookupId: string;
          multiplier: number;
          title: string;
        } | null
      >;
      hasWonForEpisode: FunctionReference<
        "query",
        "public",
        { episodeId: Id<"episodes"> },
        boolean
      >;
      listActiveTypes: FunctionReference<
        "query",
        "public",
        Record<string, never>,
        Array<{
          createdAt: number;
          description: string | null;
          id: Id<"gamblingTypes">;
          isActive: boolean;
          lookupId: string;
          multiplier: number;
          title: string;
        }>
      >;
      listForAssignment: FunctionReference<
        "query",
        "public",
        { assignmentId: Id<"assignments"> },
        Array<{
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
          } | null;
          awardPoint: {
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
          createdAt: number;
          gamblingType: {
            createdAt: number;
            description: string | null;
            id: Id<"gamblingTypes">;
            isActive: boolean;
            lookupId: string;
            multiplier: number;
            title: string;
          };
          id: Id<"gamblingEntries">;
          notes: string | null;
          points: number;
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
          } | null;
          status: "pending" | "locked" | "won" | "lost" | "rejected";
          targetUser: {
            id: Id<"users">;
            image: string | null;
            name: string | null;
          } | null;
          user: { id: Id<"users">; image: string | null; name: string | null };
        }>
      >;
      listForSeasonPage: FunctionReference<
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
          seasonId: Id<"seasons">;
        },
        {
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
            } | null;
            awardPoint: {
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
            createdAt: number;
            gamblingType: {
              createdAt: number;
              description: string | null;
              id: Id<"gamblingTypes">;
              isActive: boolean;
              lookupId: string;
              multiplier: number;
              title: string;
            };
            id: Id<"gamblingEntries">;
            notes: string | null;
            points: number;
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
            } | null;
            status: "pending" | "locked" | "won" | "lost" | "rejected";
            targetUser: {
              id: Id<"users">;
              image: string | null;
              name: string | null;
            } | null;
            user: {
              id: Id<"users">;
              image: string | null;
              name: string | null;
            };
          }>;
          pageStatus?: "SplitRecommended" | "SplitRequired" | null;
          splitCursor?: string | null;
        }
      >;
      listForTypePage: FunctionReference<
        "query",
        "public",
        {
          gamblingTypeId: Id<"gamblingTypes">;
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
            } | null;
            awardPoint: {
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
            createdAt: number;
            gamblingType: {
              createdAt: number;
              description: string | null;
              id: Id<"gamblingTypes">;
              isActive: boolean;
              lookupId: string;
              multiplier: number;
              title: string;
            };
            id: Id<"gamblingEntries">;
            notes: string | null;
            points: number;
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
            } | null;
            status: "pending" | "locked" | "won" | "lost" | "rejected";
            targetUser: {
              id: Id<"users">;
              image: string | null;
              name: string | null;
            } | null;
            user: {
              id: Id<"users">;
              image: string | null;
              name: string | null;
            };
          }>;
          pageStatus?: "SplitRecommended" | "SplitRequired" | null;
          splitCursor?: string | null;
        }
      >;
      listForUserPage: FunctionReference<
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
          season:
            | { kind: "all" }
            | { kind: "current"; today: string }
            | { kind: "season"; seasonId: Id<"seasons"> };
          userId: Id<"users">;
        },
        {
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
            } | null;
            awardPoint: {
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
            createdAt: number;
            gamblingType: {
              createdAt: number;
              description: string | null;
              id: Id<"gamblingTypes">;
              isActive: boolean;
              lookupId: string;
              multiplier: number;
              title: string;
            };
            id: Id<"gamblingEntries">;
            notes: string | null;
            points: number;
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
            } | null;
            status: "pending" | "locked" | "won" | "lost" | "rejected";
            targetUser: {
              id: Id<"users">;
              image: string | null;
              name: string | null;
            } | null;
            user: {
              id: Id<"users">;
              image: string | null;
              name: string | null;
            };
          }>;
          pageStatus?: "SplitRecommended" | "SplitRequired" | null;
          splitCursor?: string | null;
        }
      >;
      listTypes: FunctionReference<
        "query",
        "public",
        Record<string, never>,
        Array<{
          createdAt: number;
          description: string | null;
          id: Id<"gamblingTypes">;
          isActive: boolean;
          lookupId: string;
          multiplier: number;
          title: string;
        }>
      >;
      mineForActiveTypes: FunctionReference<
        "query",
        "public",
        Record<string, never>,
        Array<{
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
          } | null;
          awardPoint: {
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
          createdAt: number;
          gamblingType: {
            createdAt: number;
            description: string | null;
            id: Id<"gamblingTypes">;
            isActive: boolean;
            lookupId: string;
            multiplier: number;
            title: string;
          };
          id: Id<"gamblingEntries">;
          notes: string | null;
          points: number;
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
          } | null;
          status: "pending" | "locked" | "won" | "lost" | "rejected";
          targetUser: {
            id: Id<"users">;
            image: string | null;
            name: string | null;
          } | null;
          user: { id: Id<"users">; image: string | null; name: string | null };
        }>
      >;
      mineForAssignment: FunctionReference<
        "query",
        "public",
        { assignmentId: Id<"assignments"> },
        Array<{
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
          } | null;
          awardPoint: {
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
          createdAt: number;
          gamblingType: {
            createdAt: number;
            description: string | null;
            id: Id<"gamblingTypes">;
            isActive: boolean;
            lookupId: string;
            multiplier: number;
            title: string;
          };
          id: Id<"gamblingEntries">;
          notes: string | null;
          points: number;
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
          } | null;
          status: "pending" | "locked" | "won" | "lost" | "rejected";
          targetUser: {
            id: Id<"users">;
            image: string | null;
            name: string | null;
          } | null;
          user: { id: Id<"users">; image: string | null; name: string | null };
        }>
      >;
      mineForAssignments: FunctionReference<
        "query",
        "public",
        { assignmentIds: Array<Id<"assignments">> },
        Array<{
          assignmentId: Id<"assignments">;
          entries: Array<{
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
            } | null;
            awardPoint: {
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
            createdAt: number;
            gamblingType: {
              createdAt: number;
              description: string | null;
              id: Id<"gamblingTypes">;
              isActive: boolean;
              lookupId: string;
              multiplier: number;
              title: string;
            };
            id: Id<"gamblingEntries">;
            notes: string | null;
            points: number;
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
            } | null;
            status: "pending" | "locked" | "won" | "lost" | "rejected";
            targetUser: {
              id: Id<"users">;
              image: string | null;
              name: string | null;
            } | null;
            user: {
              id: Id<"users">;
              image: string | null;
              name: string | null;
            };
          }>;
        }>
      >;
      mineForType: FunctionReference<
        "query",
        "public",
        { gamblingTypeId?: Id<"gamblingTypes"> },
        Array<{
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
          } | null;
          awardPoint: {
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
          createdAt: number;
          gamblingType: {
            createdAt: number;
            description: string | null;
            id: Id<"gamblingTypes">;
            isActive: boolean;
            lookupId: string;
            multiplier: number;
            title: string;
          };
          id: Id<"gamblingEntries">;
          notes: string | null;
          points: number;
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
          } | null;
          status: "pending" | "locked" | "won" | "lost" | "rejected";
          targetUser: {
            id: Id<"users">;
            image: string | null;
            name: string | null;
          } | null;
          user: { id: Id<"users">; image: string | null; name: string | null };
        }>
      >;
      reject: FunctionReference<
        "mutation",
        "public",
        {
          clientApiVersion: string;
          earnedAt?: number;
          id: Id<"gamblingEntries">;
          season?:
            | { kind: "current"; today: string }
            | { kind: "season"; seasonId: Id<"seasons"> };
        },
        {
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
          } | null;
          awardPoint: {
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
          createdAt: number;
          gamblingType: {
            createdAt: number;
            description: string | null;
            id: Id<"gamblingTypes">;
            isActive: boolean;
            lookupId: string;
            multiplier: number;
            title: string;
          };
          id: Id<"gamblingEntries">;
          notes: string | null;
          points: number;
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
          } | null;
          status: "pending" | "locked" | "won" | "lost" | "rejected";
          targetUser: {
            id: Id<"users">;
            image: string | null;
            name: string | null;
          } | null;
          user: { id: Id<"users">; image: string | null; name: string | null };
        }
      >;
      remove: FunctionReference<
        "mutation",
        "public",
        { clientApiVersion: string; id: Id<"gamblingEntries"> },
        { id: Id<"gamblingEntries"> }
      >;
      removeType: FunctionReference<
        "mutation",
        "public",
        { clientApiVersion: string; id: Id<"gamblingTypes"> },
        { id: Id<"gamblingTypes"> }
      >;
      setAwardPoint: FunctionReference<
        "mutation",
        "public",
        {
          clientApiVersion: string;
          id: Id<"gamblingEntries">;
          pointId: Id<"points"> | null;
        },
        {
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
          } | null;
          awardPoint: {
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
          createdAt: number;
          gamblingType: {
            createdAt: number;
            description: string | null;
            id: Id<"gamblingTypes">;
            isActive: boolean;
            lookupId: string;
            multiplier: number;
            title: string;
          };
          id: Id<"gamblingEntries">;
          notes: string | null;
          points: number;
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
          } | null;
          status: "pending" | "locked" | "won" | "lost" | "rejected";
          targetUser: {
            id: Id<"users">;
            image: string | null;
            name: string | null;
          } | null;
          user: { id: Id<"users">; image: string | null; name: string | null };
        }
      >;
      submit: FunctionReference<
        "mutation",
        "public",
        {
          assignmentId?: Id<"assignments">;
          clientApiVersion: string;
          createdAt?: number;
          gamblingTypeId?: Id<"gamblingTypes">;
          points: number;
          targetUserId?: Id<"users">;
          today: string;
        },
        {
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
          } | null;
          awardPoint: {
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
          createdAt: number;
          gamblingType: {
            createdAt: number;
            description: string | null;
            id: Id<"gamblingTypes">;
            isActive: boolean;
            lookupId: string;
            multiplier: number;
            title: string;
          };
          id: Id<"gamblingEntries">;
          notes: string | null;
          points: number;
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
          } | null;
          status: "pending" | "locked" | "won" | "lost" | "rejected";
          targetUser: {
            id: Id<"users">;
            image: string | null;
            name: string | null;
          } | null;
          user: { id: Id<"users">; image: string | null; name: string | null };
        }
      >;
      updatePoints: FunctionReference<
        "mutation",
        "public",
        {
          clientApiVersion: string;
          expected?: {
            awardPointId: Id<"points"> | null;
            points: number;
            status: "pending" | "locked" | "won" | "lost" | "rejected";
          };
          id: Id<"gamblingEntries">;
          points: number;
        },
        {
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
          } | null;
          awardPoint: {
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
          createdAt: number;
          gamblingType: {
            createdAt: number;
            description: string | null;
            id: Id<"gamblingTypes">;
            isActive: boolean;
            lookupId: string;
            multiplier: number;
            title: string;
          };
          id: Id<"gamblingEntries">;
          notes: string | null;
          points: number;
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
          } | null;
          status: "pending" | "locked" | "won" | "lost" | "rejected";
          targetUser: {
            id: Id<"users">;
            image: string | null;
            name: string | null;
          } | null;
          user: { id: Id<"users">; image: string | null; name: string | null };
        }
      >;
      updateStatus: FunctionReference<
        "mutation",
        "public",
        {
          clientApiVersion: string;
          earnedAt?: number;
          expectedStatus?: "pending" | "locked" | "won" | "lost" | "rejected";
          id: Id<"gamblingEntries">;
          season?:
            | { kind: "current"; today: string }
            | { kind: "season"; seasonId: Id<"seasons"> };
          status: "pending" | "locked" | "won" | "lost" | "rejected";
        },
        {
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
          } | null;
          awardPoint: {
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
          createdAt: number;
          gamblingType: {
            createdAt: number;
            description: string | null;
            id: Id<"gamblingTypes">;
            isActive: boolean;
            lookupId: string;
            multiplier: number;
            title: string;
          };
          id: Id<"gamblingEntries">;
          notes: string | null;
          points: number;
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
          } | null;
          status: "pending" | "locked" | "won" | "lost" | "rejected";
          targetUser: {
            id: Id<"users">;
            image: string | null;
            name: string | null;
          } | null;
          user: { id: Id<"users">; image: string | null; name: string | null };
        }
      >;
      updateType: FunctionReference<
        "mutation",
        "public",
        {
          clientApiVersion: string;
          description?: string | null;
          id: Id<"gamblingTypes">;
          isActive?: boolean;
          lookupId?: string;
          multiplier?: number;
          title?: string;
        },
        {
          createdAt: number;
          description: string | null;
          id: Id<"gamblingTypes">;
          isActive: boolean;
          lookupId: string;
          multiplier: number;
          title: string;
        }
      >;
    };
    guesses: {
      awardPoint: FunctionReference<
        "mutation",
        "public",
        {
          adjustment: number;
          clientApiVersion: string;
          earnedAt?: number;
          gamePointTypeId?: Id<"gamePointTypes">;
          id: Id<"guesses">;
          reason: string;
        },
        {
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
          user: { id: Id<"users">; image: string | null; name: string | null };
        }
      >;
      create: FunctionReference<
        "mutation",
        "public",
        {
          assignmentReviewId: Id<"assignmentReviews">;
          clientApiVersion: string;
          createdAt?: number;
          ratingId: Id<"ratings">;
          seasonId: Id<"seasons">;
          userId: Id<"users">;
        },
        {
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
          user: { id: Id<"users">; image: string | null; name: string | null };
        }
      >;
      getById: FunctionReference<
        "query",
        "public",
        { id: Id<"guesses"> },
        {
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
          user: { id: Id<"users">; image: string | null; name: string | null };
        } | null
      >;
      listForAssignment: FunctionReference<
        "query",
        "public",
        { assignmentId: Id<"assignments"> },
        Array<{
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
          user: { id: Id<"users">; image: string | null; name: string | null };
        }>
      >;
      listForSeasonPage: FunctionReference<
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
          seasonId: Id<"seasons">;
        },
        {
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
        }
      >;
      listForUserPage: FunctionReference<
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
          season:
            | { kind: "all" }
            | { kind: "current"; today: string }
            | { kind: "season"; seasonId: Id<"seasons"> };
          userId: Id<"users">;
        },
        {
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
        }
      >;
      mineForAssignment: FunctionReference<
        "query",
        "public",
        { assignmentId: Id<"assignments"> },
        Array<{
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
          user: { id: Id<"users">; image: string | null; name: string | null };
        }>
      >;
      mineForAssignments: FunctionReference<
        "query",
        "public",
        { assignmentIds: Array<Id<"assignments">> },
        Array<{
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
        }>
      >;
      remove: FunctionReference<
        "mutation",
        "public",
        {
          clientApiVersion: string;
          expected?: {
            assignmentReviewId: Id<"assignmentReviews">;
            createdAt: number;
            hasPoint: boolean;
            ratingId: Id<"ratings">;
            seasonId: Id<"seasons">;
            userId: Id<"users">;
          };
          id: Id<"guesses">;
        },
        { id: Id<"guesses"> }
      >;
      removeForAssignmentUser: FunctionReference<
        "mutation",
        "public",
        {
          assignmentId: Id<"assignments">;
          clientApiVersion: string;
          userId: Id<"users">;
        },
        { deletedGuesses: number; deletedPoints: number }
      >;
      setPoint: FunctionReference<
        "mutation",
        "public",
        {
          clientApiVersion: string;
          id: Id<"guesses">;
          pointId: Id<"points"> | null;
        },
        {
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
          user: { id: Id<"users">; image: string | null; name: string | null };
        }
      >;
      submit: FunctionReference<
        "mutation",
        "public",
        {
          assignmentId: Id<"assignments">;
          clientApiVersion: string;
          createdAt?: number;
          hostId: Id<"users">;
          ratingId: Id<"ratings">;
          today: string;
        },
        {
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
          user: { id: Id<"users">; image: string | null; name: string | null };
        }
      >;
      updateRating: FunctionReference<
        "mutation",
        "public",
        {
          clientApiVersion: string;
          expectedRatingId?: Id<"ratings">;
          id: Id<"guesses">;
          ratingId: Id<"ratings">;
        },
        {
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
          user: { id: Id<"users">; image: string | null; name: string | null };
        }
      >;
      upsertForUser: FunctionReference<
        "mutation",
        "public",
        {
          assignmentId: Id<"assignments">;
          clientApiVersion: string;
          createdAt?: number;
          guesses: Array<{ hostId: Id<"users">; ratingId: Id<"ratings"> }>;
          today: string;
          userId: Id<"users">;
        },
        Array<{
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
          user: { id: Id<"users">; image: string | null; name: string | null };
        }>
      >;
    };
    member: {
      myAvailablePoints: FunctionReference<
        "query",
        "public",
        {
          season:
            | { kind: "current"; today: string }
            | { kind: "season"; seasonId: Id<"seasons"> };
        },
        number
      >;
      myPointsPage: FunctionReference<
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
        }
      >;
    };
    points: {
      create: FunctionReference<
        "mutation",
        "public",
        {
          adjustment: number | null;
          clientApiVersion: string;
          earnedAt?: number;
          gamePointTypeId?: Id<"gamePointTypes">;
          reason?: string;
          season:
            | { kind: "current"; today: string }
            | { kind: "season"; seasonId: Id<"seasons"> };
          userId: Id<"users">;
        },
        {
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
          user: { id: Id<"users">; image: string | null; name: string | null };
        }
      >;
      createByLookup: FunctionReference<
        "mutation",
        "public",
        {
          adjustment?: number;
          clientApiVersion: string;
          earnedAt?: number;
          gamePointLookupId: string;
          reason: string;
          season:
            | { kind: "current"; today: string }
            | { kind: "season"; seasonId: Id<"seasons"> };
          userId: Id<"users">;
        },
        {
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
          user: { id: Id<"users">; image: string | null; name: string | null };
        }
      >;
      createForAssignmentByLookup: FunctionReference<
        "mutation",
        "public",
        {
          adjustment?: number;
          assignmentId: Id<"assignments">;
          clientApiVersion: string;
          earnedAt?: number;
          gamePointLookupId: string;
          reason: string;
          season:
            | { kind: "current"; today: string }
            | { kind: "season"; seasonId: Id<"seasons"> };
          userId: Id<"users">;
        },
        {
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
          gamblingEntries: Array<{ id: Id<"gamblingEntries"> }>;
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
          quoteSubmissions: Array<{ id: Id<"quoteSubmissions"> }>;
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
          tagVotes: Array<{ id: Id<"tagVotes">; tag: string }>;
          total: number;
          user: { id: Id<"users">; image: string | null; name: string | null };
        }
      >;
      getById: FunctionReference<
        "query",
        "public",
        { id: Id<"points"> },
        {
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
          gamblingEntries: Array<{ id: Id<"gamblingEntries"> }>;
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
          quoteSubmissions: Array<{ id: Id<"quoteSubmissions"> }>;
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
          tagVotes: Array<{ id: Id<"tagVotes">; tag: string }>;
          total: number;
          user: { id: Id<"users">; image: string | null; name: string | null };
        } | null
      >;
      getWorkbench: FunctionReference<
        "query",
        "public",
        { id: Id<"points"> },
        {
          guessAssignments: Array<{
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
            assignmentReviewId: Id<"assignmentReviews">;
            id: Id<"guesses">;
          }>;
          impact: {
            assignmentLinkCount: number;
            gamblingEntryCount: number;
            guessCount: number;
            quoteSubmissionCount: number;
            tagVoteCount: number;
          };
          point: {
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
            gamblingEntries: Array<{ id: Id<"gamblingEntries"> }>;
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
            quoteSubmissions: Array<{ id: Id<"quoteSubmissions"> }>;
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
            tagVotes: Array<{ id: Id<"tagVotes">; tag: string }>;
            total: number;
            user: {
              id: Id<"users">;
              image: string | null;
              name: string | null;
            };
          };
        } | null
      >;
      linkAssignment: FunctionReference<
        "mutation",
        "public",
        {
          assignmentId: Id<"assignments">;
          clientApiVersion: string;
          pointId: Id<"points">;
        },
        {
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
        }
      >;
      listForAssignmentAndUser: FunctionReference<
        "query",
        "public",
        { assignmentId: Id<"assignments">; userId: Id<"users"> },
        Array<{
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
        }>
      >;
      listForSeasonPage: FunctionReference<
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
          seasonId: Id<"seasons">;
        },
        {
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
        }
      >;
      listForUserPage: FunctionReference<
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
          season:
            | { kind: "all" }
            | { kind: "current"; today: string }
            | { kind: "season"; seasonId: Id<"seasons"> };
          userId: Id<"users">;
        },
        {
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
        }
      >;
      remove: FunctionReference<
        "mutation",
        "public",
        {
          clientApiVersion: string;
          expected?: {
            adjustment: number | null;
            earnedAt: number;
            gamePointTypeId: Id<"gamePointTypes"> | null;
            reason: string | null;
            seasonId: Id<"seasons">;
            userId: Id<"users">;
          };
          expectedImpact?: {
            assignmentLinkCount: number;
            gamblingEntryCount: number;
            guessCount: number;
            quoteSubmissionCount: number;
            tagVoteCount: number;
          };
          id: Id<"points">;
        },
        { id: Id<"points"> }
      >;
      searchAssignmentsForLink: FunctionReference<
        "query",
        "public",
        { query: string },
        Array<{
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
        }>
      >;
      totalForUser: FunctionReference<
        "query",
        "public",
        {
          season:
            | { kind: "all" }
            | { kind: "current"; today: string }
            | { kind: "season"; seasonId: Id<"seasons"> };
          userId: Id<"users">;
        },
        number
      >;
      totalsForAssignments: FunctionReference<
        "query",
        "public",
        {
          assignmentIds: Array<Id<"assignments">>;
          userIds: Array<Id<"users">>;
        },
        Array<{
          assignmentId: Id<"assignments">;
          total: number;
          userId: Id<"users">;
        }>
      >;
      unlinkAssignment: FunctionReference<
        "mutation",
        "public",
        {
          assignmentId: Id<"assignments">;
          clientApiVersion: string;
          expectedLinkId?: Id<"assignmentPointLinks">;
          pointId: Id<"points">;
        },
        { count: number }
      >;
      update: FunctionReference<
        "mutation",
        "public",
        {
          adjustment?: number | null;
          clientApiVersion: string;
          earnedAt?: number;
          expected?: {
            adjustment: number | null;
            earnedAt: number;
            gamePointTypeId: Id<"gamePointTypes"> | null;
            reason: string | null;
            seasonId: Id<"seasons">;
            userId: Id<"users">;
          };
          gamePointTypeId?: Id<"gamePointTypes"> | null;
          id: Id<"points">;
          reason?: string | null;
        },
        {
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
          user: { id: Id<"users">; image: string | null; name: string | null };
        }
      >;
    };
    public: {
      currentPerformance: FunctionReference<
        "query",
        "public",
        { today: string },
        {
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
        } | null
      >;
      currentSeason: FunctionReference<
        "query",
        "public",
        { today: string },
        {
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
        } | null
      >;
      hasActiveSeason: FunctionReference<
        "query",
        "public",
        { today: string },
        boolean
      >;
      predictionScoring: FunctionReference<
        "query",
        "public",
        Record<string, never>,
        {
          allCorrectBonus: number | null;
          allIncorrect: number | null;
          correctHost: number | null;
        }
      >;
    };
    quotes: {
      awardPlacements: FunctionReference<
        "mutation",
        "public",
        {
          clientApiVersion: string;
          earnedAt?: number;
          episodeId: Id<"episodes">;
          expectedAwards?: Array<{
            placement: number | null;
            pointId: Id<"points"> | null;
            submissionId: Id<"quoteSubmissions">;
          }>;
          now?: number;
          placements: Array<{
            placement: number;
            submissionId: Id<"quoteSubmissions">;
          }>;
        },
        { awarded: number; cleared: number }
      >;
      createForUser: FunctionReference<
        "mutation",
        "public",
        {
          clientApiVersion: string;
          clipStartSeconds?: number | null;
          clipUrl?: string | null;
          episodeId: Id<"episodes">;
          listenerNotes?: string | null;
          now?: number;
          quoteText: string;
          sourceTitle: string;
          sourceType: "MOVIE" | "TV" | "OTHER";
          today: string;
          userId: Id<"users">;
        },
        {
          adminNotes: string | null;
          bracketOrder: number | null;
          clipStartSeconds: number | null;
          clipUrl: string | null;
          createdAt: number;
          episode: {
            id: Id<"episodes">;
            number: number;
            status: string | null;
            title: string;
          };
          episodeId: Id<"episodes">;
          id: Id<"quoteSubmissions">;
          listenerNotes: string | null;
          placement: number | null;
          point: {
            adjustment: number | null;
            id: Id<"points">;
            reason: string | null;
          } | null;
          quoteText: string;
          scored: boolean;
          season: { id: Id<"seasons">; title: string };
          seasonId: Id<"seasons">;
          sourceTitle: string;
          sourceType: "MOVIE" | "TV" | "OTHER";
          status: "SUBMITTED" | "INCLUDED" | "REJECTED";
          updatedAt: number;
          user: {
            email: string | null;
            id: Id<"users">;
            image: string | null;
            name: string | null;
          };
          userId: Id<"users">;
        }
      >;
      currentForMe: FunctionReference<
        "query",
        "public",
        Record<string, never>,
        {
          episode: {
            id: Id<"episodes">;
            number: number;
            status: string | null;
            title: string;
          } | null;
          isOpen: boolean;
          submission: {
            bracketOrder: number | null;
            clipStartSeconds: number | null;
            clipUrl: string | null;
            createdAt: number;
            id: Id<"quoteSubmissions">;
            listenerNotes: string | null;
            placement: number | null;
            quoteText: string;
            scored: boolean;
            sourceTitle: string;
            sourceType: "MOVIE" | "TV" | "OTHER";
            status: "SUBMITTED" | "INCLUDED" | "REJECTED";
            updatedAt: number;
          } | null;
        }
      >;
      getAdminById: FunctionReference<
        "query",
        "public",
        { id: Id<"quoteSubmissions"> },
        {
          adminNotes: string | null;
          bracketOrder: number | null;
          clipStartSeconds: number | null;
          clipUrl: string | null;
          createdAt: number;
          episode: {
            id: Id<"episodes">;
            number: number;
            status: string | null;
            title: string;
          };
          episodeId: Id<"episodes">;
          id: Id<"quoteSubmissions">;
          listenerNotes: string | null;
          placement: number | null;
          point: {
            adjustment: number | null;
            id: Id<"points">;
            reason: string | null;
          } | null;
          quoteText: string;
          scored: boolean;
          season: { id: Id<"seasons">; title: string };
          seasonId: Id<"seasons">;
          sourceTitle: string;
          sourceType: "MOVIE" | "TV" | "OTHER";
          status: "SUBMITTED" | "INCLUDED" | "REJECTED";
          updatedAt: number;
          user: {
            email: string | null;
            id: Id<"users">;
            image: string | null;
            name: string | null;
          };
          userId: Id<"users">;
        } | null
      >;
      listAdminEpisodes: FunctionReference<
        "query",
        "public",
        Record<string, never>,
        Array<{
          id: Id<"episodes">;
          number: number;
          status: string | null;
          submissionCount: number;
          title: string;
        }>
      >;
      listAdminForEpisode: FunctionReference<
        "query",
        "public",
        { episodeId: Id<"episodes"> },
        Array<{
          adminNotes: string | null;
          bracketOrder: number | null;
          clipStartSeconds: number | null;
          clipUrl: string | null;
          createdAt: number;
          episode: {
            id: Id<"episodes">;
            number: number;
            status: string | null;
            title: string;
          };
          episodeId: Id<"episodes">;
          id: Id<"quoteSubmissions">;
          listenerNotes: string | null;
          placement: number | null;
          point: {
            adjustment: number | null;
            id: Id<"points">;
            reason: string | null;
          } | null;
          quoteText: string;
          scored: boolean;
          season: { id: Id<"seasons">; title: string };
          seasonId: Id<"seasons">;
          sourceTitle: string;
          sourceType: "MOVIE" | "TV" | "OTHER";
          status: "SUBMITTED" | "INCLUDED" | "REJECTED";
          updatedAt: number;
          user: {
            email: string | null;
            id: Id<"users">;
            image: string | null;
            name: string | null;
          };
          userId: Id<"users">;
        }>
      >;
      randomizeIncluded: FunctionReference<
        "mutation",
        "public",
        {
          clientApiVersion: string;
          episodeId: Id<"episodes">;
          now?: number;
          seed: string;
        },
        { count: number }
      >;
      remove: FunctionReference<
        "mutation",
        "public",
        {
          clientApiVersion: string;
          expectedAward?: {
            placement: number | null;
            pointId: Id<"points"> | null;
          };
          id: Id<"quoteSubmissions">;
        },
        { id: Id<"quoteSubmissions"> }
      >;
      setStatus: FunctionReference<
        "mutation",
        "public",
        {
          clientApiVersion: string;
          id: Id<"quoteSubmissions">;
          now?: number;
          status: "SUBMITTED" | "INCLUDED" | "REJECTED";
        },
        {
          adminNotes: string | null;
          bracketOrder: number | null;
          clipStartSeconds: number | null;
          clipUrl: string | null;
          createdAt: number;
          episode: {
            id: Id<"episodes">;
            number: number;
            status: string | null;
            title: string;
          };
          episodeId: Id<"episodes">;
          id: Id<"quoteSubmissions">;
          listenerNotes: string | null;
          placement: number | null;
          point: {
            adjustment: number | null;
            id: Id<"points">;
            reason: string | null;
          } | null;
          quoteText: string;
          scored: boolean;
          season: { id: Id<"seasons">; title: string };
          seasonId: Id<"seasons">;
          sourceTitle: string;
          sourceType: "MOVIE" | "TV" | "OTHER";
          status: "SUBMITTED" | "INCLUDED" | "REJECTED";
          updatedAt: number;
          user: {
            email: string | null;
            id: Id<"users">;
            image: string | null;
            name: string | null;
          };
          userId: Id<"users">;
        }
      >;
      submitMine: FunctionReference<
        "mutation",
        "public",
        {
          clientApiVersion: string;
          clipStartSeconds?: number | null;
          clipUrl?: string | null;
          listenerNotes?: string | null;
          now?: number;
          quoteText: string;
          sourceTitle: string;
          sourceType: "MOVIE" | "TV" | "OTHER";
          today: string;
        },
        {
          bracketOrder: number | null;
          clipStartSeconds: number | null;
          clipUrl: string | null;
          createdAt: number;
          id: Id<"quoteSubmissions">;
          listenerNotes: string | null;
          placement: number | null;
          quoteText: string;
          scored: boolean;
          sourceTitle: string;
          sourceType: "MOVIE" | "TV" | "OTHER";
          status: "SUBMITTED" | "INCLUDED" | "REJECTED";
          updatedAt: number;
        }
      >;
      updateContent: FunctionReference<
        "mutation",
        "public",
        {
          adminNotes?: string | null;
          clientApiVersion: string;
          clipStartSeconds?: number | null;
          clipUrl?: string | null;
          id: Id<"quoteSubmissions">;
          listenerNotes?: string | null;
          now?: number;
          quoteText: string;
          sourceTitle: string;
          sourceType: "MOVIE" | "TV" | "OTHER";
        },
        {
          adminNotes: string | null;
          bracketOrder: number | null;
          clipStartSeconds: number | null;
          clipUrl: string | null;
          createdAt: number;
          episode: {
            id: Id<"episodes">;
            number: number;
            status: string | null;
            title: string;
          };
          episodeId: Id<"episodes">;
          id: Id<"quoteSubmissions">;
          listenerNotes: string | null;
          placement: number | null;
          point: {
            adjustment: number | null;
            id: Id<"points">;
            reason: string | null;
          } | null;
          quoteText: string;
          scored: boolean;
          season: { id: Id<"seasons">; title: string };
          seasonId: Id<"seasons">;
          sourceTitle: string;
          sourceType: "MOVIE" | "TV" | "OTHER";
          status: "SUBMITTED" | "INCLUDED" | "REJECTED";
          updatedAt: number;
          user: {
            email: string | null;
            id: Id<"users">;
            image: string | null;
            name: string | null;
          };
          userId: Id<"users">;
        }
      >;
      withdrawMine: FunctionReference<
        "mutation",
        "public",
        { clientApiVersion: string },
        { id: Id<"quoteSubmissions"> }
      >;
    };
    seasons: {
      create: FunctionReference<
        "mutation",
        "public",
        {
          clientApiVersion: string;
          description?: string;
          endedOn?: string | null;
          gameTypeId: Id<"gameTypes">;
          startedOn: string;
          title: string;
        },
        {
          counts: {
            gamblingEntries: { count: number; isExact: boolean };
            guesses: { count: number; isExact: boolean };
            points: { count: number; isExact: boolean };
            quoteSubmissions: { count: number; isExact: boolean };
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
        }
      >;
      getById: FunctionReference<
        "query",
        "public",
        { id: Id<"seasons"> },
        {
          counts: {
            gamblingEntries: { count: number; isExact: boolean };
            guesses: { count: number; isExact: boolean };
            points: { count: number; isExact: boolean };
            quoteSubmissions: { count: number; isExact: boolean };
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
        } | null
      >;
      getPerformance: FunctionReference<
        "query",
        "public",
        { seasonId: Id<"seasons"> },
        {
          points: Array<{
            earnedAt: number;
            pointValue: number;
            userId: Id<"users">;
          }>;
          userSummary: Array<{
            gamblingCount: number;
            guessCount: number;
            total: number;
            user: {
              id: Id<"users">;
              image: string | null;
              name: string | null;
            };
          }>;
        }
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
            counts: {
              gamblingEntries: { count: number; isExact: boolean };
              guesses: { count: number; isExact: boolean };
              points: { count: number; isExact: boolean };
              quoteSubmissions: { count: number; isExact: boolean };
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
        }
      >;
      removeIfUnreferenced: FunctionReference<
        "mutation",
        "public",
        { clientApiVersion: string; id: Id<"seasons"> },
        { id: Id<"seasons"> }
      >;
      update: FunctionReference<
        "mutation",
        "public",
        {
          clientApiVersion: string;
          description?: string | null;
          endedOn?: string | null;
          gameTypeId?: Id<"gameTypes">;
          id: Id<"seasons">;
          startedOn?: string;
          title?: string;
        },
        {
          counts: {
            gamblingEntries: { count: number; isExact: boolean };
            guesses: { count: number; isExact: boolean };
            points: { count: number; isExact: boolean };
            quoteSubmissions: { count: number; isExact: boolean };
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
        }
      >;
    };
    tags: {
      applyVotePoints: FunctionReference<
        "mutation",
        "public",
        {
          clientApiVersion: string;
          earnedAt?: number;
          id: Id<"tagVotes">;
          today: string;
        },
        {
          award:
            | { kind: "unawarded" }
            | {
                kind: "point";
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
              }
            | { kind: "legacyAwardTombstone" };
          createdAt: number;
          id: Id<"tagVotes">;
          isTag: boolean | null;
          tag: string;
          tmdbId: number;
          user: {
            id: Id<"users">;
            image: string | null;
            name: string | null;
          } | null;
        }
      >;
      createCatalogTag: FunctionReference<
        "mutation",
        "public",
        {
          clientApiVersion: string;
          createdAt?: number;
          description?: string;
          name: string;
        },
        {
          createdAt: number;
          description: string | null;
          id: Id<"tags">;
          name: string;
        }
      >;
      deleteCatalogTag: FunctionReference<
        "mutation",
        "public",
        { clientApiVersion: string; id: Id<"tags"> },
        { id: Id<"tags"> }
      >;
      deleteVote: FunctionReference<
        "mutation",
        "public",
        { clientApiVersion: string; id: Id<"tagVotes"> },
        { id: Id<"tagVotes"> }
      >;
      getVoteById: FunctionReference<
        "query",
        "public",
        { id: Id<"tagVotes"> },
        {
          award:
            | { kind: "unawarded" }
            | {
                kind: "point";
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
              }
            | { kind: "legacyAwardTombstone" };
          createdAt: number;
          id: Id<"tagVotes">;
          isTag: boolean | null;
          tag: string;
          tmdbId: number;
          user: {
            id: Id<"users">;
            image: string | null;
            name: string | null;
          } | null;
        } | null
      >;
      listCatalog: FunctionReference<
        "query",
        "public",
        Record<string, never>,
        Array<{
          createdAt: number;
          description: string | null;
          id: Id<"tags">;
          name: string;
        }>
      >;
      listVotesForUserPage: FunctionReference<
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
          userId: Id<"users">;
        },
        {
          continueCursor: string;
          isDone: boolean;
          page: Array<{
            award:
              | { kind: "unawarded" }
              | {
                  kind: "point";
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
                }
              | { kind: "legacyAwardTombstone" };
            createdAt: number;
            id: Id<"tagVotes">;
            isTag: boolean | null;
            tag: string;
            tmdbId: number;
            user: {
              id: Id<"users">;
              image: string | null;
              name: string | null;
            } | null;
          }>;
          pageStatus?: "SplitRecommended" | "SplitRequired" | null;
          splitCursor?: string | null;
        }
      >;
      listVotesPage: FunctionReference<
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
          tmdbId?: number;
        },
        {
          continueCursor: string;
          isDone: boolean;
          page: Array<{
            award:
              | { kind: "unawarded" }
              | {
                  kind: "point";
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
                }
              | { kind: "legacyAwardTombstone" };
            createdAt: number;
            id: Id<"tagVotes">;
            isTag: boolean | null;
            tag: string;
            tmdbId: number;
            user: {
              id: Id<"users">;
              image: string | null;
              name: string | null;
            } | null;
          }>;
          pageStatus?: "SplitRecommended" | "SplitRequired" | null;
          splitCursor?: string | null;
        }
      >;
      updateCatalogTag: FunctionReference<
        "mutation",
        "public",
        {
          clientApiVersion: string;
          description?: string | null;
          id: Id<"tags">;
          name?: string;
        },
        {
          createdAt: number;
          description: string | null;
          id: Id<"tags">;
          name: string;
        }
      >;
    };
  };
  identity: {
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
        {
          clientApiVersion: string;
          expected?: {
            assignedAt: number | null;
            assignedBy: Id<"users"> | null;
            roleId: Id<"roles">;
            userId: Id<"users">;
          };
          id: Id<"userRoles">;
        },
        { id: Id<"userRoles"> }
      >;
      setUserStatus: FunctionReference<
        "mutation",
        "public",
        {
          clientApiVersion: string;
          expected?: {
            email: string | null;
            name: string | null;
            status: "active" | "disabled";
            updatedAt: number;
          };
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
          expected?: {
            email: string | null;
            name: string | null;
            status: "active" | "disabled";
            updatedAt: number;
          };
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
    impersonation: {
      current: FunctionReference<
        "query",
        "public",
        Record<string, never>,
        {
          endsAt: number;
          id: Id<"impersonationSessions">;
          reason: string;
          startedAt: number;
          targetName: string | null;
          targetUserId: Id<"users">;
        } | null
      >;
      revoke: FunctionReference<
        "mutation",
        "public",
        { clientApiVersion: string; sessionId: Id<"impersonationSessions"> },
        { revoked: boolean; revokedAt: number | null }
      >;
      start: FunctionReference<
        "mutation",
        "public",
        {
          clientApiVersion: string;
          durationMinutes: number;
          reason: string;
          targetUserId: Id<"users">;
        },
        {
          endsAt: number;
          id: Id<"impersonationSessions">;
          reason: string;
          startedAt: number;
          targetName: string | null;
          targetUserId: Id<"users">;
        }
      >;
    };
    linking: {
      linkOrCreateMe: FunctionReference<
        "mutation",
        "public",
        { clientApiVersion: string },
        {
          email: string | null;
          id: Id<"users">;
          image: string | null;
          isAdmin: boolean;
          isHost: boolean;
          linkMode: "alreadyLinked" | "existingUser" | "newUser";
          name: string | null;
        }
      >;
    };
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
      administratorMe: FunctionReference<
        "query",
        "public",
        Record<string, never>,
        {
          email: string | null;
          id: Id<"users">;
          image: string | null;
          isAdmin: boolean;
          isHost: boolean;
          name: string | null;
        }
      >;
      discardMyProfileImageUpload: FunctionReference<
        "mutation",
        "public",
        { clientApiVersion: string; fileKey: string; uploadId: string },
        { intentId: Id<"sideEffectIntents">; queued: true }
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
          isHost: boolean;
          name: string | null;
        }
      >;
      updateMyName: FunctionReference<
        "mutation",
        "public",
        { clientApiVersion: string; name: string },
        { name: string; updatedAt: number }
      >;
      updateMyProfileWithImage: FunctionReference<
        "mutation",
        "public",
        {
          clientApiVersion: string;
          expectedImage: string | null;
          fileKey: string;
          image: string;
          name: string;
          uploadId: string;
        },
        { image: string; name: string; updatedAt: number }
      >;
    };
    public: {
      listHosts: FunctionReference<
        "query",
        "public",
        Record<string, never>,
        Array<{ id: Id<"users">; image: string | null; name: string | null }>
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
    content: {
      getEpisodeByDate: FunctionReference<
        "query",
        "public",
        { date: string },
        {
          date: string | null;
          description: string | null;
          id: Id<"episodes">;
          notes: string | null;
          number: number;
          seoDescription: string | null;
          seoKeywords: string | null;
          seoTitle: string | null;
          slug: string | null;
          status: string | null;
          title: string;
        } | null
      >;
      getEpisodeContextByDate: FunctionReference<
        "query",
        "public",
        { date: string },
        {
          episode: {
            date: string | null;
            description: string | null;
            id: Id<"episodes">;
            notes: string | null;
            number: number;
            seoDescription: string | null;
            seoKeywords: string | null;
            seoTitle: string | null;
            slug: string | null;
            status: string | null;
            title: string;
          };
          movies: Array<{
            assignmentType: string | null;
            id: Id<"movies">;
            poster: string | null;
            source: "assignment" | "extra_review";
            title: string;
            year: number;
          }>;
        } | null
      >;
      getEpisodeContextById: FunctionReference<
        "query",
        "public",
        { id: Id<"episodes"> },
        {
          episode: {
            date: string | null;
            description: string | null;
            id: Id<"episodes">;
            notes: string | null;
            number: number;
            seoDescription: string | null;
            seoKeywords: string | null;
            seoTitle: string | null;
            slug: string | null;
            status: string | null;
            title: string;
          };
          movies: Array<{
            assignmentType: string | null;
            id: Id<"movies">;
            poster: string | null;
            source: "assignment" | "extra_review";
            title: string;
            year: number;
          }>;
        } | null
      >;
      getMoviePosters: FunctionReference<
        "query",
        "public",
        { movieIds: Array<Id<"movies">> },
        Array<{ id: Id<"movies">; poster: string }>
      >;
      listEpisodeDatesPage: FunctionReference<
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
          page: Array<{ date: string; id: Id<"episodes"> }>;
          pageStatus?: "SplitRecommended" | "SplitRequired" | null;
          splitCursor?: string | null;
        }
      >;
      listMovieCatalogPage: FunctionReference<
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
            year: number;
          }>;
          pageStatus?: "SplitRecommended" | "SplitRequired" | null;
          splitCursor?: string | null;
        }
      >;
      publishEpisodeSeo: FunctionReference<
        "mutation",
        "public",
        {
          clientApiVersion: string;
          date: string;
          expected: {
            seoDescription: string | null;
            seoKeywords: string | null;
            seoTitle: string | null;
          };
          operationId: string;
          seoDescription: string | null;
          seoKeywords: string | null;
          seoTitle: string | null;
        },
        {
          changed: boolean;
          episode: {
            date: string | null;
            description: string | null;
            id: Id<"episodes">;
            notes: string | null;
            number: number;
            seoDescription: string | null;
            seoKeywords: string | null;
            seoTitle: string | null;
            slug: string | null;
            status: string | null;
            title: string;
          };
        }
      >;
      upsertEpisodeFromAudio: FunctionReference<
        "mutation",
        "public",
        {
          clientApiVersion: string;
          date: string;
          number: number;
          operationId: string;
          title: string;
        },
        {
          created: boolean;
          episode: {
            date: string | null;
            description: string | null;
            id: Id<"episodes">;
            notes: string | null;
            number: number;
            seoDescription: string | null;
            seoKeywords: string | null;
            seoTitle: string | null;
            slug: string | null;
            status: string | null;
            title: string;
          };
        }
      >;
    };
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
  rankings: {
    items: {
      move: FunctionReference<
        "mutation",
        "public",
        {
          clientApiVersion: string;
          id: Id<"rankedItems">;
          newRank: number;
          now?: number;
        },
        {
          comment: string | null;
          createdAt: number;
          episode: {
            date: string | null;
            id: Id<"episodes">;
            number: number;
            status: string | null;
            title: string;
          } | null;
          episodeId: Id<"episodes"> | null;
          id: Id<"rankedItems">;
          movie: {
            id: Id<"movies">;
            poster: string | null;
            title: string;
            tmdbId: number | null;
            url: string;
            year: number;
          } | null;
          movieId: Id<"movies"> | null;
          rank: number;
          rankedListId: Id<"rankedLists">;
          show: {
            id: Id<"shows">;
            poster: string | null;
            title: string;
            url: string;
            year: number;
          } | null;
          showId: Id<"shows"> | null;
          targetType: "movie" | "show" | "episode";
          updatedAt: number;
        }
      >;
      remove: FunctionReference<
        "mutation",
        "public",
        { clientApiVersion: string; id: Id<"rankedItems">; now?: number },
        { id: Id<"rankedItems">; rank: number }
      >;
      reorder: FunctionReference<
        "mutation",
        "public",
        {
          clientApiVersion: string;
          itemIds: Array<Id<"rankedItems">>;
          now?: number;
          rankedListId: Id<"rankedLists">;
        },
        {
          createdAt: number;
          id: Id<"rankedLists">;
          itemCount: number;
          items: Array<{
            comment: string | null;
            createdAt: number;
            episode: {
              date: string | null;
              id: Id<"episodes">;
              number: number;
              status: string | null;
              title: string;
            } | null;
            episodeId: Id<"episodes"> | null;
            id: Id<"rankedItems">;
            movie: {
              id: Id<"movies">;
              poster: string | null;
              title: string;
              tmdbId: number | null;
              url: string;
              year: number;
            } | null;
            movieId: Id<"movies"> | null;
            rank: number;
            rankedListId: Id<"rankedLists">;
            show: {
              id: Id<"shows">;
              poster: string | null;
              title: string;
              url: string;
              year: number;
            } | null;
            showId: Id<"shows"> | null;
            targetType: "movie" | "show" | "episode";
            updatedAt: number;
          }>;
          rankedListTypeId: Id<"rankedListTypes">;
          status: "DRAFT" | "PUBLISHED";
          title: string | null;
          type: {
            createdAt: number;
            description: string | null;
            id: Id<"rankedListTypes">;
            maxItems: number;
            name: string;
            targetType: "MOVIE" | "SHOW" | "EPISODE";
            updatedAt: number;
          };
          updatedAt: number;
          user: { id: Id<"users">; image: string | null; name: string | null };
          userId: Id<"users">;
        }
      >;
      upsert: FunctionReference<
        "mutation",
        "public",
        {
          clientApiVersion: string;
          comment?: string | null;
          now?: number;
          rank: number;
          rankedListId: Id<"rankedLists">;
          target:
            | { id: Id<"movies">; kind: "movie" }
            | { id: Id<"shows">; kind: "show" }
            | { id: Id<"episodes">; kind: "episode" };
        },
        {
          comment: string | null;
          createdAt: number;
          episode: {
            date: string | null;
            id: Id<"episodes">;
            number: number;
            status: string | null;
            title: string;
          } | null;
          episodeId: Id<"episodes"> | null;
          id: Id<"rankedItems">;
          movie: {
            id: Id<"movies">;
            poster: string | null;
            title: string;
            tmdbId: number | null;
            url: string;
            year: number;
          } | null;
          movieId: Id<"movies"> | null;
          rank: number;
          rankedListId: Id<"rankedLists">;
          show: {
            id: Id<"shows">;
            poster: string | null;
            title: string;
            url: string;
            year: number;
          } | null;
          showId: Id<"shows"> | null;
          targetType: "movie" | "show" | "episode";
          updatedAt: number;
        }
      >;
    };
    lists: {
      changeOwner: FunctionReference<
        "mutation",
        "public",
        {
          clientApiVersion: string;
          id: Id<"rankedLists">;
          now?: number;
          userId: Id<"users">;
        },
        {
          createdAt: number;
          id: Id<"rankedLists">;
          itemCount: number;
          items: Array<{
            comment: string | null;
            createdAt: number;
            episode: {
              date: string | null;
              id: Id<"episodes">;
              number: number;
              status: string | null;
              title: string;
            } | null;
            episodeId: Id<"episodes"> | null;
            id: Id<"rankedItems">;
            movie: {
              id: Id<"movies">;
              poster: string | null;
              title: string;
              tmdbId: number | null;
              url: string;
              year: number;
            } | null;
            movieId: Id<"movies"> | null;
            rank: number;
            rankedListId: Id<"rankedLists">;
            show: {
              id: Id<"shows">;
              poster: string | null;
              title: string;
              url: string;
              year: number;
            } | null;
            showId: Id<"shows"> | null;
            targetType: "movie" | "show" | "episode";
            updatedAt: number;
          }>;
          rankedListTypeId: Id<"rankedListTypes">;
          status: "DRAFT" | "PUBLISHED";
          title: string | null;
          type: {
            createdAt: number;
            description: string | null;
            id: Id<"rankedListTypes">;
            maxItems: number;
            name: string;
            targetType: "MOVIE" | "SHOW" | "EPISODE";
            updatedAt: number;
          };
          updatedAt: number;
          user: { id: Id<"users">; image: string | null; name: string | null };
          userId: Id<"users">;
        }
      >;
      createMine: FunctionReference<
        "mutation",
        "public",
        {
          clientApiVersion: string;
          now?: number;
          rankedListTypeId: Id<"rankedListTypes">;
          status: "DRAFT" | "PUBLISHED";
          title?: string | null;
        },
        {
          createdAt: number;
          id: Id<"rankedLists">;
          itemCount: number;
          items: Array<{
            comment: string | null;
            createdAt: number;
            episode: {
              date: string | null;
              id: Id<"episodes">;
              number: number;
              status: string | null;
              title: string;
            } | null;
            episodeId: Id<"episodes"> | null;
            id: Id<"rankedItems">;
            movie: {
              id: Id<"movies">;
              poster: string | null;
              title: string;
              tmdbId: number | null;
              url: string;
              year: number;
            } | null;
            movieId: Id<"movies"> | null;
            rank: number;
            rankedListId: Id<"rankedLists">;
            show: {
              id: Id<"shows">;
              poster: string | null;
              title: string;
              url: string;
              year: number;
            } | null;
            showId: Id<"shows"> | null;
            targetType: "movie" | "show" | "episode";
            updatedAt: number;
          }>;
          rankedListTypeId: Id<"rankedListTypes">;
          status: "DRAFT" | "PUBLISHED";
          title: string | null;
          type: {
            createdAt: number;
            description: string | null;
            id: Id<"rankedListTypes">;
            maxItems: number;
            name: string;
            targetType: "MOVIE" | "SHOW" | "EPISODE";
            updatedAt: number;
          };
          updatedAt: number;
          user: { id: Id<"users">; image: string | null; name: string | null };
          userId: Id<"users">;
        }
      >;
      get: FunctionReference<
        "query",
        "public",
        { id: Id<"rankedLists"> },
        {
          createdAt: number;
          id: Id<"rankedLists">;
          itemCount: number;
          items: Array<{
            comment: string | null;
            createdAt: number;
            episode: {
              date: string | null;
              id: Id<"episodes">;
              number: number;
              status: string | null;
              title: string;
            } | null;
            episodeId: Id<"episodes"> | null;
            id: Id<"rankedItems">;
            movie: {
              id: Id<"movies">;
              poster: string | null;
              title: string;
              tmdbId: number | null;
              url: string;
              year: number;
            } | null;
            movieId: Id<"movies"> | null;
            rank: number;
            rankedListId: Id<"rankedLists">;
            show: {
              id: Id<"shows">;
              poster: string | null;
              title: string;
              url: string;
              year: number;
            } | null;
            showId: Id<"shows"> | null;
            targetType: "movie" | "show" | "episode";
            updatedAt: number;
          }>;
          rankedListTypeId: Id<"rankedListTypes">;
          status: "DRAFT" | "PUBLISHED";
          title: string | null;
          type: {
            createdAt: number;
            description: string | null;
            id: Id<"rankedListTypes">;
            maxItems: number;
            name: string;
            targetType: "MOVIE" | "SHOW" | "EPISODE";
            updatedAt: number;
          };
          updatedAt: number;
          user: { id: Id<"users">; image: string | null; name: string | null };
          userId: Id<"users">;
        }
      >;
      listAdminPage: FunctionReference<
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
          rankedListTypeId?: Id<"rankedListTypes">;
          userId?: Id<"users">;
        },
        {
          continueCursor: string;
          isDone: boolean;
          page: Array<{
            createdAt: number;
            id: Id<"rankedLists">;
            itemCount: number;
            rankedListTypeId: Id<"rankedListTypes">;
            status: "DRAFT" | "PUBLISHED";
            title: string | null;
            type: {
              createdAt: number;
              description: string | null;
              id: Id<"rankedListTypes">;
              maxItems: number;
              name: string;
              targetType: "MOVIE" | "SHOW" | "EPISODE";
              updatedAt: number;
            };
            updatedAt: number;
            user: {
              id: Id<"users">;
              image: string | null;
              name: string | null;
            };
            userId: Id<"users">;
          }>;
          pageStatus?: "SplitRecommended" | "SplitRequired" | null;
          splitCursor?: string | null;
        }
      >;
      listMine: FunctionReference<
        "query",
        "public",
        { targetType?: "MOVIE" | "SHOW" | "EPISODE" },
        Array<{
          createdAt: number;
          id: Id<"rankedLists">;
          itemCount: number;
          rankedListTypeId: Id<"rankedListTypes">;
          status: "DRAFT" | "PUBLISHED";
          title: string | null;
          type: {
            createdAt: number;
            description: string | null;
            id: Id<"rankedListTypes">;
            maxItems: number;
            name: string;
            targetType: "MOVIE" | "SHOW" | "EPISODE";
            updatedAt: number;
          };
          updatedAt: number;
          user: { id: Id<"users">; image: string | null; name: string | null };
          userId: Id<"users">;
        }>
      >;
      removeAccessible: FunctionReference<
        "mutation",
        "public",
        { clientApiVersion: string; id: Id<"rankedLists"> },
        { deletedItems: number; id: Id<"rankedLists"> }
      >;
      updateAccessible: FunctionReference<
        "mutation",
        "public",
        {
          clientApiVersion: string;
          id: Id<"rankedLists">;
          now?: number;
          status?: "DRAFT" | "PUBLISHED";
          title?: string | null;
        },
        {
          createdAt: number;
          id: Id<"rankedLists">;
          itemCount: number;
          items: Array<{
            comment: string | null;
            createdAt: number;
            episode: {
              date: string | null;
              id: Id<"episodes">;
              number: number;
              status: string | null;
              title: string;
            } | null;
            episodeId: Id<"episodes"> | null;
            id: Id<"rankedItems">;
            movie: {
              id: Id<"movies">;
              poster: string | null;
              title: string;
              tmdbId: number | null;
              url: string;
              year: number;
            } | null;
            movieId: Id<"movies"> | null;
            rank: number;
            rankedListId: Id<"rankedLists">;
            show: {
              id: Id<"shows">;
              poster: string | null;
              title: string;
              url: string;
              year: number;
            } | null;
            showId: Id<"shows"> | null;
            targetType: "movie" | "show" | "episode";
            updatedAt: number;
          }>;
          rankedListTypeId: Id<"rankedListTypes">;
          status: "DRAFT" | "PUBLISHED";
          title: string | null;
          type: {
            createdAt: number;
            description: string | null;
            id: Id<"rankedListTypes">;
            maxItems: number;
            name: string;
            targetType: "MOVIE" | "SHOW" | "EPISODE";
            updatedAt: number;
          };
          updatedAt: number;
          user: { id: Id<"users">; image: string | null; name: string | null };
          userId: Id<"users">;
        }
      >;
    };
    types: {
      create: FunctionReference<
        "mutation",
        "public",
        {
          clientApiVersion: string;
          description?: string | null;
          maxItems: number;
          name: string;
          now?: number;
          targetType: "MOVIE" | "SHOW" | "EPISODE";
        },
        {
          createdAt: number;
          description: string | null;
          id: Id<"rankedListTypes">;
          maxItems: number;
          name: string;
          targetType: "MOVIE" | "SHOW" | "EPISODE";
          updatedAt: number;
        }
      >;
      list: FunctionReference<
        "query",
        "public",
        Record<string, never>,
        Array<{
          createdAt: number;
          description: string | null;
          id: Id<"rankedListTypes">;
          maxItems: number;
          name: string;
          targetType: "MOVIE" | "SHOW" | "EPISODE";
          updatedAt: number;
        }>
      >;
      remove: FunctionReference<
        "mutation",
        "public",
        { clientApiVersion: string; id: Id<"rankedListTypes"> },
        { id: Id<"rankedListTypes"> }
      >;
      update: FunctionReference<
        "mutation",
        "public",
        {
          clientApiVersion: string;
          description?: string | null;
          id: Id<"rankedListTypes">;
          maxItems?: number;
          name?: string;
          now?: number;
          targetType?: "MOVIE" | "SHOW" | "EPISODE";
        },
        {
          createdAt: number;
          description: string | null;
          id: Id<"rankedListTypes">;
          maxItems: number;
          name: string;
          targetType: "MOVIE" | "SHOW" | "EPISODE";
          updatedAt: number;
        }
      >;
    };
  };
  ratings: {
    admin: {
      create: FunctionReference<
        "mutation",
        "public",
        {
          category?: string;
          clientApiVersion: string;
          icon?: string;
          name: string;
          sound?: string;
          value: number;
        },
        {
          category: string | null;
          icon: string | null;
          id: Id<"ratings">;
          name: string;
          sound: string | null;
          value: number;
        }
      >;
      getById: FunctionReference<
        "query",
        "public",
        { id: Id<"ratings"> },
        {
          category: string | null;
          icon: string | null;
          id: Id<"ratings">;
          name: string;
          sound: string | null;
          value: number;
        } | null
      >;
      list: FunctionReference<
        "query",
        "public",
        Record<string, never>,
        Array<{
          category: string | null;
          icon: string | null;
          id: Id<"ratings">;
          name: string;
          sound: string | null;
          value: number;
        }>
      >;
      removeIfUnreferenced: FunctionReference<
        "mutation",
        "public",
        { clientApiVersion: string; id: Id<"ratings"> },
        { id: Id<"ratings"> }
      >;
      update: FunctionReference<
        "mutation",
        "public",
        {
          category?: string | null;
          clientApiVersion: string;
          icon?: string | null;
          id: Id<"ratings">;
          name?: string;
          sound?: string | null;
          value?: number;
        },
        {
          category: string | null;
          icon: string | null;
          id: Id<"ratings">;
          name: string;
          sound: string | null;
          value: number;
        }
      >;
    };
    public: {
      getById: FunctionReference<
        "query",
        "public",
        { id: Id<"ratings"> },
        {
          category: string | null;
          icon: string | null;
          id: Id<"ratings">;
          name: string;
          sound: string | null;
          value: number;
        } | null
      >;
      getByValue: FunctionReference<
        "query",
        "public",
        { value: number },
        {
          category: string | null;
          icon: string | null;
          id: Id<"ratings">;
          name: string;
          sound: string | null;
          value: number;
        } | null
      >;
      list: FunctionReference<
        "query",
        "public",
        Record<string, never>,
        Array<{
          category: string | null;
          icon: string | null;
          id: Id<"ratings">;
          name: string;
          sound: string | null;
          value: number;
        }>
      >;
    };
  };
  recording: {
    favorites: {
      list: FunctionReference<
        "query",
        "public",
        { accessToken: string; clientId: string; publicSessionId: string },
        Array<{
          category: string;
          duration: number;
          id: string;
          name: string;
          url: string;
        }>
      >;
      replaceAll: FunctionReference<
        "mutation",
        "public",
        {
          accessToken: string;
          clientApiVersion: string;
          clientId: string;
          favorites: Array<{
            category: string;
            duration: number;
            id: string;
            name: string;
            url: string;
          }>;
          publicSessionId: string;
          updatedAt: number;
        },
        { count: number }
      >;
    };
    manifests: {
      getBySession: FunctionReference<
        "query",
        "public",
        { accessToken: string; clientId: string; publicSessionId: string },
        {
          date: string;
          episode: string;
          hosts: Array<string>;
          manifest: any;
          manifestVersion: string;
          publicSessionId: string;
          updatedAt: number;
        } | null
      >;
      save: FunctionReference<
        "mutation",
        "public",
        {
          accessToken: string;
          clientApiVersion: string;
          clientId: string;
          date: string;
          episode: string;
          hosts: Array<string>;
          manifest: any;
          manifestVersion: string;
          publicSessionId: string;
          updatedAt: number;
        },
        Id<"recordingSessionManifests">
      >;
    };
    recordings: {
      listBySession: FunctionReference<
        "query",
        "public",
        { accessToken: string; clientId: string; publicSessionId: string },
        Array<{
          blobName: string;
          contentType: string;
          episode: string;
          hostName: string;
          id: Id<"recordingUploads">;
          publicSessionId: string | null;
          size: number;
          startedAt: number;
          trackType: "mic" | "sounders";
          uploadedAt: number;
          url: string;
        }>
      >;
      saveUpload: FunctionReference<
        "mutation",
        "public",
        {
          accessToken: string;
          blobName: string;
          clientApiVersion: string;
          clientId: string;
          contentType: string;
          episode: string;
          hostName: string;
          publicSessionId: string;
          size: number;
          startedAt: number;
          trackType: "mic" | "sounders";
          uploadedAt: number;
          url: string;
        },
        Id<"recordingUploads">
      >;
    };
    rtc: {
      cleanupRtcSession: FunctionReference<
        "mutation",
        "public",
        {
          clientApiVersion: string;
          olderThan: number;
          publicSessionId: string;
        },
        { deletedPresence: number; deletedSignals: number }
      >;
      heartbeatAudio: FunctionReference<
        "mutation",
        "public",
        {
          accessToken: string;
          clientApiVersion: string;
          clientId: string;
          muted: boolean;
          publicSessionId: string;
          recording: boolean;
        },
        { ok: true } | null
      >;
      joinAudio: FunctionReference<
        "mutation",
        "public",
        {
          accessToken: string;
          clientApiVersion: string;
          clientId: string;
          muted: boolean;
          publicSessionId: string;
          recording: boolean;
        },
        { ok: true } | { ok: false; reason: "room-full" }
      >;
      leaveAudio: FunctionReference<
        "mutation",
        "public",
        {
          accessToken: string;
          clientApiVersion: string;
          clientId: string;
          publicSessionId: string;
        },
        { ok: true }
      >;
      listAudioPresence: FunctionReference<
        "query",
        "public",
        { accessToken: string; clientId: string; publicSessionId: string },
        Array<{
          clientId: string;
          displayName: string;
          joinedAudioAt: number;
          lastSeenAt: number;
          muted: boolean;
          recording: boolean;
          role: "owner" | "participant";
        }>
      >;
      listSignalsForParticipant: FunctionReference<
        "query",
        "public",
        {
          accessToken: string;
          clientId: string;
          now: number;
          publicSessionId: string;
        },
        Array<{
          createdAt: number;
          fromClientId: string;
          payload: any;
          signalId: string;
          toClientId: string;
          type: "offer" | "answer" | "ice-candidate" | "leave" | "renegotiate";
        }>
      >;
      sendSignal: FunctionReference<
        "mutation",
        "public",
        {
          accessToken: string;
          clientApiVersion: string;
          clientId: string;
          payload: any;
          publicSessionId: string;
          signalId: string;
          toClientId: string;
          type: "offer" | "answer" | "ice-candidate" | "leave" | "renegotiate";
        },
        { ok: true } | null
      >;
    };
    sessions: {
      appendSessionEvent: FunctionReference<
        "mutation",
        "public",
        {
          accessToken: string;
          clientApiVersion: string;
          clientId: string;
          createdAt: number;
          eventId: string;
          payload:
            | {
                from?: string;
                kind: "sounder";
                played_at_ms: number;
                played_by: string;
                sounder: {
                  category: string;
                  duration: number;
                  id: string;
                  name: string;
                  url: string;
                };
              }
            | {
                from?: string;
                kind: "note";
                note: {
                  author: string;
                  id: string;
                  text: string;
                  timestamp_ms: number;
                };
              }
            | { from?: string; id: string; kind: "note-delete" }
            | {
                from?: string;
                kind: "segment-start";
                segment: {
                  end_ms: number | null;
                  id: string;
                  label: string;
                  start_ms: number;
                  type:
                    "intro" | "segment" | "ad" | "outro" | "news" | "interview";
                };
              }
            | { end_ms: number; from?: string; id: string; kind: "segment-end" }
            | { from?: string; id: string; kind: "segment-delete" }
            | {
                cue: {
                  author?: string;
                  end_ms: number | null;
                  id: string;
                  reason?: string;
                  start_ms: number;
                  type:
                    | "doxx-bleep"
                    | "network-drop"
                    | "dmca-music"
                    | "spoiler"
                    | "other";
                };
                from?: string;
                kind: "edit-cue";
              }
            | {
                end_ms: number;
                from?: string;
                id: string;
                kind: "edit-cue-update";
              }
            | { from?: string; id: string; kind: "edit-cue-delete" }
            | { episode: string; from?: string; kind: "episode-update" }
            | {
                from?: string;
                kind: "recording-started";
                participant?: {
                  clientId: string;
                  joinedAt: number;
                  name: string;
                  role: "owner";
                };
                startedAt: number;
                startedByRole?: "owner";
              }
            | {
                durationMs: number;
                from?: string;
                kind: "recording-stopped";
                participant?: {
                  clientId: string;
                  leftAt: number;
                  reason: "host-stopped";
                };
                startedAt: number;
                stoppedByRole?: "owner";
              }
            | {
                from?: string;
                kind: "recording-joined";
                participant: {
                  clientId: string;
                  joinedAt: number;
                  name: string;
                  recordingStartedAt: number;
                  role: "owner" | "participant";
                };
              }
            | {
                from?: string;
                kind: "recording-left";
                participant: {
                  clientId: string;
                  leftAt: number;
                  reason?: "left" | "host-stopped";
                  recordingStartedAt: number;
                };
              }
            | {
                from?: string;
                kind: "audio-joined";
                participant: {
                  clientId: string;
                  joinedAudioAt: number;
                  name: string;
                  recordingStartedAt: number | null;
                  role: "owner" | "participant";
                };
              }
            | {
                from?: string;
                kind: "audio-left";
                participant: {
                  clientId: string;
                  leftAudioAt: number;
                  recordingStartedAt: number | null;
                };
              }
            | {
                disconnect: {
                  clientId: string;
                  disconnectId: string;
                  reason:
                    | "ice-disconnected"
                    | "ice-failed"
                    | "heartbeat-timeout"
                    | "page-hidden-timeout";
                  recordingStartedAt: number | null;
                  startedAt: number;
                };
                from?: string;
                kind: "audio-disconnect-started";
              }
            | {
                disconnect: {
                  clientId: string;
                  disconnectId: string;
                  endedAt: number;
                  recordingStartedAt: number | null;
                };
                from?: string;
                kind: "audio-disconnect-ended";
              };
          publicId: string;
        },
        Id<"recordingSessionEvents">
      >;
      cleanupEndedSessions: FunctionReference<
        "mutation",
        "public",
        {
          clientApiVersion: string;
          confirmation: "delete-ended-sessions";
          limit?: number;
          olderThan: number;
        },
        {
          events: number;
          favorites: number;
          invites: number;
          manifests: number;
          participants: number;
          recordings: number;
          rtcPresence: number;
          rtcSignals: number;
          sessions: number;
        }
      >;
      createSession: FunctionReference<
        "mutation",
        "public",
        {
          clientApiVersion: string;
          createdAt: number;
          episode: string;
          episodeId?: Id<"episodes">;
          inviteToken: string;
          participant: {
            accessToken: string;
            clientId: string;
            displayName: string;
            joinedAt: number;
          };
          publicId: string;
        },
        {
          createdAt: string;
          endedAt: string | null;
          episode: string;
          episodeId: Id<"episodes"> | null;
          id: string;
          participants: Array<{
            clientId: string;
            displayName: string;
            joinedAt: string;
            role: "owner" | "participant";
          }>;
          status: "active" | "ended";
        }
      >;
      deleteSessionData: FunctionReference<
        "mutation",
        "public",
        {
          clientApiVersion: string;
          confirmation: "delete-session-data";
          publicId: string;
        },
        {
          events: number;
          favorites: number;
          invites: number;
          manifests: number;
          participants: number;
          recordings: number;
          rtcPresence: number;
          rtcSignals: number;
          sessions: number;
        } | null
      >;
      endSession: FunctionReference<
        "mutation",
        "public",
        {
          accessToken: string;
          clientApiVersion: string;
          clientId: string;
          publicId: string;
        },
        {
          createdAt: string;
          endedAt: string | null;
          episode: string;
          episodeId: Id<"episodes"> | null;
          id: string;
          status: "active" | "ended";
        }
      >;
      getParticipantForGrant: FunctionReference<
        "query",
        "public",
        { accessToken: string; clientId: string; publicId: string },
        {
          clientId: string;
          displayName: string;
          joinedAt: string;
          role: "owner" | "participant";
        } | null
      >;
      getSession: FunctionReference<
        "query",
        "public",
        { accessToken: string; clientId: string; publicId: string },
        {
          createdAt: string;
          endedAt: string | null;
          episode: string;
          episodeId: Id<"episodes"> | null;
          id: string;
          participants: Array<{
            clientId: string;
            displayName: string;
            joinedAt: string;
            role: "owner" | "participant";
          }>;
          status: "active" | "ended";
        } | null
      >;
      getSessionLifecycle: FunctionReference<
        "query",
        "public",
        { accessToken: string; clientId: string; publicId: string },
        {
          createdAt: string;
          endedAt: string | null;
          episode: string;
          episodeId: Id<"episodes"> | null;
          id: string;
          status: "active" | "ended";
        } | null
      >;
      joinSessionByInviteToken: FunctionReference<
        "mutation",
        "public",
        {
          clientApiVersion: string;
          inviteToken: string;
          participant: {
            accessToken: string;
            clientId: string;
            displayName: string;
            joinedAt: number;
          };
        },
        {
          createdAt: string;
          endedAt: string | null;
          episode: string;
          episodeId: Id<"episodes"> | null;
          id: string;
          participants: Array<{
            clientId: string;
            displayName: string;
            joinedAt: string;
            role: "owner" | "participant";
          }>;
          status: "active" | "ended";
        } | null
      >;
      listParticipants: FunctionReference<
        "query",
        "public",
        { accessToken: string; clientId: string; publicId: string },
        Array<{ id: string; name: string }>
      >;
      listSessionEvents: FunctionReference<
        "query",
        "public",
        { accessToken: string; clientId: string; publicId: string },
        Array<{
          actorId: string;
          createdAt: number;
          eventId: string;
          payload:
            | {
                from?: string;
                kind: "sounder";
                played_at_ms: number;
                played_by: string;
                sounder: {
                  category: string;
                  duration: number;
                  id: string;
                  name: string;
                  url: string;
                };
              }
            | {
                from?: string;
                kind: "note";
                note: {
                  author: string;
                  id: string;
                  text: string;
                  timestamp_ms: number;
                };
              }
            | { from?: string; id: string; kind: "note-delete" }
            | {
                from?: string;
                kind: "segment-start";
                segment: {
                  end_ms: number | null;
                  id: string;
                  label: string;
                  start_ms: number;
                  type:
                    "intro" | "segment" | "ad" | "outro" | "news" | "interview";
                };
              }
            | { end_ms: number; from?: string; id: string; kind: "segment-end" }
            | { from?: string; id: string; kind: "segment-delete" }
            | {
                cue: {
                  author?: string;
                  end_ms: number | null;
                  id: string;
                  reason?: string;
                  start_ms: number;
                  type:
                    | "doxx-bleep"
                    | "network-drop"
                    | "dmca-music"
                    | "spoiler"
                    | "other";
                };
                from?: string;
                kind: "edit-cue";
              }
            | {
                end_ms: number;
                from?: string;
                id: string;
                kind: "edit-cue-update";
              }
            | { from?: string; id: string; kind: "edit-cue-delete" }
            | { episode: string; from?: string; kind: "episode-update" }
            | {
                from?: string;
                kind: "recording-started";
                participant?: {
                  clientId: string;
                  joinedAt: number;
                  name: string;
                  role: "owner";
                };
                startedAt: number;
                startedByRole?: "owner";
              }
            | {
                durationMs: number;
                from?: string;
                kind: "recording-stopped";
                participant?: {
                  clientId: string;
                  leftAt: number;
                  reason: "host-stopped";
                };
                startedAt: number;
                stoppedByRole?: "owner";
              }
            | {
                from?: string;
                kind: "recording-joined";
                participant: {
                  clientId: string;
                  joinedAt: number;
                  name: string;
                  recordingStartedAt: number;
                  role: "owner" | "participant";
                };
              }
            | {
                from?: string;
                kind: "recording-left";
                participant: {
                  clientId: string;
                  leftAt: number;
                  reason?: "left" | "host-stopped";
                  recordingStartedAt: number;
                };
              }
            | {
                from?: string;
                kind: "audio-joined";
                participant: {
                  clientId: string;
                  joinedAudioAt: number;
                  name: string;
                  recordingStartedAt: number | null;
                  role: "owner" | "participant";
                };
              }
            | {
                from?: string;
                kind: "audio-left";
                participant: {
                  clientId: string;
                  leftAudioAt: number;
                  recordingStartedAt: number | null;
                };
              }
            | {
                disconnect: {
                  clientId: string;
                  disconnectId: string;
                  reason:
                    | "ice-disconnected"
                    | "ice-failed"
                    | "heartbeat-timeout"
                    | "page-hidden-timeout";
                  recordingStartedAt: number | null;
                  startedAt: number;
                };
                from?: string;
                kind: "audio-disconnect-started";
              }
            | {
                disconnect: {
                  clientId: string;
                  disconnectId: string;
                  endedAt: number;
                  recordingStartedAt: number | null;
                };
                from?: string;
                kind: "audio-disconnect-ended";
              };
        }>
      >;
      updateParticipantDisplayName: FunctionReference<
        "mutation",
        "public",
        {
          accessToken: string;
          clientApiVersion: string;
          clientId: string;
          displayName: string;
          publicId: string;
        },
        {
          clientId: string;
          displayName: string;
          joinedAt: string;
          role: "owner" | "participant";
        }
      >;
      updateSessionEpisode: FunctionReference<
        "mutation",
        "public",
        {
          accessToken: string;
          clientApiVersion: string;
          clientId: string;
          episode: string;
          episodeId?: Id<"episodes"> | null;
          publicId: string;
        },
        {
          createdAt: string;
          endedAt: string | null;
          episode: string;
          episodeId: Id<"episodes"> | null;
          id: string;
          status: "active" | "ended";
        }
      >;
    };
    sounders: {
      list: FunctionReference<
        "query",
        "public",
        Record<string, never>,
        Array<{
          blobName: string;
          category: string;
          contentType: string;
          duration: number;
          id: string;
          name: string;
          size: number;
          url: string;
        }>
      >;
      replaceAll: FunctionReference<
        "mutation",
        "public",
        {
          clientApiVersion: string;
          sounders: Array<{
            blobName: string;
            category: string;
            contentType: string;
            duration: number;
            id: string;
            name: string;
            size: number;
            url: string;
          }>;
          updatedAt: number;
        },
        { count: number }
      >;
    };
    templates: {
      list: FunctionReference<
        "query",
        "public",
        Record<string, never>,
        Array<{
          id: string;
          introSounder: string | null;
          label: string;
          outroSounder: string | null;
          sortOrder: number;
          type: "intro" | "segment" | "ad" | "outro" | "news" | "interview";
        }>
      >;
      upsertMany: FunctionReference<
        "mutation",
        "public",
        {
          clientApiVersion: string;
          templates: Array<{
            id: string;
            introSounder?: string;
            label: string;
            outroSounder?: string;
            sortOrder?: number;
            type: "intro" | "segment" | "ad" | "outro" | "news" | "interview";
          }>;
          updatedAt: number;
        },
        { count: number }
      >;
    };
  };
  reviews: {
    admin: {
      createExtra: FunctionReference<
        "mutation",
        "public",
        {
          clientApiVersion: string;
          episodeId: Id<"episodes">;
          movieId?: Id<"movies">;
          ratingId?: Id<"ratings">;
          showId?: Id<"shows">;
          userId: Id<"users">;
        },
        {
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
        }
      >;
      createForAssignment: FunctionReference<
        "mutation",
        "public",
        {
          assignmentId: Id<"assignments">;
          clientApiVersion: string;
          ratingId?: Id<"ratings">;
          userId: Id<"users">;
        },
        {
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
        }
      >;
      getById: FunctionReference<
        "query",
        "public",
        { id: Id<"reviews"> },
        {
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
        } | null
      >;
      getDeleteImpact: FunctionReference<
        "query",
        "public",
        { id: Id<"reviews"> },
        {
          assignmentReviewCount: number;
          extraReviewCount: number;
          guessCount: number;
          id: Id<"reviews">;
        }
      >;
      listExtrasForEpisode: FunctionReference<
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
        }
      >;
      listForAssignment: FunctionReference<
        "query",
        "public",
        {
          assignmentId: Id<"assignments">;
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
        }
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
          ratingId?: Id<"ratings">;
          unrated?: boolean;
          userId?: Id<"users">;
        },
        {
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
        }
      >;
      remove: FunctionReference<
        "mutation",
        "public",
        {
          clientApiVersion: string;
          expectedImpact?: {
            assignmentReviewCount: number;
            extraReviewCount: number;
            guessCount: number;
          };
          id: Id<"reviews">;
        },
        {
          assignmentReviewCount: number;
          extraReviewCount: number;
          guessCount: number;
          id: Id<"reviews">;
        }
      >;
      removeAssignmentIfNoGuesses: FunctionReference<
        "mutation",
        "public",
        { clientApiVersion: string; id: Id<"assignmentReviews"> },
        { id: Id<"assignmentReviews"> }
      >;
      setRating: FunctionReference<
        "mutation",
        "public",
        {
          clientApiVersion: string;
          expectedRatingId?: Id<"ratings"> | null;
          ratingId: Id<"ratings"> | null;
          reviewId: Id<"reviews">;
        },
        {
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
        }
      >;
    };
    mine: {
      addMovieExtra: FunctionReference<
        "mutation",
        "public",
        {
          clientApiVersion: string;
          episodeId: Id<"episodes">;
          movieId: Id<"movies">;
        },
        {
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
        }
      >;
      addShowExtra: FunctionReference<
        "mutation",
        "public",
        {
          clientApiVersion: string;
          episodeId: Id<"episodes">;
          showId: Id<"shows">;
        },
        {
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
        }
      >;
    };
    public: {
      listMovieReviewsForYear: FunctionReference<
        "query",
        "public",
        { year: number },
        Array<{
          episode: {
            id: Id<"episodes">;
            number: number;
            slug: string | null;
            status: string | null;
            title: string;
          } | null;
          id: Id<"reviews">;
          movie: {
            id: Id<"movies">;
            poster: string | null;
            title: string;
            tmdbId: number | null;
            url: string;
            year: number;
          };
          rating: {
            category: string | null;
            icon: string | null;
            id: Id<"ratings">;
            name: string;
            sound: string | null;
            value: number;
          } | null;
          reviewedAt: number;
          user: {
            id: Id<"users">;
            image: string | null;
            name: string | null;
          } | null;
        }>
      >;
    };
  };
  sideEffects: {
    intents: {
      list: FunctionReference<
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
          status?:
            | "pending"
            | "processing"
            | "retryScheduled"
            | "succeeded"
            | "terminal";
        },
        {
          continueCursor: string;
          isDone: boolean;
          page: Array<{
            attemptCount: number;
            completedAt: number | null;
            createdAt: number;
            id: Id<"sideEffectIntents">;
            lastAttemptAt: number | null;
            lastErrorCode: string | null;
            nextAttemptAt: number | null;
            operation: "uploadthing.deleteFile";
            resourceId: string;
            resourceType:
              "episodeAudioMessage" | "assignmentAudioMessage" | "profileImage";
            status:
              | "pending"
              | "processing"
              | "retryScheduled"
              | "succeeded"
              | "terminal";
            updatedAt: number;
          }>;
          pageStatus?: "SplitRecommended" | "SplitRequired" | null;
          splitCursor?: string | null;
        }
      >;
      redrive: FunctionReference<
        "mutation",
        "public",
        {
          clientApiVersion: string;
          expectedStatus:
            | "pending"
            | "processing"
            | "retryScheduled"
            | "succeeded"
            | "terminal";
          expectedUpdatedAt: number;
          id: Id<"sideEffectIntents">;
        },
        {
          attemptCount: number;
          completedAt: number | null;
          createdAt: number;
          id: Id<"sideEffectIntents">;
          lastAttemptAt: number | null;
          lastErrorCode: string | null;
          nextAttemptAt: number | null;
          operation: "uploadthing.deleteFile";
          resourceId: string;
          resourceType:
            "episodeAudioMessage" | "assignmentAudioMessage" | "profileImage";
          status:
            | "pending"
            | "processing"
            | "retryScheduled"
            | "succeeded"
            | "terminal";
          updatedAt: number;
        }
      >;
    };
  };
  syllabus: {
    admin: {
      assignEpisode: FunctionReference<
        "mutation",
        "public",
        {
          assignmentType: string;
          clientApiVersion: string;
          episodeNumber: number;
          expected?: {
            assignmentId: Id<"assignments"> | null;
            createdAt: number;
            movieId: Id<"movies">;
            notes: string | null;
            order: number;
            userId: Id<"users">;
          };
          syllabusId: Id<"syllabusEntries">;
        },
        {
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
        }
      >;
      getById: FunctionReference<
        "query",
        "public",
        { id: Id<"syllabusEntries"> },
        {
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
        } | null
      >;
      listForUser: FunctionReference<
        "query",
        "public",
        { userId: Id<"users"> },
        Array<{
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
        }>
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
        }
      >;
      removeEntry: FunctionReference<
        "mutation",
        "public",
        {
          clientApiVersion: string;
          expected?: {
            assignmentId: Id<"assignments"> | null;
            createdAt: number;
            movieId: Id<"movies">;
            notes: string | null;
            order: number;
            userId: Id<"users">;
          };
          id: Id<"syllabusEntries">;
        },
        { id: Id<"syllabusEntries"> }
      >;
      reorderPendingForUser: FunctionReference<
        "mutation",
        "public",
        {
          clientApiVersion: string;
          items: Array<{ expectedOrder: number; id: Id<"syllabusEntries"> }>;
          userId: Id<"users">;
        },
        Array<{
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
        }>
      >;
      unlinkEpisode: FunctionReference<
        "mutation",
        "public",
        {
          clientApiVersion: string;
          expected?: {
            assignmentId: Id<"assignments"> | null;
            createdAt: number;
            movieId: Id<"movies">;
            notes: string | null;
            order: number;
            userId: Id<"users">;
          };
          syllabusId: Id<"syllabusEntries">;
        },
        {
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
        }
      >;
    };
    mine: {
      add: FunctionReference<
        "mutation",
        "public",
        {
          clientApiVersion: string;
          movieId: Id<"movies">;
          position?: "TOP" | "AFTER_NEXT" | "END";
        },
        {
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
        }
      >;
      list: FunctionReference<
        "query",
        "public",
        Record<string, never>,
        Array<{
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
        }>
      >;
      remove: FunctionReference<
        "mutation",
        "public",
        { clientApiVersion: string; id: Id<"syllabusEntries"> },
        { id: Id<"syllabusEntries"> }
      >;
      reorderPending: FunctionReference<
        "mutation",
        "public",
        {
          clientApiVersion: string;
          orderedPendingIds: Array<Id<"syllabusEntries">>;
        },
        { success: true }
      >;
      updateNotes: FunctionReference<
        "mutation",
        "public",
        {
          clientApiVersion: string;
          id: Id<"syllabusEntries">;
          notes: string | null;
        },
        {
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
        }
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
      administratorWriteGateProbe: FunctionReference<
        "mutation",
        "public",
        { clientApiVersion: string },
        null
      >;
      applicationWriteGateProbe: FunctionReference<
        "mutation",
        "public",
        { clientApiVersion: string },
        null
      >;
      memberWriteGateProbe: FunctionReference<
        "mutation",
        "public",
        { clientApiVersion: string },
        null
      >;
      pipelineWriteGateProbe: FunctionReference<
        "mutation",
        "public",
        { clientApiVersion: string },
        null
      >;
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
};
export type InternalApiType = {};
