"use client";
import React, { useState, type FC } from "react";
import { Mic } from "lucide-react";
import dynamic from "next/dynamic";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "./ui/button";
import { useBbpcAuth } from "@/components/auth/BbpcAuthContext";

const ConvexVoiceMailRecorder = dynamic(
  () =>
    import("./ConvexVoiceMailRecorder").then(
      (module) => module.ConvexVoiceMailRecorder
    ),
  { ssr: false }
);

const LeaveMessage: FC = () => {
  const { signIn, user } = useBbpcAuth();
  const [isModalOpen, setIsModalOpen] = useState(false);

  if (user === null) {
    return (
      <Button
        variant="outline"
        aria-label="Log in to leave a message"
        className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 text-red-300 transition-colors hover:bg-red-500/20 hover:text-red-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
        onClick={signIn}
      >
        <MicrophoneIcon />
        <span className="hidden text-sm font-semibold lg:inline">
          Leave a message
        </span>
      </Button>
    );
  }

  return (
    <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          aria-label="Leave a message"
          className="p-1 hover:bg-transparent hover:text-accent"
          onClick={() => setIsModalOpen(true)}
        >
          <MicrophoneIcon />
          <span className="hidden text-sm font-semibold lg:inline">
            Leave a message
          </span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <DialogTitle className="text-xl font-bold">
            Leave a Message
          </DialogTitle>
        </DialogHeader>
        <ConvexVoiceMailRecorder enabled={isModalOpen} />
      </DialogContent>
    </Dialog>
  );
};

const MicrophoneIcon = () => {
  return (
    <div className="relative flex items-center justify-center">
      <Mic className="h-5 w-5" aria-hidden="true" />
    </div>
  );
};

export default LeaveMessage;
