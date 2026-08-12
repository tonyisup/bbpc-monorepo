import { type FC } from "react";
import {
  HiOutlineClipboardList,
  HiOutlinePaperClip,
  HiOutlineStar,
} from "react-icons/hi";

interface HomeworkFlagProps {
  type: string;
}

const HomeworkFlag: FC<HomeworkFlagProps> = ({ type }) => {
  return (
    <>
      {type === "HOMEWORK" && (
        <div className="sm:whitespace-nowrap">
          <HiOutlineClipboardList
            className="mx-1 inline text-4xl text-gray-300"
            title="Homework"
          />
          <span className="hidden sm:inline">Homework</span>
        </div>
      )}
      {type === "EXTRA_CREDIT" && (
        <div className="sm:whitespace-nowrap">
          <HiOutlinePaperClip
            className="mx-1 inline text-4xl text-gray-300"
            title="Extra Credit"
          />
          <span className="hidden sm:inline">Extra Credit</span>
        </div>
      )}
      {type === "BONUS" && (
        <div className="sm:whitespace-nowrap">
          <HiOutlineStar
            className="mx-1 inline text-4xl text-gray-300"
            title="Bonus"
          />
          <span className="hidden sm:inline">Bonus</span>
        </div>
      )}
    </>
  );
};

export default HomeworkFlag;
