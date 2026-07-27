export function parseNamedArguments(values) {
  if (!Array.isArray(values)) {
    throw new Error("Command arguments must be an array");
  }
  const parsed = new Map();
  for (let index = 0; index < values.length; index += 1) {
    const argument = values[index];
    if (
      typeof argument !== "string" ||
      !argument.startsWith("--") ||
      argument.length <= 2
    ) {
      throw new Error(
        `Unexpected positional argument ${String(argument)}`,
      );
    }
    const equalsIndex = argument.indexOf("=");
    if (equalsIndex > 2) {
      parsed.set(
        argument.slice(2, equalsIndex),
        argument.slice(equalsIndex + 1),
      );
      continue;
    }
    const name = argument.slice(2);
    const following = values[index + 1];
    if (
      typeof following === "string" &&
      !following.startsWith("--")
    ) {
      parsed.set(name, following);
      index += 1;
    } else {
      parsed.set(name, "");
    }
  }
  return parsed;
}
