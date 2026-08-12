import { type FC } from "react";
import { HiOutlineClipboardList, HiOutlinePaperClip, HiOutlineStar } from "react-icons/hi"


interface HomeworkFlagProps {
  type: "HOMEWORK" | "EXTRA_CREDIT" | "BONUS",
	showText?: boolean
}

const HomeworkFlag: FC<HomeworkFlagProps> = ({type, showText = false}) => {
  return <>
    {type === "HOMEWORK" && <div className="sm:whitespace-nowrap">
      <HiOutlineClipboardList className="inline mx-1 text-xl text-gray-300" title="Homework" />
      {showText && <span className="hidden sm:inline">Homework</span>}
    </div>}
    {type === "EXTRA_CREDIT" && <div className="sm:whitespace-nowrap">
      <HiOutlinePaperClip className="inline mx-1 text-xl text-gray-300" title="Extra Credit" />
      {showText && <span className="hidden sm:inline">Extra Credit</span>}
    </div>}
    {type === "BONUS" && <div className="sm:whitespace-nowrap">
      <HiOutlineStar className="inline mx-1 text-xl text-gray-300" title="Bonus" />
      {showText && <span className="hidden sm:inline">Bonus</span>}
    </div>}
  </>
}

export default HomeworkFlag;