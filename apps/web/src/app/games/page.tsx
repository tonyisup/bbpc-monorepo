import { permanentRedirect } from "next/navigation";

export default async function GamesPage() {
  permanentRedirect("/game");
}
