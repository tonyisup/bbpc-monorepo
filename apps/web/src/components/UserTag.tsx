import type { FC } from "react";
import type { EpisodeUser } from "@/types/episode";

interface UserTagProps {
  user: EpisodeUser | null;
}

const UserTag: FC<UserTagProps> = ({ user }) => {
  if (!user) return null;
  return (
    <span className="max-w-full self-center truncate rounded-lg px-2 py-1 text-gray-200 underline underline-offset-4 outline outline-2 outline-gray-500">
      {user.name}
    </span>
  );
};

export default UserTag;
