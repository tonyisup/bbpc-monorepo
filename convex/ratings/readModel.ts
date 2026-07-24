import type { Doc } from "../_generated/dataModel.js";

function nullable<T>(value: T | undefined): T | null {
  return value ?? null;
}

export function toRating(rating: Doc<"ratings">) {
  return {
    id: rating._id,
    name: rating.name,
    value: rating.value,
    sound: nullable(rating.sound),
    icon: nullable(rating.icon),
    category: nullable(rating.category),
  };
}
