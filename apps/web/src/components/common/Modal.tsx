import { Dialog } from "@headlessui/react"
import type { Dispatch, FC, ReactNode, SetStateAction } from "react"
import { HiX } from "react-icons/hi"
import { Button } from "../ui/button"

interface ModalProps {
	isOpen: boolean,
	openText?: string,
	titleText: string,
	children: ReactNode,
	setIsOpen: Dispatch<SetStateAction<boolean>>
}

const Modal: FC<ModalProps> = ({ isOpen, openText, titleText, children, setIsOpen }) => {
	
	return (
		<>
			{!isOpen && openText &&
				<Button
					onClick={() => setIsOpen(true)}
				>
					{openText}
				</Button>
			}
			
			<Dialog open={isOpen} onClose={() => setIsOpen(false)} className="relative z-50">
      <div className="fixed inset-0 bg-black/70" aria-hidden="true" />

				<div className="fixed inset-0 flex items-center justify-center p-4">
					<Dialog.Panel className="w-full self-center mx-auto max-w-sm rounded bg-gray-900 text-white">
						<Dialog.Title className="flex justify-between items-center px-2">
							{titleText}
							
							<HiX className="text-red-500 cursor-pointer" onClick={() => setIsOpen(false)} />
						</Dialog.Title>
						<div>{children}</div>
						
					</Dialog.Panel>
				</div>
			</Dialog>
		</>
	)
}

export default Modal