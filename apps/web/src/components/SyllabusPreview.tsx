import { type FC } from "react";
import Image from "next/image";
import Link from "next/link";

interface SyllabusPreviewMovie {
  id: string;
  title: string;
  poster: string | null;
  url: string;
}

interface SyllabusPreviewProps {
  count: number;
  syllabus: {
    movie: SyllabusPreviewMovie;
  }[];
}

const SyllabusPreview: FC<SyllabusPreviewProps> = ({ count, syllabus }) => {
  const totalMovies = syllabus.length;

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="text-lg">Available Movies: {count}</div>
      {totalMovies > 0 && (
        <div className="flex gap-4">
          {syllabus.map((item) => (
            <Link
              key={item.movie.id}
              href={item.movie.url}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:opacity-80"
            >
              {item.movie.poster && (
                <Image
                  unoptimized
                  className="rounded-lg"
                  src={item.movie.poster}
                  alt={item.movie.title}
                  width={100}
                  height={150}
                />
              )}
            </Link>
          ))}

          {count > 3 && (
            <div className="flex flex-col items-center justify-center">
              <p>
                <Link href="/syllabus">More...</Link>
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default SyllabusPreview;
